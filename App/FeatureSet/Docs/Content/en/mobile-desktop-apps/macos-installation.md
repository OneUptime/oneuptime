# macOS Installation Guide

Install OneUptime as a native desktop application on macOS for seamless monitoring and incident management.

## Installation Methods

### Method 1: Safari (Recommended for macOS)

Safari provides excellent PWA integration with native macOS features.

1. **Open OneUptime in Safari**
   - Launch Safari browser
   - Navigate to your OneUptime instance URL
   - Sign in to your OneUptime account
   - Wait for the page to completely load

2. **Install PWA**
   - Click **File** in the menu bar
   - Select **"Add to Dock"** (macOS Sonoma+)
   - Or look for **install icon** in address bar
   - Alternatively: **File** → **"Add to Home Screen"** (older macOS)

3. **Customize Installation**
   - **App Name**: Modify if desired (default: OneUptime)
   - **Dock**: Choose to add to Dock
   - **Launchpad**: Add to Launchpad for easy access

4. **Launch App**
   - Find OneUptime in Dock, Launchpad, or Applications folder
   - Click to launch in dedicated window
   - App runs independently of Safari browser

### Method 2: Google Chrome

Chrome offers robust PWA support with excellent desktop integration.

1. **Open OneUptime in Chrome**
   - Launch Google Chrome
   - Go to your OneUptime instance
   - Ensure you're signed in
   - Allow complete page loading

2. **Install via Menu**
   - Look for **install icon** (⊞) in address bar
   - Click **"Install OneUptime"**
   - Or use **Chrome menu** → **More tools** → **Create shortcut**

3. **Installation Options**
   - Check **"Open as window"** for native app experience
   - Customize app name if needed
   - Click **"Install"** or **"Create"**

4. **Access App**
   - Find OneUptime in Applications folder
   - Or access via Spotlight search
   - Pin to Dock for quick access

### Method 3: Microsoft Edge

Edge provides solid PWA support with good macOS integration.

1. **Open OneUptime in Edge**
   - Launch Microsoft Edge
   - Navigate to OneUptime URL
   - Complete sign-in process

2. **Install App**
   - Click **three-dot menu** → **Apps** → **Install this site as an app**
   - Or look for install prompt in address bar
   - Customize app name if desired
   - Click **"Install"**

### Customization Options

### Dock and Launchpad
1. **Dock Position**: Drag OneUptime to preferred Dock position
2. **Dock Size**: Resize icon in Dock preferences
3. **Launchpad Organization**: Create monitoring app folder
4. **Badge Notifications**: Show incident count on Dock icon

### Menu Bar and Notifications
1. **Notification Center**
   - System Preferences → Notifications → OneUptime
   - Configure alert styles and delivery
   - Set priority levels for different incident types

2. **Menu Bar Integration**
   - Native menu bar for Safari PWAs
   - Custom menu items for frequent actions
   - Keyboard shortcuts for common tasks

## Troubleshooting

### Installation Issues

**"Add to Dock" not available in Safari:**
```
Solutions:
1. Ensure macOS Sonoma (14.0) or later
2. Update Safari to latest version
3. Try alternative: File → Add to Home Screen
4. Clear Safari cache and try again
5. Use Chrome or Edge as alternative
```

**PWA doesn't install or crashes:**
```
Solutions:
1. Check macOS version compatibility
2. Ensure sufficient disk space (100MB+)
3. Update browser to latest version
4. Clear browser cache and cookies
5. Temporarily disable browser extensions
6. Restart Mac and try installation again
```

**App not appearing in Applications:**
```
Solutions:
1. Check Launchpad for OneUptime icon
2. Search with Spotlight (⌘+Space)
3. Look in browser's PWA management section
4. Try reinstalling with different browser
5. Check if installed under different name
```

### Notification Issues

**macOS notifications not working:**
```
Solutions:
1. System Preferences → Notifications → OneUptime
2. Enable "Allow notifications"
3. Set appropriate alert style (banners/alerts)
4. Check Do Not Disturb settings
5. Verify OneUptime notification settings
6. Grant notification permissions when prompted
```

## Uninstallation

### Complete Removal
1. **Applications Folder Method**
   - Open Applications folder
   - Find OneUptime
   - Drag to Trash or right-click → Move to Trash

2. **Dock Method**
   - Right-click OneUptime in Dock
   - Select "Options" → "Remove from Dock"
   - Then delete from Applications folder

3. **Browser PWA Management**
   - **Chrome**: chrome://apps/ → Find OneUptime → Remove
   - **Edge**: edge://apps/ → Find OneUptime → Uninstall
   - **Safari**: No dedicated management page

## Updates and Maintenance

### Automatic Updates
- OneUptime PWA updates automatically when online
- No App Store updates required
- New features available immediately
- Critical updates applied instantly

## Troubleshooting

### Installation Issues

**"Add to Dock" not available in Safari:**
```
Solutions:
1. Ensure macOS Sonoma (14.0) or later
2. Update Safari to latest version
3. Try alternative: File → Add to Home Screen
4. Clear Safari cache and try again
5. Use Chrome or Edge as alternative
```

