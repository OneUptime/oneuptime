import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";

/*
 * The calendar-feed feature is one new User Settings page, one new On-Call
 * Duty page, a card on the schedule page, two links, two notification event
 * rows and ~125 strings in sixteen locale files. None of the wiring between
 * them is reachable from a unit test: a PageRoute that imports the wrong
 * page, a breadcrumb missing for a route, an EVENT_LIBRARY row that never made
 * it into the On-Call section, or a locale key that exists in en.json only,
 * all render "fine" and are wrong. So these read the sources and pin the
 * exact expressions, the same way RecommendationPageWiring.test.ts pins the
 * recommendation pages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_TESTS_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Tests",
  "UI",
);

const LOCALES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
];

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

function readCode(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("PageMap / RouteMap", () => {
  const pageMap: string = readCode("Utils", "PageMap.ts");
  /*
   * Read raw: RouteMap's splat routes ("/user-settings/*") look like comment
   * openers to the comment stripper and would swallow half the file.
   */
  const routeMap: string = readSource("Utils", "RouteMap.ts");

  test("both pages have PageMap members", () => {
    expect(pageMap).toContain(
      'USER_SETTINGS_ON_CALL_CALENDAR_FEED = "USER_SETTINGS_ON_CALL_CALENDAR_FEED"',
    );
    expect(pageMap).toContain(
      'ON_CALL_DUTY_CALENDAR_FEEDS = "ON_CALL_DUTY_CALENDAR_FEEDS"',
    );
  });

  test("the user-settings page is at calendar-feed under the project's user settings", () => {
    expect(routeMap).toContain(
      '[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED]: "calendar-feed"',
    );
    expect(routeMap).toContain(
      "[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED]: new Route( `/dashboard/${RouteParams.ProjectID}/user-settings/${ UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] }`, )",
    );
  });

  test("the on-call page is at calendar-feeds under on-call-duty", () => {
    expect(routeMap).toContain(
      '[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS]: "calendar-feeds"',
    );
    expect(routeMap).toContain(
      "[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS]: new Route( `/dashboard/${RouteParams.ProjectID}/on-call-duty/${ OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS] }`, )",
    );
  });

  test("the user-settings route is declared before the section's deliberately-last landing route", () => {
    const calendarIndex: number = routeMap.indexOf(
      "[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED]: new Route(",
    );
    const landingIndex: number = routeMap.indexOf(
      "Declared LAST in this block on purpose",
      calendarIndex,
    );

    expect(calendarIndex).toBeGreaterThan(-1);
    expect(landingIndex).toBeGreaterThan(calendarIndex);
  });
});

describe("Routes", () => {
  test("UserSettingsRoutes mounts the Calendar Feed page under its PageMap route", () => {
    const routes: string = readCode("Routes", "UserSettingsRoutes.tsx");

    expect(routes).toContain(
      'import UserSettingsOnCallCalendarFeed from "../Pages/UserSettings/OnCallCalendarFeed"',
    );
    expect(routes).toContain(
      '<PageRoute path={ UserSettingsRoutePath[ PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED ] || "" } element={ <UserSettingsOnCallCalendarFeed {...props} pageRoute={ RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route } /> } />',
    );
  });

  test("OnCallDutyRoutes mounts the Calendar Feeds page under its PageMap route", () => {
    const routes: string = readCode("Routes", "OnCallDutyRoutes.tsx");

    expect(routes).toContain(
      'import OnCallDutyCalendarFeeds from "../Pages/OnCallDuty/CalendarFeeds"',
    );
    expect(routes).toContain(
      '<PageRoute path={OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS] || ""} element={ <OnCallDutyCalendarFeeds {...props} pageRoute={RouteMap[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS] as Route} /> } />',
    );
  });
});

