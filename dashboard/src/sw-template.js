/* eslint-disable */
if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.0.2/workbox-sw.js', './sw.js'
    );
    
    /* global workbox */
    if (workbox) {
        const {skipWaiting, clientsClaim} = workbox.core;
        const {precacheAndRoute, cleanupOutdatedCaches} = workbox.precaching;

        // skip waiting and switch to activating stage
        skipWaiting();
        // control webpage as soon as possible
        clientsClaim();
        // try to clean up old caches from previous versions
        cleanupOutdatedCaches();
        
        /* injection point for manifest files.  */
        precacheAndRoute([], {
            cleanURLs: false,
        });
    }
}