**PWA doesn't install or crashes:**
```
Solutions:
1. Check macOS version compatibility
2. Ensure sufficient disk space (100MB+)
3. Update browser to latest version
4. Clear browser cache and cookies
5. Temporarily disable browser extensions
6. Restart Mac and try installation again
```

**App not appearing in Applications:**
```
Solutions:
1. Check Launchpad for OneUptime icon
2. Search with Spotlight (⌘+Space)
3. Look in browser's PWA management section
4. Try reinstalling with different browser
5. Check if installed under different name
```

### Performance Issues

**Slow performance or high CPU usage:**
```
Solutions:
1. Check Activity Monitor for resource usage
2. Close unnecessary applications
3. Ensure adequate RAM (8GB+ recommended)
4. Update macOS and browser
5. Clear browser cache and app data
6. Restart OneUptime app
```

**Memory leaks or crashes:**
```
Solutions:
1. Monitor memory usage in Activity Monitor
2. Restart OneUptime app regularly
3. Update to latest browser version
4. Clear browser cache completely
5. Check Console app for error logs
6. Report issues with crash logs
```

### Display and Window Issues

**Window size or position problems:**
```
Solutions:
1. Manually resize and reposition window
2. Use Window menu → Zoom (Safari PWAs)
3. Reset window state by quitting and reopening
4. Check display scaling in System Preferences
5. Try different desktop space or full-screen mode
```

**App not responding:**
```
Solutions:
1. Force quit: ⌘+Option+Esc → Select OneUptime
2. Or right-click Dock icon → Force Quit
3. Restart the application
4. Check for macOS and browser updates
5. Clear app cache and reinstall if necessary
```

### Notification Issues

**macOS notifications not working:**
```
Solutions:
1. System Preferences → Notifications → OneUptime
2. Enable "Allow notifications"
3. Set appropriate alert style (banners/alerts)
4. Check Do Not Disturb settings
5. Verify OneUptime notification settings
6. Grant notification permissions when prompted
```

## Uninstallation

### Complete Removal
1. **Applications Folder Method**
   - Open Applications folder
   - Find OneUptime
   - Drag to Trash or right-click → Move to Trash

2. **Dock Method**
   - Right-click OneUptime in Dock
   - Select "Options" → "Remove from Dock"
   - Then delete from Applications folder

3. **Browser PWA Management**
   - **Chrome**: chrome://apps/ → Find OneUptime → Remove
   - **Edge**: edge://apps/ → Find OneUptime → Uninstall
   - **Safari**: No dedicated management page

### Clean Uninstallation
Remove all associated data:

```bash
# Clear Safari PWA data (general website data)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Clear Chrome PWA data
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Clear Edge PWA data
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Updates and Maintenance

### Automatic Updates
- OneUptime PWA updates automatically when online
- No App Store updates required
- New features available immediately
- Critical updates applied instantly

### Manual Update Process
Force update the application:
1. **Safari PWAs**: Refresh within Safari browser
2. **Chrome PWAs**: Right-click app → Reload or ⌘+R
3. **Complete Refresh**: Close app, reopen browser, visit OneUptime

### Maintenance Schedule
Regular maintenance for optimal performance:

**Weekly:**
- Restart OneUptime app
- Clear browser cache if experiencing issues
- Check for macOS updates

**Monthly:**
- Review storage usage and clean if needed
- Update browsers if not auto-updating
- Verify notification settings still work

## Integration with macOS Features

### Shortcuts App Integration
Create custom shortcuts for OneUptime:
1. Open **Shortcuts** app
2. Create **New Shortcut**
3. Add **"Open App"** action
4. Select **OneUptime**
5. Add to Siri for voice activation

### Automator Integration
Automate OneUptime tasks:
1. Launch **Automator**
2. Create **Application** or **Workflow**
3. Add **"Launch Application"** action
4. Select OneUptime PWA
5. Add additional automation steps

### Terminal Integration
Manage OneUptime through Terminal:

```bash
# Create alias for quick OneUptime launch
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Function to check if OneUptime is running
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Security and Privacy

### macOS Security Features
1. **Gatekeeper**: Ensure PWA installations are from trusted sources
2. **System Integrity Protection**: Protects system files
3. **FileVault**: Encrypt disk for data protection
4. **Keychain**: Secure credential storage

### Privacy Considerations
1. **Location Services**: Configure if needed for monitoring
2. **Camera/Microphone**: Grant permissions as required
3. **Screen Recording**: May be needed for certain monitoring features
4. **Network Access**: Ensure proper firewall configuration

### Best Practices
1. **Regular Updates**: Keep macOS and browsers updated
2. **Strong Authentication**: Use Touch ID/Face ID when available
3. **Network Security**: Use VPN for remote monitoring access
4. **Data Backup**: Regular Time Machine backups include PWA data
5. **Permission Review**: Regularly review granted permissions
