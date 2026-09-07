import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * User Settings > Email Preferences, wired.
 *
 * A new page under User Settings is registered in eight separate places -
 * PageMap, the route-path dictionary, the RouteMap Route, the react-router
 * PageRoute, the breadcrumb map, the side menu, and the two shared breadcrumb
 * fixtures - and EVERY ONE of them fails silently when it is missing, because
 * every lookup is `Dictionary[key]` returning undefined behind an `as Route`
 * cast or an `|| ""` default:
 *
 *  - no PageMap member: the side-menu link renders with an undefined href and
 *    the PageRoute mounts at path "", hijacking the section's index render;
 *  - no UserSettingsRoutePath entry: the URL 404s to a blank layout while the
 *    RouteMap Route becomes ".../user-settings/undefined";
 *  - no RouteMap Route: nothing can link to the page, and the breadcrumb
 *    resolver cannot key it;
 *  - the RouteMap Route declared in the WRONG PLACE: the breadcrumb resolver
 *    treats the first non-splat route under a prefix as the section landing
 *    page, so declaring this above notification-methods silently repoints the
 *    middle "User Settings" crumb on all twelve pages;
 *  - no breadcrumb entry: the page renders with no trail at all, which reads
 *    as a styling glitch rather than a missing map entry (Custom Fields
 *    already ships this way);
 *  - no PageRoute inside the layout route: the page renders with no side
 *    menu and no chrome;
 *  - no fixture rows: the resolver's "every crumb links to a real route"
 *    invariant simply never exercises this page.
 *
 * None of it is reachable from a rendering test - App's suite runs in a plain
 * Node environment - so these read the sources and pin the exact expressions,
 * the way OnCallCalendarFeedWiring.test.ts does for the page that landed
 * before this one. Sources are whitespace-squashed first so a prettier
 * re-wrap cannot turn a real regression check into a red herring.
 *
 * The page's BEHAVIOUR is covered in a real DOM by
 * Common/Tests/App/Dashboard/UserSettingsEmailPreferences.test.tsx, and the
 * rollup card's source invariants by NotificationRollupSettingCard.test.ts.
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

/*
 * Every string the two pages hand to translateString. A key that is missing
 * from en.json renders English forever for all fifteen other languages and
 * nothing fails, so the list is pinned here rather than inferred.
 */