describe("Breadcrumbs", () => {
  test("both pages have a breadcrumb trail", () => {
    const userSettings: string = readCode(
      "Utils",
      "Breadcrumbs",
      "UserSettingsBreadcrumbs.ts",
    );
    const onCall: string = readCode(
      "Utils",
      "Breadcrumbs",
      "OnCallDutyBreadcrumbs.ts",
    );

    expect(userSettings).toContain(
      '...BuildBreadcrumbLinksByTitles( PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED, ["Project", "User Settings", "Calendar Feed"], )',
    );
    expect(onCall).toContain(
      '...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_CALENDAR_FEEDS, [ "Project", "On-Call Duty", "Calendar Feeds", ])',
    );
  });

  test("the shared breadcrumb fixtures enumerate both routes", () => {
    const trails: string = squash(
      fs.readFileSync(
        path.join(
          COMMON_TESTS_UI,
          "Utils",
          "Breadcrumb",
          "fixtures",
          "RealBreadcrumbTrails.ts",
        ),
        "utf8",
      ),
    );
    const patterns: string = squash(
      fs.readFileSync(
        path.join(
          COMMON_TESTS_UI,
          "Utils",
          "Breadcrumb",
          "fixtures",
          "RealRoutePatterns.ts",
        ),
        "utf8",
      ),
    );

    expect(trails).toContain(
      '{ getter: "getUserSettingsBreadcrumbs", pagePattern: "/dashboard/:projectId/user-settings/calendar-feed", titles: ["Project", "User Settings", "Calendar Feed"], }',
    );
    expect(trails).toContain(
      '{ getter: "getOnCallDutyBreadcrumbs", pagePattern: "/dashboard/:projectId/on-call-duty/calendar-feeds", titles: ["Project", "On-Call Duty", "Calendar Feeds"], }',
    );
    expect(patterns).toContain(
      '"/dashboard/:projectId/user-settings/calendar-feed"',
    );
    expect(patterns).toContain(
      '"/dashboard/:projectId/on-call-duty/calendar-feeds"',
    );
  });
});

describe("Side menus", () => {
  test("User Settings has a Calendar section before Workspace, holding Calendar Feed", () => {
    const menu: string = readCode("Pages", "UserSettings", "SideMenu.tsx");

    const calendarIndex: number = menu.indexOf(
      '{ title: "Calendar", items: [ { link: { title: "Calendar Feed", to: RouteUtil.populateRouteParams( RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route, ), }, icon: IconProp.Calendar, }, ], }',
    );
    const workspaceIndex: number = menu.indexOf('{ title: "Workspace",');

    expect(calendarIndex).toBeGreaterThan(-1);
    expect(workspaceIndex).toBeGreaterThan(calendarIndex);
  });

  test("On-Call Duty lists Calendar Feeds in the Schedules section", () => {
    const menu: string = readCode("Pages", "OnCallDuty", "SideMenu.tsx");

    expect(menu).toContain(
      '{ link: { title: "Calendar Feeds", to: RouteUtil.populateRouteParams( RouteMap[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS] as Route, ), }, icon: IconProp.Link, }',
    );

    const schedulesHeader: string = '{ title: "Schedules", items: [';
    const schedulesIndex: number = menu.indexOf(schedulesHeader);
    const feedsIndex: number = menu.indexOf('title: "Calendar Feeds"');
    // Section headers are the only `title: "...", items: [` shapes in the menu.
    const nextSectionIndex: number = menu.indexOf(
      '", items: [',
      schedulesIndex + schedulesHeader.length,
    );

    expect(feedsIndex).toBeGreaterThan(schedulesIndex);
    expect(feedsIndex).toBeLessThan(nextSectionIndex);
  });
});

describe("Pages and cards", () => {
  test("the User Settings page composes the link card, the upcoming shifts card and the reminders card", () => {
    const page: string = readCode(
      "Pages",
      "UserSettings",
      "OnCallCalendarFeed.tsx",
    );

    expect(page).toContain(
      "<PersonalCalendarFeedCard variant={PersonalCalendarFeedVariant.Full} />",
    );
    expect(page).toContain("<UpcomingShiftsCard />");
    expect(page).toContain(
      "<ShiftRemindersCard projectId={projectId} userId={userId} />",
    );
  });

  test("the On-Call Duty page hosts the project-wide shared feed card", () => {
    const page: string = readCode("Pages", "OnCallDuty", "CalendarFeeds.tsx");

    expect(page).toContain(
      "<SharedCalendarFeedCard kind={SharedCalendarFeedKind.Project} />",
    );
  });

  test("the schedule page renders the subscribe card between the roster alert and the preview, with the schedule's timezone", () => {
    const page: string = readCode(
      "Pages",
      "OnCallDuty",
      "OnCallDutySchedule",
      "Index.tsx",
    );

    const subscribeIndex: number = page.indexOf(
      "<ScheduleSubscribeCard scheduleId={modelId} scheduleTimezone={ onCallSchedule ? onCallSchedule.timezone?.toString() || null : undefined } />",
    );
    const previewIndex: number = page.indexOf("<FinalPreview");

    expect(subscribeIndex).toBeGreaterThan(-1);
    expect(previewIndex).toBeGreaterThan(subscribeIndex);
    // The timezone must be SELECTED for the legacy-timezone warning to work.
    expect(page).toContain("timezone: true,");
  });

  test("the on-call modal and the cross-project page link to the calendar feed page", () => {
    const modal: string = readCode(
      "Components",
      "OnCallPolicy",
      "CurrentOnCallPolicyModal.tsx",
    );
    const myOnCall: string = readCode(
      "Pages",
      "Global",
      "MyOnCallPolicies.tsx",
    );

    expect(modal).toContain(
      "RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route",
    );
    expect(modal).toContain(
      '{translateString("Add your shifts to your calendar")}',
    );

    expect(myOnCall).toContain(
      "UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED]",
    );
    expect(myOnCall).toContain('{translateString("Add to calendar")}');
  });
});

