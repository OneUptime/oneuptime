import {
  BROWSER_PUSH_PROBLEM_MESSAGES,
  BROWSER_PUSH_PROBLEM_MESSAGES_WITHOUT_APP,
  BrowserPushProblem,
  getBrowserPushProblemMessage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import { ON_CALL_SETUP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetup";
import { WEBSITE_DOWN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import { WELCOME_MORE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistCatalog";
import { MEMBER_FIRST_STEPS_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/MemberFirstSteps/MemberFirstStepsModel";
import { AI_ACTION_LINES } from "../../../Types/AI/AIActionWords";
import ComplianceRule from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO SENTENCE NAMES A MOBILE APP THE SERVER DOES NOT OFFER (#10945).
 *
 * A self-hosted server's admins can take the mobile app away (Admin
 * Dashboard > Settings > Help and Support > Get the Mobile App). Every
 * prompt to get it goes with it (#10866). A few sentences elsewhere still
 * named the app in passing, as a way to be reached: the website and
 * on-call setups' "by SMS, a phone call or the mobile app", Home's "Add
 * your phone or the mobile app", an import's "a phone number, an email
 * address or the mobile app", a browser that cannot take push told to
 * "install the OneUptime On-Call app", and Ask AI's "The mobile app is not
 * set up for you yet".
 *
 * Each now has a sentence without the app, shown where the server does not
 * offer it, and the sentence it always had everywhere else. This suite
 * reads every sentence of the Dashboard's that names the on-call app - in
 * en.json, and still in the code - and holds each to one of two lists:
 *
 *   PAIRS   a sentence with the app, and the one shown without it; each in
 *           every Dashboard language, and different from the first;
 *   STAYS   a sentence that stays as it is, with why: it describes a phone
 *           that already runs the app, it is part of a prompt to get the
 *           app (which goes when the app does), or it says the app is off.
 *
 * A new sentence that names the app fails here until it is put on one of
 * them: whether it should leave the app out is a decision, made where it is
 * written.
 */

const REPOSITORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD_LOCALES: string = path.join(
  REPOSITORY,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

/*
 * The Enterprise Edition's screens, where ee/ is checked out: the Common
 * test job removes ee/ before it runs (core runs without ee/), and the
 * Enterprise Edition's own jobs keep it.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY, "ee", "Dashboard"),
);

// Where the Dashboard's sentences are written.
const SOURCE_ROOTS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/Common/Types",
  "packages/Common/UI",
  "packages/Common/Utils",
  ...(ENTERPRISE_PRESENT ? ["ee/Dashboard"] : []),
];

const SKIPPED_FOLDERS: ReadonlyArray<string> = [
  "node_modules",
  "Locales",
  "build",
  "dist",
];

// What names OneUptime's own mobile app, the on-call app.
const NAMES_THE_APP: RegExp = /mobile app|on-call app|app store|google play/i;

// The word itself, as a sentence without the app must never say it.
const NAMES_ANY_APP: RegExp = /\bapp\b/i;

/*
 * Sentences that name a mobile app or an app store that is not OneUptime's
 * on-call app: an app of the project's own that sends telemetry (Real User
 * Monitoring, ingestion keys), and Microsoft Teams' store.
 */
const NOT_THE_ON_CALL_APP: ReadonlyArray<string> = [
  "How OneUptime recognises a mobile app",
  "Install the OneUptime app directly from the Microsoft Teams App Store to enable notifications and integrations.",
  "For servers, containers and OpenTelemetry collectors. Keep it secret: never put it in a browser or a mobile app.",
  "Your web and mobile apps, as their real users see them. Each app appears here once it sends telemetry.",
  "Add the OpenTelemetry SDK to your web or mobile app. Every page load, Core Web Vital, error and session shows up, linked to the backend traces behind each click.",
  "Mobile apps send with a Mobile key. It ships inside your app, so anyone who has the app can copy it, but a copy can only send this app's traces, logs, metrics and session replays, all filed under the service name the key is pinned to. Pick a key or create one; the settings below update to use it.",
  "Not used — a mobile app sends no origin, and a request from a web page is refused.",
  "Safe to ship in a mobile app. Everything sent with it is filed under the pinned service name below, and it is accepted only for that app's traces, logs, metrics and session replays, never from a web page.",
  "Server key: keep it secret. It can send every kind of telemetry to this project from anywhere, so put it only in server environment variables and collector settings. Never put it in a web page or a mobile app: use a Browser key in a page and a Mobile key in an app.",
];

interface Pair {
  withApp: string;
  withoutApp: string;
  // Where it is shown.
  where: string;
}

const PAIRS: ReadonlyArray<Pair> = [
  {
    withApp: BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.NeedsHomeScreen],
    withoutApp:
      BROWSER_PUSH_PROBLEM_MESSAGES_WITHOUT_APP[
        BrowserPushProblem.NeedsHomeScreen
      ]!,
    where:
      "Register Device, How to Reach Me and the on-call setup, on an iPhone or iPad",
  },
  {
    withApp: BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.NotSupported],
    withoutApp:
      BROWSER_PUSH_PROBLEM_MESSAGES_WITHOUT_APP[
        BrowserPushProblem.NotSupported
      ]!,
    where:
      "Register Device, How to Reach Me and the on-call setup, in a browser without push",
  },
  {
    withApp:
      "People you invited accept their invitation, then add a phone number, an email address or the mobile app to be paged on.",
    withoutApp:
      "People you invited accept their invitation, then add a phone number or an email address to be paged on.",
    where: "An on-call tool's import report: Make sure everyone can be paged",
  },
  {
    withApp: WELCOME_MORE_COPY.phoneDescription,
    withoutApp: WELCOME_MORE_COPY.phoneDescriptionWithoutApp,
    where: "Home's welcome card: Get paged by SMS or phone call",
  },
  {
    withApp: WEBSITE_DOWN_COPY.noEmail,
    withoutApp: WEBSITE_DOWN_COPY.noEmailWithoutApp,
    where: "The website setup, on a server that cannot send email",
  },
  {
    withApp: WEBSITE_DOWN_COPY.noEmailForAdmin,
    withoutApp: WEBSITE_DOWN_COPY.noEmailForAdminWithoutApp,
    where:
      "The website setup, on a server that cannot send email, for its admin",
  },
  {
    withApp: WEBSITE_DOWN_COPY.testDidNotGetItHelp,
    withoutApp: WEBSITE_DOWN_COPY.testDidNotGetItHelpWithoutApp,
    where: "The website and on-call setups' test page: I did not get it",
  },
  {
    withApp: ON_CALL_SETUP_COPY.pushRow,
    withoutApp: ON_CALL_SETUP_COPY.pushRowWithoutApp,
    where: "The on-call setup: How should we reach you?",
  },
  {
    withApp: ON_CALL_SETUP_COPY.pushHelp,
    withoutApp: ON_CALL_SETUP_COPY.pushHelpWithoutApp,
    where: "The on-call setup: How should we reach you? (#10866)",
  },
  {
    withApp: ON_CALL_SETUP_COPY.serverNoTwilio,
    withoutApp: ON_CALL_SETUP_COPY.serverNoTwilioWithoutApp,
    where: "The on-call setup, on a server without Twilio",
  },
  {
    withApp: ON_CALL_SETUP_COPY.serverNoTwilioForAdmin,
    withoutApp: ON_CALL_SETUP_COPY.serverNoTwilioForAdminWithoutApp,
    where: "The on-call setup, on a server without Twilio, for its admin",
  },
  {
    withApp: MEMBER_FIRST_STEPS_COPY.emailCannotReachDescription,
    withoutApp: MEMBER_FIRST_STEPS_COPY.emailCannotReachWithoutAppDescription,
    where: "A new member's first steps on Home (#10866)",
  },
  {
    withApp: MEMBER_FIRST_STEPS_COPY.onlyEmailDescription,
    withoutApp: MEMBER_FIRST_STEPS_COPY.onlyEmailWithoutAppDescription,
    where: "A new member's first steps on Home (#10866)",
  },
  {
    withApp:
      "Phones signed in to the OneUptime On-Call app, and browsers you register here, get push notifications for this project.",
    withoutApp:
      "Browsers you register here get push notifications for this project.",
    where: "Notification Methods: Push Notification Devices (#10866)",
  },
  {
    withApp: AI_ACTION_LINES.noMobileApp,
    withoutApp: AI_ACTION_LINES.noPushDeviceWithoutApp,
    where: "Ask AI's approval card for set_up_paging",
  },
  {
    withApp: ComplianceRule.getDefinition(
      ComplianceRuleType.HasNotificationPushMethod,
    )!.description,
    withoutApp: ComplianceRule.getDefinition(
      ComplianceRuleType.HasNotificationPushMethod,
    )!.descriptionWithoutApp!,
    where: "A team's compliance rules: Verified push device",
  },
];

enum Why {
  // A phone that already runs the app: its critical alerts, its push token.
  DeviceWithTheApp = "describes a phone that already runs the app",
  // Drawn only while the server offers the app, and gone with it.
  PromptToGetTheApp = "is part of a prompt to get the app, which goes with it",
  // Says the app is off on this server.
  AppTurnedOff = "says the server's admins turned the app off",
}

const STAYS: Readonly<Record<string, Why>> = {
  "Mobile Apps": Why.PromptToGetTheApp,
  "For devices without the Google Play Store.": Why.PromptToGetTheApp,
  "App Store": Why.PromptToGetTheApp,
  "Google Play": Why.PromptToGetTheApp,
  "Get paged on critical incidents, manage your rotation, and respond — all from your phone. Install the OneUptime On-Call app on your device.":
    Why.PromptToGetTheApp,
  "Get the mobile app": Why.PromptToGetTheApp,
  "Get push notifications on your phone with the OneUptime On-Call app. Its critical alerts ring even on silent.":
    Why.PromptToGetTheApp,
  "Install the app from the App Store or Google Play, sign in to {{serverUrl}}, and allow notifications and critical alerts when it asks.":
    Why.PromptToGetTheApp,
  "The mobile app was removed from this device, or its push token is no longer valid. Open the mobile app on it to register it again.":
    Why.DeviceWithTheApp,
  "A critical alert rings through only on a phone with Critical On-Call Alerts turned on in the OneUptime On-Call app.":
    Why.DeviceWithTheApp,
  "On-call pages to this device override silent mode and Do Not Disturb, except from on-call rules set to Standard. Set in the OneUptime On-Call mobile app, which updates it here each time it's opened.":
    Why.DeviceWithTheApp,
  "Rings like a standard push until Critical On-Call Alerts is turned on in the OneUptime On-Call app on this phone.":
    Why.DeviceWithTheApp,
  "No Critical Alerts switch there? Update {{app}} from the App Store: versions before 1.5.0 cannot receive critical alerts.":
    Why.DeviceWithTheApp,
  "No mobile app on this server": Why.AppTurnedOff,
  "This server's admins turned the mobile app off. Pages reach you through the other ways in How to Reach Me.":
    Why.AppTurnedOff,
};

const LANGUAGES: Array<string> = fs
  .readdirSync(DASHBOARD_LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

type Locale = Record<string, unknown>;

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Locale;
};

// Every .ts and .tsx file under a root, but for the folders above.
const readSources: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const texts: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.includes(entry.name)) {
        texts.push(...readSources(path.join(directory, entry.name)));
      }
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      texts.push(fs.readFileSync(path.join(directory, entry.name), "utf8"));
    }
  }

  return texts;
};

/*
 * The sentences of the Dashboard's that name the on-call app and are still
 * written in its code: en.json keeps the words of a sentence the code no
 * longer has until it is tidied, and those are not drawn.
 */
const findSentencesThatNameTheApp: () => Array<string> = (): Array<string> => {
  const source: string = SOURCE_ROOTS.map((root: string): string => {
    return readSources(path.join(REPOSITORY, root)).join("\n");
  }).join("\n");
  const english: Locale = readLocale("en");

  return Object.values(english)
    .filter((value: unknown): value is string => {
      return typeof value === "string";
    })
    .filter((sentence: string): boolean => {
      return (
        NAMES_THE_APP.test(sentence) &&
        (source.includes(sentence) ||
          source.includes(JSON.stringify(sentence).slice(1, -1)))
      );
    });
};

describe("every sentence that names the mobile app is a decision (#10945)", () => {
  const namingAnApp: Array<string> = findSentencesThatNameTheApp();
  const found: Array<string> = namingAnApp.filter(
    (sentence: string): boolean => {
      return !NOT_THE_ON_CALL_APP.includes(sentence);
    },
  );
  const withApp: Array<string> = PAIRS.map((pair: Pair): string => {
    return pair.withApp;
  });

  test("the sweep reads the Dashboard's sentences, the ones this issue named among them", () => {
    expect(found.length).toBeGreaterThan(15);
    expect(found).toContain(WELCOME_MORE_COPY.phoneDescription);
    expect(found).toContain(WEBSITE_DOWN_COPY.noEmail);
    expect(found).toContain(
      BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.NotSupported],
    );
  });

  test("each one has a sentence without the app, or says why it stays", () => {
    const undecided: Array<string> = found.filter(
      (sentence: string): boolean => {
        return !withApp.includes(sentence) && !(sentence in STAYS);
      },
    );

    expect(undecided).toEqual([]);
  });

  test("every sentence listed is still one the Dashboard draws", () => {
    const listed: Array<string> = [...Object.keys(STAYS)];
    const english: Locale = readLocale("en");

    for (const sentence of NOT_THE_ON_CALL_APP) {
      expect({ sentence, isDrawn: namingAnApp.includes(sentence) }).toEqual({
        sentence,
        isDrawn: true,
      });
    }

    for (const sentence of listed) {
      expect({ sentence, isDrawn: found.includes(sentence) }).toEqual({
        sentence,
        isDrawn: true,
      });
    }

    for (const pair of PAIRS) {
      expect({ pair: pair.withApp, isKey: pair.withApp in english }).toEqual({
        pair: pair.withApp,
        isKey: true,
      });
      expect({
        pair: pair.withoutApp,
        isKey: english[pair.withoutApp] === pair.withoutApp,
      }).toEqual({ pair: pair.withoutApp, isKey: true });
    }
  });

  test("a sentence without the app never names it, and never reads as its sentence with it", () => {
    for (const pair of PAIRS) {
      expect({
        where: pair.where,
        sentence: pair.withoutApp,
        namesTheApp: NAMES_ANY_APP.test(pair.withoutApp),
        isTheSame: pair.withoutApp === pair.withApp,
      }).toEqual({
        where: pair.where,
        sentence: pair.withoutApp,
        namesTheApp: false,
        isTheSame: false,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s words every sentence without the app, unlike the one with it",
    (language: string) => {
      const locale: Locale = readLocale(language);

      for (const pair of PAIRS) {
        const without: unknown = locale[pair.withoutApp];

        expect({
          language,
          sentence: pair.withoutApp,
          isWorded: typeof without === "string" && without !== pair.withoutApp,
          differsFromTheAppsSentence: without !== locale[pair.withApp],
        }).toEqual({
          language,
          sentence: pair.withoutApp,
          isWorded: true,
          differsFromTheAppsSentence: true,
        });
      }
    },
  );
});

describe("a browser that cannot take push (#10945)", () => {
  test("is offered the app only where the server offers it", () => {
    for (const problem of [
      BrowserPushProblem.NeedsHomeScreen,
      BrowserPushProblem.NotSupported,
    ]) {
      expect(getBrowserPushProblemMessage(problem, true)).toBe(
        BROWSER_PUSH_PROBLEM_MESSAGES[problem],
      );
      expect(getBrowserPushProblemMessage(problem, false)).toBe(
        BROWSER_PUSH_PROBLEM_MESSAGES_WITHOUT_APP[problem],
      );
      expect(getBrowserPushProblemMessage(problem, false)).not.toContain("app");
    }
  });

  test("every other problem reads the same either way: it never named the app", () => {
    for (const problem of Object.values(BrowserPushProblem)) {
      if (problem in BROWSER_PUSH_PROBLEM_MESSAGES_WITHOUT_APP) {
        continue;
      }

      expect(getBrowserPushProblemMessage(problem, false)).toBe(
        BROWSER_PUSH_PROBLEM_MESSAGES[problem],
      );
      expect(BROWSER_PUSH_PROBLEM_MESSAGES[problem]).not.toMatch(NAMES_THE_APP);
    }
  });
});

describe("the on-call setup and the website setup say the same thing", () => {
  test("I did not get it, without the app, is the website setup's own sentence", () => {
    expect(ON_CALL_SETUP_COPY.testDidNotGetItHelpWithoutApp).toBe(
      WEBSITE_DOWN_COPY.testDidNotGetItHelpWithoutApp,
    );
    expect(ON_CALL_SETUP_COPY.testDidNotGetItHelp).toBe(
      WEBSITE_DOWN_COPY.testDidNotGetItHelp,
    );
  });
});
