'use strict';

const cacheName = 'Fyipe';
const filesToCache = [
    '/',
    '/assets/css/dashboard.css',
    '/assets/css/newdashboard.css',
    '/assets/css/sail.css',
];

self.addEventListener('install', function(event) {
    self.skipWaiting();
    event.waitUntil(
        caches.open(cacheName).then(function(cache) {
            return cache.addAll(filesToCache);
        })
    );
});

self.addEventListener('activate', function(event) {
    if (!event) {
        return;
    }
    return self.clients.claim();
});

self.addEventListener('fetch', event => {
    //To tell browser to evaluate the result of event
    event.respondWith(
        caches
            .match(event.request) //To match current request with cached request it
            .then(function(response) {
                //If response found return it, else fetch again.
                return response || fetch(event.request);
            })
    );
});
