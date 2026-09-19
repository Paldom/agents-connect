# Self-hosting

The hub is a Firebase project: Auth (email/password), Firestore, one Cloud Function, Hosting, Cloud Messaging. The repository contains no project identifiers; everything specific to your deployment lives in three gitignored files, each with a committed `.example`:

| File | Holds |
|---|---|
| `.firebaserc` | your Firebase project id |
| `web/.env.local` | `VITE_FIREBASE_CONFIG` (the web app config JSON), `VITE_FIREBASE_VAPID_KEY` |
| `functions/.env.<project-id>` | `APP_URL`, `ALLOWED_EMAILS`, `SMTP_URL`, `SMTP_FROM` |

## 1. Create and provision the project

```bash
npm i -g firebase-tools@latest
firebase login
firebase projects:create <project-id> --display-name "Agents Connect"
cp .firebaserc.example .firebaserc && sed -i '' 's/<your-project-id>/<project-id>/' .firebaserc
firebase apps:create WEB "Agents Connect Web"
firebase apps:sdkconfig WEB <web-app-id>      # paste the JSON object into web/.env.local as VITE_FIREBASE_CONFIG='{...}'
firebase deploy --only auth                   # enables email/password (auth block in firebase.json)
firebase deploy --only firestore              # creates the database on first run, then rules and indexes
```

Hosting domains (`<project-id>.web.app`, `.firebaseapp.com`) are authorized for Auth automatically; add custom domains in the console.

## 2. Upgrade to Blaze and deploy the function

Cloud Functions need the Blaze (pay-as-you-go) plan. Link a billing account in the console, set a budget alert, then:

```bash
cp functions/.env.example functions/.env.<project-id>   # set APP_URL=https://<project-id>.web.app at least
cd functions && npm install && cd ..
firebase deploy --only functions
```

Without `SMTP_URL` email is skipped; push still works. `ALLOWED_EMAILS` restricts which verified accounts may use the hub.

## 3. Build and deploy the web app

```bash
cd web && npm install && npm run build && cd ..
firebase deploy --only hosting
```

Web push needs a VAPID key: Firebase console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair, then set `VITE_FIREBASE_VAPID_KEY` in `web/.env.local` and rebuild.

## 4. Create the first user

Sign-up is disabled in the apps. Create accounts with bcrypt + `auth:import`:

```bash
scripts/create-user.sh you@example.com
```

The script marks the email as verified; the API rejects unverified accounts. If you created the account in the Firebase console instead, sign in to the web app and use the **Send verification email** banner, open the link, then click **I have verified**. Then, in the console under Authentication → Settings → User actions, untick **Enable create (sign-up)** so nobody can register through the public Auth endpoint.

## 5. Retention

Enable a TTL policy on the `expiresAt` field of the `messages` collection group (Firestore console → TTL, or `gcloud firestore fields ttls update expiresAt --collection-group=messages --enable-ttl`). Messages are written with `expiresAt = createdAt + 90 days`. TTL is retention, not enforcement: rows may remain visible for up to a day after expiry.

## 6. Agents

```bash
npm i -g agents-connect
aconn login --api-url https://<project-id>.web.app/api   # token from the web app → Tokens
aconn init <scope> --subscribe build,deploy
aconn setup                                              # MCP entries + Claude Code hooks + AGENTS.md snippet
```

For Claude Code channel mode (pushed turns and permission relay) add the marketplace and start with the development flag while channels are in research preview:

```bash
claude plugin marketplace add Paldom/agents-connect   # or /plugin marketplace add in a session
claude --dangerously-load-development-channels plugin:agents-connect@paldom
```

## Local development

```bash
brew install openjdk@21                                  # emulators need Java 21
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
firebase emulators:start --only auth,firestore,functions # Firestore on 8090 (see firebase.json)
bash scripts/e2e-emulator.sh                             # CLI + API + MCP + channel mode end to end
cd web && VITE_USE_EMULATORS=1 VITE_API_URL=http://127.0.0.1:5001/<project-id>/europe-west1/api npm run dev
```

The scripts read the project id from `.firebaserc`. `NODE_PATH=<a checkout with playwright>/node_modules node scripts/smoke-web.cjs` drives the web UI headlessly, creating its own emulator user.
