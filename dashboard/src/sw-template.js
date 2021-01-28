/* eslint-disable */
if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.0.2/workbox-sw.js'
    );
    const {skipWaiting, clientsClaim, CacheNames} = workbox.core;
    const {precacheAndRoute} = workbox.precaching;

    self.cacheNames = CacheNames;
    console.log('******* cache names ********', CacheNames)

    /* global workbox */
    if (workbox) {
        skipWaiting();
        // clientsClaim();
        /* injection point for manifest files.  */
        precacheAndRoute([], {
            cleanURLs: false,
        });
    }
}
