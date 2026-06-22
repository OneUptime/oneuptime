# Linux Installation Guide

व्यापक monitoring और incident management के लिए OneUptime को Linux distributions पर desktop application के रूप में install करें।

## Installation Methods

### Method 1: Google Chrome/Chromium (अनुशंसित)

Chrome और Chromium native desktop integration के साथ सबसे अच्छा Linux PWA experience प्रदान करते हैं।

#### PWA Installation Steps:

1. **OneUptime को Chrome/Chromium में खोलें**

   - अपना browser launch करें
   - अपने OneUptime instance URL पर जाएं
   - अपने OneUptime account में sign in करें
   - page पूरी तरह load होने का इंतज़ार करें

2. **PWA Install करें**

   - address bar में **install icon** (⊞) देखें
   - **"Install OneUptime"** पर क्लिक करें
   - या **Chrome menu** (⋮) → **More tools** → **Create shortcut** उपयोग करें

3. **Installation Options**

   - native app experience के लिए **"Open as window"** चेक करें
   - यदि चाहें तो app का नाम customize करें
   - desktop shortcut creation चुनें
   - **"Install"** या **"Create"** पर क्लिक करें

4. **App Launch करें**
   - application launcher में OneUptime खोजें
   - या desktop shortcut उपयोग करें
   - App dedicated window में खुलता है

### Method 2: Firefox

Firefox basic desktop integration के साथ Linux पर PWA installation का समर्थन करता है।

1. **PWA Installation**:
   - Firefox में OneUptime खोलें
   - installation banner या prompt देखें
   - उपलब्ध होने पर **"Install"** पर क्लिक करें
   - नोट: Chrome की तुलना में limited desktop integration

### Method 3: Microsoft Edge

Edge Linux पर उपलब्ध है और अच्छा PWA support प्रदान करता है।

1. **PWA Install करें**: Chrome method के समान steps का पालन करें

## Updates और Maintenance

### Automatic Updates

OneUptime PWA स्वचालित रूप से update होता है:

- जब browser app refresh करता है तो Updates लागू होते हैं
- Critical security updates तुरंत deployed
- कोई manual intervention आवश्यक नहीं

## Uninstallation

### Browser-Specific Removal

```bash
# Chrome PWA management
google-chrome chrome://apps/

# OneUptime-related सभी browser data हटाएं
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```
