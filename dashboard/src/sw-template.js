/* eslint-disable */
if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.1.1/workbox-sw.js'
    );

    /* global workbox */
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
        // precacheAndRoute([], {
        //     cleanURLs: false,
        // });
        precacheAndRoute(self.__WB_MANIFEST, { cleanUrls: false });

        self.addEventListener('push', e => {
            const data = e.data.json();
            self.registration.showNotification(data.title, {
                body: data.body,
                icon:
                    'https://www.dropbox.com/s/dwawm02f1toxnm8/Fyipe-Icon.png?dl=0&raw=1',
            });
        });
    } else {
        console.log('Workbox could not be loaded. No Offline support');
    }
}
