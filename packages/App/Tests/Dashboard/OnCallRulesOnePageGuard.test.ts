import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * YOUR ON-CALL RULES ARE ONE PAGE WITH A TAB PER KIND, NOT FOUR PAGES.
 *
 * User Settings had two side-menu sections (Incident On-Call, Alert On-Call)
 * holding four pages that each drew the same rules table for one kind of rule,
 * and Users > (a member) > On-Call repeated them as four more menu entries.
 * They are one On-Call Rules page in each place now, with Incidents | Incident
 * Episodes | Alerts | Alert Episodes tabs, and the tab is in the address
 * (?type=alerts). This holds that shape, so a page written later cannot
 * quietly bring a per-kind page back, or draw the two places differently:
 *
 *   - one component draws the tabs (OnCallRulesTabs), both pages draw it,
 *     and nothing else draws the rules table itself;
 *   - one menu entry per place, and no page, route or menu entry per kind;
 *   - the four old addresses are named in one place (Common's OnCallRuleKind,
 *     which both route groups forward from) and linked from nowhere: every
 *     link builds the new address from the same vocabulary, server included.
 *
 * Source is read as text: App's tests never import a React module.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const REPO_ROOT: string = path.join(PACKAGES, "..");

const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const TABS_FILE: string = "Components/NotificationRule/OnCallRulesTabs.tsx";
const TABLE_FILE: string = "Components/NotificationRule/OnCallRulesTable.tsx";
const KINDS_FILE: string = "Components/NotificationRule/OnCallRuleKinds.ts";
const OWN_PAGE: string = "Pages/UserSettings/OnCallRules.tsx";
const MEMBER_PAGE: string = "Pages/Users/View/OnCall/Rules.tsx";
const OWN_MENU: string = "Pages/UserSettings/SideMenu.tsx";
const MEMBER_MENU: string = "Pages/Users/View/SideMenu.tsx";

const COMMON_KIND_FILE: string = path.join(
  PACKAGES,
  "Common",
  "Types",
  "NotificationRule",
  "OnCallRuleKind.ts",
);

const RETIRED_RULE_PAGE_PATHS: Array<string> = [
  "incident-on-call-rules",
  "incident-episode-on-call-rules",
  "alert-on-call-rules",
  "alert-episode-on-call-rules",
];

const RETIRED_MENU_TITLES: Array<string> = [
  "Incident On-Call Rules",
  "Incident Episode On-Call Rules",
  "Alert On-Call Rules",
  "Alert Episode On-Call Rules",
];

const RETIRED_SECTION_TITLES: Array<string> = [
  "Incident On-Call",
  "Alert On-Call",
];

function readDashboard(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Without comments, so a sentence about the old pages is not mistaken for code.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

// Every .ts/.tsx source under a directory, skipping dependencies and builds.
function sourcesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "build" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourcesUnder(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

/*
 * The product's sources that could link a page or draw a table: every
 * frontend and server in App, Common's server, UI, types and utils, and the
 * Enterprise Edition's dashboard and server. Tests are not sources.
 */
function productSources(): Array<string> {
  return [
    ...sourcesUnder(path.join(PACKAGES, "App", "FeatureSet")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "Server")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "UI")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "Types")),
    ...sourcesUnder(path.join(PACKAGES, "Common", "Utils")),
    ...sourcesUnder(path.join(REPO_ROOT, "ee", "Dashboard")),
    ...sourcesUnder(path.join(REPO_ROOT, "ee", "Server")),
  ];
}

function relativeToRepo(file: string): string {
  return path.relative(REPO_ROOT, file);
}

