// Only here to show "should I run?" notifications (phones' browsers show them only from a service
// worker) and to bring the map back when one is tapped. It doesn't cache or touch any requests.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => 'focus' in w);
      return open ? open.focus() : self.clients.openWindow('/');
    }),
  );
});
