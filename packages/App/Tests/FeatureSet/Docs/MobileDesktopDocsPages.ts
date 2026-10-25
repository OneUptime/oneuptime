/*
 * The Mobile & Desktop Apps pages, by the paths their suites name them
 * with, and the words they keep as the apps write them. Docs overhaul task
 * 31 rewrote the whole group: the overview, the Android and iOS pages of the
 * OneUptime On-Call app (packages/MobileApp), the Windows, macOS and Linux
 * pages of the dashboard installed as a desktop app, and the FAQ.
 *
 * MobileDesktopDocsFacts holds the English pages to the mobile app, the
 * dashboard and the server, and MobileDesktopDocsTranslations holds every
 * translation to its English page. They read the page lists and the kept
 * words from here, never from each other: importing a .test.ts file runs
 * its tests.
 */

export interface MobileDesktopDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const APPS_OVERVIEW: string = "mobile-desktop-apps/index";
export const ANDROID: string = "mobile-desktop-apps/android-installation";
export const IOS: string = "mobile-desktop-apps/ios-installation";
export const WINDOWS: string = "mobile-desktop-apps/windows-installation";
export const MACOS: string = "mobile-desktop-apps/macos-installation";
export const LINUX: string = "mobile-desktop-apps/linux-installation";
export const FAQ: string = "mobile-desktop-apps/faq-troubleshooting";

// The Mobile & Desktop Apps nav group, page for page.
export const MOBILE_DESKTOP_PAGES: ReadonlyArray<MobileDesktopDocsPageEntry> = [
  { page: APPS_OVERVIEW, navTitle: "Apps Overview" },
  { page: ANDROID, navTitle: "Android Installation" },
  { page: IOS, navTitle: "iOS Installation" },
  { page: WINDOWS, navTitle: "Windows Installation" },
  { page: MACOS, navTitle: "macOS Installation" },
  { page: LINUX, navTitle: "Linux Installation" },
  { page: FAQ, navTitle: "FAQ & Troubleshooting" },
];

// The pages about the OneUptime On-Call app.
export const MOBILE_PAGES: ReadonlyArray<string> = [ANDROID, IOS];

// The pages about the dashboard installed as a desktop app.
export const DESKTOP_PAGES: ReadonlyArray<string> = [WINDOWS, MACOS, LINUX];

/*
 * What the OneUptime On-Call app draws: its name, and its screens, buttons,
 * switches and tabs. The app is in English only, so every language keeps
 * them as written, as the Dashboard's own critical alert steps do
 * (MOBILE_APP_LABELS in Dashboard/src/Components/NotificationMethods/
 * PushDeviceCriticalAlerts.ts). A path through the app's menus keeps its
 * segments too; Persian bolds each one and joins them with " > ".
 */
export const APP_LABELS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [APPS_OVERVIEW]: ["OneUptime On-Call"],
  [ANDROID]: [
    "OneUptime On-Call",
    "Connect your workspace",
    "Connect",
    "Sign In",
    "Forgot password?",
    "Sign in with a passkey",
    "Sign in with SSO",
    "Continue",
    "SSO Required",
    "Authenticate with SSO",
    "Settings",
    "Critical On-Call Alerts",
    "Notifications",
    "Alarm sound",
    "Biometrics Login",
    "Appearance",
  ],
  [IOS]: [
    "OneUptime On-Call",
    "Connect your workspace",
    "Connect",
    "Sign In",
    "Forgot password?",
    "Sign in with a passkey",
    "Sign in with SSO",
    "Continue",
    "SSO Required",
    "Authenticate with SSO",
    "Settings",
    "Critical On-Call Alerts",
    "Notifications",
    "Alarm sound",
    "Biometrics Login",
    "Appearance",
  ],
  [FAQ]: [
    "Change Server",
    "Home",
    "Monitors",
    "Inbox",
    "Acknowledge",
    "Resolve",
    "Add Note",
    "Security",
    "Approve",
    "Reject",
    "Assign to me",
    "Close case",
    "On-Call",
    "Cover for me",
    "Settings",
    "Biometrics Login",
    "Log Out",
    "No internet connection",
    "Critical On-Call Alerts",
  ],
};

// Paths through the app's own menus, kept segment for segment.
export const APP_PATHS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ANDROID]: ["Settings → Manage Projects", "Settings → Log Out"],
  [IOS]: ["Settings → Manage Projects", "Settings → Log Out"],
};

/*
 * What another product draws, which a translation writes in its own
 * language, as that product draws it there: the phone's and the
 * computer's settings, the stores' buttons, and the browsers' menus and
 * prompts. No locale file of OneUptime's holds them, so a translation words
 * them freely, in bold. Persian joins a path's segments with " > ".
 */
