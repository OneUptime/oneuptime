if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.1.1/workbox-sw.js'
    );

    if (workbox) {
        const { skipWaiting, clientsClaim }: $TSFixMe = workbox.core;

        const { precacheAndRoute, cleanupOutdatedCaches }: $TSFixMe = workbox.precaching;

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
            const data: $TSFixMe = e.data.json();

            self.registration.showNotification(data.title, {
                body: data.body,
                icon: 'https://res.cloudinary.com/deityhub/image/upload/v1637736803/1png.png',
            });
        });
    } else {
        //eslint-disable-next-line no-console
        console.log('Workbox could not be loaded. No Offline support');
    }
}
