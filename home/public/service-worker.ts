

const cacheName = 'OneUptime-home';
const filesToCache = [];

self.addEventListener('install', function (event) {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'skipWaiting' does not exist on type 'Win... Remove this comment to see the full error message
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  if (!event) { return }

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'waitUntil' does not exist on type 'Event... Remove this comment to see the full error message
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.filter(function (cacheName) {
          // return true if you want to delete this cache. 
          return true; 
        }).map(function (cacheName) {
          return caches.delete(cacheName);
        })
      );
    })
  );

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'clients' does not exist on type 'Window ... Remove this comment to see the full error message
  return self.clients.claim();
});
