#!/bin/bash

# Webpack to ESBuild Migration Cleanup Script
# This script removes webpack dependencies and configurations

echo "🧹 Starting webpack to esbuild migration cleanup..."

# Services to clean up
SERVICES=("Dashboard" "Accounts" "AdminDashboard" "StatusPage")

for service in "${SERVICES[@]}"; do
    echo "📦 Cleaning up $service..."
    
    if [ -d "./$service" ]; then
        cd "./$service"
        
        # Remove webpack configuration file
        if [ -f "webpack.config.js" ]; then
            echo "  🗑️  Removing webpack.config.js"
            rm webpack.config.js
        fi
        
        # Remove webpack-related dependencies
        echo "  📦 Removing webpack dependencies..."
        npm uninstall \
            webpack \
            webpack-bundle-analyzer \
            ts-loader \
            css-loader \
            style-loader \
            sass-loader \
            file-loader \
            cross-env \
            react-app-rewired 2>/dev/null || true
        
        # Clean up any webpack-related build artifacts
        if [ -d "dist" ]; then
            echo "  🗑️  Cleaning old dist directory"
            rm -rf dist
        fi
        
        cd ..
    else
        echo "  ⚠️  Directory $service not found, skipping..."
    fi
done

echo "✅ Webpack to esbuild migration cleanup completed!"
echo ""
echo "📝 Summary of changes:"
echo "  • Removed webpack.config.js files"
echo "  • Uninstalled webpack and related dependencies"
echo "  • Created esbuild.config.js configurations"
echo "  • Updated package.json build scripts"
echo ""
echo "🚀 You can now use the following commands:"
echo "  • npm run dev-build    - Development build"
echo "  • npm run build        - Production build"
echo "  • npm run build:watch  - Development build with watch mode"
echo "  • npm run analyze      - Production build with bundle analysis"
