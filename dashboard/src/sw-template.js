/* eslint-disable */
if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.0.2/workbox-sw.js'
    );
    
    /* global workbox */
    if (workbox) {
        const {skipWaiting} = workbox.core;
        const {precacheAndRoute, cleanupOutdatedCaches} = workbox.precaching;

        skipWaiting();
        cleanupOutdatedCaches();
        /* injection point for manifest files.  */
        precacheAndRoute([], {
            cleanURLs: false,
        });
    }
}
