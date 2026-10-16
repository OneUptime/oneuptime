import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CRITICAL_ALERT_HOW_TO_HEAR_IT,
  CRITICAL_ALERT_ONCE_ON,
  CRITICAL_ALERT_STEPS,
  CRITICAL_ALERT_TROUBLESHOOTING,
  MOBILE_APP_LABELS,
  PushDevicePlatform,
} from "../../FeatureSet/Dashboard/src/Components/NotificationMethods/PushDeviceCriticalAlerts";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";

/*
 * The Push Notification Devices card tells a person how to turn critical
 * alerts on: which app, which tab, which section, which switch, and what
 * iOS or Android asks for after it. All of that lives in the OneUptime
 * On-Call app (packages/MobileApp), not here - so this reads the app's own
 * source and holds the card's words to it. Rename the switch, move it to
 * another section, or change what the app does on the way back from
 * Android's settings, and this fails until the card says the same.
 *
 * It also holds the card to the server: the setting cannot be written from
 * the Dashboard (so the card shows a status, not a control), a browser
 * cannot have it, and a test notification to a phone with it on is sent as
 * a critical alert.
 */

const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..", "..");
const MOBILE_APP: string = path.join(REPOSITORY, "packages", "MobileApp");
const COMMON: string = path.join(REPOSITORY, "packages", "Common");

function read(...parts: Array<string>): string {
  return fs.readFileSync(path.join(...parts), "utf8");
}

const APP_JSON: {
  expo: {
    name: string;
    version: string;
    ios: { bundleIdentifier: string };
    android: { package: string };
  };
} = JSON.parse(read(MOBILE_APP, "app.json"));

const MAIN_TABS: string = read(
  MOBILE_APP,
  "src",
  "navigation",
  "MainTabNavigator.tsx",
);
const SETTINGS_STACK: string = read(
  MOBILE_APP,
  "src",
  "navigation",
  "SettingsStackNavigator.tsx",
);
const SETTINGS_SCREEN: string = read(
  MOBILE_APP,
  "src",
  "screens",
  "SettingsScreen.tsx",
);
const CRITICAL_ALERTS: string = read(
  MOBILE_APP,
  "src",
  "notifications",
  "criticalAlerts.ts",
);
const USE_CRITICAL_ALERTS: string = read(
  MOBILE_APP,
  "src",
  "hooks",
  "useCriticalAlerts.ts",
);
const CRITICAL_ALERTS_REPORT: string = read(
  MOBILE_APP,
  "src",
  "notifications",
  "criticalAlertsReport.ts",
);
const USE_PUSH_NOTIFICATIONS: string = read(
  MOBILE_APP,
  "src",
  "hooks",
  "usePushNotifications.ts",
);
const APP_README: string = read(MOBILE_APP, "README.md");

const WHITESPACE: RegExp = /\s+/;

/*
 * A source with its whitespace taken out, so a pin of code that spans lines
 * does not depend on where prettier wraps it.
 */
function compact(source: string): string {
  return source.split(WHITESPACE).join("");
}

// The source of one exported function of a file, to the next export.
function exportedFunction(source: string, name: string): string {
  const start: number = source.indexOf(`export async function ${name}(`);

  expect(start).toBeGreaterThan(-1);

  const next: number = source.indexOf("\nexport ", start + 1);

  return source.slice(start, next === -1 ? undefined : next);
}

// What the steps say, with the app's labels where the dialog draws them.
function filled(template: string): string {
  return template
    .split("{{app}}")
    .join(MOBILE_APP_LABELS.appName)
    .split("{{settings}}")
    .join(MOBILE_APP_LABELS.settingsTab)
    .split("{{notifications}}")
    .join(MOBILE_APP_LABELS.notificationsSection)
    .split("{{criticalAlerts}}")
    .join(MOBILE_APP_LABELS.criticalAlertsSwitch)
    .split("{{alarmSoundPath}}")
    .join(
      [
        MOBILE_APP_LABELS.settingsTab,
        MOBILE_APP_LABELS.notificationsSection,
        MOBILE_APP_LABELS.alarmSoundRow,
      ].join(" > "),
    )
    .split("{{appStore}}")
    .join("App Store")
    .split("{{googlePlay}}")
    .join("Google Play");
}

