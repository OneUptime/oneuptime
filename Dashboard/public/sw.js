/* eslint-disable no-restricted-globals */

// Service Worker for OneUptime Push Notifications

self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: data.icon || '/icon-192x192.png',
      badge: data.badge || '/badge-72x72.png',
      tag: data.tag || 'oneuptime-notification',
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || [],
      data: data.data || {},
      silent: false,
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
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
