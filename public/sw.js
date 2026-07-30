// Service Worker für webSSHadmin – bewusst minimal.
//
// Zweck ist ausschließlich die Installierbarkeit als PWA ("Zum Startbildschirm
// hinzufügen"), damit die App in einem eigenen Fenster ohne Browserleiste läuft.
// Es wird NICHTS gecacht: ein Terminal ist ohnehin nutzlos ohne Server, und ein
// Cache würde nach einem Deploy veraltete JS-Dateien auf den Geräten festhalten.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Alte Caches früherer Versionen aufräumen, falls je welche angelegt wurden
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', () => {
  // Kein respondWith() -> der Browser lädt ganz normal aus dem Netz.
});