describe("one component draws the page, in both places", () => {
  test("both pages draw OnCallRulesTabs", () => {
    for (const page of [OWN_PAGE, MEMBER_PAGE]) {
      const source: string = stripComments(readDashboard(page));

      expect(source).toContain(
        'import OnCallRulesTabs from "../../Components/NotificationRule/OnCallRulesTabs";'.replace(
          "../../",
          page === OWN_PAGE ? "../../" : "../../../../",
        ),
      );
      expect(source).toContain("<OnCallRulesTabs");
      expect(source).not.toContain("<OnCallRulesTable");
    }
  });

  test("nothing but the tabs draws the rules table itself", () => {
    const drawers: Array<string> = productSources()
      .filter((file: string): boolean => {
        return stripComments(fs.readFileSync(file, "utf8")).includes(
          "<OnCallRulesTable",
        );
      })
      .map(relativeToRepo);

    expect(drawers).toEqual([
      path.join(
        "packages",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        ...TABS_FILE.split("/"),
      ),
    ]);
  });

  test("the tabs come from the kinds' one definition, keyed per kind, opened from the address", () => {
    const tabs: string = stripComments(readDashboard(TABS_FILE));

    expect(tabs).toContain("ON_CALL_RULE_KIND_DEFINITIONS.map(");
    expect(tabs).toContain("key={definition.kind}");
    expect(tabs).toContain(
      "initialTabName={getOnCallRuleKindDefinition(requestedKind).tabName}",
    );
    expect(tabs).toContain("readOnCallRuleKind(");
    expect(tabs).toContain("Navigation.setQueryString({");

    // The kinds module is React-free, so a test or the server could read it.
    const kinds: string = readDashboard(KINDS_FILE);

    expect(kinds).not.toMatch(/from "react"/);
    expect(kinds).not.toMatch(/\.tsx"/);
  });

  test("the rules table titles a card by its severity, not by a sentence around it", () => {
    const table: string = stripComments(readDashboard(TABLE_FILE));

    expect(table).toContain("title: <SeverityCardTitle severity={severity} />");
    expect(table).not.toContain("getTitle");
    expect(table).not.toContain("When I am on call");
  });
});

describe("one menu entry in each place, and no page per kind", () => {
  test.each([OWN_MENU, MEMBER_MENU])(
    "%s has exactly one On-Call Rules entry and none of the old ones",
    (menuFile: string) => {
      const menu: string = stripComments(readDashboard(menuFile));

      expect(menu.split('title: "On-Call Rules"').length - 1).toBe(1);

      for (const title of [...RETIRED_MENU_TITLES, ...RETIRED_SECTION_TITLES]) {
        expect(menu).not.toContain(`title: "${title}"`);
      }
    },
  );

  test("your own entry sits in Alerts & Notifications, right after Notification Methods", () => {
    const menu: string = stripComments(readDashboard(OWN_MENU)).replace(
      /\s+/g,
      " ",
    );

    const section: number = menu.indexOf('title: "Alerts & Notifications"');
    const methods: number = menu.indexOf('title: "Notification Methods"');
    const rules: number = menu.indexOf('title: "On-Call Rules"');
    const settings: number = menu.indexOf('title: "Notification Settings"');

    expect(section).toBeGreaterThan(-1);
    expect(methods).toBeGreaterThan(section);
    expect(rules).toBeGreaterThan(methods);
    expect(settings).toBeGreaterThan(rules);
    expect(menu).toContain(
      "RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route",
    );
  });

  test("the route table, the page map and the breadcrumbs have one page each side", () => {
    const pageMap: string = readDashboard("Utils/PageMap.ts");
    const routeMap: string = readDashboard("Utils/RouteMap.ts");

    expect(
      (
        pageMap.match(/^\s*USER_(SETTINGS|VIEW)_\w*ON_CALL_RULES\b/gm) || []
      ).map((key: string): string => {
        return key.trim();
      }),
    ).toEqual(["USER_SETTINGS_ON_CALL_RULES", "USER_VIEW_ON_CALL_RULES"]);

    for (const retired of RETIRED_RULE_PAGE_PATHS) {
      expect(routeMap).not.toContain(`"${retired}"`);
      expect(routeMap).not.toContain(`/${retired}\``);
    }

    for (const breadcrumbs of [
      "Utils/Breadcrumbs/UserSettingsBreadcrumbs.ts",
      "Utils/Breadcrumbs/UsersBreadcrumbs.ts",
    ]) {
      const source: string = readDashboard(breadcrumbs);

      expect(source).toContain('"On-Call Rules"');

      for (const title of RETIRED_MENU_TITLES) {
        expect(source).not.toContain(`"${title}"`);
      }
    }
  });

  test("the four old page files are gone", () => {
    for (const file of [
      "IncidentOnCallRules.tsx",
      "IncidentEpisodeOnCallRules.tsx",
      "AlertOnCallRules.tsx",
      "EpisodeOnCallRules.tsx",
    ]) {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, "Pages", "UserSettings", file)),
      ).toBe(false);
    }
  });
});

