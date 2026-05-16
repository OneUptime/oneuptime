# Android Installation Guide

सर्वोत्तम monitoring experience के लिए OneUptime को अपने Android device पर native app के रूप में install करें।

## Installation Methods

### Method 1: Chrome Browser (अनुशंसित)

1. **OneUptime को Chrome में खोलें**
   - अपने Android device पर Google Chrome launch करें
   - अपने OneUptime instance URL पर जाएं
   - page पूरी तरह load होने का इंतज़ार करें

2. **Install Prompt**
   - नीचे "Add to Home Screen" banner देखें
   - "Install" या "Add to Home Screen" पर tap करें
   - यदि prompt नहीं दिखाई दे, तो top-right corner में three-dot menu (⋮) पर tap करें

3. **Menu के माध्यम से Manual Installation**
   - Chrome menu (three dots) पर tap करें
   - "Add to Home Screen" या "Install App" चुनें
   - यदि चाहें तो app का नाम customize करें
   - confirm करने के लिए "Add" पर tap करें

4. **App Launch करें**
   - अपनी home screen या app drawer पर OneUptime icon खोजें
   - full-screen mode में app launch करने के लिए tap करें

### Method 2: Samsung Internet

1. **OneUptime खोलें**
   - Samsung Internet browser launch करें
   - अपने OneUptime instance पर जाएं
   - page पूरी तरह load होने का इंतज़ार करें

2. **Home Screen पर Add करें**
   - menu button (three lines) पर tap करें
   - "Add page to" → "Home screen" चुनें
   - app का नाम दर्ज करें और "Add" पर tap करें

3. **Launch करें**
   - अपनी home screen पर app icon खोजें
   - app mode में OneUptime खोलने के लिए tap करें

### Method 3: Firefox

1. **OneUptime खोलें**
   - Firefox browser launch करें
   - अपने OneUptime URL पर जाएं
   - page पूरी तरह load होने दें

2. **Install करें**
   - three-dot menu पर tap करें
   - "Install" चुनें (यदि उपलब्ध हो)
   - या "Add to Home Screen" चुनें
   - installation confirm करें

### Customization Options

### App Name
- installation के दौरान, आप app का नाम customize कर सकते हैं
- Default: "OneUptime"
- अनुशंसित: "OneUptime" रखें या अपनी company का नाम जोड़ें

### Notification Settings
1. **Permissions Grant करें**
   - जब पूछा जाए तो notifications की अनुमति दें
   - Settings → Apps → OneUptime → Notifications पर जाएं
   - सर्वोत्तम experience के लिए सभी notification categories सक्षम करें

2. **Alerts Customize करें**
   - configure करें कि कौन से incidents notifications trigger करते हैं
   - notification priority levels सेट करें
   - sound और vibration preferences चुनें

## समस्या निवारण

### Installation संबंधी समस्याएं

**"Add to Home Screen" दिखाई नहीं दे रहा:**
```
1. browser cache और cookies clear करें
2. सुनिश्चित करें कि आप HTTPS (secure connection) पर हैं
3. prompt देखने से पहले page पर 2-3 मिनट इंतज़ार करें
4. जांचें कि आपके OneUptime instance पर PWA requirements पूरी हैं
```

**Installation fail हो रहा है:**
```
1. storage space खाली करें (कम से कम 50MB चाहिए)
2. अपना browser latest version पर update करें
3. अपना browser restart करें और फिर कोशिश करें
4. दूसरा browser आज़माएं (Chrome अनुशंसित)
```

**App icon नहीं दिख रहा:**
```
1. home screen और app drawer जांचें
2. apps section में "Recently added" देखें
3. app drawer में "OneUptime" खोजें
4. यदि आवश्यक हो तो Reinstall करें
```

### Notification संबंधी समस्याएं

**Notifications नहीं मिल रही:**
```
1. notification permissions जांचें:
   - Settings → Apps → OneUptime → Permissions → Notifications
2. सुनिश्चित करें कि OneUptime dashboard में notifications सक्षम हैं
3. Do Not Disturb settings जांचें
4. सत्यापित करें कि battery optimization settings OneUptime को block नहीं कर रहीं
```

**Notifications delayed हो रही हैं:**
```
1. OneUptime के लिए battery optimization अक्षम करें:
   - Settings → Apps → OneUptime → Battery → Optimize battery usage
2. background activity की अनुमति दें
3. data saver settings जांचें
```

## Uninstallation

### App हटाएं
1. home screen पर OneUptime icon को **Long press** करें
2. **"Uninstall"** चुनें या trash में drag करें
3. removal confirm करें

### Alternative Method
1. **Settings → Apps** पर जाएं
2. **"OneUptime"** खोजें
3. **"Uninstall"** पर tap करें
4. removal confirm करें

## Updates और Maintenance

### Automatic Updates
OneUptime PWA स्वचालित रूप से update होता है:
- **Automatic Updates**: online होने पर visit करते समय App update होता है
- **No Manual Updates**: store apps के विपरीत, user action आवश्यक नहीं
- **Instant Updates**: नई features तुरंत उपलब्ध
- **Rollback Safe**: खराब updates को जल्दी revert किया जा सकता है

## Advanced Configuration

### Developer Options
उन advanced users के लिए जो PWA inspect करना चाहते हैं:
1. Android में Developer Options सक्षम करें
2. ADB के साथ computer से connect करें
3. remote debugging के लिए Chrome DevTools उपयोग करें

### Network Configuration
- internal OneUptime instance access करने के लिए VPN configure करें
- यदि आपके organization को आवश्यकता हो तो proxy settings सेट अप करें
- सुनिश्चित करें कि firewall PWA resources की अनुमति देता है

## Security Recommendations
1. **HTTPS Only**: केवल secure OneUptime instances से install करें
2. **Official URLs**: सत्यापित करें कि आप अपने organization के official OneUptime URL से install कर रहे हैं
3. **Permissions**: केवल आवश्यक permissions grant करें
4. **Updates**: अपने Android OS और browsers को अपडेट रखें
