import {
  ANDROID,
  APPS_OVERVIEW,
  APP_LABELS,
  DESKTOP_PAGES,
  FAQ,
  IOS,
  LINUX,
  MACOS,
  MINIMUM_ANDROID,
  MINIMUM_IOS,
  MOBILE_PAGES,
  WINDOWS,
} from "./MobileDesktopDocsPages";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  PACKAGES_DIR,
  bold,
  boldIn,
  codeIn,
  englishPage,
  englishSection,
  listOf,
  readRepoFile,
  rowStartingWith,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import { getDefaultDeviceName } from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_APK_URL,
  MOBILE_APP_IOS_URL,
} from "../../../FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";
import {
  CRITICAL_ALERT_VOLUME_OPTIONS,
  DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
} from "Common/Types/PushNotification/CriticalAlertVolume";
import PushNotificationLevel, {
  DEFAULT_PUSH_NOTIFICATION_LEVEL,
} from "Common/Types/NotificationRule/PushNotificationLevel";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 31: what the Mobile & Desktop Apps pages say, held to
 * the code that makes it true. MobileDesktopDocsTranslations holds the 16
 * translations to these English pages line for line, so a fact that changes
 * here changes in every language with the English.
 *
 * The mobile app (packages/MobileApp) is read as files, never imported: its
 * labels, its sign-in, how often it registers the phone, what it keeps on
 * the phone and what it offers for critical alerts. The Dashboard's push
 * devices and browser registration, its manifest and service worker, the
 * server's push code and the release workflow are read the same way, or
 * imported where they are plain values. Rename a switch in the app, move the
 * minimum iOS with a new Expo SDK, or change what the server does with a
 * phone Expo says is gone, and this fails until the pages say the new thing.
 */

const MOBILE_APP: string = "MobileApp";
const DASHBOARD: string = "App/FeatureSet/Dashboard";

/*
 * The minimums each Expo SDK builds for: the iOS deployment target of its
 * modules (expo-modules-core's podspec) and the Android API level of its
 * minSdkVersion (expo-modules-core's Gradle plugin). A new SDK fails the
 * suite until it is added here and the pages say what it needs.
 */
const EXPO_SDK_MINIMUMS: Readonly<
  Record<number, { ios: string; androidApiLevel: number }>
> = {
  57: { ios: "16.4", androidApiLevel: 24 },
};

// The Android release of each API level an Expo SDK has built for.
const ANDROID_RELEASE_OF_API_LEVEL: Readonly<Record<number, string>> = {
  23: "6.0",
  24: "7.0",
  26: "8.0",
};

const WHITESPACE_RUN: RegExp = /\s+/g;
const EXPO_VERSION: RegExp = /^[~^]?(\d+)\./;
const PODSPEC_IOS: RegExp = /:ios\s*=>\s*'([\d.]+)'/;
const GRADLE_MIN_SDK: RegExp = /safeExtGet\("minSdkVersion",\s*(\d+)\)/;
const MULTIPLIED_MS: RegExp = /^([\d\s*]+)$/;
const ALARM_SOUND_TITLE: RegExp = /title: "([^"]+)"/g;
const TAB_LABEL: RegExp = /tabBarAccessibilityLabel: "([^"]+)"/g;
const LIST_ITEM_LEAD: RegExp = /^- \*\*([^*]+)\*\*:/gm;
const STATED_IOS_MINIMUM: RegExp = /\b(?:iOS|iPadOS) (\d+(?:\.\d+)?) or later/g;
const STATED_ANDROID_MINIMUM: RegExp = /\bAndroid (\d+(?:\.\d+)?) or later/g;
const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;
// A group of a side menu: "{ title: "Notifications", items: [".
const MENU_GROUP: RegExp = /\{ title: "([^"]+)", items: \[/g;
// A ListGroup of the app's Settings screen, to the next one.
const SETTINGS_GROUP_START: string = "<ListGroup";

function mobile(relativePath: string): string {
  return readRepoFile(`${MOBILE_APP}/${relativePath}`);
}

function dashboard(relativePath: string): string {
  return readRepoFile(`${DASHBOARD}/${relativePath}`);
}

function common(relativePath: string): string {
  return readRepoFile(`Common/${relativePath}`);
}

// A file of the repository outside packages/: the release workflow.
function repositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, "..", relativePath), "utf8");
}

// One line of text: a page's paragraph or a source's statement, unwrapped.
function flat(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

/*
 * A number of milliseconds a source writes as a product of whole numbers
 * ("export const NAME: number = 15 * 60 * 1000;").
 */
function millisecondsConstant(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`export const ${escapeRegExp(name)}: number = ([^;]+);`),
  );
  const product: string | undefined = match?.[1]?.trim();

  if (!product || !MULTIPLIED_MS.test(product)) {
    throw new Error(`No product of whole numbers for ${name}`);
  }

  return product
    .split("*")
    .map((factor: string): number => {
      return Number(factor.trim());
    })
    .reduce((total: number, factor: number): number => {
      return total * factor;
    }, 1);
}

// A whole number of minutes in words, as the pages write a small one.
const MINUTES_IN_WORDS: Readonly<Record<number, string>> = {
  1: "one",
  2: "two",
  5: "five",
  10: "ten",
  15: "fifteen",
};

// The details block of a page that opens with this title, title to ":::".
function detailsBlock(page: string, title: string): string {
  const markdown: string = englishPage(page);
  const start: number = markdown.indexOf(`:::details ${title}\n`);

  if (start < 0) {
    throw new Error(`${page} has no details block titled ${title}`);
  }

  const end: number = markdown.indexOf("\n:::", start + 1);

  return markdown.slice(start, end);
}

// Every bold span of a page.
function boldOnPage(page: string): Array<string> {
  return boldIn(englishPage(page));
}

