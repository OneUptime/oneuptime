# Linux Installation Guide

Install OneUptime as a desktop application on Linux distributions for comprehensive monitoring and incident management.

## Installation Methods

### Method 1: Google Chrome/Chromium (Recommended)

Chrome and Chromium provide the best Linux PWA experience with native desktop integration.

#### PWA Installation Steps:
1. **Open OneUptime in Chrome/Chromium**
   - Launch your browser
   - Navigate to your OneUptime instance URL
   - Sign in to your OneUptime account
   - Wait for complete page loading

2. **Install PWA**
   - Look for **install icon** (⊞) in address bar
   - Click **"Install OneUptime"**
   - Or use **Chrome menu** (⋮) → **More tools** → **Create shortcut**

3. **Installation Options**
   - Check **"Open as window"** for native app experience
   - Customize app name if desired
   - Choose desktop shortcut creation
   - Click **"Install"** or **"Create"**

4. **Launch App**
   - Find OneUptime in application launcher
   - Or use desktop shortcut
   - App opens in dedicated window

### Method 2: Firefox

Firefox supports PWA installation on Linux with basic desktop integration.

1. **PWA Installation**:
   - Open OneUptime in Firefox
   - Look for installation banner or prompt
   - Click **"Install"** when available
   - Note: Limited desktop integration compared to Chrome

### Method 3: Microsoft Edge

Edge is available on Linux and provides good PWA support.

1. **Install PWA**: Follow same steps as Chrome method




## Updates and Maintenance

### Automatic Updates
OneUptime PWA updates automatically:
- Updates apply when browser refreshes the app
- Critical security updates deployed immediately
- No manual intervention required


## Uninstallation


### Browser-Specific Removal
```bash
# Chrome PWA management
google-chrome chrome://apps/

# Remove all OneUptime-related browser data
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Updates and Maintenance

### Automatic Updates
OneUptime PWA updates automatically:
- Updates apply when browser refreshes the app
- Critical security updates deployed immediately
- No manual intervention required

