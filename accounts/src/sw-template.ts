if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.1.1/workbox-sw.js'
    );

    
    if (workbox) {
        
        const { skipWaiting, clientsClaim } = workbox.core;
        
        const { precacheAndRoute, cleanupOutdatedCaches } = workbox.precaching;

        // skip waiting and switch to activating stage
        skipWaiting();
        // control webpage as soon as possible
        clientsClaim();
        // try to clean up old caches from previous versions
        cleanupOutdatedCaches();

        /* injection point for manifest files.  */
        
        precacheAndRoute(self.__WB_MANIFEST, { cleanUrls: false });
    } else {
        // eslint-disable-next-line no-console
        console.log('Workbox could not be loaded. No Offline support');
    }
}