// The app's own JSON config.
interface AppJson {
  expo: {
    name: string;
    version: string;
    ios: {
      bundleIdentifier: string;
      infoPlist: Record<string, unknown>;
    };
    android: Record<string, unknown> & { package: string };
  };
}

function appJson(): AppJson {
  return JSON.parse(mobile("app.json")) as AppJson;
}

function expoMajor(): number {
  const packageJson: { dependencies: Record<string, string> } = JSON.parse(
    mobile("package.json"),
  ) as { dependencies: Record<string, string> };
  const match: RegExpMatchArray | null = (
    packageJson.dependencies["expo"] || ""
  ).match(EXPO_VERSION);

  if (!match) {
    throw new Error("The mobile app's package.json names no Expo version");
  }

  return Number(match[1]);
}

const INSTALLED_EXPO_CORE: string = path.join(
  PACKAGES_DIR,
  MOBILE_APP,
  "node_modules",
  "expo-modules-core",
);

describe("the systems the mobile app runs on", () => {
  it("are the minimums of the Expo SDK the app is built with", () => {
    const minimums: { ios: string; androidApiLevel: number } | undefined =
      EXPO_SDK_MINIMUMS[expoMajor()];

    expect({ sdk: expoMajor(), known: minimums !== undefined }).toEqual({
      sdk: expoMajor(),
      known: true,
    });
    expect(MINIMUM_IOS).toBe(minimums?.ios);
    expect(MINIMUM_ANDROID).toBe(
      ANDROID_RELEASE_OF_API_LEVEL[minimums?.androidApiLevel || 0],
    );
  });

  (fs.existsSync(INSTALLED_EXPO_CORE) ? it : it.skip)(
    "are the ones the installed Expo SDK builds for",
    () => {
      const installedExpo: { version: string } = JSON.parse(
        mobile("node_modules/expo/package.json"),
      ) as { version: string };
      const podspec: string = mobile(
        "node_modules/expo-modules-core/ExpoModulesCore.podspec",
      );
      const gradle: string = mobile(
        "node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle",
      );

      expect(Number(installedExpo.version.split(".")[0])).toBe(expoMajor());
      expect(podspec.match(PODSPEC_IOS)?.[1]).toBe(MINIMUM_IOS);
      expect(
        ANDROID_RELEASE_OF_API_LEVEL[
          Number(gradle.match(GRADLE_MIN_SDK)?.[1] || 0)
        ],
      ).toBe(MINIMUM_ANDROID);
    },
  );

  it("are what every page states, and no page states another", () => {
    const iosStated: Array<string> = [];
    const androidStated: Array<string> = [];

    for (const page of [APPS_OVERVIEW, ANDROID, IOS, FAQ]) {
      for (const match of englishPage(page).matchAll(STATED_IOS_MINIMUM)) {
        iosStated.push(match[1] as string);
      }

      for (const match of englishPage(page).matchAll(STATED_ANDROID_MINIMUM)) {
        androidStated.push(match[1] as string);
      }
    }

    expect(new Set(iosStated)).toEqual(new Set([MINIMUM_IOS]));
    expect(new Set(androidStated)).toEqual(new Set([MINIMUM_ANDROID]));
  });

  it("are in the overview's table, the Before you begin lists and the FAQ", () => {
    expect(
      rowStartingWith(
        tableWithHeader(englishSection(APPS_OVERVIEW, "## Choose an app"), ""),
        "Runs on",
      )[1],
    ).toBe(`iOS ${MINIMUM_IOS} or later, Android ${MINIMUM_ANDROID} or later`);
    expect(englishSection(ANDROID, "## Before you begin")).toContain(
      `- A phone or tablet with Android ${MINIMUM_ANDROID} or later.`,
    );
    expect(englishSection(IOS, "## Before you begin")).toContain(
      `- An iPhone or iPad with iOS ${MINIMUM_IOS} or later, or iPadOS ${MINIMUM_IOS} or later.`,
    );
    expect(
      detailsBlock(FAQ, "Which phones and tablets does it run on?"),
    ).toContain(
      `iPhones and iPads with iOS or iPadOS ${MINIMUM_IOS} or later, and Android phones and tablets with Android ${MINIMUM_ANDROID} or later.`,
    );
  });

  it("are what the Dashboard's Mobile Apps page says the app needs", () => {
    const mobileApps: string = dashboard("src/Pages/Settings/MobileApps.tsx");

    expect(mobileApps).toContain(`"Requires iOS ${MINIMUM_IOS} or later."`);
    expect(mobileApps).toContain(
      `"Requires Android ${MINIMUM_ANDROID} or later."`,
    );
  });
});