describe("Notification Settings", () => {
  const page: string = readCode(
    "Pages",
    "UserSettings",
    "NotificationSettings.tsx",
  );

  test("both new event types have EVENT_LIBRARY rows", () => {
    expect(page).toContain(
      '[NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS]: { label: "Before my on-call shift starts",',
    );
    expect(page).toContain(
      '[NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED]: { label: "My upcoming on-call shift is reassigned",',
    );
  });

  test("both new event types are listed in the On-Call section", () => {
    const sectionStart: number = page.indexOf(
      "NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY, NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS, NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,",
    );

    expect(sectionStart).toBeGreaterThan(-1);
  });

  test("the enum members the rows key on exist in Common", () => {
    expect(
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
    ).toBe("Before user's on-call shift starts");
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
    ).toBe("User's upcoming on-call shift is reassigned");
  });
});

describe("Setup checklist", () => {
  test("the checklist model knows the calendar-feed step and points at the page", () => {
    const model: string = readCode(
      "Components",
      "UserSettings",
      "SetupChecklist",
      "ChecklistModel.ts",
    );

    expect(model).toContain("calendarFeed?: CalendarFeedProbe | undefined;");
    expect(model).toContain('key: "calendar-feed",');
    expect(model).toContain(
      "pageMap: PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED,",
    );
    expect(model).toContain(
      "if (input.calendarFeed && input.calendarFeed.isKnown) {",
    );
  });

  test("the hook probes /feed/current and treats a 404 as unknown", () => {
    const hook: string = readCode(
      "Components",
      "UserSettings",
      "SetupChecklist",
      "useSetupChecklist.ts",
    );

    expect(hook).toContain(
      "await CalendarFeedAPI.getFeedStatus( PERSONAL_FEED_CURRENT_PATH, )",
    );
    expect(hook).toContain("if (!status) { return UNKNOWN_CALENDAR_FEED; }");
    expect(hook).toContain(
      "hasEnabledLink: status.exists && status.isEnabled,",
    );
    expect(hook).toContain("calendarFeed: calendarFeed,");
  });
});

