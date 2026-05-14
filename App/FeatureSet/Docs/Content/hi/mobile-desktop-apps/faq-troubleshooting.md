# FAQ और Troubleshooting

OneUptime Mobile और Desktop Apps (PWA) के लिए अक्सर पूछे जाने वाले प्रश्न और समाधान।

## सामान्य FAQ

### Progressive Web App (PWA) क्या है?

एक Progressive Web App एक web application है जो app-like experiences deliver करने के लिए modern web technologies का उपयोग करती है। PWAs को app stores के बिना सीधे browsers से install किया जा सकता है, offline काम करते हैं, push notifications भेजते हैं और आपके device के operating system के साथ integrate होते हैं।

### OneUptime पारंपरिक app stores का उपयोग क्यों नहीं करता?

OneUptime PWA technology उपयोग करता है क्योंकि यह कई फायदे प्रदान करती है:
- **Instant Updates**: app store approval या manual updates का इंतज़ार नहीं
- **Cross-Platform**: एक codebase सभी devices पर काम करता है
- **No Download Size Limits**: size restrictions के बिना full features
- **Direct Distribution**: अपने OneUptime instance से सीधे install करें
- **Always Latest**: Users हमेशा नवीनतम version पर होते हैं
- **Security**: web applications के समान security benefits


### OneUptime PWA कितना storage उपयोग करता है?

- **Initial Installation**: 10-20MB
- **Cache Growth**: नियमित उपयोग के साथ 50-100MB
- **Maximum Cache**: आमतौर पर browsers द्वारा 200MB तक सीमित
- **Auto-Cleanup**: Browsers storage स्वचालित रूप से प्रबंधित करते हैं

### क्या OneUptime PWA push notifications का समर्थन करता है?

हाँ, OneUptime PWA rich push notifications का समर्थन करता है:
- **Incident Alerts**: Real-time incident notifications
- **Status Updates**: Monitor status change alerts
- **Custom Triggers**: notification rules configure करें
- **Rich Content**: Images, actions और विस्तृत जानकारी
- **Badge Updates**: app icon पर unread count

## Installation FAQ

### मुझे "Install" button क्यों नहीं दिख रहा?

सामान्य कारण और समाधान:
1. **Browser Compatibility**: Chrome, Edge या Safari उपयोग करें
2. **HTTPS Required**: सुनिश्चित करें कि OneUptime instance HTTPS उपयोग करता है
3. **PWA Requirements**: Server को PWA manifest requirements पूरी करनी चाहिए
4. **Cache Issues**: browser cache clear करें और reload करें
5. **Already Installed**: App पहले से installed हो सकता है
6. **Wait Time**: कुछ browsers को page पर 30+ seconds चाहिए

### क्या मैं कई devices पर install कर सकता हूं?

हाँ! आप OneUptime PWA install कर सकते हैं:
- प्रति user असीमित devices पर
- एक ही device पर कई browsers में
- विभिन्न operating systems पर
- Shared/family devices पर (अलग accounts के साथ)

### installed app को कैसे update करूं?

OneUptime PWA स्वचालित रूप से update होता है:
- **Automatic Updates**: online होने पर visit करते समय App update होता है
- **Background Updates**: Updates background में download होते हैं
- **Immediate Availability**: नई features तुरंत उपलब्ध
- **No User Action**: store apps के विपरीत, manual updates आवश्यक नहीं

### क्या मैं installation के दौरान app का नाम customize कर सकता हूं?

हाँ, installation के दौरान आप कर सकते हैं:
- app का नाम बदलें (default: "OneUptime")
- अपने organization का नाम जोड़ें
- custom naming convention उपयोग करें
- icon label modify करें (platform dependent)

### OneUptime PWA कैसे uninstall करूं?

Uninstallation platform के अनुसार अलग होती है:

**Android:**
- app icon long press करें → Uninstall
- Settings → Apps → OneUptime → Uninstall

**iOS:**
- app icon long press करें → Remove App → Delete App

**Windows:**
- Settings → Apps → OneUptime → Uninstall
- Start Menu item पर Right-click → Uninstall

**macOS:**
- Applications से Trash पर drag करें
- Dock icon पर Right-click → Remove

**Linux:**
- application launcher से हटाएं
- .desktop फ़ाइल delete करें


## Notification FAQ

### मुझे notifications क्यों नहीं मिल रहीं?

सामान्य notification समस्याएं और fixes:

**Permissions जांचें:**
```
1. Browser notification permissions सक्षम हैं
2. Operating system notification permissions
3. OneUptime notification settings configured हैं
4. Do Not Disturb mode अक्षम है
```

**Platform-Specific:**
- **Android**: battery optimization settings जांचें
- **iOS**: Settings app में notification settings सत्यापित करें
- **Windows**: Focus Assist settings जांचें
- **macOS**: notification center permissions सत्यापित करें
- **Linux**: notification daemon status जांचें

### क्या मैं notification sounds customize कर सकता हूं?

Notification customization options:
- **System Sounds**: OS notification sound settings उपयोग करें
- **Browser Settings**: browser notification preferences में configure करें
- **OneUptime Settings**: dashboard में notification preferences सेट करें
- **Priority Levels**: severity levels के लिए अलग sounds configure करें

### Notifications अस्थायी रूप से कैसे अक्षम करूं?

अस्थायी notification disable:
- **Do Not Disturb**: system DND mode सक्षम करें
- **Browser Settings**: site notifications अस्थायी रूप से अक्षम करें
- **OneUptime Dashboard**: settings में notifications pause करें
- **Focus Modes**: OS focus/concentration modes उपयोग करें

## Security FAQ