describe("where the pages send people for the mobile app", () => {
  it("link the App Store, Google Play and the APK the Dashboard links", () => {
    const install: string = englishSection(
      APPS_OVERVIEW,
      "## Get the mobile app",
    );

    for (const url of [
      MOBILE_APP_IOS_URL,
      MOBILE_APP_ANDROID_URL,
      MOBILE_APP_APK_URL,
    ]) {
      expect(install).toContain(`](${url})`);
    }

    expect(englishSection(ANDROID, "## Install the app")).toContain(
      `](${MOBILE_APP_ANDROID_URL})`,
    );
    expect(englishSection(ANDROID, "## Install the app")).toContain(
      `](${MOBILE_APP_APK_URL})`,
    );
    expect(englishSection(IOS, "## Install the app")).toContain(
      `](${MOBILE_APP_IOS_URL})`,
    );
  });

  it("link the app that is published: its App Store id and its Android package", () => {
    const eas: {
      submit: { production: { ios: { ascAppId: string } } };
    } = JSON.parse(mobile("eas.json")) as {
      submit: { production: { ios: { ascAppId: string } } };
    };

    expect(new URL(MOBILE_APP_IOS_URL).pathname).toMatch(
      new RegExp(`/id${escapeRegExp(eas.submit.production.ios.ascAppId)}$`),
    );
    expect(new URL(MOBILE_APP_ANDROID_URL).searchParams.get("id")).toBe(
      appJson().expo.android.package,
    );
  });

  it("link the APK every release attaches to itself on GitHub", () => {
    const releaseWorkflow: string = repositoryFile(
      ".github/workflows/release.yml",
    );
    const apk: string = path.posix.basename(
      new URL(MOBILE_APP_APK_URL).pathname,
    );

    expect(new URL(MOBILE_APP_APK_URL).pathname).toBe(
      `/OneUptime/oneuptime/releases/latest/download/${apk}`,
    );
    expect(releaseWorkflow).toMatch(
      new RegExp(`files: \\S+/${escapeRegExp(apk)}`),
    );
    expect(englishSection(ANDROID, "## Install the app")).toContain(
      "The APK is built from the same code for every OneUptime release and attached to the release on GitHub.",
    );
  });

  it("call the app by the name it is published under", () => {
    expect(appJson().expo.name).toBe("OneUptime On-Call");
    expect(APP_LABELS[APPS_OVERVIEW]).toContain(appJson().expo.name);

    for (const page of [APPS_OVERVIEW, ...MOBILE_PAGES]) {
      expect(englishPage(page).split("\n")[2]).toContain(
        bold(appJson().expo.name),
      );
    }
  });

  it("say the Dashboard has the same links under Project Settings → Notifications → Mobile Apps", () => {
    const sideMenu: string = flat(dashboard("src/Pages/Settings/SideMenu.tsx"));
    const groups: Array<RegExpMatchArray> = Array.from(
      sideMenu.matchAll(MENU_GROUP),
    );
    const notifications: number = groups.findIndex(
      (group: RegExpMatchArray): boolean => {
        return group[1] === "Notifications";
      },
    );
    const start: number = groups[notifications]?.index ?? -1;
    const end: number = groups[notifications + 1]?.index ?? sideMenu.length;

    expect(start).toBeGreaterThanOrEqual(0);
    expect(sideMenu.slice(start, end)).toContain('title: "Mobile Apps"');
    expect(dashboard("src/Pages/Settings/MobileApps.tsx")).toContain(
      "MobileAppStoreLinks",
    );
    expect(englishSection(APPS_OVERVIEW, "## Get the mobile app")).toContain(
      "The same links are in the dashboard, under **Project Settings → Notifications → Mobile Apps**.",
    );
  });
});