describe("Locales", () => {
  const en: Record<string, unknown> = readLocale("en");

  const REQUIRED_KEYS: Array<string> = [
    "Calendar",
    "Calendar Feed",
    "Calendar Feeds",
    "Subscribe to your on-call shifts",
    "Subscribe to this schedule",
    "Generate calendar link",
    "Regenerate link",
    "Publish shared link",
    "Remind me before shifts",
    "Upcoming shifts (next 30 days)",
    "Get cover",
    "Apple / other apps",
    "Copy webcal link",
    "Google Calendar",
    "Add your shifts to your calendar",
    "Add to calendar",
    "Before my on-call shift starts",
    "My upcoming on-call shift is reassigned",
    "Google Calendar and Outlook on the web fetch this link from their servers; it must be reachable from the internet. Apple Calendar, Thunderbird and Outlook desktop fetch from your computer.",
  ];

  test("every calendar-feed string is a key in en.json whose value is the key", () => {
    for (const key of REQUIRED_KEYS) {
      expect(en[key]).toBe(key);
    }
  });

  test("every locale carries the same keys, with a non-empty translation", () => {
    for (const locale of LOCALES) {
      const json: Record<string, unknown> = readLocale(locale);

      for (const key of REQUIRED_KEYS) {
        expect(typeof json[key]).toBe("string");
        expect((json[key] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("the fifteen translations mirror en.json key for key", () => {
    const enKeys: Array<string> = Object.keys(en).sort();

    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }

      expect(Object.keys(readLocale(locale)).sort()).toEqual(enKeys);
    }
  });

  test("the strings the components translate at runtime are all in en.json", () => {
    const sources: Array<string> = [
      readSource("Components", "OnCallPolicy", "CalendarFeedLinks.tsx"),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "FeedStatusLine.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "PersonalCalendarFeedCard.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "SharedCalendarFeedCard.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "ShiftRemindersCard.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "UpcomingShiftsCard.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "CalendarFeedPlanGate.tsx",
      ),
      readSource("Pages", "OnCallDuty", "CalendarFeeds.tsx"),
    ];

    const literalPattern: RegExp =
      /translateString\(\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g;
    let found: number = 0;

    for (const source of sources) {
      for (const match of source.matchAll(literalPattern)) {
        const key: string = (match[1] as string).replace(/\\"/g, '"');
        found += 1;
        expect(en[key]).toBe(key);
      }
    }

    expect(found).toBeGreaterThan(30);
  });

  /*
   * Sentences with values in them go through translateInterpolated: ONE
   * whole-sentence key with {{placeholders}} that a translator can reorder,
   * never a translated fragment glued to a value. Those keys skip the
   * translateString scan above, so they get their own.
   */
  test("every interpolated sentence is a key in en.json, placeholders and all", () => {
    const sources: Array<string> = [
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "FeedStatusLine.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "UpcomingShiftsCard.tsx",
      ),
    ];

    /*
     * The key argument is sometimes a singular/plural ternary, so the call is
     * matched up to its values object and every literal inside is collected.
     */
    const callPattern: RegExp =
      /translateInterpolated\(\s*translateString,\s*(.*?),\s*\{/g;
    const literalPattern: RegExp = /"((?:[^"\\]|\\.)*)"/g;
    const keys: Array<string> = [];

    for (const source of sources) {
      for (const call of source.matchAll(callPattern)) {
        for (const literal of (call[1] as string).matchAll(literalPattern)) {
          keys.push((literal[1] as string).replace(/\\"/g, '"'));
        }
      }
    }

    /*
     * Both status-line variants, both fetch counts, the hint, both rotation
     * ages and the two shift pills.
     */
    expect(keys.length).toBeGreaterThanOrEqual(9);

    for (const key of keys) {
      expect(en[key]).toBe(key);
      expect(key).toMatch(/\{\{[a-zA-Z]+\}\}/);
    }
  });

  /*
   * The sentences the components reference through a shared constant rather
   * than a literal: rotation copy, the previous-link lines and the lead-time
   * units. A renamed constant would silently stop matching the locale files.
   */
  test("the shared copy constants are keys in every locale", () => {
    const constantKeys: Array<string> = [
      "Every app subscribed to the current link stops updating and shows an empty calendar. For 30 days the old link keeps answering with that empty calendar instead of an error, then it stops working - paste the new link into every app you subscribed with.",
      "Your previous link returns an empty calendar until {{date}}, then stops working.",
      "The previous link returns an empty calendar until {{date}}, then stops working.",
      "{{count}} weeks",
      "{{count}} days",
      "{{count}} hours",
      "{{count}} minutes",
    ];

    const util: string = readSource(
      "Components",
      "OnCallPolicy",
      "CalendarFeed",
      "CalendarFeedUtil.ts",
    );

    for (const key of constantKeys) {
      expect(util).toContain(`"${key}"`);
      expect(en[key]).toBe(key);

      for (const locale of LOCALES) {
        const json: Record<string, unknown> = readLocale(locale);
        expect(typeof json[key]).toBe("string");
        expect((json[key] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  /*
   * The rotated-out link serves an EMPTY calendar for its grace window
   * (spec 2.1). "Keeps working" in any locale is a promise the server does not
   * keep, and the rotate flow is the one people run when somebody leaves.
   */
  test("no locale promises the old link keeps working after a rotation", () => {
    const forbidden: Record<string, string> = {
      en: "keeps working",
      de: "funktioniert weiterhin",
      fr: "continue de fonctionner",
      es: "sigue funcionando",
      it: "continua a funzionare",
      pt: "continua a funcionar",
      nl: "blijft werken",
      da: "virker fortsat",
      no: "fortsetter å virke",
      sv: "fortsätter att fungera",
      ru: "продолжает работать",
      "zh-CN": "可继续使用至",
      "zh-TW": "可繼續使用至",
    };

    for (const [locale, phrase] of Object.entries(forbidden)) {
      const json: Record<string, unknown> = readLocale(locale);

      // The three sentences that describe the rotated-out link, by their key.
      const previousLinkKeys: Array<string> = Object.keys(json).filter(
        (key: string): boolean => {
          return key.includes("previous link") || key.includes("old link");
        },
      );

      expect(previousLinkKeys.length).toBe(3);

      for (const key of previousLinkKeys) {
        expect(String(json[key])).not.toContain(phrase);
      }
    }
  });
});
