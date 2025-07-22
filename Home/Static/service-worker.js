
/* eslint-disable no-restricted-globals */

// OneUptime Home PWA Service Worker
// Handles mobile redirection for marketing site - no caching or offline functionality

console.log('[ServiceWorker] OneUptime Home PWA Service Worker Loaded');

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
// Mobile detection and redirection is handled server-side

// Handle messages from the main thread
self.addEventListener('message', function(event) {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: 'oneuptime-home-pwa-no-cache' });
  }
});

console.log('[ServiceWorker] OneUptime Home PWA Service Worker Ready');