// A string constant's value in a source file: const NAME: string = "...";
function stringConstant(source: string, name: string): string {
  const start: number = source.indexOf(`const ${name}: string =`);

  expect(start).toBeGreaterThan(-1);

  const open: number = source.indexOf('"', start);
  const close: number = source.indexOf('";', open + 1);

  return source.slice(open + 1, close);
}

/*
 * The Settings screen's Notifications group: from its <ListGroup> to the
 * end of the <ListGroup> it opens.
 */
function notificationsGroup(): string {
  const start: number = SETTINGS_SCREEN.indexOf(
    `<ListGroup title="${MOBILE_APP_LABELS.notificationsSection}">`,
  );

  expect(start).toBeGreaterThan(-1);

  const end: number = SETTINGS_SCREEN.indexOf("</ListGroup>", start);

  expect(end).toBeGreaterThan(start);

  return SETTINGS_SCREEN.slice(start, end);
}

describe("the steps name the app's own screens", () => {
  test("the app is called what the stores and the phone call it", () => {
    expect(MOBILE_APP_LABELS.appName).toBe(APP_JSON.expo.name);
    expect(MOBILE_APP_LABELS.appName).toBe("OneUptime On-Call");
  });

  test("Settings is a tab of the app, drawn with its label, and opens the Settings screen", () => {
    expect(MAIN_TABS).toContain(`name="${MOBILE_APP_LABELS.settingsTab}"`);
    expect(MAIN_TABS).toContain("component={SettingsStackNavigator}");
    expect(MAIN_TABS).toContain("tabBarShowLabel: true");
    expect(SETTINGS_STACK).toContain("component={SettingsScreen}");
    expect(SETTINGS_STACK).toContain(
      `options={{ title: "${MOBILE_APP_LABELS.settingsTab}" }}`,
    );
  });

  test("the switch is Critical On-Call Alerts, in the Notifications group of that screen", () => {
    const group: string = notificationsGroup();

    expect(group).toContain(
      `title="${MOBILE_APP_LABELS.criticalAlertsSwitch}"`,
    );
    // A switch, read out under the same name.
    expect(group).toContain("<Switch");
    expect(group).toContain(
      `accessibilityLabel="${MOBILE_APP_LABELS.criticalAlertsSwitch}"`,
    );
    expect(group).toContain("onValueChange={handleCriticalAlertsToggle}");
  });

  test("Alarm sound sits in the same group, shown once the switch is on", () => {
    const group: string = notificationsGroup();
    const shownWhenOn: number = group.indexOf("{criticalAlerts.isEnabled ? (");
    const row: number = group.indexOf(
      `title="${MOBILE_APP_LABELS.alarmSoundRow}"`,
    );

    expect(shownWhenOn).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(shownWhenOn);
    expect(group).toContain('navigation.navigate("CriticalAlertSound")');
  });

  test("every step names only labels the app draws", () => {
    const labels: Array<string> = [
      MOBILE_APP_LABELS.settingsTab,
      MOBILE_APP_LABELS.notificationsSection,
      MOBILE_APP_LABELS.criticalAlertsSwitch,
      MOBILE_APP_LABELS.alarmSoundRow,
    ];

    for (const label of labels) {
      expect({
        label,
        drawn: SETTINGS_SCREEN.includes(`title="${label}"`),
      }).toEqual({ label, drawn: true });
    }
  });
});

