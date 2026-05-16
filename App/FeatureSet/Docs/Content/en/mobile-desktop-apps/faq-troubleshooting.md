# FAQ and Troubleshooting

Frequently asked questions and solutions for OneUptime Mobile and Desktop Apps (PWA).

## General FAQ

### What is a Progressive Web App (PWA)?

A Progressive Web App is a web application that uses modern web technologies to deliver app-like experiences. PWAs can be installed directly from browsers without app stores, work offline, send push notifications, and integrate with your device's operating system.

### Why doesn't OneUptime use traditional app stores?

OneUptime uses PWA technology because it offers several advantages:
- **Instant Updates**: No waiting for app store approval or manual updates
- **Cross-Platform**: Single codebase works on all devices
- **No Download Size Limits**: Full features without size restrictions
- **Direct Distribution**: Install directly from your OneUptime instance
- **Always Latest**: Users always have the newest version
- **Security**: Same security benefits as web applications


### How much storage does OneUptime PWA use?

- **Initial Installation**: 10-20MB
- **Cache Growth**: 50-100MB with regular use
- **Maximum Cache**: Typically limited to 200MB by browsers
- **Auto-Cleanup**: Browsers automatically manage storage

### Does OneUptime PWA support push notifications?

Yes, OneUptime PWA supports rich push notifications:
- **Incident Alerts**: Real-time incident notifications
- **Status Updates**: Monitor status change alerts
- **Custom Triggers**: Configure notification rules
- **Rich Content**: Images, actions, and detailed information
- **Badge Updates**: Unread count on app icon

## Installation FAQ

### Why don't I see the "Install" button?

Common reasons and solutions:
1. **Browser Compatibility**: Use Chrome, Edge, or Safari
2. **HTTPS Required**: Ensure OneUptime instance uses HTTPS
3. **PWA Requirements**: Server must meet PWA manifest requirements
4. **Cache Issues**: Clear browser cache and reload
5. **Already Installed**: App may already be installed
6. **Wait Time**: Some browsers need 30+ seconds on page

### Can I install on multiple devices?

Yes! You can install OneUptime PWA on:
- Unlimited devices per user
- Multiple browsers on same device
- Different operating systems
- Shared/family devices (with separate accounts)

### How do I update the installed app?

OneUptime PWA updates automatically:
- **Automatic Updates**: App updates when you visit while online
- **Background Updates**: Updates download in background
- **Immediate Availability**: New features available instantly
- **No User Action**: Unlike store apps, no manual updates needed

### Can I customize the app name during installation?

Yes, during installation you can:
- Change the app name (default: "OneUptime")
- Add your organization name
- Use custom naming convention
- Modify icon label (platform dependent)

### How do I uninstall OneUptime PWA?

Uninstallation varies by platform:

**Android:**
- Long press app icon → Uninstall
- Settings → Apps → OneUptime → Uninstall

**iOS:**
- Long press app icon → Remove App → Delete App

**Windows:**
- Settings → Apps → OneUptime → Uninstall
- Right-click Start Menu item → Uninstall

**macOS:**
- Drag from Applications to Trash
- Right-click Dock icon → Remove

**Linux:**
- Remove from application launcher
- Delete .desktop file


## Notification FAQ

### Why am I not receiving notifications?

Common notification issues and fixes:

**Check Permissions:**
```
1. Browser notification permissions enabled
2. Operating system notification permissions
3. OneUptime notification settings configured
4. Do Not Disturb mode disabled
```

**Platform-Specific:**
- **Android**: Check battery optimization settings
- **iOS**: Verify notification settings in Settings app
- **Windows**: Check Focus Assist settings
- **macOS**: Verify notification center permissions
- **Linux**: Check notification daemon status

### Can I customize notification sounds?

Notification customization options:
- **System Sounds**: Use OS notification sound settings
- **Browser Settings**: Configure in browser notification preferences
- **OneUptime Settings**: Set notification preferences in dashboard
- **Priority Levels**: Configure different sounds for severity levels

### How do I disable notifications temporarily?

Temporary notification disable:
- **Do Not Disturb**: Enable system DND mode
- **Browser Settings**: Disable site notifications temporarily
- **OneUptime Dashboard**: Pause notifications in settings
- **Focus Modes**: Use OS focus/concentration modes