export const OTHER_PRODUCT_LABELS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [APPS_OVERVIEW]: ["File → Add to Dock"],
  [ANDROID]: [
    "Install",
    "Open",
    "Allow",
    "Do Not Disturb access",
    "Unrestricted",
    "App battery usage",
    "Settings → Apps → OneUptime On-Call → Battery",
    "Settings → Apps → OneUptime On-Call → Notifications",
    "Settings → Notifications → Do Not Disturb access",
  ],
  [IOS]: [
    "Get",
    "Open",
    "App Updates",
    "Settings → App Store",
    "Allow",
    "Critical Alerts",
    "Settings → Notifications → OneUptime On-Call",
    "Settings → Focus",
    "Settings → Notifications → Scheduled Summary",
    "Allow Notifications",
    "Remove App",
    "Delete App",
    "Settings → Face ID & Passcode",
    "Settings → Touch ID & Passcode",
  ],
  [WINDOWS]: [
    "Install",
    "Settings and more (…) → More tools → Apps → Install this site as an app",
    "⋮ → Cast, save, and share → Install page as app…",
    "Pin to taskbar",
    "Details",
    "Auto-start on device login",
    "Allow",
    "Uninstall",
    "⋮",
    "Remove",
    "Settings → Apps → Installed apps",
    "Settings → System → Notifications",
  ],
  [MACOS]: [
    "File → Add to Dock",
    "Add to Dock",
    "Add",
    "Install",
    "⋮ → Cast, save, and share → Install page as app…",
    "Settings and more (…) → More tools → Apps → Install this site as an app",
    "Options → Keep in Dock",
    "Options → Open at Login",
    "Allow",
    "⋮",
    "Remove",
    "Details",
    "Uninstall",
    "System Settings → Notifications",
  ],
  [LINUX]: [
    "Install",
    "⋮ → Cast, save, and share → Install page as app…",
    "Settings and more (…) → More tools → Apps → Install this site as an app",
    "Allow",
    "⋮",
    "Remove",
    "Details",
    "Uninstall",
  ],
  [FAQ]: ["Unrestricted"],
};

/*
 * Bold words that are a list item's lead, not a label of anything: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ANDROID]: ["Update.", "Sign out.", "Uninstall."],
  [IOS]: [
    "Focus.",
    "Scheduled Summary.",
    "Notifications.",
    "Update.",
    "Sign out.",
    "Delete.",
  ],
  [WINDOWS]: ["Taskbar.", "Start with Windows."],
  [MACOS]: ["Dock.", "Open at login.", "Spotlight."],
};

/*
 * How each page draws its diagrams: every one reads top to bottom, one
 * part under the next, so it fits the docs column.
 */
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [APPS_OVERVIEW]: "flowchart TB",
  [ANDROID]: "flowchart TB",
  [IOS]: "flowchart TB",
  [WINDOWS]: "flowchart TB",
  [MACOS]: "flowchart TB",
  [LINUX]: "flowchart TB",
  [FAQ]: "flowchart TB",
};

/*
 * The tabs of each page, in order. Each names a store, a browser or a kind
 * of download, and keeps its name in every language: the docs remember a
 * reader's choice by its label, from one page to the next.
 */
export const TAB_LABELS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ANDROID]: ["Google Play", "APK"],
  [WINDOWS]: ["Edge", "Chrome", "Edge", "Chrome"],
  [MACOS]: ["Safari", "Chrome", "Edge", "Safari", "Chrome", "Edge"],
  [LINUX]: ["Chrome", "Edge", "Chrome", "Edge"],
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, stores, browsers, systems and protocols. A line made of them
 * alone is not a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime On-Call",
  "OneUptime Cloud",
  "OneUptime",
  "Google Play",
  "App Store",
  "GitHub",
  "Microsoft Edge",
  "Google Chrome",
  "Chromium",
  "Chrome",
  "Edge",
  "Safari",
  "Firefox",
  "macOS Sonoma",
  "macOS",
  "Windows",
  "Linux",
  "GNOME",
  "KDE Plasma",
  "Android",
  "iPadOS",
  "iPhone",
  "iPad",
  "iOS",
  "Expo",
  "Apple",
  "Google",
  "Face ID",
  "Touch ID",
  "Spotlight",
  "Launchpad",
  "Finder",
  "Dock",
  "VAPID",
  "HTTPS",
  "HTTP",
  "APK",
  "SSO",
];

/*
 * The minimum versions the pages state, of the systems the mobile app runs
 * on. MobileDesktopDocsFacts holds them to the Expo SDK the app is built
 * with, and to the Dashboard's Mobile Apps page.
 */
export const MINIMUM_IOS: string = "16.4";
export const MINIMUM_ANDROID: string = "7.0";
