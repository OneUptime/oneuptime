/* eslint-disable no-restricted-globals */

// Service Worker for OneUptime Push Notifications

console.log('[ServiceWorker] OneUptime Push Notifications Service Worker Loaded');

// Test the service worker is working
self.addEventListener('install', function(event) {
  console.log('[ServiceWorker] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(self.clients.claim());
});

// Add error logging for push subscription
self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[ServiceWorker] Push subscription changed:', event);
});

self.addEventListener('push', function(event) {
  console.log('[ServiceWorker] Push received:', event);
  console.log('[ServiceWorker] Event type:', typeof event);
  console.log('[ServiceWorker] Event data available:', !!event.data);
  
  if (event.data) {
    try {
      const dataText = event.data.text();
      console.log('[ServiceWorker] Raw push data (text):', dataText);
      
      const data = event.data.json();
      console.log('[ServiceWorker] Push data (parsed):', data);
      
      const options = {
        body: data.body,
        icon: data.icon || '/icon-192x192.png',
        badge: data.badge || '/badge-72x72.png',
        tag: data.tag || 'oneuptime-notification',
        requireInteraction: data.requireInteraction || false,
        actions: data.actions || [],
        data: data.data || {},
        silent: false,
        renotify: true, // Allow renotification with same tag
      };

      console.log('[ServiceWorker] Showing notification with options:', options);

      event.waitUntil(
        self.registration.showNotification(data.title, options)
          .then(() => {
            console.log('[ServiceWorker] Notification shown successfully');
          })
          .catch((error) => {
            console.error('[ServiceWorker] Error showing notification:', error);
          })
      );
    } catch (error) {
      console.error('[ServiceWorker] Error parsing push data:', error);
      const rawData = event.data ? event.data.text() : 'No data';
      console.log('[ServiceWorker] Raw event data:', rawData);
      
      // Show a fallback notification
      event.waitUntil(
        self.registration.showNotification('OneUptime Notification', {
          body: 'You have a new notification (fallback)',
          icon: '/icon-192x192.png',
          tag: 'oneuptime-fallback'
        })
      );
    }
  } else {
    console.log('[ServiceWorker] Push event received but no data');
    
    // Show a fallback notification when no data is provided
    event.waitUntil(
      self.registration.showNotification('OneUptime Notification', {
        body: 'You have a new notification (no data)',
        icon: '/icon-192x192.png',
        tag: 'oneuptime-fallback'
      })
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action) {
    // Handle action button clicks
    const actionData = event.notification.data[event.action];
    if (actionData && actionData.url) {
      event.waitUntil(
        clients.openWindow(actionData.url)
      );
    }
  } else {
    // Handle main notification click
    const url = event.notification.data.url || 
                event.notification.data.clickAction || 
                event.notification.data.link ||
                '/';
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        // Check if there's already a OneUptime window open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes('oneuptime') && 'focus' in client) {
            // Navigate to the notification URL and focus the window
            client.navigate(url);
            return client.focus();
          }
        }
        
        // If no OneUptime window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
    );
  }
});

self.addEventListener('notificationclose', function(event) {
  // Optional: Track notification close events
  console.log('Notification closed:', event.notification.tag);
});

// Handle background sync for offline notifications (optional)
self.addEventListener('sync', function(event) {
  if (event.tag === 'oneuptime-notifications') {
    event.waitUntil(
      // Could implement offline notification handling here
      Promise.resolve()
    );
  }
});

// Keep the service worker alive
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
