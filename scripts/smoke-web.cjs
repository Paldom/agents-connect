// Headless smoke test of the web UI against the emulators. Run: node scripts/smoke-web.cjs
// Needs: emulators + `VITE_USE_EMULATORS=1 VITE_API_URL=... npm run dev` in web/. Creates (or reuses) owner@example.com / password123 in the Auth emulator.
// ponytail: borrows playwright from a sibling checkout via NODE_PATH so the repo stays dependency-free.
const { chromium } = require('playwright')
const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173'
const scope = 'ui' + Math.floor(Math.random() * 1e6)
;(async () => {
  // ensure the emulator user exists and is verified (the API rejects unverified emails)
  const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
  const creds = { email: 'owner@example.com', password: 'password123', returnSecureToken: true }
  const json = { 'content-type': 'application/json' }
  let r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: json, body: JSON.stringify(creds) }).then((x) => x.json())
  if (r.error) r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: json, body: JSON.stringify(creds) }).then((x) => x.json())
  if (!r.localId) throw new Error('emulator user setup failed: ' + JSON.stringify(r))
  await fetch(`${AUTH}/accounts:update?key=fake`, { method: 'POST', headers: { ...json, authorization: 'Bearer owner' }, body: JSON.stringify({ localId: r.localId, emailVerified: true }) })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  const shot = (n) => page.screenshot({ path: `/tmp/ac-smoke-${n}.png` })

  await page.goto(`${BASE}/login`)
  await page.fill('#email', 'owner@example.com')
  await page.fill('#password', 'password123')
  await page.click('button[type=submit]')
  await page.waitForURL(`${BASE}/`)
  await shot('1-scopes')

  await page.fill('[aria-label="New scope name"]', scope)
  await page.click('button:has-text("Create")')
  await page.waitForSelector(`a:has-text("${scope}")`)
  await page.click(`a:has-text("${scope}")`)
  await page.waitForURL(`${BASE}/s/${scope}`)

  // compose a notice on channel ops
  await page.fill('input[placeholder="alerts"]', 'ops')
  await page.locator('button[role=combobox]').first().click()
  await page.click('[role=option]:has-text("notice")')
  await page.fill('textarea', 'Disk usage at 91%')
  await page.click('button:has-text("Send")')
  await page.waitForSelector(`a:has-text("ops")`)
  await shot('2-channels')
  await page.click(`a:has-text("ops")`)
  await page.waitForURL(`${BASE}/s/${scope}/ops`)
  await page.waitForSelector('text=Disk usage at 91%')

  // compose a confirm question and answer it
  await page.locator('button[role=combobox]').first().click()
  await page.click('[role=option]:has-text("question")')
  await page.fill('textarea', 'Clean up old logs?')
  await page.click('button:has-text("Send")')
  await page.getByRole('button', { name: 'Yes', exact: true }).waitFor()
  await shot('3-question')
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  try {
    await page.waitForSelector('text=answered', { timeout: 15000 })
  } catch (e) {
    await shot('fail-answer')
    console.log('errors:', errors)
    console.log('toasts:', await page.locator('[data-sonner-toast]').allTextContents())
    console.log('cards:', await page.locator('[data-slot=card]').allTextContents())
    throw e
  }
  await shot('4-answered')

  // decision history lists the answered question
  await page.goto(`${BASE}/history`)
  await page.waitForSelector('text=Clean up old logs?')
  await page.waitForSelector('text=answered')
  await shot('4b-history')

  // inbox should now be empty of this question; tokens page
  await page.goto(`${BASE}/tokens`)
  await page.click('button:has-text("New token")')
  await page.fill('#tname', 'smoke-agent')
  // "All scopes" is checked by default
  await page.click('button[type=submit]:has-text("Create")')
  await page.getByText('Token created').waitFor()
  const token = await page.locator('input.font-mono[readonly]').inputValue()
  if (!token || !token.startsWith('ac_')) throw new Error('token not shown')
  await shot('5-token')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForSelector('text=smoke-agent')

  // settings
  await page.goto(`${BASE}/settings`)
  await page.waitForSelector('text=Email notifications')
  await shot('6-settings')

  const bad = errors.filter((e) => !/favicon|icon-192|Download the React DevTools|messaging\/unsupported/i.test(e))
  await browser.close()
  if (bad.length) {
    console.error('console errors:\n' + bad.join('\n'))
    process.exit(1)
  }
  console.log('SMOKE OK', { scope, token: token.slice(0, 10) + '…' })
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
