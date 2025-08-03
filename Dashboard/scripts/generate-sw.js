#!/usr/bin/env node

/**
 * Dashboard Service Worker Generator
 * 
 * This script generates the Dashboard service worker from a template,
 * using the universal generator from Common/Scripts.
 */

const path = require('path');
const { generateServiceWorker } = require('../../Common/Scripts/generate-service-worker');

// Generate Dashboard service worker
const templatePath = path.join(__dirname, '..', 'sw.js.template');
const outputPath = path.join(__dirname, '..', 'public', 'sw.js');

try {
  generateServiceWorker(templatePath, outputPath, 'OneUptime Dashboard');
} catch (error) {
  console.error('❌ Failed to generate Dashboard service worker:', error.message);
  process.exit(1);
}
