# OneUptime Mobile App

A React Native (Expo) application that brings the OneUptime observability and incident platform to your phone. The app focuses on a beautiful, dark, reliability-first home experience designed for SRE, platform, and customer-facing teams.

## Features

- ⚡️ Hero dashboard summarising reliability status and integrations
- 📊 Real-time metrics cards for quick health checks
- 🧭 Feature highlights that guide users through OneUptime capabilities
- 🎨 Opinionated theming system with reusable components and gradients

## Getting started

```bash
cd MobileApp
npm install
npm run start
```

Choose <kbd>i</kbd>, <kbd>a</kbd>, or <kbd>w</kbd> in the Expo CLI shell to launch the iOS simulator, Android emulator, or web preview respectively.

## Available scripts

- `npm run start` – start the Expo development server
- `npm run android` – run the project on an attached Android device or emulator
- `npm run ios` – run the project on an iOS simulator (macOS only)
- `npm run web` – run the project in a web browser
- `npm run typecheck` – ensure the TypeScript types are valid

## Architecture

- `src/theme` – color, typography, and layout tokens shared across the app
- `src/components` – reusable building blocks such as feature and metric cards
- `src/screens` – screen-level layouts (currently just the home experience)

The app uses the Expo runtime so it can run locally without native toolchains. When you’re ready for native builds, refer to the [Expo EAS build docs](https://docs.expo.dev/build/introduction/).

## Next steps

- Wire the home screen metrics to real OneUptime APIs
- Add authentication flows and workspace switching
- Introduce push notifications for incident alerts