const REQUIRED_KEYS: Array<string> = [
  "Email Preferences",
  "Applies to you in this project.",
  "Turn individual emails back on in Notification Settings",
  "Routine emails turned off.",
  "Review your individual preferences in Notification Settings",
  "These switches decide which notifications reach you, not how much email they add up to.",
  "Reduce routine emails or change email rollup in Email Preferences",
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

function readFixture(name: string): string {
  return squash(
    fs.readFileSync(
      path.join(COMMON_TESTS_UI, "Utils", "Breadcrumb", "fixtures", name),
      "utf8",
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

  test("the page has a PageMap member whose value matches its name", () => {
    expect(pageMap).toContain(
      'USER_SETTINGS_EMAIL_PREFERENCES = "USER_SETTINGS_EMAIL_PREFERENCES"',
    );
  });

  test("the route path segment is registered", () => {
    expect(routeMap).toContain(
      '[PageMap.USER_SETTINGS_EMAIL_PREFERENCES]: "email-preferences"',
    );
  });

  test("the full route is built from that segment, not spelled twice", () => {
    expect(routeMap).toContain(
      "[PageMap.USER_SETTINGS_EMAIL_PREFERENCES]: new Route( `/dashboard/${RouteParams.ProjectID}/user-settings/${ UserSettingsRoutePath[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] }`, )",
    );
  });

  /*
   * The "User Settings" crumb on every page in this section links to whatever
   * non-splat user-settings route RouteMap declares FIRST. Declaring this one
   * above notification-methods repoints that crumb everywhere, and every
   * crumb still resolves to a real route, so no existing test notices.
   */
  test("it is declared after the section landing route and before the deliberately-last one", () => {
    const landingIndex: number = routeMap.indexOf(
      "[PageMap.USER_SETTINGS]: new Route(",
    );
    const emailIndex: number = routeMap.indexOf(
      "[PageMap.USER_SETTINGS_EMAIL_PREFERENCES]: new Route(",
    );
    const lastCommentIndex: number = routeMap.indexOf(
      "Declared LAST in this block on purpose",
    );

    expect(landingIndex).toBeGreaterThan(-1);
    expect(emailIndex).toBeGreaterThan(landingIndex);
    expect(lastCommentIndex).toBeGreaterThan(emailIndex);
  });

  test("the path segment collides with no other user-settings route", () => {
    const paths: Array<string> =
      routeMap
        .slice(
          routeMap.indexOf("export const UserSettingsRoutePath"),
          routeMap.indexOf("const RouteMap: Dictionary<Route>"),
        )
        .match(/: "[^"]+"/g) || [];

    expect(
      paths.filter((entry: string): boolean => {
        return entry === ': "email-preferences"';
      }),
    ).toHaveLength(1);
  });
});

describe("Routes", () => {
  const routes: string = readCode("Routes", "UserSettingsRoutes.tsx");

  test("the page component is imported", () => {
    expect(routes).toContain(
      'import UserSettingsEmailPreferences from "../Pages/UserSettings/EmailPreferences";',
    );
  });

  test("the PageRoute passes the matching path and pageRoute", () => {
    expect(routes).toContain(
      '<PageRoute path={ UserSettingsRoutePath[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] || "" } element={ <UserSettingsEmailPreferences {...props} pageRoute={ RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route } /> } />',
    );
  });

  /*
   * Outside the layout route the page renders with no side menu and no
   * breadcrumbs - it looks like a styling bug, not a routing one.
   */
  test("it is nested inside the User Settings layout route", () => {
    const layoutIndex: number = routes.indexOf(
      "<PageRoute element={<UserSettingsLayout {...props} />}>",
    );
    const pageIndex: number = routes.indexOf(
      "UserSettingsRoutePath[PageMap.USER_SETTINGS_EMAIL_PREFERENCES]",
    );
    const layoutCloseIndex: number = routes.indexOf("</PageRoute>");

    expect(layoutIndex).toBeGreaterThan(-1);
    expect(pageIndex).toBeGreaterThan(layoutIndex);
    expect(pageIndex).toBeLessThan(layoutCloseIndex);
  });
});

describe("Breadcrumbs", () => {
  test("the User Settings breadcrumb map has a three-crumb trail", () => {
    expect(
      readCode("Utils", "Breadcrumbs", "UserSettingsBreadcrumbs.ts"),
    ).toContain(
      '...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_EMAIL_PREFERENCES, [ "Project", "User Settings", "Email Preferences", ])',
    );
  });

  test("the shared fixtures enumerate the route and its trail", () => {
    expect(readFixture("RealRoutePatterns.ts")).toContain(
      '"/dashboard/:projectId/user-settings/email-preferences"',
    );
    expect(readFixture("RealBreadcrumbTrails.ts")).toContain(
      '{ getter: "getUserSettingsBreadcrumbs", pagePattern: "/dashboard/:projectId/user-settings/email-preferences", titles: ["Project", "User Settings", "Email Preferences"], }',
    );
  });

  /*
   * The fixture is a snapshot of RouteMap in declaration order, and the
   * landing-page rule reads it in that order. A fixture that disagrees with
   * RouteMap lets the repointed-crumb regression through unnoticed.
   */
  test("the fixture lists it in the same position RouteMap declares it", () => {
    const patterns: string = readFixture("RealRoutePatterns.ts");
    const landingIndex: number = patterns.indexOf(
      '"/dashboard/:projectId/user-settings/notification-methods"',
    );
    const emailIndex: number = patterns.indexOf(
      '"/dashboard/:projectId/user-settings/email-preferences"',
    );
    const setupIndex: number = patterns.indexOf(
      '"/dashboard/:projectId/user-settings/setup"',
    );

    expect(landingIndex).toBeGreaterThan(-1);
    expect(emailIndex).toBeGreaterThan(landingIndex);
    expect(setupIndex).toBeGreaterThan(emailIndex);
  });
});

describe("Side menu", () => {
  const menu: string = readCode("Pages", "UserSettings", "SideMenu.tsx");

  test("the row sits inside Alerts & Notifications, after Notification Settings", () => {
    const sectionIndex: number = menu.indexOf(
      '{ title: "Alerts & Notifications",',
    );
    const settingsIndex: number = menu.indexOf(
      '{ link: { title: "Notification Settings",',
    );
    const emailIndex: number = menu.indexOf(
      '{ link: { title: "Email Preferences", to: RouteUtil.populateRouteParams( RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route, ), }, icon: IconProp.Envelope, }',
    );
    const nextSectionIndex: number = menu.indexOf(
      '{ title: "Incident On-Call",',
    );

    expect(sectionIndex).toBeGreaterThan(-1);
    expect(emailIndex).toBeGreaterThan(settingsIndex);
    expect(emailIndex).toBeLessThan(nextSectionIndex);
  });

  /*
   * A new top-level SECTION between Calendar and Workspace would break
   * OnCallCalendarFeedSideMenus.test.tsx, which asserts those two are exactly
   * adjacent. Keeping the row inside an existing section is what avoids that.
   */
  test("no new top-level section was introduced", () => {
    expect(menu).not.toContain('{ title: "Email Preferences", items:');
  });

  /*
   * The row is scanned by icon. Notification Methods is a bell and
   * Notification Settings a cog; a third cog would be indistinguishable.
   */
  test("it carries an icon nothing else in this menu uses", () => {
    expect(menu.match(/IconProp\.Envelope/g)).toHaveLength(1);
  });
});

describe("The page itself", () => {
  const page: string = readCode(
    "Pages",
    "UserSettings",
    "EmailPreferences.tsx",
  );

  test("it renders both cards and no page chrome of its own", () => {
    expect(page).toContain(
      'import EmailNoiseCard from "../../Components/EmailPreferences/EmailNoiseCard";',
    );
    expect(page).toContain(
      'import EmailRollupCard from "../../Components/EmailPreferences/EmailRollupCard";',
    );
    expect(page).toContain("<EmailNoiseCard onApply={reduceRoutineEmails} />");
    expect(page).toContain("<EmailRollupCard />");
    /* Layout.tsx supplies <Page>, breadcrumbs and the side menu. */
    expect(page).not.toContain("<Page ");
  });

  /*
   * Both preferences are keyed (user, project). Without the remount the
   * switch keeps showing the previous project's answer after a project
   * switch, on a setting whose entire point is that it is per-project.
   */
  test("switching projects remounts it", () => {
    expect(page).toContain("<Fragment key={projectId}>");
  });

  /*
   * The endpoint takes the user from the session and the project from the
   * tenantid header, and ignores the body entirely. Dropping the headers
   * fails every click with "Project ID is required"; putting ids in the body
   * changes nothing while reading as if it did.
   */
  test("the preset posts an empty body with the tenant headers, and checks the response", () => {
    expect(page).toContain(
      'URL.fromURL(APP_API_URL).addRoute( new Route("/user-notification-setting/reduce-routine-emails"), )',
    );
    expect(page).toContain("data: {},");
    expect(page).toContain("headers: ModelAPI.getCommonHeaders(),");
    expect(page).toContain(
      "if (response instanceof HTTPErrorResponse || response.isFailure()) { throw response; }",
    );
  });

  test("neither card is left behind on Notification Settings", () => {
    const matrixPage: string = readCode(
      "Pages",
      "UserSettings",
      "NotificationSettings.tsx",
    );

    expect(matrixPage).not.toContain("<EmailNoiseCard");
    expect(matrixPage).not.toContain("<EmailRollupCard");
    expect(matrixPage).not.toContain("reduce-routine-emails");
  });
});

/*
 * THE POINTERS BETWEEN THE TWO PAGES.
 *
 * Splitting them costs a navigation in both directions, and each direction
 * has a reader who is stuck without it: somebody on Notification Settings
 * looking for a way to get less mail, and somebody who has just switched
 * twenty-one event types off looking for the undo.
 */
describe("Cross-page links", () => {
  test("Notification Settings sends a reader to Email Preferences", () => {
    const matrixPage: string = readCode(
      "Pages",
      "UserSettings",
      "NotificationSettings.tsx",
    );

    expect(matrixPage).toContain(
      "const emailPreferencesRoute: Route = RouteUtil.populateRouteParams( RouteMap[PageMap.USER_SETTINGS_EMAIL_PREFERENCES] as Route, );",
    );
    expect(matrixPage).toContain(
      '<Link to={emailPreferencesRoute} className="text-indigo-600 hover:underline" >',
    );
  });

  test("the routine-email card sends a reader back to Notification Settings", () => {
    const card: string = readCode(
      "Components",
      "EmailPreferences",
      "EmailNoiseCard.tsx",
    );

    expect(card).toContain(
      "const notificationSettingsRoute: Route = RouteUtil.populateRouteParams( RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route, );",
    );
    /* Both the standing copy and the post-apply confirmation carry it. */
    expect(card.match(/<Link to={notificationSettingsRoute}/g)).toHaveLength(2);
  });

  /*
   * RouteMap entries are templates. Linking to one without
   * populateRouteParams ships a href containing the literal ":projectId" -
   * it renders and clicks fine and 404s for every real user.
   */
  test("no cross-page link uses a RouteMap entry unpopulated", () => {
    for (const source of [
      readCode("Pages", "UserSettings", "NotificationSettings.tsx"),
      readCode("Components", "EmailPreferences", "EmailNoiseCard.tsx"),
    ]) {
      expect(source).not.toMatch(/to={RouteMap\[/);
    }
  });
});

/*
 * The rollup digest's own footer is the only place a recipient who never
 * asked for batching learns the switch exists, and its link is the single
 * call to action. Common/Server cannot import the Dashboard's RouteMap, so
 * the path segment is duplicated there by hand and nothing links the two -
 * this test is the link.
 */
describe("Server-built links into this page", () => {
  test("the rollup email's preferences link points here, not at the matrix", () => {
    const runner: string = squash(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Server",
          "Utils",
          "EmailRollup",
          "EmailRollupFlushRunner.ts",
        ),
        "utf8",
      ),
    );

    expect(runner).toContain(
      "`/${bucket.projectId.toString()}/user-settings/email-preferences`",
    );
    expect(runner).not.toContain(
      "`/${bucket.projectId.toString()}/user-settings/notification-settings`",
    );
  });
});

describe("Locales", () => {
  const en: Record<string, unknown> = readLocale("en");

  test("en.json carries every new string as an identity pair", () => {
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

  /*
   * Not English: a locale left identical to en.json for these keys renders
   * the menu row in English inside a Japanese dashboard, and the parity test
   * above cannot tell that apart from a real translation.
   */
  test("the non-Latin locales actually translated the menu row", () => {
    for (const locale of ["ja", "ko", "zh-CN", "zh-TW", "ru", "hi"]) {
      expect(readLocale(locale)["Email Preferences"]).not.toBe(
        "Email Preferences",
      );
    }
  });

  test("every string these pages translate at runtime is in en.json", () => {
    const sources: Array<string> = [
      readSource("Pages", "UserSettings", "EmailPreferences.tsx"),
      readSource("Pages", "UserSettings", "NotificationSettings.tsx"),
      readSource("Components", "EmailPreferences", "EmailNoiseCard.tsx"),
      readSource("Components", "EmailPreferences", "EmailRollupCard.tsx"),
    ];

    /*
     * Only the single-argument literal form. Conditional calls such as
     * translateString(isBusy ? "a" : "b") are matched by neither branch here
     * and are covered by REQUIRED_KEYS where they matter.
     */
    const found: Set<string> = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(
        /translateString\(\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g,
      )) {
        found.add(match[1]!.replace(/\\"/g, '"'));
      }
    }

    expect(found.size).toBeGreaterThan(0);
    for (const value of found) {
      expect(Object.keys(en)).toContain(value);
    }
  });
});
