import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";

/*
 * The calendar-feed feature is one new User Settings page, one new On-Call
 * Duty page, a card on the schedule page, two links, two notification event
 * rows and ~125 strings in seventeen locale files. None of the wiring between
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
  "fa",
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
  /*
   * The section folds down to its title until opened, like every section of
   * User Settings after Alerts & Notifications: the feed is set up once.
   */
  test("User Settings has a Calendar section before Workspace, holding Calendar Feed", () => {
    const menu: string = readCode("Pages", "UserSettings", "SideMenu.tsx");

    const calendarIndex: number = menu.indexOf(
      '{ title: "Calendar", defaultCollapsed: true, items: [ { link: { title: "Calendar Feed", to: RouteUtil.populateRouteParams( RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route, ), }, icon: IconProp.Calendar, }, ], }',
    );
    /*
     * The Workspace section lists only the chat workspaces the project has
     * connected, so it is built by useWorkspaceSideMenuSection and placed in
     * the list by this spread.
     */
    const workspaceIndex: number = menu.indexOf(
      "...(workspaceSection ? [workspaceSection] : [])",
    );

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

  /*
   * The schedule page leads with who is on call - the Final Schedule
   * (FinalPreview) - now that the roster banner which said it first is gone,
   * and offers the calendar links after it, once the schedule has layers:
   * before anybody takes turns there are no shifts to follow.
   */
  test("the schedule page renders the subscribe card after the preview, once the schedule has layers, with the schedule's timezone", () => {
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
    const layersCheckIndex: number = page.indexOf("{hasLayers ? (");

    expect(subscribeIndex).toBeGreaterThan(-1);
    expect(previewIndex).toBeGreaterThan(-1);
    expect(subscribeIndex).toBeGreaterThan(previewIndex);
    expect(layersCheckIndex).toBeGreaterThan(previewIndex);
    expect(subscribeIndex).toBeGreaterThan(layersCheckIndex);
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

/*
 * The "no link yet" panel.
 *
 * All three empty states (the settings page, the schedule page's personal
 * half, and the shared link) render the same component, so a change to the
 * panel cannot drift between them. What a unit test cannot see is that the
 * cards still go through it at all, and that the sentences handed to it as
 * props are translatable keys - a literal passed as a prop skips the
 * translateString scan above and would render in English everywhere.
 */
describe("Empty state panel", () => {
  const personal: string = readCode(
    "Components",
    "OnCallPolicy",
    "CalendarFeed",
    "PersonalCalendarFeedCard.tsx",
  );
  const shared: string = readCode(
    "Components",
    "OnCallPolicy",
    "CalendarFeed",
    "SharedCalendarFeedCard.tsx",
  );
  const panel: string = readCode(
    "Components",
    "OnCallPolicy",
    "CalendarFeed",
    "FeedEmptyState.tsx",
  );

  test("both feed cards render their empty state through FeedEmptyState", () => {
    expect(personal).toContain(
      'import FeedEmptyState, { FeedEmptyStatePoint } from "./FeedEmptyState";',
    );
    expect(shared).toContain('import FeedEmptyState from "./FeedEmptyState";');

    /*
     * The settings page and the schedule page's personal half, then the
     * shared card. `\s` so the FeedEmptyStatePoint type annotation is not
     * mistaken for a third render.
     */
    expect(personal.match(/<FeedEmptyState\s/g) || []).toHaveLength(2);
    expect(shared.match(/<FeedEmptyState\s/g) || []).toHaveLength(1);
  });

  test("the panel namespaces every test id it renders by its idPrefix", () => {
    for (const suffix of [
      "-empty-state",
      "-empty-icon",
      "-empty-title",
      "-empty-description",
      "-empty-points",
      "-empty-control",
    ]) {
      expect(panel).toContain(`\${props.idPrefix}${suffix}\``);
    }

    // The bullets and their icons are indexed, so each one is addressable.
    expect(panel).toContain("`${props.idPrefix}-empty-point-${index}`");
    expect(panel).toContain("`${props.idPrefix}-empty-point-icon-${index}`");
  });

  test("the panel translates every string it is handed", () => {
    expect(panel).toContain("{translateString(props.title)}");
    expect(panel).toContain("{translateString(props.description)}");
    expect(panel).toContain("{translateString(point.text)}");
  });

  test("every sentence written inline at a FeedEmptyState call site is a key in en.json", () => {
    const en: Record<string, unknown> = readLocale("en");
    const callPattern: RegExp = /<FeedEmptyState\s([\s\S]*?)\/>/g;
    const literalPattern: RegExp = /"((?:[^"\\]|\\.)*)"/g;
    const keys: Array<string> = [];

    for (const source of [squash(personal), squash(shared)]) {
      for (const call of source.matchAll(callPattern)) {
        for (const literal of (call[1] as string).matchAll(literalPattern)) {
          keys.push((literal[1] as string).replace(/\\"/g, '"'));
        }
      }
    }

    // The shared card's two "who is this link for" sentences.
    expect(keys.length).toBeGreaterThanOrEqual(2);

    for (const key of keys) {
      expect(en[key]).toBe(key);

      for (const locale of LOCALES) {
        const json: Record<string, unknown> = readLocale(locale);
        expect(typeof json[key]).toBe("string");
        expect((json[key] as string).trim().length).toBeGreaterThan(0);
      }
    }
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

/*
 * THE UPCOMING SHIFTS CARD.
 *
 * Its redesign ("Please improve the UI of this card") replaced a heading per
 * day and a row per rotation turn with one row per stretch on call, written
 * in the reader's zone and language. What a unit test cannot see: that the
 * card's words are keys in every locale, translated - the card is read once
 * a week by somebody planning their life around it, in whatever language
 * they read; that the three sentences it no longer says are gone from every
 * file; and that neither component formats a date itself - every time on
 * the card goes through UpcomingShiftTime, with one clock, so the start and
 * the end of a row can never again be in two different zones.
 */
const UPCOMING_SHIFTS_KEYS: Array<string> = [
  "Upcoming shifts",
  "Your shifts over the next 30 days. Times are in {{timezone}}.",
  "On call now",
  "until {{time}}",
  "until at least {{time}}",
  "at least {{time}}",
  "{{duration}} left",
  "At least {{duration}}",
  "At least {{duration}} left",
  "Show {{count}} more shifts",
  "Show fewer shifts",
  "No shifts in the next 30 days",
  "When a schedule puts you on call, your shifts show up here.",
  "Could not load your shifts.",
  "Only schedule shifts are listed. If an escalation policy names you or your team directly, it can page you at any time.",
];

const RETIRED_UPCOMING_SHIFTS_KEYS: Array<string> = [
  "Upcoming shifts (next 30 days)",
  "You have no shifts on any schedule in the next 30 days.",
  "Direct and team assignments on escalation policies are standing and are not shown.",
];

// A date written by one of OneUptimeDate's own formatters, moment's English.
const DATE_FORMATTING_CALL: RegExp =
  /OneUptimeDate\.(?:toTimeString|getDateAs\w*|fromNow|getZoneAbbr\w*)/;

describe("Upcoming shifts card", () => {
  const card: string = readCode(
    "Components",
    "OnCallPolicy",
    "CalendarFeed",
    "UpcomingShiftsCard.tsx",
  );
  const row: string = readCode(
    "Components",
    "OnCallPolicy",
    "CalendarFeed",
    "UpcomingShiftRow.tsx",
  );

  test("every word the card says is a key in en.json, translated in every locale", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const key of UPCOMING_SHIFTS_KEYS) {
      expect(en[key]).toBe(key);
    }

    // The fold's one form, for the counts a language calls "one".
    expect(en["Show {{count}} more shifts_one"]).toBe(
      "Show {{count}} more shift",
    );

    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }

      const json: Record<string, unknown> = readLocale(locale);

      for (const key of [
        ...UPCOMING_SHIFTS_KEYS,
        "Show {{count}} more shifts_one",
      ]) {
        const value: unknown = json[key];

        expect({ locale, key, isString: typeof value === "string" }).toEqual({
          locale,
          key,
          isString: true,
        });
        expect({ locale, key, translated: value !== en[key] }).toEqual({
          locale,
          key,
          translated: true,
        });
      }
    }
  });

  test("the sentences it no longer says are gone from every locale", () => {
    for (const locale of LOCALES) {
      const json: Record<string, unknown> = readLocale(locale);

      for (const key of RETIRED_UPCOMING_SHIFTS_KEYS) {
        expect({ locale, key, present: key in json }).toEqual({
          locale,
          key,
          present: false,
        });
      }
    }
  });

  test("the card's words live where the extractor finds them", () => {
    // A call prettier wrapped over three lines reads as one: translationKey("…").
    const util: string = readSource(
      "Components",
      "OnCallPolicy",
      "CalendarFeed",
      "CalendarFeedUtil.ts",
    )
      .split("translationKey( ")
      .join("translationKey(")
      .split('", )')
      .join('")');

    for (const key of [
      "Upcoming shifts",
      "Your shifts over the next 30 days. Times are in {{timezone}}.",
      "No shifts in the next 30 days",
      "When a schedule puts you on call, your shifts show up here.",
      "Only schedule shifts are listed. If an escalation policy names you or your team directly, it can page you at any time.",
    ]) {
      expect(util).toContain(`translationKey("${key}")`);
    }

    // The phrases that hold a time the row keeps whole are TranslatedSentences.
    expect(row).toContain('"until at least {{time}}" : "until {{time}}"');
    expect(row).toContain('template="at least {{time}}"');
  });

  test("neither component formats a date itself: one clock for every time on the card", () => {
    for (const source of [card, row]) {
      expect(source).not.toMatch(DATE_FORMATTING_CALL);
      expect(source).not.toContain("moment");
    }

    expect(card).toContain(
      "getFeedClock({ language: translator.language, now: now, })",
    );
  });

  test("the card asks for the window it says, and lists spans rather than shifts", () => {
    expect(card).toContain("getUpcomingShiftsWindow(");
    expect(card).toContain(
      "buildUpcomingShiftSpans(response.shifts, now, askedWindow?.to)",
    );
    expect(card).toContain("<UpcomingShiftRow");
    expect(card).not.toContain("groupShiftsByDay");
  });
});

/*
 * The words the card's redesign added: the ⋯ and its items, the status pill,
 * the subscribe options' lines, the link field and the status sentences.
 */
const REDESIGN_KEYS: Array<string> = [
  "Manage link",
  "Disable link",
  "Enable link",
  "Delete link",
  "Waiting for first sync",
  "Needs regeneration",
  "Show link",
  "Hide link",
  "Calendar link",
  "Calendar link, hidden",
  "Link copied.",
  "Opens Google Calendar in a new tab",
  "Opens the calendar app on this device",
  "This browser did not let the page copy the link, so it is shown and selected above. Copy it with Ctrl+C, or Cmd+C on a Mac.",
  "No calendar app has fetched this link yet. Most apps do within minutes of subscribing; Google Calendar can take a few hours.",
];

describe("Locales", () => {
  const en: Record<string, unknown> = readLocale("en");

  const REQUIRED_KEYS: Array<string> = [
    "Calendar",
    "Calendar Feed",
    "Calendar Feeds",
    "Subscribe to your on-call shifts",
    "Subscribe to this schedule",
    "No calendar link yet",
    "No shared link yet",
    "Generate calendar link",
    "Regenerate link",
    "Publish shared link",
    "Remind me before shifts",
    "Upcoming shifts",
    "Get cover",
    "Add to your calendar",
    "Google Calendar",
    "Apple Calendar / Outlook",
    "Or copy the link",
    "Copy link",
    "Add your shifts to your calendar",
    "Add to calendar",
    "Before my on-call shift starts",
    "My upcoming on-call shift is reassigned",
    "Google Calendar refreshes subscribed calendars on its own schedule, every few hours (sometimes only once a day), so changes take a while to show up there. Reminders and pages still come from OneUptime on time.",
    "Google Calendar reads this link from Google's servers, so this OneUptime server must be reachable from the internet.",
    "Google Calendar and Outlook on the web can't reach this link: {{host}} is a private address, and they read calendars from their own servers. Apple Calendar or Outlook on a computer in your network can still subscribe.",
    ...REDESIGN_KEYS,
  ];

  /*
   * The subscribe block's old controls are gone with the redesign - a third
   * "Copy webcal link" button and an "Apple / other apps" link to webcals://,
   * which iOS refuses to open - and so are their keys.
   */
  test("the retired subscribe-block keys are gone from every locale", () => {
    for (const locale of LOCALES) {
      const json: Record<string, unknown> = readLocale(locale);

      for (const key of [
        "Apple / other apps",
        "Copy webcal link",
        "Opens Google Calendar's 'From URL' page with this link filled in.",
        "Outlook: Add calendar, then Subscribe from web, then paste this link.",
      ]) {
        expect({ locale, key, present: key in json }).toEqual({
          locale,
          key,
          present: false,
        });
      }
    }
  });

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

  test("the sixteen translations mirror en.json key for key", () => {
    const enKeys: Array<string> = Object.keys(en).sort();

    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }

      expect(Object.keys(readLocale(locale)).sort()).toEqual(enKeys);
    }
  });

  /*
   * Every word the redesign added is in all sixteen languages - translated,
   * not an English placeholder: the card is the one page a reader sets up
   * once, in whatever language they read.
   */
  test("the redesign's words are translated in every locale", () => {
    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }

      const json: Record<string, unknown> = readLocale(locale);

      for (const key of REDESIGN_KEYS) {
        expect({ locale, key, translated: json[key] !== key }).toEqual({
          locale,
          key,
          translated: true,
        });
      }
    }
  });

  test("the strings the components translate at runtime are all in en.json", () => {
    const sources: Array<string> = [
      readSource("Components", "OnCallPolicy", "CalendarFeedLinks.tsx"),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "FeedStatusPanel.tsx",
      ),
      readSource(
        "Components",
        "OnCallPolicy",
        "CalendarFeed",
        "FeedLinkField.tsx",
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
        "UpcomingShiftRow.tsx",
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
      /(?:translateString|translateText)\(\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g;
    /*
     * A word chosen between two - Show or Hide, Copy link or Copied! - is
     * looked up as `translateText(cond ? "A" : "B")`: both are keys.
     */
    const choicePattern: RegExp =
      /translateText\(\s*[\w.!]+\s*\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g;
    let found: number = 0;

    for (const source of sources) {
      for (const match of source.matchAll(literalPattern)) {
        const key: string = (match[1] as string).replace(/\\"/g, '"');
        found += 1;
        expect(en[key]).toBe(key);
      }

      for (const match of source.matchAll(choicePattern)) {
        for (const literal of [match[1], match[2]] as Array<string>) {
          const key: string = literal.replace(/\\"/g, '"');
          found += 1;
          expect(en[key]).toBe(key);
        }
      }
    }

    expect(found).toBeGreaterThan(40);
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
        "FeedStatusPanel.tsx",
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
        "UpcomingShiftRow.tsx",
      ),
    ];

    /*
     * The key argument is sometimes a singular/plural ternary, so the call is
     * matched up to its values object and every literal inside is collected:
     * translator.translateTemplate in the status panel and the upcoming
     * shifts rows.
     */
    const callPattern: RegExp =
      /(?:translateInterpolated\(\s*translateString,|translateTemplate\()\s*(.*?),\s*\{/g;
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
     * ages, the two shift pills and the upcoming rows' lengths.
     */
    expect(keys.length).toBeGreaterThanOrEqual(12);

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
      "No calendar link yet",
      "Generate a private link, then subscribe to it from your calendar app.",
      "Every shift you hold on this project's schedules.",
      "Shifts you cover for someone else, when an override names you.",
      "Private to you. Anyone who has the link can read your shifts, so treat it like a password.",
      "No shared link yet",
      "Apps subscribed to the current link stop getting shifts and show an empty calendar. Paste the new link into every app you subscribed with.",
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

      /*
       * The two sentences that describe the rotated-out link, by their key.
       * Each says what the old link serves - an empty calendar - which is also
       * what tells them apart from other features' sentences about an old
       * link of their own (an incident form's Reset Link, whose old link
       * stops working at once). The rotate dialog itself only says that
       * subscribed apps go empty and need the new link.
       */
      const previousLinkKeys: Array<string> = Object.keys(json).filter(
        (key: string): boolean => {
          return (
            (key.includes("previous link") || key.includes("old link")) &&
            key.includes("calendar")
          );
        },
      );

      expect(previousLinkKeys.length).toBe(2);

      for (const key of previousLinkKeys) {
        expect(String(json[key])).not.toContain(phrase);
      }
    }
  });
});