describe("the steps follow what the app does on each platform", () => {
  test("iOS: turning the switch on asks iOS for critical alerts, and once allowed the app saves it at once", () => {
    const request: number = CRITICAL_ALERTS.indexOf(
      "export async function requestCriticalAlertPermission(",
    );

    expect(request).toBeGreaterThan(-1);
    expect(CRITICAL_ALERTS.slice(request)).toContain(
      "allowCriticalAlerts: true",
    );

    // The hook asks, and only stops short of the server when the OS said no.
    const setEnabled: string = USE_CRITICAL_ALERTS.slice(
      USE_CRITICAL_ALERTS.indexOf("const setEnabled:"),
    );
    const asks: number = setEnabled.indexOf("requestCriticalAlertPermission(");
    const stopsWhenRefused: number = setEnabled.indexOf(
      "status.availability !== CriticalAlertAvailability.Granted",
    );
    const saves: number = setEnabled.indexOf("saveCriticalAlertsChoice(");

    expect(asks).toBeGreaterThan(-1);
    expect(stopsWhenRefused).toBeGreaterThan(asks);
    expect(saves).toBeGreaterThan(stopsWhenRefused);

    // ...and saving it is telling the server.
    expect(
      exportedFunction(CRITICAL_ALERTS_REPORT, "saveCriticalAlertsChoice"),
    ).toContain("setCriticalAlertsEnabledOnServer(");

    expect(CRITICAL_ALERT_STEPS[PushDevicePlatform.IOS].map(filled)).toEqual([
      "Open OneUptime On-Call on this iPhone or iPad and tap Settings.",
      "Under Notifications, turn on Critical On-Call Alerts.",
      "When iOS asks whether OneUptime On-Call may send critical alerts, tap Allow.",
    ]);
  });

  test("Android: the app opens Do Not Disturb access, and the switch has to be turned on again on the way back", () => {
    expect(CRITICAL_ALERTS).toContain(
      '"android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS"',
    );

    /*
     * Coming back only re-reads the OS: the switch shows on only for a
     * choice the app had already saved, and the app saves it only after the
     * server took it - which an Android phone without Do Not Disturb access
     * never reached. So the responder turns it on again.
     */
    expect(compact(USE_CRITICAL_ALERTS)).toContain(
      compact(
        "const reading: CriticalAlertsReading = await readCriticalAlerts();",
      ),
    );
    expect(compact(USE_CRITICAL_ALERTS)).toContain(
      compact("setIsEnabled(reading.isEffective);"),
    );
    expect(compact(CRITICAL_ALERTS_REPORT)).toContain(
      compact(
        "data.isChosen && data.availability === CriticalAlertAvailability.Granted",
      ),
    );

    const save: string = exportedFunction(
      CRITICAL_ALERTS_REPORT,
      "saveCriticalAlertsChoice",
    );

    expect(save.indexOf("setCriticalAlertsEnabledOnServer(")).toBeLessThan(
      save.indexOf("await storeCriticalAlertsEnabled(isEnabled);"),
    );

    expect(
      CRITICAL_ALERT_STEPS[PushDevicePlatform.Android].map(filled),
    ).toEqual([
      "Open OneUptime On-Call on this phone and tap Settings.",
      "Under Notifications, turn on Critical On-Call Alerts.",
      "Android opens Do Not Disturb access. Allow it for OneUptime On-Call.",
      "Go back to the app and turn on Critical On-Call Alerts again.",
    ]);
  });

  test("when it did not turn on, the card says what the app says, and where", () => {
    const iosDenied: string = stringConstant(
      CRITICAL_ALERTS,
      "IOS_DENIED_REASON",
    );
    const iosNotOffered: string = stringConstant(
      CRITICAL_ALERTS,
      "IOS_NOT_OFFERED_REASON",
    );
    const androidDenied: string = stringConstant(
      CRITICAL_ALERTS,
      "ANDROID_DENIED_REASON",
    );

    // The app sends an iPhone that declined to the same switch.
    expect(iosDenied).toContain("Allow Critical Alerts for OneUptime On-Call");
    expect(iosDenied).toContain("iOS Settings > Notifications");
    // ...and one iOS never asked to an App Store update.
    expect(iosNotOffered).toContain(
      "Update OneUptime On-Call from the App Store",
    );
    // ...and an Android phone to Do Not Disturb access.
    expect(androidDenied).toContain(
      "Settings > Notifications > Do Not Disturb access",
    );

    expect(
      CRITICAL_ALERT_TROUBLESHOOTING[PushDevicePlatform.IOS].map(filled),
    ).toEqual([
      "Tapped Don't Allow? Turn on Critical Alerts in iOS Settings > Notifications > OneUptime On-Call, then turn on Critical On-Call Alerts in the app again.",
      "iOS didn't ask? Update OneUptime On-Call from the App Store: versions before 1.5.0 cannot receive critical alerts.",
    ]);
    expect(
      CRITICAL_ALERT_TROUBLESHOOTING[PushDevicePlatform.Android].map(filled),
    ).toEqual([
      "The app still asks for Do Not Disturb access? Allow OneUptime On-Call in the phone's Settings > Notifications > Do Not Disturb access, then turn on Critical On-Call Alerts again.",
    ]);
    expect(CRITICAL_ALERT_TROUBLESHOOTING[PushDevicePlatform.Browser]).toEqual(
      [],
    );
  });

  test("the version the card names is the first App Store build with Apple's entitlement, and the app is past it", () => {
    // The app's README: every App Store build up to 1.4.0 lacked it.
    expect(APP_README).toContain("every App Store build");
    expect(APP_README).toContain("up to 1.4.0");

    const [major, minor] = APP_JSON.expo.version
      .split(".")
      .map((part: string): number => {
        return Number(part);
      });

    expect(major! > 1 || (major === 1 && minor! >= 5)).toBe(true);
  });

  test("once it is on: the alarm is chosen in the app, and the test notification plays it", () => {
    expect(filled(CRITICAL_ALERT_ONCE_ON)).toBe(
      "Once it's on, choose the alarm sound for on-call pages under Settings > Notifications > Alarm sound.",
    );
    expect(CRITICAL_ALERT_HOW_TO_HEAR_IT).toBe(
      "To hear it, silence the phone and send it a Test Notification from this list.",
    );

    // The test plays the device's own alarm, as a page would.
    const api: string = read(COMMON, "Server", "API", "UserPushAPI.ts");

    expect(api).toContain(
      "testMessage.criticalAlertSound = device.criticalAlertSound;",
    );
  });

  test("a browser is sent to the app, on a phone: it installs from the stores, and the same switch", () => {
    expect(
      CRITICAL_ALERT_STEPS[PushDevicePlatform.Browser].map(filled),
    ).toEqual([
      "Install OneUptime On-Call on your phone from the App Store or Google Play.",
      "Open it, connect to {{serverUrl}} and sign in. Allow notifications, and your phone shows up in this list.",
      "In the app, tap Settings and, under Notifications, turn on Critical On-Call Alerts. Allow what the phone asks for, then check the switch is on.",
    ]);

    // The Play Store link is the app's own package.
    expect(new URL(MOBILE_APP_ANDROID_URL).hostname).toBe("play.google.com");
    expect(new URL(MOBILE_APP_ANDROID_URL).searchParams.get("id")).toBe(
      APP_JSON.expo.android.package,
    );
    expect(new URL(MOBILE_APP_IOS_URL).hostname).toBe("apps.apple.com");
    expect(new URL(MOBILE_APP_IOS_URL).pathname).toBe(
      "/us/app/oneuptime-on-call/id6759615391",
    );
  });

  /*
   * A new install opens on "Connect your workspace", with OneUptime
   * Cloud's address filled in. A self-hosted person who only signs in, as
   * the steps used to say, signs in to the wrong OneUptime. So the steps
   * say "connect to <this address>": the origin the app then checks at
   * /api/status, which is where this Dashboard's API is served.
   */
  test("a browser's steps connect the app to this OneUptime first: the app's first screen asks which", () => {
    const serverUrlScreen: string = read(
      MOBILE_APP,
      "src",
      "screens",
      "auth",
      "ServerUrlScreen.tsx",
    );
    const auth: string = read(MOBILE_APP, "src", "api", "auth.ts");

    expect(serverUrlScreen).toContain('title="Connect your workspace"');
    expect(serverUrlScreen).toContain('label="Server URL"');
    expect(serverUrlScreen).toContain('label="Connect"');
    expect(serverUrlScreen).toContain("validateServerUrl(normalizedUrl)");

    // Filled in with OneUptime Cloud's: right for Cloud, wrong for anyone else.
    expect(serverUrlScreen).toContain("const [url, setUrl] = useState(");

    const filledIn: number =
      serverUrlScreen.indexOf("const [url, setUrl] = useState(") +
      "const [url, setUrl] = useState(".length;
    const filledInValue: string = JSON.parse(
      serverUrlScreen.slice(filledIn, serverUrlScreen.indexOf(")", filledIn)),
    ) as string;

    expect(new URL(filledInValue).host).toBe("oneuptime.com");

    // The app checks the address it is given at <address>/api/status.
    const validate: string = auth.slice(
      auth.indexOf("export async function validateServerUrl("),
    );

    expect(validate).toContain("axios.get(`${url}/api/status`");

    // The step names the address, before signing in.
    const connect: string =
      CRITICAL_ALERT_STEPS[PushDevicePlatform.Browser][1]!;

    expect(connect.indexOf("connect to {{serverUrl}}")).toBeGreaterThan(-1);
    expect(connect.indexOf("{{serverUrl}}")).toBeLessThan(
      connect.indexOf("sign in"),
    );

    /*
     * ...and the address is this Dashboard's API origin: its host, as the
     * API's own URL is built (Common/UI/Config's APP_API_URL).
     */
    const helper: string = read(
      REPOSITORY,
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Utils",
      "MobileAppServerUrl.ts",
    );
    const config: string = read(COMMON, "UI", "Config.ts");

    expect(helper).toContain("return `${HTTP_PROTOCOL}${HOST}`;");
    expect(config).toContain(
      "export const APP_HOSTNAME: Hostname = Hostname.fromString(HOST);",
    );
    expect(config).toContain(
      "export const APP_API_URL: URL = new URL(\n  HTTP_PROTOCOL,\n  APP_HOSTNAME,",
    );
  });

  test("the app registers a signed-in phone in every project, so it shows up in this list", () => {
    const usePush: string = read(
      MOBILE_APP,
      "src",
      "hooks",
      "usePushNotifications.ts",
    );

    expect(usePush).toContain("for (const project of projectList)");
    expect(usePush).toContain("await registerPushDevice({");
  });
});