### क्या OneUptime PWA सुरक्षित है?

Security features और considerations:
- **HTTPS Encryption**: सभी डेटा सुरक्षित रूप से transmitted
- **Same-Origin Policy**: Browser security restrictions लागू होती हैं
- **Sandboxed Environment**: browser security sandbox में चलता है
- **Regular Updates**: security patches स्वचालित रूप से लागू
- **No Root Access**: native apps की तुलना में limited system access


*नोट: Sensitive data encrypted है और browser security standards का पालन करता है।*

### क्या मैं corporate networks पर OneUptime PWA उपयोग कर सकता हूं?

Corporate network considerations:
- **Firewall Rules**: HTTPS (port 443) access सुनिश्चित करें
- **Proxy Configuration**: browser proxy settings configure करें
- **Certificate Trust**: यदि आवश्यक हो तो corporate certificates install करें
- **VPN Access**: remote access के लिए VPN उपयोग करें
- **Security Policies**: IT security requirements का पालन करें

## समस्या निवारण

### Installation Problems

**समस्या**: Installation button नहीं दिख रहा
```
Solutions:
1. OneUptime page पर 30+ seconds इंतज़ार करें
2. page refresh करें और फिर इंतज़ार करें
3. browser cache और cookies clear करें
4. दूसरा browser आज़माएं (Chrome/Edge अनुशंसित)
5. HTTPS connection सत्यापित करें (lock icon जांचें)
6. जांचें कि पहले से installed तो नहीं है
```

**समस्या**: Installation fail या crash होती है
```
Solutions:
1. पर्याप्त storage space सुनिश्चित करें (100MB+)
2. अन्य browser tabs और applications बंद करें
3. browser को latest version पर update करें
4. browser extensions अस्थायी रूप से अक्षम करें
5. private/incognito mode में installation आज़माएं
6. browser restart करें और फिर कोशिश करें
```

**समस्या**: App install हो जाता है लेकिन दिखाई नहीं देता
```
Solutions:
1. सभी app launcher locations जांचें
2. device search में "OneUptime" खोजें
3. browser के app management section में देखें
4. system refresh के लिए 1-2 मिनट इंतज़ार करें
5. device restart करें और फिर जांचें
```

**समस्या**: App बार-बार crash होता है
```
Solutions:
1. browser को latest version पर update करें
2. OneUptime के लिए सभी browser data clear करें
3. browser extensions अक्षम करें
4. उपलब्ध storage space जांचें
5. operating system restart करें
6. OneUptime PWA reinstall करें
```

**समस्या**: Push notifications काम नहीं कर रहीं
```
Solutions:
1. browser में notification permissions जांचें
2. system notification settings सत्यापित करें
3. पहले simple notification से test करें
4. notification data clear करें और permissions फिर से grant करें
5. Do Not Disturb/Focus mode settings जांचें
6. OneUptime notification configuration सत्यापित करें
```

**समस्या**: App latest data sync नहीं करता
```
Solutions:
1. pull down to refresh करें (mobile)
2. Ctrl+F5 (Windows/Linux) या Cmd+R (Mac) press करें
3. app बंद करें और फिर खोलें
4. app cache clear करें और reload करें
5. network connectivity जांचें
```

### Platform-Specific Issues

**Android Issues:**
```
समस्या: App app drawer में नहीं दिख रहा
समाधान: "Recently added" apps section जांचें, app drawer में खोजें

समस्या: Notifications delayed हो रही हैं
समाधान: browser app के लिए battery optimization अक्षम करें

समस्या: Startup पर App crash होता है
समाधान: Chrome app data clear करें, device restart करें
```

**iOS Issues:**
```
समस्या: Home screen पर add नहीं कर सकते
समाधान: Safari browser उपयोग करें, सुनिश्चित करें iOS 11.3+

समस्या: App icon missing है
समाधान: सभी home screen pages और App Library जांचें

समस्या: Face ID काम नहीं कर रहा
समाधान: settings में Safari के लिए Face ID सक्षम करें
```

**Windows Issues:**
```
समस्या: App Start Menu में नहीं दिख रहा
समाधान: app name खोजें, installed apps list जांचें

समस्या: Notifications नहीं दिख रहीं
समाधान: Windows notification settings जांचें, browser के लिए सक्षम करें

समस्या: Window sizing issues
समाधान: manually resize करें, app dimensions याद रखेगा
```

**macOS Issues:**
```
समस्या: Safari के माध्यम से install नहीं कर सकते
समाधान: macOS Sonoma+ पर update करें, File → Add to Dock उपयोग करें

समस्या: App Applications folder में नहीं है
समाधान: Launchpad जांचें, Spotlight search उपयोग करें

समस्या: Notifications काम नहीं कर रहीं
समाधान: System Preferences → Notifications जांचें
```

**Linux Issues:**
```
समस्या: PWA install option missing है
समाधान: Chrome/Chromium उपयोग करें, desktop environment support सुनिश्चित करें

समस्या: Icon launcher में नहीं दिख रहा
समाधान: desktop database update करें, .desktop फ़ाइल जांचें

समस्या: Audio notifications काम नहीं कर रहीं
समाधान: PulseAudio जांचें, browser audio permissions सत्यापित करें
```

### Error Messages

**"This site cannot be installed"**
```
Causes:
- OneUptime instance PWA requirements पूरी नहीं करता
- Missing या invalid web app manifest
- HTTPS ठीक से configured नहीं
- Browser PWA installation का समर्थन नहीं करता

Solutions:
- PWA setup सत्यापित करने के लिए administrator से संपर्क करें
- दूसरा browser आज़माएं
- विस्तृत errors के लिए browser console जांचें
```