describe("signing in to the mobile app", () => {
  it("starts on the screen, address and button the app shows", () => {
    const serverUrlScreen: string = mobile(
      "src/screens/auth/ServerUrlScreen.tsx",
    );

    expect(serverUrlScreen).toContain('title="Connect your workspace"');
    expect(serverUrlScreen).toContain('label="Connect"');
    expect(serverUrlScreen).toContain('useState("https://oneuptime.com")');
    expect(mobile("src/storage/serverUrl.ts")).toContain(
      'const DEFAULT_SERVER_URL: string = "https://oneuptime.com";',
    );

    for (const page of MOBILE_PAGES) {
      expect(
        englishSection(page, "### Enter your OneUptime's address"),
      ).toContain(
        "On **Connect your workspace**, keep `https://oneuptime.com` for OneUptime Cloud, or enter your own OneUptime's address, and tap **Connect**.",
      );
    }
  });

  it('goes on once /api/status answers, and the server answers it with {"status":"ok"}', () => {
    const statusApi: string = flat(common("Server/API/StatusAPI.ts"));

    expect(mobile("src/api/auth.ts")).toContain(
      "await axios.get(`${url}/api/status`",
    );
    expect(statusApi).toMatch(
      /router\.get\("\/status", .*? Response\.sendJsonObjectResponse\(req, res, \{ status: "ok", \}\);/,
    );
    expect(common("Server/API/Index.ts")).toContain(
      'app.use([`/${data.appName}`, "/"], StatusAPI.init(data.statusOptions));',
    );
    expect(readRepoFile("App/Index.ts")).toContain(
      'const APP_NAME: string = "api";',
    );

    for (const page of MOBILE_PAGES) {
      expect(
        englishSection(page, "### Enter your OneUptime's address"),
      ).toContain(
        "The app goes on once `https://<your-oneuptime>/api/status` answers.",
      );
      expect(detailsBlock(page, '"Could not connect to the server"')).toContain(
        '`{"status":"ok"}`',
      );
    }

    expect(detailsBlock(FAQ, '"Could not connect to the server"')).toContain(
      '`{"status":"ok"}`',
    );
  });

  it("quotes the app's own words when it cannot reach the server", () => {
    expect(mobile("src/screens/auth/ServerUrlScreen.tsx")).toContain(
      '"Could not connect to the server. Please check the URL and try again."',
    );

    for (const page of [...MOBILE_PAGES, FAQ]) {
      expect(detailsBlock(page, '"Could not connect to the server"')).toContain(
        "The app could not reach `https://<your-oneuptime>/api/status`.",
      );
    }
  });

  it("is over HTTPS only: the app's build allows no plain HTTP", () => {
    const config: AppJson = appJson();
    const appConfigJs: string = mobile("app.config.js");

    expect(Object.keys(config.expo.ios.infoPlist)).not.toContain(
      "NSAppTransportSecurity",
    );
    expect(Object.keys(config.expo.android)).not.toContain(
      "usesCleartextTraffic",
    );
    expect(appConfigJs).not.toContain("NSAllowsArbitraryLoads");
    expect(appConfigJs).not.toContain("usesCleartextTraffic");

    for (const page of MOBILE_PAGES) {
      expect(englishSection(page, "## Before you begin")).toContain(
        "The app connects over HTTPS only.",
      );
    }

    expect(englishSection(APPS_OVERVIEW, "## Before you begin")).toContain(
      "The mobile app does not connect over plain HTTP",
    );
    expect(detailsBlock(FAQ, '"Could not connect to the server"')).toContain(
      "the app does not connect over plain HTTP",
    );
  });

  it("names the sign-in screens' buttons as the app draws them", () => {
    const login: string = mobile("src/screens/auth/LoginScreen.tsx");
    const sso: string = mobile("src/screens/auth/SSOLoginScreen.tsx");

    for (const label of [
      "Sign In",
      "Forgot password?",
      "Sign in with SSO",
      "Change Server",
    ]) {
      expect(login).toContain(`label="${label}"`);
    }

    expect(login).toContain('"Sign in with a passkey"');
    expect(sso).toContain('label="Continue"');

    for (const page of MOBILE_PAGES) {
      for (const label of [
        "Sign In",
        "Forgot password?",
        "Sign in with a passkey",
        "Sign in with SSO",
        "Continue",
      ]) {
        expect(boldOnPage(page)).toContain(label);
      }
    }

    expect(boldOnPage(FAQ)).toContain("Change Server");
  });

  it("with a passkey needs an https:// address, and Change Server changes it", () => {
    const passkeyRequest: string = mobile("src/passkeys/request.ts");

    expect(flat(passkeyRequest)).toContain("serverUrl.match( /^https:\\/\\/");
    expect(passkeyRequest).toContain(
      '"Passkeys need a secure HTTPS server address. Change Server to update it."',
    );
    expect(flat(detailsBlock(FAQ, "Passkey sign-in fails"))).toContain(
      "Passkeys need your OneUptime's address to start with `https://`, and a passkey you added for this OneUptime",
    );
    expect(detailsBlock(FAQ, "Passkey sign-in fails")).toContain(
      "To use another server, tap **Change Server** on the sign-in screen.",
    );
  });

  it("quotes the app's answer to an email with no single sign-on", () => {
    expect(mobile("src/screens/auth/SSOLoginScreen.tsx")).toContain(
      "`No SSO configuration found for the email: ${trimmedEmail}`",
    );
    expect(
      detailsBlock(FAQ, '"No SSO configuration found for the email"'),
    ).toContain(
      "None of the projects that email belongs to has single sign-on set up",
    );
  });

  it("cannot use a security key, as the two-factor screen says", () => {
    expect(mobile("src/screens/auth/TwoFactorScreen.tsx")).toContain(
      "Security keys are LISTED but cannot be used.",
    );

    for (const page of MOBILE_PAGES) {
      expect(englishSection(page, "### Sign in to your account")).toContain(
        "A security key cannot be used in the app.",
      );
    }

    expect(
      detailsBlock(FAQ, "A security key is your only second factor"),
    ).toContain("The app cannot use a security key.");
  });

  it("names the projects screen's single sign-on states as the app does", () => {
    const projects: string = mobile("src/screens/settings/ProjectsScreen.tsx");

    expect(projects).toContain('"SSO Required"');
    expect(projects).toContain("Authenticate with SSO");
    expect(mobile("src/screens/SettingsScreen.tsx")).toContain(
      'title="Manage Projects"',
    );

    for (const page of MOBILE_PAGES) {
      expect(englishSection(page, "## Sign in")).toContain(
        "A project that requires single sign-on says **SSO Required** under **Settings → Manage Projects** until you tap **Authenticate with SSO** there.",
      );
    }
  });
});

describe("the phone in the dashboard", () => {
  it("is found where the Dashboard lists push devices, by the names it draws", () => {
    const push: string = dashboard(
      "src/Components/NotificationMethods/Push.tsx",
    );

    expect(
      dashboard(
        "src/Components/NotificationMethods/NotificationMethodTabs.tsx",
      ),
    ).toContain('name: translationKey("Push Notifications")');
    expect(dashboard("src/Pages/UserSettings/SideMenu.tsx")).toContain(
      'title: "Notification Methods"',
    );
    expect(dashboard("src/Pages/UserSettings/SideMenu.tsx")).toContain(
      'title: "On-Call Rules"',
    );
    expect(push).toContain('title: "Push Notification Devices"');
    expect(push).toContain('title: "Test Notification"');

    for (const page of MOBILE_PAGES) {
      const check: string = englishSection(
        page,
        page === ANDROID
          ? "## Check that pages reach the phone"
          : "## Check that pages reach the device",
      );

      expect(check).toContain(
        "open **User Settings → Notification Methods** and the **Push Notifications** tab.",
      );
      expect(check).toContain("**Push Notification Devices**");
      expect(check).toContain("Click **Test Notification**");
    }
  });

  it("gets the default on-call rules when it registers", () => {
    expect(flat(common("Server/API/UserPushAPI.ts"))).toMatch(
      /addDefaultNotificationRulesForVerifiedMethod\( \{ projectId: [^}]*?notificationMethod: \{ userPushId:/,
    );

    for (const page of MOBILE_PAGES) {
      expect(englishSection(page, "### Allow notifications")).toContain(
        "lists it among your push devices with the default on-call rules",
      );
    }
  });

  it("leaves every project, with its rules, when you sign out", () => {
    const useAuth: string = flat(mobile("src/hooks/useAuth.tsx"));
    const userPushApi: string = flat(common("Server/API/UserPushAPI.ts"));
    const rule: string = flat(
      common("Models/DatabaseModels/UserNotificationRule.ts"),
    );

    expect(useAuth).toContain(
      "const logout: () => Promise<void> = useCallback(async (): Promise<void> => { await unregisterPushToken();",
    );
    expect(mobile("src/api/pushDevice.ts")).toContain(
      'await apiClient.post("/api/user-push/unregister", {',
    );
    // By token across the person's projects: no project in the query.
    expect(userPushApi).toMatch(
      /`\/user-push\/unregister`.*?await this\.service\.deleteBy\(\{ query: \{ userId: userId, deviceToken: req\.body\.deviceToken, \},/,
    );
    expect(rule).toMatch(
      /return UserPush; \}, \{ eager: false, nullable: true, onDelete: "CASCADE",/,
    );

    for (const page of MOBILE_PAGES) {
      expect(englishPage(page)).toContain(
        "**Settings → Log Out** signs you out and removes the",
      );
      expect(englishPage(page)).toContain(
        "from your push devices in every project, together with its on-call rules. Signing in again adds it back with the default rules.",
      );
    }
  });
});

describe("ringing through silent mode", () => {
  it("names the app's switch, its section and the alarm screen as the app draws them", () => {
    const settings: string = flat(mobile("src/screens/SettingsScreen.tsx"));
    const start: number = settings.indexOf('<ListGroup title="Notifications">');
    const notifications: string = settings.slice(
      start,
      settings.indexOf(SETTINGS_GROUP_START, start + 1),
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(notifications).toContain('title="Critical On-Call Alerts"');
    expect(notifications).toContain('title="Alarm sound"');

    for (const page of MOBILE_PAGES) {
      expect(
        englishSection(page, "### Turn on Critical On-Call Alerts"),
      ).toContain(
        "In the app, open **Settings** and turn on **Critical On-Call Alerts** under **Notifications**.",
      );
      expect(englishPage(page)).toContain(
        "Tap **Alarm sound** under the switch.",
      );
    }
  });

  it("offers the alarms the app offers, in its order", () => {
    const sounds: string = mobile("src/notifications/criticalAlertSounds.ts");
    const titles: Array<string> = Array.from(sounds.matchAll(ALARM_SOUND_TITLE))
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .filter((title: string): boolean => {
        return title !== "System default";
      });

    expect(titles.length).toBe(5);

    for (const page of MOBILE_PAGES) {
      expect(englishPage(page)).toContain(
        `it offers ${listOf(titles, "and")}, which starts soft and gets louder.`,
      );
    }
  });

  it("offers the iPhone volumes the app offers, the default last", () => {
    const sounds: string = flat(
      mobile("src/notifications/criticalAlertSounds.ts"),
    );
    const percents: Array<string> = CRITICAL_ALERT_VOLUME_OPTIONS.map(
      (option: number): string => {
        return `${option}%`;
      },
    );

    expect(sounds).toContain(
      `export const CRITICAL_ALERT_VOLUME_OPTIONS: ReadonlyArray<number> = [ ${CRITICAL_ALERT_VOLUME_OPTIONS.join(", ")}, ];`,
    );
    expect(
      CRITICAL_ALERT_VOLUME_OPTIONS[CRITICAL_ALERT_VOLUME_OPTIONS.length - 1],
    ).toBe(DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT);
    expect(
      englishSection(IOS, "### Choose an alarm sound and its volume"),
    ).toContain(
      `Then pick the volume a page plays at: ${listOf(percents, "or")}, the default.`,
    );
  });

  it("follows the rule's level: Critical alert by default, Standard following the phone", () => {
    const control: string = dashboard(
      "src/Components/NotificationRule/PushNotificationLevelControl.tsx",
    );

    expect(DEFAULT_PUSH_NOTIFICATION_LEVEL).toBe(
      PushNotificationLevel.Critical,
    );
    expect(control).toContain('title: translationKey("Critical alert")');
    expect(control).toContain('title: translationKey("Standard")');

    for (const page of MOBILE_PAGES) {
      expect(englishSection(page, "## Ring through silent mode")).toContain(
        "Only on-call pages ring through, and only from on-call rules set to **Critical alert**, the default. A rule set to **Standard** follows the",
      );
    }

    expect(
      detailsBlock(FAQ, "Critical alerts do not ring through silent mode"),
    ).toContain("is set to **Critical alert**, not **Standard**");
  });

  it("on Android plays at the alarm volume, through Do Not Disturb access the app opens", () => {
    const channels: string = mobile("src/notifications/channels.ts");

    expect(channels).toContain("bypassDnd: true,");
    expect(channels).toContain("usage: Notifications.AndroidAudioUsage.ALARM,");
    expect(mobile("src/notifications/criticalAlerts.ts")).toContain(
      '"android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS"',
    );
    expect(
      englishSection(ANDROID, "### Allow Do Not Disturb access"),
    ).toContain("Android opens its **Do Not Disturb access** list.");
    expect(englishSection(ANDROID, "### Choose an alarm sound")).toContain(
      "A critical page plays at the phone's alarm volume, so keep that turned up.",
    );
  });

  it("on an iPhone needs app 1.5.0 or later, the first built with Apple's permission", () => {
    const version: RegExpMatchArray | null =
      appJson().expo.version.match(SEMVER);

    expect(mobile("README.md")).toContain(
      "the build lacks the entitlement - true of every App Store build\nup to 1.4.0",
    );
    expect(version).not.toBeNull();
    expect(
      Number(version?.[1]) * 10000 + Number(version?.[2]) * 100,
    ).toBeGreaterThanOrEqual(10500);
    expect(englishPage(IOS)).toContain(
      "> Critical alerts need OneUptime On-Call 1.5.0 or later from the App Store.",
    );
  });
});

describe("pages arriving on the phone", () => {
  it("go out at high priority", () => {
    expect(common("Server/Services/PushNotificationService.ts")).toContain(
      'priority: "high",',
    );
    expect(
      englishSection(ANDROID, "## Keep pages from arriving late"),
    ).toContain("OneUptime sends on-call pages at high priority");
  });

  it("carry no actions to acknowledge from: the server names no notification category", () => {
    const pushService: string = common(
      "Server/Services/PushNotificationService.ts",
    );

    expect(pushService).not.toContain("categoryId");
    expect(pushService).not.toContain("categoryIdentifier");
    expect(
      detailsBlock(FAQ, "Can I acknowledge a page from the notification?"),
    ).toContain(
      "No. Tap the notification: the app opens the incident, alert, episode or security case it is about, in the right project, and you acknowledge it there.",
    );
  });

  it("open the security case they are about: the server names the case and its project, and the app opens its screen", () => {
    const handlers: string = flat(mobile("src/notifications/handlers.ts"));

    expect(flat(common("Server/Utils/PushNotificationUtil.ts"))).toMatch(
      /public static createSecurityCaseNotification\(.{0,900}?entityType: "security-case", entityId: params\.securityCaseId, projectId: params\.projectId,/,
    );
    // Parked like any other page until the app is unlocked and signed in.
    expect(handlers).toMatch(
      /function tabRouteForEntityType\(entityType: string\): string \| null \{ switch \(entityType\) \{[^}]*?case "security-case": return "Inbox";/,
    );
    expect(handlers).toMatch(
      /case "security-case": \/\*.{0,600}?\*\/ navigationRef\.navigate\( "Inbox", buildInboxDetailNavigation\(\{ name: "SecurityCaseDetail", params: \{ caseId: entityId, projectId \},/,
    );
  });
});

describe("a phone that has to register again", () => {
  it("is marked, never deleted, when Expo says it is gone", () => {
    const userPushService: string = flat(
      common("Server/Services/UserPushService.ts"),
    );

    expect(userPushService).toMatch(
      /private async markPushTokenAsGone\([^)]*\): Promise<number> \{ return await this\.updateBy\(\{ query: \{ deviceToken: data\.deviceToken, deviceType: data\.deviceType, isVerified: true, \.\.\.\(data\.userId \? \{ userId: data\.userId \} : \{\}\), \}, data: \{ isVerified: false, \},/,
    );

    // A refused ticket, and a receipt read later, both stop sending the same way.
    expect(flat(common("Server/Services/PushNotificationService.ts"))).toMatch(
      /public static async stopSendingToGoneExpoPushToken\(.{0,400}?UserPushService\.markExpoPushTokenAsGone\(/,
    );
    expect(common("Server/Services/ExpoPushReceiptService.ts")).toContain(
      "await PushNotificationService.stopSendingToGoneExpoPushToken(",
    );
    expect(
      flat(dashboard("src/Components/NotificationMethods/Push.tsx")),
    ).toMatch(
      /\{item\.isVerified === false \? \(.{0,300}?text="Not receiving notifications"/,
    );
    expect(
      englishSection(FAQ, "## When a phone has to register again"),
    ).toContain(
      "The phone is not deleted: **User Settings → Notification Methods**, on the **Push Notifications** tab, shows it as **Not receiving notifications**",
    );
  });

  it("is reported by a receipt about 15 minutes after the push", () => {
    const minutes: number =
      millisecondsConstant(
        common("Server/Infrastructure/ExpoPushReceiptQueue.ts"),
        "EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS",
      ) / 60000;

    expect(minutes).toBe(15);
    expect(
      englishSection(FAQ, "## When a phone has to register again"),
    ).toContain(`about ${minutes} minutes later`);
  });

  it("registers again each time the app starts, on sign-in and on coming back, at most every five minutes", () => {
    const minutes: number =
      millisecondsConstant(
        mobile("src/hooks/usePushNotifications.ts"),
        "FOREGROUND_REGISTRATION_INTERVAL_MS",
      ) / 60000;

    expect(MINUTES_IN_WORDS[minutes]).toBe("five");
    expect(
      englishSection(FAQ, "## When a phone has to register again"),
    ).toContain(
      `The app registers the phone each time it starts, when you sign in, and when you come back to it, at most once every ${MINUTES_IN_WORDS[minutes]} minutes.`,
    );
  });

  it("is verified again, with its rules, when it registers again", () => {
    expect(flat(common("Server/API/UserPushAPI.ts"))).toContain(
      "await this.service.verifyExpoPushDeviceRegisteredAgain(",
    );
    expect(
      rowStartingWith(
        tableWithHeader(
          englishSection(FAQ, "## When a phone has to register again"),
          "What happened",
        ),
        "The app is still installed",
      ),
    ).toEqual([
      "The app is still installed",
      "Open it while signed in",
      "The phone receives notifications again, with its rules",
    ]);
  });

  it("is taken over by a phone set up from its backup only while it is marked", () => {
    const userPushService: string = flat(
      common("Server/Services/UserPushService.ts"),
    );

    expect(mobile("src/hooks/pushTokenUtils.ts")).toContain(
      "export async function getPreviousPushTokenToReport(",
    );
    expect(userPushService).toMatch(
      /public async renewExpoPushDevice\(.*?const previous: UserPush \| null = await this\.findOneBy\(\{ query: \{ userId: data\.userId, projectId: data\.projectId, deviceToken: data\.previousDeviceToken, deviceType: new Includes\(\[\.\.\.EXPO_PUSH_DEVICE_TYPES\]\), isVerified: false, \},/,
    );
    expect(
      rowStartingWith(
        tableWithHeader(
          englishSection(FAQ, "## When a phone has to register again"),
          "What happened",
        ),
        "A new phone, set up from a backup of the old one",
      )[2],
    ).toBe(
      "If the old phone's entry is marked, the new phone takes it over, with its rules; if not, the new phone gets an entry of its own",
    );
  });

  it("lists, in order, the six ways a phone stops and what to do about each", () => {
    expect(
      tableWithHeader(
        englishSection(FAQ, "## When a phone has to register again"),
        "What happened",
      ).map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "The app is still installed",
      "You reinstalled the app on an iPhone or iPad",
      "You reinstalled the app on Android",
      "A new phone, set up from a backup of the old one",
      "A new phone, set up from scratch",
      "You signed out of the app",
    ]);
  });

  it("is what the Android and iOS pages send a marked phone's owner to", () => {
    for (const page of MOBILE_PAGES) {
      expect(detailsBlock(page, "No notifications arrive")).toContain(
        "[When a phone has to register again](/docs/mobile-desktop-apps/faq-troubleshooting#when-a-phone-has-to-register-again)",
      );
    }
  });
});

describe("what the mobile app keeps and shows", () => {
  it("keeps the sign-in in its own storage, as the README says, and Log Out deletes it", () => {
    const keychain: string = mobile("src/storage/keychain.ts");
    const logout: string = flat(mobile("src/api/auth.ts"));

    expect(keychain).toContain(
      'import AsyncStorage from "@react-native-async-storage/async-storage";',
    );
    expect(keychain).not.toMatch(/expo-secure-store|react-native-keychain/);
    expect(mobile("README.md")).toContain(
      "The session's tokens and the server URL are stored in AsyncStorage, the app's own storage on the device",
    );
    expect(logout).toMatch(
      /export async function logout\(\): Promise<void> \{.*?`\$\{serverUrl\}\/identity\/logout`/,
    );
    expect(detailsBlock(FAQ, "Is my sign-in safe on the phone?")).toContain(
      "Your sign-in is kept in the app's own storage on the phone, and **Log Out** deletes it and signs the session out on the server.",
    );
  });

  it("lists the app's tabs as it draws them, in order", () => {
    const tabs: Array<string> = Array.from(
      mobile("src/navigation/MainTabNavigator.tsx").matchAll(TAB_LABEL),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const leads: Array<string> = Array.from(
      detailsBlock(FAQ, "What can I do in the app?").matchAll(LIST_ITEM_LEAD),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(tabs).toEqual(["Home", "Monitors", "Inbox", "On-Call", "Settings"]);
    expect(leads).toEqual(tabs);
  });

  it("names the inbox's actions and On-Call's Cover for me as the app draws them", () => {
    for (const screen of ["IncidentDetailScreen", "AlertDetailScreen"]) {
      const source: string = mobile(`src/screens/${screen}.tsx`);

      expect(source).toContain('label: "Acknowledge",');
      expect(source).toContain('label: "Resolve",');
    }

    expect(mobile("src/components/NotesSection.tsx")).toContain(
      'label="Add Note"',
    );
    expect(mobile("src/screens/OnCallOverviewScreen.tsx")).toContain(
      'label="Cover for me"',
    );

    const answer: string = detailsBlock(FAQ, "What can I do in the app?");

    expect(answer).toContain(
      "Open one to **Acknowledge**, **Resolve** or **Add Note**.",
    );
    expect(answer).toContain("and **Cover for me**, which hands your pages");
  });

  it("names the Security category and a case's actions as the app draws them, for the people who can see the project's cases", () => {
    const inbox: string = flat(mobile("src/screens/InboxScreen.tsx"));
    const home: string = flat(mobile("src/screens/HomeScreen.tsx"));
    const availability: string = flat(mobile("src/hooks/useSecurityCases.ts"));
    const caseScreen: string = mobile(
      "src/screens/SecurityCaseDetailScreen.tsx",
    );
    const approval: string = mobile(
      "src/components/security/PlaybookApproval.tsx",
    );

    /*
     * The Inbox's category and Home's row show only when the project's
     * cases can be counted: a role without them is refused the count.
     */
    expect(inbox).toContain('{ key: "security", label: "Security",');
    expect(inbox).toContain(
      'category.key !== "security" || security.isAvailable ||',
    );
    expect(home).toContain(
      '{securityCounts.isAvailable ? ( <ListGroup testID="home-security"',
    );
    expect(home).toContain('label="Open security cases"');
    expect(availability).toContain(
      "isAvailable: Boolean(projectId) && (query.data ?? 0) > 0,",
    );
    expect(mobile("src/api/securityCases.ts")).toContain(
      '"/api/security-case/count",',
    );

    expect(approval).toContain('label="Approve"');
    expect(approval).toContain('label="Reject"');
    expect(caseScreen).toContain('label: "Assign to me",');
    expect(caseScreen).toContain('label: "Close case",');

    const answer: string = detailsBlock(FAQ, "What can I do in the app?");

    expect(answer).toContain(
      "active incidents and alerts, open security cases if your role lets you see them, monitors with issues, and grouped events.",
    );
    expect(answer).toContain(
      "If your role lets you see the project's security cases, **Security** lists the open ones: open one to **Approve** or **Reject** a playbook step waiting for approval, take it on with **Assign to me**, or **Close case**.",
    );
    expect(englishPage(APPS_OVERVIEW)).toContain(
      "| What you can do | Incidents, alerts, security cases, monitors and who is on call; acknowledge, resolve, approve playbook steps and add notes | Everything the dashboard does |",
    );
  });

  it("says No internet connection while it is offline", () => {
    expect(mobile("src/components/OfflineBanner.tsx")).toContain(
      "No internet connection",
    );
    expect(detailsBlock(FAQ, "Does the app work offline?")).toContain(
      "No. It shows **No internet connection** at the top of the screen",
    );
  });

  it("shows Biometrics Login once the phone has biometrics set up, and Appearance beside it", () => {
    const settings: string = flat(mobile("src/screens/SettingsScreen.tsx"));
    const biometric: string = flat(mobile("src/hooks/useBiometric.ts"));

    expect(settings).toMatch(
      /\{biometric\.isAvailable \? \( <ListGroup title="Security"[^>]*> <ListItem title="Biometrics Login"/,
    );
    expect(biometric).toContain(
      "const compatible: boolean = await LocalAuthentication.hasHardwareAsync(); const enrolled: boolean = await LocalAuthentication.isEnrolledAsync();",
    );
    expect(settings).toContain('title="Appearance"');
    expect(englishSection(ANDROID, "## Lock the app")).toContain(
      "The switch is there once the phone has a fingerprint or face unlock set up.",
    );
    expect(englishSection(IOS, "## Lock the app")).toContain(
      "The switch is there once Face ID or Touch ID is set up on the device.",
    );
  });

  it("shows its version at the bottom of its Settings screen", () => {
    expect(mobile("src/screens/SettingsScreen.tsx")).toContain(
      'OneUptime · Version {Constants.expoConfig?.version || "unknown"}',
    );

    for (const page of MOBILE_PAGES) {
      expect(englishPage(page)).toContain(
        "The app's version is at the bottom of its **Settings** screen.",
      );
    }

    expect(englishSection(FAQ, "## Get help")).toContain(
      "with your app's version, from the bottom of its **Settings** screen",
    );
  });
});

describe("the desktop app", () => {
  interface Manifest {
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
  }

  it("installs from a dashboard page: the Dashboard's manifest starts and stays in /dashboard/", () => {
    const manifest: Manifest = JSON.parse(
      dashboard("public/manifest.json"),
    ) as Manifest;

    expect({
      start: manifest.start_url,
      scope: manifest.scope,
      display: manifest.display,
    }).toEqual({
      start: "/dashboard/",
      scope: "/dashboard/",
      display: "standalone",
    });
    expect(dashboard("views/index.ejs")).toContain(
      '<link rel="manifest" href="/dashboard/manifest.json">',
    );

    for (const page of DESKTOP_PAGES) {
      expect(englishSection(page, "## Install the app")).toContain(
        "Install from a dashboard page, after you sign in: the sign-in page is not the app.",
      );
    }
  });

  it("cannot install from the sign-in page, which links no manifest of its own", () => {
    expect(readRepoFile("App/FeatureSet/Accounts/views/index.ejs")).not.toMatch(
      /<link rel="manifest" href="[^"]*manifest\.json">/,
    );
  });

  it("is found under the name its manifest gives it", () => {
    const manifest: Manifest = JSON.parse(
      dashboard("public/manifest.json"),
    ) as Manifest;

    expect(manifest.short_name).toBe("OneUptime");
    expect(englishSection(WINDOWS, "## Install the app")).toContain(
      `Search the Start menu for ${manifest.short_name} to open it later.`,
    );
    expect(englishSection(MACOS, "## Keep it in the Dock")).toContain(
      `Press Command-Space and type ${manifest.short_name}.`,
    );
  });

  it("loads the dashboard from OneUptime each time it opens: the service worker asks the network first for pages", () => {
    const worker: string = flat(dashboard("sw.js.template"));

    expect(worker).toMatch(
      /\/\/ Strategy 1: Network First for HTML pages \(with fallback\) if \(.*?pathname === '\/dashboard'.*?\) \{ return await networkFirstWithFallback\(request, DYNAMIC_CACHE\);/,
    );

    for (const page of DESKTOP_PAGES) {
      expect(englishSection(page, "## Updates")).toContain(
        "The app loads the dashboard from your OneUptime each time it opens, so it changes when your OneUptime is upgraded.",
      );
    }
  });

  it("suggests the device name the Dashboard suggests for that browser and system", () => {
    const suggested: Record<string, string> = {
      [WINDOWS]: getDefaultDeviceName({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
        brands: [{ brand: "Microsoft Edge" }, { brand: "Chromium" }],
      }),
      [MACOS]: getDefaultDeviceName({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        maxTouchPoints: 0,
      }),
      [LINUX]: getDefaultDeviceName({
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        brands: [{ brand: "Google Chrome" }, { brand: "Chromium" }],
      }),
    };

    expect(suggested).toEqual({
      [WINDOWS]: "Edge on Windows",
      [MACOS]: "Safari on macOS",
      [LINUX]: "Chrome on Linux",
    });

    for (const page of DESKTOP_PAGES) {
      expect(codeIn(englishPage(page))).toContain(suggested[page]);
    }
  });

  it("registers through the dialog the Dashboard draws, by its labels", () => {
    const push: string = dashboard(
      "src/Components/NotificationMethods/Push.tsx",
    );

    expect(push).toContain('submitButtonText="Register Device"');
    expect(push).toContain('title: "Device Name",');
    expect(push).toContain(': "Browser Registered"');
    expect(push).toContain('submitButtonText="Send Test Notification"');

    for (const page of DESKTOP_PAGES) {
      const words: Array<string> = boldOnPage(page);

      for (const label of [
        "Register Device",
        "Device Name",
        "Browser Registered",
        "Send Test Notification",
      ]) {
        expect(words).toContain(label);
      }
    }
  });

  it("needs HTTPS and the server's VAPID keys, and is unblocked as the Dashboard says", () => {
    const registration: string = flat(
      dashboard(
        "src/Components/NotificationMethods/BrowserPushRegistration.ts",
      ),
    );

    expect(registration).toContain(
      "Push notifications are not set up on this OneUptime server. An administrator needs to set the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.",
    );
    expect(registration).toContain(
      "Browsers only allow push notifications over a secure connection. Open OneUptime over HTTPS to register this browser.",
    );
    expect(registration).toContain(
      "Click the icon at the left of the address bar, allow notifications for this site, and then register this browser again.",
    );

    for (const page of DESKTOP_PAGES) {
      const noNotifications: string = flat(
        detailsBlock(page, "No notifications appear"),
      );

      expect(noNotifications).toContain(
        "the **Register Device** dialog says when the server has no VAPID keys.",
      );
      expect(englishSection(page, "## Before you begin")).toContain(
        "Your OneUptime's address, over HTTPS:",
      );
    }

    for (const page of [WINDOWS, LINUX]) {
      expect(detailsBlock(page, "No notifications appear")).toContain(
        "click the icon at the left of the address bar, allow notifications for the site, and register the browser again.",
      );
    }
  });

  it("cannot ring through Do Not Disturb, and the pages say to use the mobile app instead", () => {
    for (const page of DESKTOP_PAGES) {
      expect(
        englishSection(
          page,
          page === MACOS
            ? "## Get notifications on this Mac"
            : "## Get notifications on this computer",
        ),
      ).toContain(
        "For pages that must wake you, use the mobile app with critical alerts",
      );
    }
  });
});