describe("the old addresses are named once, and linked from nowhere", () => {
  test("only Common's OnCallRuleKind names them", () => {
    const offenders: Array<string> = [];

    for (const file of productSources()) {
      if (file === COMMON_KIND_FILE) {
        continue;
      }

      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      for (const retired of RETIRED_RULE_PAGE_PATHS) {
        /*
         * As a path segment or a quoted value - not as part of a longer name
         * such as the incident settings' "incident-on-call-rules-table".
         */
        const asPath: RegExp = new RegExp(`(^|[^\\w-])${retired}(?![\\w-])`);

        if (asPath.test(source)) {
          offenders.push(`${relativeToRepo(file)}: ${retired}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("Common's OnCallRuleKind forwards each of them to a tab", () => {
    const source: string = fs.readFileSync(COMMON_KIND_FILE, "utf8");

    for (const retired of RETIRED_RULE_PAGE_PATHS) {
      expect(source).toContain(`"${retired}": OnCallRuleKind.`);
    }
  });

  test.each(["Routes/UserSettingsRoutes.tsx", "Routes/UsersRoutes.tsx"])(
    "%s forwards every old address with its tab",
    (routesFile: string) => {
      const routes: string = stripComments(readDashboard(routesFile)).replace(
        /\s+/g,
        " ",
      );

      expect(routes).toContain("Object.keys(MOVED_ON_CALL_RULES_PATHS).map(");
      expect(routes).toContain("searchParams={getOnCallRuleKindQuery(kind)}");
    },
  );

  test.each([
    "Common/Server/Services/OnCallSetupReminderService.ts",
    "Common/Server/Services/OnCallNotificationAlertingService.ts",
  ])(
    "%s builds its link from the shared vocabulary, not a spelled-out path",
    (serviceFile: string) => {
      const source: string = stripComments(
        fs.readFileSync(path.join(PACKAGES, serviceFile), "utf8"),
      );

      expect(source).toContain(
        'from "../../Types/NotificationRule/OnCallRuleKind"',
      );
      expect(source).toContain("ON_CALL_RULES_PAGE_PATH");
      expect(source).toContain("ON_CALL_RULE_KIND_QUERY_PARAM");
      expect(source).not.toContain('"on-call-rules"');
    },
  );

  test("the dashboard's links to a gap use the same query", () => {
    for (const file of [
      "Components/OnCallPolicy/Readiness/ReadinessTypes.ts",
      "Components/UserSettings/SetupChecklist/ChecklistModel.ts",
    ]) {
      const source: string = stripComments(readDashboard(file));

      expect(source).toMatch(
        /getOnCallRuleKindQueryForRuleType|getSettingsPageForRuleType/,
      );
    }

    /*
     * The team compliance page's "fix it yourself" links live in the
     * Enterprise Edition, which the App test job removes before it runs; the
     * Enterprise Edition Test job runs this with it present.
     */
    const complianceView: string = path.join(
      REPO_ROOT,
      "ee",
      "Dashboard",
      "TeamCompliance",
      "ComplianceView.ts",
    );

    if (fs.existsSync(complianceView)) {
      expect(stripComments(fs.readFileSync(complianceView, "utf8"))).toContain(
        "getOnCallRuleKindQueryForRuleType(",
      );
    }
  });
});
