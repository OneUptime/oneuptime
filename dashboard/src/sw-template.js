/* eslint-disable */
if ('function' === typeof importScripts) {
    importScripts(
        'https://storage.googleapis.com/workbox-cdn/releases/6.0.2/workbox-sw.js'
    );
    
    /* global workbox */
    if (workbox) {
        const {skipWaiting, clientsClaim} = workbox.core;
        const {precacheAndRoute, cleanupOutdatedCaches} = workbox.precaching;
        const {registerRoute} = workbox.routing;
        const {StaleWhileRevalidate, CacheFirst, NetworkFirst} = workbox.strategies;
        const {ExpirationPlugin} = workbox.expiration;
        const {CacheableResponse} = workbox.cacheableResponse;

        // skip waiting and switch to activating stage
        skipWaiting();
        // control webpage as soon as possible
        clientsClaim();
        // try to clean up old caches from previous versions
        cleanupOutdatedCaches();
        
        /* injection point for manifest files.  */
        precacheAndRoute(self.__WB_MANIFEST, {
            cleanURLs: false,
        });

        // java-script files cache
        registerRoute(
            new RegExp('.+\\.js$'),
            new StaleWhileRevalidate({
                cacheName: 'js-cache',
                plugins: [
                    new ExpirationPlugin({
                        maxEntries: 30,
                        maxAgeSeconds: 60 * 60 * 24 * 7,
                        purgeOnQuotaError: true,
                    }),
                    new CacheableResponsePlugin({
                        statuses: [0, 200],
                    }),
                ],
            }),
        );

        // css files cache
        registerRoute(
            new RegExp('.+\\.css$'),
            new StaleWhileRevalidate({
                cacheName: 'css-cache',
                plugins: [
                    new ExpirationPlugin({
                        maxEntries: 30,
                        maxAgeSeconds: 60 * 60 * 24 * 7,
                        purgeOnQuotaError: true,
                    }),
                    new CacheableResponsePlugin({
                        statuses: [0, 200],
                    }),
                ],
            }),
        );

        // image files cache
        registerRoute(
            new RegExp('.+\\.(png|jpg|jpeg|svg)$'),
            new CacheFirst({
                cacheName: 'images-cache',
                plugins: [
                    new ExpirationPlugin({
                        maxEntries: 60,
                        maxAgeSeconds: 60 * 60 * 24 * 7,
                        purgeOnQuotaError: true,
                    }),
                    new CacheableResponsePlugin({
                        statuses: [0, 200],
                    }),
                ],
            }),
        );

        registerRoute(
            new RegExp('/.*'),
            new NetworkFirst({}),
            'GET',
        );
    }
}
