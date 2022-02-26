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
        // @ts-expect-error ts-migrate(2339) FIXME: Property '__WB_MANIFEST' does not exist on type 'W... Remove this comment to see the full error message
        precacheAndRoute(self.__WB_MANIFEST, { cleanUrls: false });
    } else {
        // eslint-disable-next-line no-console
        console.log('Workbox could not be loaded. No Offline support');
    }
}
