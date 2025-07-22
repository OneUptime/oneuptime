/* eslint-disable no-restricted-globals */

// OneUptime Progressive Web App Service Worker
// Handles push notifications, caching, and offline functionality

const CACHE_NAME = 'oneuptime-v1.0.0';
const RUNTIME_CACHE = 'oneuptime-runtime';
const NOTIFICATION_CACHE = 'oneuptime-notifications';

// Resources to cache on install
const CORE_ASSETS = [
  '/dashboard/',
  '/dashboard/manifest.json',
  '/dashboard/assets/js/tailwind-3.4.5.js',
  '/dashboard/env.js',
  '/dashboard/dist/Index.js',
  '/dashboard/assets/img/favicons/android-chrome-192x192.png',
  '/dashboard/assets/img/favicons/android-chrome-512x512.png',
  '/dashboard/assets/img/favicons/favicon.ico'
];

// API routes that should be cached
const API_CACHE_PATTERNS = [
  /^\/api\/.*$/,
  /^\/identity\/.*$/,
  /^\/file\/.*$/
];

// Assets that should be cached with stale-while-revalidate strategy
const RUNTIME_CACHE_PATTERNS = [
  /^\/dashboard\/assets\/.*$/,
  /^\/dashboard\/dist\/.*$/,
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
  /\.(?:js|css)$/,
];

console.log('[ServiceWorker] OneUptime PWA Service Worker Loaded');

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
                cacheName !== RUNTIME_CACHE && 
                cacheName !== NOTIFICATION_CACHE) {
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

// Fetch event - implement caching strategies
self.addEventListener('fetch', function(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle API requests with network-first strategy
  if (API_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(
      networkFirstStrategy(request)
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
      networkFirstStrategy(request, '/dashboard/offline.html')
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

// Network-first caching strategy
function networkFirstStrategy(request, fallbackUrl = null) {
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
      return caches.match(request)
        .then(function(cachedResponse) {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // If fallback URL is provided and no cache hit, serve fallback
          if (fallbackUrl) {
            return caches.match(fallbackUrl);
          }
          
          // Return a basic offline response
          return new Response(
            JSON.stringify({ error: 'Offline - No cached response available' }),
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' }
            }
          );
        });
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

// Handle push subscription changes
self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[ServiceWorker] Push subscription changed:', event);
  
  // Re-subscribe to push notifications
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: null // This should be set by your application
    })
    .then(function(newSubscription) {
      console.log('[ServiceWorker] New push subscription:', newSubscription);
      // Send new subscription to your server
      return updatePushSubscription(newSubscription);
    })
    .catch(function(error) {
      console.error('[ServiceWorker] Failed to resubscribe to push:', error);
    })
  );
});

