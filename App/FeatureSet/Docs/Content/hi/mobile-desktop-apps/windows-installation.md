# Windows Installation Guide

व्यापक monitoring और incident management के लिए OneUptime को Windows पर desktop application के रूप में install करें।


## Installation Methods

### Method 1: Microsoft Edge (अनुशंसित)

Edge native features के साथ सबसे अच्छा Windows PWA integration प्रदान करता है।

1. **OneUptime को Edge में खोलें**
   - Microsoft Edge browser launch करें
   - अपने OneUptime instance URL पर जाएं
   - अपने OneUptime account में sign in करें
   - page पूरी तरह load होने का इंतज़ार करें

2. **App Install करें**
   - address bar में **install icon** (⊞) देखें
   - **"Install OneUptime"** button पर क्लिक करें
   - या **three-dot menu** → **Apps** → **Install this site as an app** पर क्लिक करें

3. **Installation Customize करें**
   - **App Name**: यदि चाहें तो modify करें (default: OneUptime)
   - **Start Menu**: Start Menu में add करने का विकल्प
   - **Taskbar**: taskbar पर pin करने का विकल्प
   - **Desktop**: desktop shortcut बनाएं

4. **Installation पूरी करें**
   - finish करने के लिए **"Install"** पर क्लिक करें
   - OneUptime अपनी window में खुलेगा
   - इसे Start Menu में installed apps के अंतर्गत खोजें

### Method 2: Google Chrome

Chrome rich desktop integration के साथ उत्कृष्ट PWA support प्रदान करता है।

1. **OneUptime को Chrome में खोलें**
   - Google Chrome launch करें
   - अपने OneUptime instance पर जाएं
   - सुनिश्चित करें कि signed in हैं
   - page पूरी तरह load होने दें

2. **Address Bar के माध्यम से Install करें**
   - address bar में **install icon** (⊞) देखें
   - **"Install OneUptime"** पर क्लिक करें
   - या menu उपयोग करें: **three dots** → **More tools** → **Create shortcut**

3. **Installation Options**
   - app-like experience के लिए **"Open as window"** चेक करें
   - यदि चाहें तो app का नाम customize करें
   - **"Install"** या **"Create"** पर क्लिक करें

4. **App Launch करें**
   - Windows Start Menu में OneUptime खोजें
   - या desktop shortcut से launch करें
   - App dedicated window में खुलता है

### Method 3: Firefox

Firefox basic desktop integration के साथ PWA installation का समर्थन करता है।

1. **OneUptime को Firefox में खोलें**
   - Firefox browser launch करें
   - OneUptime URL पर जाएं
   - sign-in process पूरी करें

2. **PWA Install करें**
   - **installation prompt** या banner देखें
   - या **menu** → **Install** पर क्लिक करें
   - यदि उपलब्ध हो, **"Add to Home Screen"** equivalent पर क्लिक करें


### Startup Configuration
1. **Auto-Start**: OneUptime को Windows के साथ start करने के लिए configure करें
   - taskbar पर right-click करें → Task Manager → Startup
   - यदि चाहें तो OneUptime सक्षम करें
2. **Default Size**: पसंदीदा window size और position सेट करें

### Notification Settings
1. **Windows Notifications**
   - Settings → System → Notifications & actions
   - OneUptime खोजें और alert preferences configure करें
   - incidents के लिए banner notifications सक्षम करें

2. **Focus Assist**
   - Do Not Disturb settings configure करें
   - OneUptime critical notifications की अनुमति दें
   - different alert types के लिए priority levels सेट करें

## समस्या निवारण

### Installation संबंधी समस्याएं

**Install button नहीं दिख रहा:**
```
Solutions:
1. सुनिश्चित करें कि आप Edge या Chrome उपयोग कर रहे हैं (अनुशंसित browsers)
2. OneUptime instance से HTTPS connection सत्यापित करें
3. browser cache और cookies clear करें
4. browser को latest version पर update करें
5. जांचें कि server पर PWA requirements पूरी हैं
6. browser extensions अस्थायी रूप से अक्षम करें
```

**Installation fail या crash होती है:**
```
Solutions:
1. browser को administrator के रूप में चलाएं
2. Windows User Account Control (UAC) settings जांचें
3. पर्याप्त disk space सुनिश्चित करें (minimum 100MB)
4. antivirus software अस्थायी रूप से अक्षम करें
5. browser data पूरी तरह clear करें
6. Windows restart करें और फिर कोशिश करें
```

**App Start Menu में नहीं दिख रहा:**
```
Solutions:
1. Windows search में "OneUptime" खोजें
2. जांचें कि दूसरे नाम से installed तो नहीं है
3. "Recently added" apps section देखें
4. Reinstall करें और सुनिश्चित करें कि "Add to Start Menu" checked है
5. यदि आवश्यक हो तो manually shortcut बनाएं
```

### Notification संबंधी समस्याएं

**Windows notifications काम नहीं कर रहीं:**
```
Solutions:
1. Windows Settings → System → Notifications & actions
2. OneUptime के लिए notifications सक्षम करें
3. Focus Assist settings जांचें
4. OneUptime में notification permissions सुनिश्चित करें
5. पहले simple notification से test करें
```

## Uninstallation

### पूर्ण Removal
1. **Windows Settings Method**
   - Settings → Apps → Apps & features
   - "OneUptime" खोजें
   - क्लिक करें और "Uninstall" चुनें

2. **Browser Method**
   - Edge/Chrome खोलें
   - edge://apps/ या chrome://apps/ पर जाएं
   - OneUptime खोजें
   - options → Uninstall पर क्लिक करें

3. **Start Menu Method**
   - Start Menu में OneUptime पर Right-click करें
   - "Uninstall" चुनें
   - removal confirm करें


## Updates और Maintenance

### Automatic Updates
- OneUptime PWA online होने पर स्वचालित रूप से update होता है
- कोई manual intervention आवश्यक नहीं
- restart पर Updates तुरंत लागू
- Critical patches तुरंत deployed