## Security FAQ

### Is OneUptime PWA secure?

Security features and considerations:
- **HTTPS Encryption**: All data transmitted securely
- **Same-Origin Policy**: Browser security restrictions apply
- **Sandboxed Environment**: Runs in browser security sandbox
- **Regular Updates**: Security patches applied automatically
- **No Root Access**: Limited system access compared to native apps


*Note: Sensitive data is encrypted and follows browser security standards.*

### Can I use OneUptime PWA on corporate networks?

Corporate network considerations:
- **Firewall Rules**: Ensure HTTPS (port 443) access
- **Proxy Configuration**: Configure browser proxy settings
- **Certificate Trust**: Install corporate certificates if needed
- **VPN Access**: Use VPN for remote access
- **Security Policies**: Comply with IT security requirements

## Troubleshooting

### Installation Problems

**Problem**: Installation button doesn't appear
```
Solutions:
1. Wait 30+ seconds on the OneUptime page
2. Refresh the page and wait again
3. Clear browser cache and cookies
4. Try different browser (Chrome/Edge recommended)
5. Verify HTTPS connection (check for lock icon)
6. Check if already installed
```

**Problem**: Installation fails or crashes
```
Solutions:
1. Ensure sufficient storage space (100MB+)
2. Close other browser tabs and applications
3. Update browser to latest version
4. Disable browser extensions temporarily
5. Try installation in private/incognito mode
6. Restart browser and try again
```

**Problem**: App installs but doesn't appear
```
Solutions:
1. Check all app launcher locations
2. Search for "OneUptime" in device search
3. Look in browser's app management section
4. Wait 1-2 minutes for system to refresh
5. Restart device and check again
```

**Problem**: App crashes frequently
```
Solutions:
1. Update browser to latest version
2. Clear all browser data for OneUptime
3. Disable browser extensions
4. Check available storage space
5. Restart operating system
6. Reinstall OneUptime PWA
```

**Problem**: Push notifications not working
```
Solutions:
1. Check notification permissions in browser
2. Verify system notification settings
3. Test with simple notification first
4. Clear notification data and re-grant permissions
5. Check Do Not Disturb/Focus mode settings
6. Verify OneUptime notification configuration
```

**Problem**: App doesn't sync latest data
```
Solutions:
1. Pull down to refresh (mobile)
2. Press Ctrl+F5 (Windows/Linux) or Cmd+R (Mac)
3. Close and reopen the app
4. Clear app cache and reload
5. Check network connectivity
```

### Platform-Specific Issues

**Android Issues:**
```
Problem: App not appearing in app drawer
Solution: Check "Recently added" apps section, search in app drawer

Problem: Notifications delayed
Solution: Disable battery optimization for browser app

Problem: App crashes on startup
Solution: Clear Chrome app data, restart device
```

**iOS Issues:**
```
Problem: Can't add to home screen
Solution: Use Safari browser, ensure iOS 11.3+

Problem: App icon missing
Solution: Check all home screen pages and App Library

Problem: Face ID not working
Solution: Enable Face ID for Safari in settings
```

**Windows Issues:**
```
Problem: App doesn't appear in Start Menu
Solution: Search for app name, check installed apps list

Problem: Notifications not showing
Solution: Check Windows notification settings, enable for browser

Problem: Window sizing issues
Solution: Manually resize, app will remember dimensions
```

**macOS Issues:**
```
Problem: Can't install via Safari
Solution: Update to macOS Sonoma+, use File → Add to Dock

Problem: App not in Applications folder
Solution: Check Launchpad, use Spotlight search

Problem: Notifications not working
Solution: Check System Preferences → Notifications
```

**Linux Issues:**
```
Problem: PWA install option missing
Solution: Use Chrome/Chromium, ensure desktop environment support

Problem: Icon not appearing in launcher
Solution: Update desktop database, check .desktop file

Problem: Audio notifications not working
Solution: Check PulseAudio, verify browser audio permissions
```

### Error Messages

**"This site cannot be installed"**
```
Causes:
- OneUptime instance doesn't meet PWA requirements
- Missing or invalid web app manifest
- HTTPS not properly configured
- Browser doesn't support PWA installation

Solutions:
- Contact administrator to verify PWA setup
- Try different browser
- Check browser console for detailed errors
```
