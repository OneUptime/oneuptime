if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.1.1/workbox-sw.js'
    );

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'workbox'.
    if (workbox) {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'workbox'.
        const { skipWaiting, clientsClaim } = workbox.core;
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'workbox'.
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property '__WB_MANIFEST' does not exist on type 'W... Remove this comment to see the full error message
        precacheAndRoute(self.__WB_MANIFEST, { cleanUrls: false });

        self.addEventListener('push', e => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Event'.
            const data = e.data.json();
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'registration' does not exist on type 'Wi... Remove this comment to see the full error message
            self.registration.showNotification(data.title, {
                body: data.body,
                icon:
                    'https://res.cloudinary.com/deityhub/image/upload/v1637736803/1png.png',
            });
        });
    } else {
        // eslint-disable-next-line no-console
        console.log('Workbox could not be loaded. No Offline support');
    }
}
