/* eslint-disable no-restricted-globals */

// OneUptime Progressive Web App Service Worker
// Handles push notifications only - no caching or offline functionality

console.log('[ServiceWorker] OneUptime PWA Service Worker Loaded');

// Install event - just skip waiting, no caching
self.addEventListener('install', function(event) {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(self.skipWaiting());
});

// Activate event - claim clients, no cache cleanup needed
self.addEventListener('activate', function(event) {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(self.clients.claim());
});

// No fetch event handling - let all requests go to network
// PWA will work entirely online without any caching

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
});

// Handle background sync - removed offline functionality
self.addEventListener('sync', function(event) {
  console.log('[ServiceWorker] Background sync:', event.tag);
  // Background sync events can still be handled but no offline caching
});

// Handle messages from the main thread
self.addEventListener('message', function(event) {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: 'oneuptime-pwa-no-cache' });
  }
});

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

console.log('[ServiceWorker] OneUptime PWA Service Worker Ready');