// Handle push notifications
self.addEventListener('push', function(event) {
  console.log('[ServiceWorker] Push received:', event);
  console.log('[ServiceWorker] Event data available:', !!event.data);
  
  if (event.data) {
    try {
      const dataText = event.data.text();
      console.log('[ServiceWorker] Raw push data:', dataText);
      
      const data = event.data.json();
      console.log('[ServiceWorker] Push data (parsed):', data);
      
      const options = {
        body: data.body,
        icon: data.icon || '/dashboard/assets/img/favicons/android-chrome-192x192.png',
        badge: data.badge || '/dashboard/assets/img/favicons/favicon-32x32.png',
        tag: data.tag || 'oneuptime-notification',
        requireInteraction: data.requireInteraction || false,
        actions: data.actions || [],
        data: data.data || {},
        silent: false,
        renotify: true,
        vibrate: [100, 50, 100],
        timestamp: Date.now()
      };

      console.log('[ServiceWorker] Showing notification with options:', options);

      event.waitUntil(
        self.registration.showNotification(data.title, options)
          .then(() => {
            console.log('[ServiceWorker] Notification shown successfully');
            // Cache notification for offline viewing
            return cacheNotification(data);
          })
          .catch((error) => {
            console.error('[ServiceWorker] Error showing notification:', error);
          })
      );
    } catch (error) {
      console.error('[ServiceWorker] Error parsing push data:', error);
      const rawData = event.data ? event.data.text() : 'No data';
      console.log('[ServiceWorker] Raw event data:', rawData);
      
      // Show fallback notification
      event.waitUntil(
        self.registration.showNotification('OneUptime Notification', {
          body: 'You have a new notification from OneUptime',
          icon: '/dashboard/assets/img/favicons/android-chrome-192x192.png',
          tag: 'oneuptime-fallback',
          data: { url: '/dashboard' }
        })
      );
    }
  } else {
    console.log('[ServiceWorker] Push event received but no data');
    
    // Show default notification
    event.waitUntil(
      self.registration.showNotification('OneUptime', {
        body: 'You have a new notification',
        icon: '/dashboard/assets/img/favicons/android-chrome-192x192.png',
        tag: 'oneuptime-default',
        data: { url: '/dashboard' }
      })
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
  console.log('[ServiceWorker] Notification clicked:', event.notification.tag);
  event.notification.close();

  const clickAction = event.action;
  const notificationData = event.notification.data || {};
  
  let targetUrl = '/dashboard';

  if (clickAction && notificationData[clickAction]) {
    // Handle action button clicks
    targetUrl = notificationData[clickAction].url || targetUrl;
  } else {
    // Handle main notification click
    targetUrl = notificationData.url || 
                notificationData.clickAction || 
                notificationData.link ||
                targetUrl;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Check if there's already a OneUptime window open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          const clientUrl = new URL(client.url);
          
          if (clientUrl.origin === self.location.origin && 'focus' in client) {
            // Navigate to the target URL and focus the window
            return client.navigate(targetUrl)
              .then(() => client.focus());
          }
        }
        
        // If no OneUptime window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
      .catch(function(error) {
        console.error('[ServiceWorker] Error handling notification click:', error);
      })
  );
});

// Handle notification close events
self.addEventListener('notificationclose', function(event) {
  console.log('[ServiceWorker] Notification closed:', event.notification.tag);
  
  // Optional: Send analytics or tracking data
  event.waitUntil(
    trackNotificationClose(event.notification.tag)
  );
});

// Handle background sync
self.addEventListener('sync', function(event) {
  console.log('[ServiceWorker] Background sync:', event.tag);
  
  if (event.tag === 'oneuptime-notifications') {
    event.waitUntil(syncOfflineNotifications());
  } else if (event.tag === 'oneuptime-data') {
    event.waitUntil(syncOfflineData());
  }
});

// Handle messages from the main thread
self.addEventListener('message', function(event) {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  } else if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearAllCaches());
  }
});

// Helper function to cache notifications
function cacheNotification(notificationData) {
  return caches.open(NOTIFICATION_CACHE)
    .then(function(cache) {
      const request = new Request('/notifications/' + Date.now(), {
        method: 'GET'
      });
      
      const response = new Response(JSON.stringify(notificationData), {
        headers: { 'Content-Type': 'application/json' }
      });
      
      return cache.put(request, response);
    })
    .catch(function(error) {
      console.error('[ServiceWorker] Error caching notification:', error);
    });
}

// Helper function to update push subscription
function updatePushSubscription(subscription) {
  return fetch('/api/push-subscription', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(subscription)
  })
  .catch(function(error) {
    console.error('[ServiceWorker] Error updating push subscription:', error);
  });
}

// Helper function to sync offline notifications
function syncOfflineNotifications() {
  return caches.open(NOTIFICATION_CACHE)
    .then(function(cache) {
      return cache.keys();
    })
    .then(function(requests) {
      return Promise.all(
        requests.map(function(request) {
          return syncNotification(request);
        })
      );
    })
    .catch(function(error) {
      console.error('[ServiceWorker] Error syncing offline notifications:', error);
    });
}

// Helper function to sync offline data
function syncOfflineData() {
  // Implement your offline data sync logic here
  return Promise.resolve();
}

// Helper function to sync individual notifications
function syncNotification(request) {
  return caches.open(NOTIFICATION_CACHE)
    .then(function(cache) {
      return cache.match(request);
    })
    .then(function(response) {
      if (response) {
        return response.json();
      }
    })
    .then(function(data) {
      if (data) {
        // Send notification data to server for processing
        return fetch('/api/notifications/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
      }
    })
    .catch(function(error) {
      console.error('[ServiceWorker] Error syncing notification:', error);
    });
}

// Helper function to track notification close events
function trackNotificationClose(tag) {
  return fetch('/api/analytics/notification-close', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tag: tag, timestamp: Date.now() })
  })
  .catch(function(error) {
    console.log('[ServiceWorker] Analytics tracking failed (offline):', error);
  });
}

// Helper function to clear all caches
function clearAllCaches() {
  return caches.keys()
    .then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    })
    .then(function() {
      console.log('[ServiceWorker] All caches cleared');
    });
}

console.log('[ServiceWorker] OneUptime PWA Service Worker Ready');