describe("the card shows a status because the server leaves nothing to change here", () => {
  const model: string = read(COMMON, "Models", "DatabaseModels", "UserPush.ts");

  test("nobody may write isCriticalAlertEnabled through the Dashboard's API", () => {
    const column: number = model.indexOf(
      "public isCriticalAlertEnabled?: boolean",
    );

    expect(column).toBeGreaterThan(-1);

    const access: string = model.slice(
      model.lastIndexOf("@ColumnAccessControl({", column),
      column,
    );

    expect(access).toContain("update: [],");
  });

  test("a browser can never have critical alerts: the server refuses the setting for one", () => {
    const service: string = read(
      COMMON,
      "Server",
      "Services",
      "UserPushService.ts",
    );

    expect(service).toContain(
      "Critical alerts are only available on iOS and Android devices.",
    );
  });

  test("a test notification to a phone with critical alerts on is sent as a critical alert, and the answer says how it went", () => {
    const api: string = read(COMMON, "Server", "API", "UserPushAPI.ts");

    expect(api).toContain(
      "const isCriticalAlert: boolean = isTestNotificationCritical(device);",
    );
    expect(compact(api)).toContain(
      compact(
        "isExpoPushDeviceType(device.deviceType) && Boolean(device.isCriticalAlertEnabled)",
      ),
    );
    expect(api).toContain("testMessage.isCriticalAlert = isCriticalAlert;");
    // The Dashboard's dialog words this answer (readTestNotificationIsCritical).
    expect(api).toContain("isCriticalAlert: isCriticalAlert,");
  });
});

