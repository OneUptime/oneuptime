#!/bin/bash

# Development Service Worker Generation Script
# 
# This script can be used during local development to test
# the service worker generation with sample environment variables

echo "🔧 Generating service worker for local development..."

# Set sample environment variables for testing
export APP_VERSION="1.0.0-dev"
export GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "local-dev")

echo "Using APP_VERSION: $APP_VERSION"
echo "Using GIT_SHA: $GIT_SHA"

# Generate the service worker
node scripts/generate-sw.js

echo "✅ Service worker generated for development"
echo "🔍 Check public/sw.js to see the generated file"
