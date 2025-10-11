# OneUptime Mobile App

A React Native mobile application built with Expo for the OneUptime monitoring platform. This app enables users to monitor their infrastructure, services, and applications on the go with real-time alerts and dashboards.

## 📱 About

OneUptime Mobile brings the power of OneUptime's comprehensive monitoring and observability platform to your mobile device. Stay connected to your systems wherever you are, receive instant notifications, and respond to incidents quickly.

### Key Features (Planned)

- 📊 Real-time monitoring dashboards
- 🔔 Push notifications for alerts and incidents
- 🚨 Incident management on the go
- 📈 Performance metrics and analytics
- 🔐 Secure authentication
- 🌐 Multi-tenant support
- 📱 Native iOS and Android experience

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- npm or yarn
- Expo CLI (will be installed with dependencies)
- For iOS development: macOS with Xcode
- For Android development: Android Studio with Android SDK

### Installation

Dependencies are already installed. If you need to reinstall:

```bash
npm install
```

### Running the App

#### Start the Expo development server:
```bash
npm start
```

This will open the Expo DevTools in your browser where you can:
- Press `i` to open in iOS simulator
- Press `a` to open in Android emulator
- Scan the QR code with Expo Go app on your physical device

#### Run directly on Android:
```bash
npm run android
```

#### Run directly on iOS:
```bash
npm run ios
```

#### Run in web browser:
```bash
npm run web
```

### Project Structure

```
MobileApp/
├── App.tsx           # Main application component
├── app.json          # Expo configuration
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── babel.config.js   # Babel configuration
├── assets/           # Images, fonts, and other assets
└── .gitignore        # Git ignore patterns
```

### Development

The app is built with:
- **React Native** - Mobile framework
- **Expo** - Development platform and tools
- **TypeScript** - Type-safe JavaScript
- **React** 18.2.0
- **React Native** 0.74.5

### Assets

Place your app assets in the `assets/` directory:
- `icon.png` - App icon (1024x1024)
- `splash.png` - Splash screen (1284x2778)
- `adaptive-icon.png` - Android adaptive icon (1024x1024)
- `favicon.png` - Web favicon

### Building for Production

For production builds, you'll need to configure EAS Build:

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Then build for your platform:
```bash
eas build --platform android
eas build --platform ios
```

### Troubleshooting

- If you encounter issues, try clearing the Expo cache: `expo start -c`
- For iOS simulator issues, rebuild: `expo run:ios --clean`
- For Android emulator issues, clean build: `expo run:android --clean`

## Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [OneUptime Documentation](https://oneuptime.com/docs)
