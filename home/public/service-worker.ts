'use strict';

const cacheName = 'OneUptime-home';
const filesToCache = [];

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  if (!event) { return }

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

  return self.clients.claim();
});