/*
 * The column says what the phone will really do because the phone says it.
 * The maintainer turned critical alerts off on an iPhone and the column went
 * on reading "On": the app told the server only its switch, and only when it
 * moved, and a device already registered kept what it was created with.
 * These hold the two sides of the fix to each other.
 */
describe("the column follows the phone because the app tells the server", () => {
  test("registration sends what the phone will do - the switch AND the phone's permission - not the switch alone", () => {
    const registration: string = compact(USE_PUSH_NOTIFICATIONS);

    expect(registration).toContain(
      compact(
        "const criticalAlerts: CriticalAlertsReading = await readCriticalAlerts();",
      ),
    );
    // ...and nothing, when the OS could not be asked.
    expect(registration).toContain(
      compact(
        "criticalAlerts.isCertain ? criticalAlerts.isEffective : undefined;",
      ),
    );
    expect(registration).not.toContain(
      compact("await getCriticalAlertsEnabled()"),
    );
    expect(registration).toContain(
      compact("{ isCriticalAlertEnabled: isCriticalAlertEnabled }"),
    );
  });

  test("the app tells the server again after every registration, and on every return to it", () => {
    const afterRegistering: number = USE_PUSH_NOTIFICATIONS.lastIndexOf(
      "await reportCriticalAlerts(",
    );

    expect(afterRegistering).toBeGreaterThan(
      USE_PUSH_NOTIFICATIONS.indexOf("for (const project of projectList)"),
    );

    // A registration that could not get a token still reports, with the one it has.
    const noToken: string = USE_PUSH_NOTIFICATIONS.slice(
      USE_PUSH_NOTIFICATIONS.indexOf("if (!token || cancelled) {"),
      USE_PUSH_NOTIFICATIONS.indexOf("for (const project of projectList)"),
    );

    expect(noToken).toContain("await reportCriticalAlerts();");

    // A return too soon to register again still reports a change.
    const listener: string = USE_PUSH_NOTIFICATIONS.slice(
      USE_PUSH_NOTIFICATIONS.indexOf("FOREGROUND_REGISTRATION_INTERVAL_MS\n"),
    );

    expect(listener.indexOf("void reportCriticalAlerts();")).toBeGreaterThan(
      -1,
    );
    expect(listener.indexOf("void reportCriticalAlerts();")).toBeLessThan(
      listener.indexOf("setReturnsToForeground("),
    );

    // ...and so does the Settings screen, whenever it reads the OS.
    expect(USE_CRITICAL_ALERTS).toContain("void reportCriticalAlerts();");
  });

  test("the server writes what a re-registering phone restates onto the device it already has", () => {
    const api: string = read(COMMON, "Server", "API", "UserPushAPI.ts");
    const existing: string = api.slice(api.indexOf("if (existingDevice) {"));

    expect(
      existing.indexOf("this.service.restateCriticalAlertEnabled("),
    ).toBeGreaterThan(-1);
    expect(
      existing.indexOf("this.service.restateCriticalAlertEnabled("),
    ).toBeLessThan(existing.indexOf("return Response.sendJsonObjectResponse("));
    expect(existing).toContain("readStatedCriticalAlertFlag(");
  });

  test("the app knows the server's words for a phone it has no device for, so it waits for the registration that makes one", () => {
    const service: string = read(
      COMMON,
      "Server",
      "Services",
      "UserPushService.ts",
    );
    const appMessage: string = stringConstant(
      CRITICAL_ALERTS_REPORT,
      "NO_REGISTERED_DEVICE_MESSAGE",
    );

    expect(appMessage).toBe(
      "No registered device was found for this device token.",
    );
    expect(service).toContain(`"${appMessage}"`);
  });

  test("the column's (i) says the app updates it whenever it is opened, as the app does", () => {
    const card: string = read(
      REPOSITORY,
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "NotificationMethods",
      "Push.tsx",
    );

    expect(card).toContain(
      "Set in the OneUptime On-Call mobile app, which updates it here each time it's opened.",
    );
  });
});
