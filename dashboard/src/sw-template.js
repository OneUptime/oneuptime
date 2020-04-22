/* eslint-disable */
if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/3.5.0/workbox-sw.js'
    );
    /* global workbox */
    if (workbox) {
        /* injection point for manifest files.  */
        workbox.precaching.precacheAndRoute([], {
            cleanURLs: false,
        });
    }
}
