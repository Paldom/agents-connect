/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

// The page registers this worker as /firebase-messaging-sw.js?config=<url-encoded JSON web config>.
firebase.initializeApp(JSON.parse(new URL(self.location).searchParams.get('config')))

const messaging = firebase.messaging()
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {}
  self.registration.showNotification(n.title || 'agents-connect', {
    body: n.body,
    icon: '/icon-192.png',
    data: payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const d = event.notification.data || {}
  const url = d.scope && d.channel ? `/s/${d.scope}/${d.channel}` : '/'
  event.waitUntil(clients.openWindow(url))
})
