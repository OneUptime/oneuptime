# macOS Installation Guide

seamless monitoring और incident management के लिए OneUptime को macOS पर native desktop application के रूप में install करें।

## Installation Methods

### Method 1: Safari (macOS के लिए अनुशंसित)

Safari native macOS features के साथ उत्कृष्ट PWA integration प्रदान करता है।

1. **OneUptime को Safari में खोलें**

   - Safari browser launch करें
   - अपने OneUptime instance URL पर जाएं
   - अपने OneUptime account में sign in करें
   - page पूरी तरह load होने का इंतज़ार करें

2. **PWA Install करें**

   - menu bar में **File** पर क्लिक करें
   - **"Add to Dock"** चुनें (macOS Sonoma+)
   - या address bar में **install icon** देखें
   - वैकल्पिक रूप से: **File** → **"Add to Home Screen"** (पुराना macOS)

3. **Installation Customize करें**

   - **App Name**: यदि चाहें तो modify करें (default: OneUptime)
   - **Dock**: Dock में add करने का विकल्प
   - **Launchpad**: आसान पहुंच के लिए Launchpad में add करें

4. **App Launch करें**
   - Dock, Launchpad या Applications folder में OneUptime खोजें
   - dedicated window में launch करने के लिए क्लिक करें
   - App Safari browser से स्वतंत्र रूप से चलता है

### Method 2: Google Chrome

Chrome उत्कृष्ट desktop integration के साथ robust PWA support प्रदान करता है।

1. **OneUptime को Chrome में खोलें**

   - Google Chrome launch करें
   - अपने OneUptime instance पर जाएं
   - सुनिश्चित करें कि signed in हैं
   - page पूरी तरह load होने दें

2. **Menu के माध्यम से Install करें**

   - address bar में **install icon** (⊞) देखें
   - **"Install OneUptime"** पर क्लिक करें
   - या **Chrome menu** → **More tools** → **Create shortcut** उपयोग करें

3. **Installation Options**

   - native app experience के लिए **"Open as window"** चेक करें
   - यदि आवश्यक हो तो app का नाम customize करें
   - **"Install"** या **"Create"** पर क्लिक करें

4. **App Access करें**
   - Applications folder में OneUptime खोजें
   - या Spotlight search के माध्यम से access करें
   - quick access के लिए Dock में pin करें

### Method 3: Microsoft Edge

Edge solid macOS integration के साथ PWA support प्रदान करता है।

1. **OneUptime को Edge में खोलें**

   - Microsoft Edge launch करें
   - OneUptime URL पर जाएं
   - sign-in process पूरी करें

2. **App Install करें**
   - **three-dot menu** → **Apps** → **Install this site as an app** पर क्लिक करें
   - या address bar में install prompt देखें
   - यदि चाहें तो app का नाम customize करें
   - **"Install"** पर क्लिक करें

### Customization Options

### Dock और Launchpad

1. **Dock Position**: OneUptime को पसंदीदा Dock position पर drag करें
2. **Dock Size**: Dock preferences में icon resize करें
3. **Launchpad Organization**: monitoring app folder बनाएं
4. **Badge Notifications**: Dock icon पर incident count दिखाएं

### Menu Bar और Notifications

1. **Notification Center**

   - System Preferences → Notifications → OneUptime
   - alert styles और delivery configure करें
   - different incident types के लिए priority levels सेट करें

2. **Menu Bar Integration**
   - Safari PWAs के लिए native menu bar
   - frequent actions के लिए custom menu items
   - common tasks के लिए keyboard shortcuts

## समस्या निवारण

### Installation संबंधी समस्याएं

**Safari में "Add to Dock" उपलब्ध नहीं:**

```
Solutions:
1. macOS Sonoma (14.0) या बाद का सुनिश्चित करें
2. Safari को latest version पर update करें
3. alternative आज़माएं: File → Add to Home Screen
4. Safari cache clear करें और फिर कोशिश करें
5. Chrome या Edge को alternative के रूप में उपयोग करें
```

**PWA install नहीं होता या crash होता है:**

```
Solutions:
1. macOS version compatibility जांचें
2. पर्याप्त disk space सुनिश्चित करें (100MB+)
3. browser को latest version पर update करें
4. browser cache और cookies clear करें
5. browser extensions अस्थायी रूप से अक्षम करें
6. Mac restart करें और installation फिर कोशिश करें
```

**App Applications में नहीं दिख रहा:**

```
Solutions:
1. OneUptime icon के लिए Launchpad जांचें
2. Spotlight के साथ खोजें (⌘+Space)
3. browser के PWA management section में देखें
4. दूसरे browser के साथ reinstall करें
5. जांचें कि दूसरे नाम से installed तो नहीं है
```

### Notification संबंधी समस्याएं

**macOS notifications काम नहीं कर रहीं:**

```
Solutions:
1. System Preferences → Notifications → OneUptime
2. "Allow notifications" सक्षम करें
3. उचित alert style सेट करें (banners/alerts)
4. Do Not Disturb settings जांचें
5. OneUptime notification settings सत्यापित करें
6. prompt होने पर notification permissions grant करें
```

## Uninstallation

### पूर्ण Removal

1. **Applications Folder Method**

   - Applications folder खोलें
   - OneUptime खोजें
   - Trash पर drag करें या right-click → Move to Trash

2. **Dock Method**

   - Dock में OneUptime पर Right-click करें
   - "Options" → "Remove from Dock" चुनें
   - फिर Applications folder से delete करें

3. **Browser PWA Management**
   - **Chrome**: chrome://apps/ → OneUptime खोजें → Remove
   - **Edge**: edge://apps/ → OneUptime खोजें → Uninstall
   - **Safari**: कोई dedicated management page नहीं

### Clean Uninstallation

सभी associated data हटाएं:

```bash
# Safari PWA data clear करें (general website data)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Chrome PWA data clear करें
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Edge PWA data clear करें
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Updates और Maintenance

### Automatic Updates

- OneUptime PWA online होने पर स्वचालित रूप से update होता है
- कोई App Store updates आवश्यक नहीं
- नई features तुरंत उपलब्ध
- Critical updates तुरंत लागू

### Manual Update Process

application को force update करें:

1. **Safari PWAs**: Safari browser के भीतर refresh करें
2. **Chrome PWAs**: app पर right-click करें → Reload या ⌘+R
3. **Complete Refresh**: app बंद करें, browser फिर खोलें, OneUptime पर जाएं

## macOS Features के साथ Integration

### Terminal Integration

Terminal के माध्यम से OneUptime प्रबंधित करें:

```bash
# quick OneUptime launch के लिए alias बनाएं
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# जांचने के लिए function कि OneUptime चल रहा है
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Security और Privacy

### macOS Security Features

1. **Gatekeeper**: सुनिश्चित करें कि PWA installations trusted sources से हैं
2. **System Integrity Protection**: system files की रक्षा करता है
3. **FileVault**: data protection के लिए disk encrypt करें
4. **Keychain**: secure credential storage

### Security Best Practices

1. **Regular Updates**: macOS और browsers updated रखें
2. **Strong Authentication**: उपलब्ध होने पर Touch ID/Face ID उपयोग करें
3. **Network Security**: remote monitoring access के लिए VPN उपयोग करें
4. **Permission Review**: दी गई permissions नियमित रूप से review करें
