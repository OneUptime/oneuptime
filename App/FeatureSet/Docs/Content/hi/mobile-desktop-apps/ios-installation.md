# iOS Installation Guide

चलते-फिरते seamless monitoring के लिए OneUptime को अपने iPhone या iPad पर native app के रूप में install करें।

## Installation Methods

### Method 1: Safari (अनुशंसित)

Safari iOS devices पर सबसे अच्छा PWA experience प्रदान करता है।

1. **OneUptime को Safari में खोलें**
   - अपने iOS device पर Safari launch करें
   - अपने OneUptime instance URL पर जाएं
   - page पूरी तरह load होने का इंतज़ार करें
   - सुनिश्चित करें कि आप अपने OneUptime account में signed in हैं

2. **Share Menu Access करें**
   - bottom toolbar में **Share button** (ऊपर arrow के साथ square) पर tap करें
   - "Add to Home Screen" खोजने के लिए share options scroll करें

3. **Home Screen पर Add करें**
   - **"Add to Home Screen"** पर tap करें
   - app का नाम customize करें (default: "OneUptime")
   - top-right corner में **"Add"** पर tap करें

4. **App Launch करें**
   - अपनी home screen पर OneUptime icon खोजें
   - full-screen app mode में launch करने के लिए tap करें

### Method 2: Chrome Browser

Chrome काम करता है, लेकिन iOS PWA experience के लिए Safari अनुशंसित है।

1. **OneUptime को Chrome में खोलें**
   - Chrome browser launch करें
   - अपने OneUptime instance पर जाएं
   - page पूरी तरह load होने दें

2. **Home Screen पर Add करें**
   - **three-dot menu** (more options) पर tap करें
   - **"Add to Home Screen"** चुनें
   - यदि चाहें तो app का नाम customize करें
   - **"Add"** पर tap करें

### Method 3: अन्य Browsers

Firefox, Edge और अन्य browsers basic PWA installation का समर्थन करते हैं:

1. **OneUptime खोलें**
   - अपना पसंदीदा browser launch करें
   - OneUptime URL पर जाएं
   - page पूरी तरह load होने दें

2. **Install Option देखें**
   - "Add to Home Screen" या "Install" के लिए browser menu जांचें
   - browser-specific installation prompts का पालन करें

### Customization Options

### App Icon और Name
- **Custom Name**: installation के दौरान या बाद में बदलें
- **Icon Placement**: folders में या specific home screen pages पर organize करें
- **Badge Notifications**: unread incident count दिखाएं

### Notification Configuration
1. **Notifications सक्षम करें**
   - prompt होने पर notifications के लिए **"Allow"** पर tap करें
   - या Settings → Notifications → OneUptime पर जाएं
   - व्यापक monitoring के लिए सभी notification types सक्षम करें

2. **Alert Styles Customize करें**
   - **Lock Screen**: locked device पर incident alerts दिखाएं
   - **Banner Style**: temporary या persistent banners चुनें
   - **Sounds**: notification sounds और vibrations customize करें
   - **Critical Alerts**: high-priority incidents के लिए सक्षम करें (permission आवश्यक)

## समस्या निवारण

### Installation संबंधी समस्याएं

**"Add to Home Screen" दिखाई नहीं दे रहा:**
```
Solutions:
1. सुनिश्चित करें कि आप Safari उपयोग कर रहे हैं (सर्वोत्तम compatibility)
2. page refresh करें और 30 seconds इंतज़ार करें
3. जांचें कि आप सही OneUptime URL पर हैं
4. HTTPS connection सत्यापित करें (lock icon देखें)
5. Safari cache clear करें: Settings → Safari → Clear History and Website Data
```

**Installation पूरी होती है लेकिन icon नहीं दिखता:**
```
Solutions:
1. सभी home screen pages जांचें
2. App Library में देखें (last home screen page के बाद left swipe करें)
3. "OneUptime" खोजने के लिए Spotlight Search उपयोग करें
4. device restart करें और फिर जांचें
5. यदि आवश्यक हो तो Reinstall करें
```

**Launch पर App crash होता है:**
```
Solutions:
1. app force close करें और फिर खोलें
2. अपना iOS device restart करें
3. Safari cache clear करें और reinstall करें
4. सुनिश्चित करें कि iOS version 11.3 या अधिक है
5. device storage space खाली करें
```

### Notification संबंधी समस्याएं

**Push notifications नहीं मिल रहीं:**
```
इन settings जांचें:
1. Settings → Notifications → OneUptime → Allow Notifications
2. Settings → Screen Time → Content & Privacy Restrictions → Allowed Apps
3. Do Not Disturb settings
4. OneUptime dashboard में notification settings जांचें
5. OneUptime से sign out करें और वापस sign in करें
```

**Notifications delayed या missed हो रही हैं:**
```
Solutions:
1. background में app चलता रहने दें (force close न करें)
2. critical monitoring के दौरान Low Power Mode अक्षम करें
3. Background App Refresh जांचें: Settings → General → Background App Refresh
4. पर्याप्त storage space सुनिश्चित करें
```

## Uninstallation

### Home Screen से हटाएं
1. OneUptime app icon को **Long press** करें
2. **"Remove App"** पर tap करें
3. **"Delete App"** चुनें
4. deletion confirm करें

### Alternative Method
1. **Settings → General → iPhone Storage** पर जाएं
2. app list में **OneUptime** खोजें
3. **"Delete App"** पर tap करें
4. removal confirm करें

## iPad-Specific Installation

### बेहतर iPad Experience
1. **Larger Interface**: iPad screen sizes के लिए optimized layouts
2. **Multi-Window**: एक साथ कई OneUptime windows चलाएं
3. **Keyboard Shortcuts**: external keyboards के लिए full support
4. **Drag और Drop**: OneUptime और अन्य apps के बीच data move करें

### iPad Installation Steps
iPhone installation के समान, लेकिन additional considerations के साथ:
- optimal dashboard viewing के लिए landscape mode उपयोग करें
- अन्य productivity apps के साथ Split View setup पर विचार करें
- सामान्य actions के लिए keyboard shortcuts configure करें

## Updates और Maintenance

### Automatic Updates
- OneUptime PWA online होने पर स्वचालित रूप से update होता है
- कोई App Store updates आवश्यक नहीं
- server deployment के बाद नई features तुरंत उपलब्ध
- critical security updates तुरंत लागू

### Manual Refresh
app को force update करें:
1. Safari में OneUptime खोलें
2. pull down to refresh करें
3. App latest version download करेगा
4. नई features तुरंत उपलब्ध

## Security Recommendations
1. **URL Verify करें**: केवल अपने organization के official OneUptime instance से install करें
2. **HTTPS Only**: secure connection सुनिश्चित करें (lock icon देखें)
3. **Regular Updates**: security patches के लिए iOS updated रखें
4. **App Permissions**: केवल आवश्यक permissions grant करें
