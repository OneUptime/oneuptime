
/* eslint-disable no-restricted-globals */

// OneUptime Home PWA Service Worker
// Handles caching and mobile redirection for marketing site

const CACHE_NAME = 'oneuptime-home-v1.0.0';
const RUNTIME_CACHE = 'oneuptime-home-runtime';

// Resources to cache on install
const CORE_ASSETS = [
  '/',
  '/manifest.json',
  '/img/favicons/android-chrome-192x192.png',
  '/img/favicons/android-chrome-512x512.png',
  '/img/favicons/favicon.ico',
  '/css/bootstrap.min.css',
  '/js/bootstrap.min.js'
];

// Assets that should be cached with stale-while-revalidate strategy
const RUNTIME_CACHE_PATTERNS = [
  /^\/img\/.*$/,
  /^\/css\/.*$/,
  /^\/js\/.*$/,
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
  /\.(?:js|css)$/,
];

console.log('[ServiceWorker] OneUptime Home PWA Service Worker Loaded');

// Install event - cache core assets
self.addEventListener('install', function(event) {
  console.log('[ServiceWorker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[ServiceWorker] Caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
      .then(function() {
        console.log('[ServiceWorker] Core assets cached');
        return self.skipWaiting();
      })
      .catch(function(error) {
        console.error('[ServiceWorker] Install failed:', error);
        return self.skipWaiting(); // Continue anyway
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (cacheName !== CACHE_NAME && 
                cacheName !== RUNTIME_CACHE) {
              console.log('[ServiceWorker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(function() {
        console.log('[ServiceWorker] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event - implement caching strategies and mobile redirection
self.addEventListener('fetch', function(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Check if this is a mobile request to the home page
  if (url.pathname === '/' && request.mode === 'navigate') {
    event.respondWith(
      handleHomePageRequest(request)
    );
    return;
  }

  // Handle runtime assets with stale-while-revalidate strategy
  if (RUNTIME_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(
      staleWhileRevalidateStrategy(request)
    );
    return;
  }

  // Handle navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirstStrategy(request)
    );
    return;
  }

  // Default: try network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then(function(response) {
        // Clone the response for caching
        const responseClone = response.clone();
        
        // Cache successful responses
        if (response.status === 200) {
          caches.open(RUNTIME_CACHE)
            .then(function(cache) {
              cache.put(request, responseClone);
            });
        }
        
        return response;
      })
      .catch(function() {
        // Try to serve from cache on network failure
        return caches.match(request);
      })
  );
});

// Handle home page requests with mobile detection
function handleHomePageRequest(request) {
  return fetch(request)
    .then(function(response) {
      // Check if this is a mobile user agent
      const userAgent = request.headers.get('user-agent') || '';
      const isMobile = detectMobile(userAgent);
      
      if (isMobile) {
        console.log('[ServiceWorker] Mobile user detected, checking for dashboard redirect');
        
        // For mobile users, we'll let the server handle the redirect
        // but we can add logic here if needed
        return response;
      }
      
      // Cache the response for desktop users
      const responseClone = response.clone();
      if (response.status === 200) {
        caches.open(CACHE_NAME)
          .then(function(cache) {
            cache.put(request, responseClone);
          });
      }
      
      return response;
    })
    .catch(function() {
      // Try to serve from cache on network failure
      return caches.match(request)
        .then(function(cachedResponse) {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // Return a basic offline response
          return new Response(
            `<!DOCTYPE html>
            <html>
              <head>
                <title>OneUptime - Offline</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 50px; }
                  .offline { color: #666; }
                </style>
              </head>
              <body>
                <h1>OneUptime</h1>
                <p class="offline">You're currently offline. Please check your connection.</p>
                <button onclick="window.location.reload()">Try Again</button>
              </body>
            </html>`,
            {
              status: 200,
              headers: { 'Content-Type': 'text/html' }
            }
          );
        });
    });
}

// Network-first caching strategy
function networkFirstStrategy(request) {
  return fetch(request)
    .then(function(response) {
      // Clone the response for caching
      const responseClone = response.clone();
      
      // Cache successful responses
      if (response.status === 200) {
        caches.open(RUNTIME_CACHE)
          .then(function(cache) {
            cache.put(request, responseClone);
          });
      }
      
      return response;
    })
    .catch(function() {
      // Try to serve from cache on network failure
      return caches.match(request);
    });
}

// Stale-while-revalidate caching strategy
function staleWhileRevalidateStrategy(request) {
  return caches.open(RUNTIME_CACHE)
    .then(function(cache) {
      return cache.match(request)
        .then(function(cachedResponse) {
          // Fetch fresh version in background
          const fetchPromise = fetch(request)
            .then(function(networkResponse) {
              // Update cache with fresh version
              if (networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            });

          // Return cached version immediately if available
          return cachedResponse || fetchPromise;
        });
    });
}

// Mobile detection helper
function detectMobile(userAgent) {
  const mobilePatterns = [
    /Mobile/i,
    /Android/i,
    /iPhone/i,
    /iPad/i,
    /iPod/i,
    /BlackBerry/i,
    /Windows Phone/i,
    /Opera Mini/i,
    /IEMobile/i,
    /Mobile Safari/i
  ];
  
  return mobilePatterns.some(pattern => pattern.test(userAgent));
}

// Handle messages from the main thread
self.addEventListener('message', function(event) {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[ServiceWorker] OneUptime Home PWA Service Worker Ready');
