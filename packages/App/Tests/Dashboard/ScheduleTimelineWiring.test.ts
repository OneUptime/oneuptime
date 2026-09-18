import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The schedule timeline is one component on two pages (On-Call Duty >
 * Schedule Timeline, and Teams > View Team > On-Call Schedules), a button on
 * the schedules list, two side-menu entries, two breadcrumb trails and one
 * API router. None of that wiring is reachable from a unit test - a route
 * that mounts the wrong page, a menu entry pointing at the wrong PageMap key,
 * a router that is never mounted all render "fine" and are wrong - so these
 * read the sources and pin the expressions, the way
 * OnCallCalendarFeedWiring.test.ts pins the calendar feed pages.
 *
 * Code is compared with ALL whitespace removed, so line wrapping chosen by
 * the formatter cannot break an assertion.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

function readDashboardCode(...parts: Array<string>): string {
  return compact(
    stripComments(fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")),
  );
}

// RouteMap's splat routes look like comment openers; read it raw.
function readDashboardRaw(...parts: Array<string>): string {
  return compact(fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8"));
}

describe("PageMap / RouteMap", () => {
  const pageMap: string = readDashboardCode("Utils", "PageMap.ts");
  const routeMap: string = readDashboardRaw("Utils", "RouteMap.ts");

  test("both pages have PageMap members", () => {
    expect(pageMap).toContain(
      compact(
        'ON_CALL_DUTY_SCHEDULE_TIMELINE = "ON_CALL_DUTY_SCHEDULE_TIMELINE"',
      ),
    );
    expect(pageMap).toContain(
      compact('TEAM_VIEW_ON_CALL_SCHEDULES = "TEAM_VIEW_ON_CALL_SCHEDULES"'),
    );
  });

  test("the project-wide page is at on-call-duty/schedule-timeline", () => {
    expect(routeMap).toContain(
      compact('[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE]: "schedule-timeline"'),
    );
    expect(routeMap).toContain(
      compact(
        "[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE]: new Route( `/dashboard/${RouteParams.ProjectID}/on-call-duty/${ OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE] }`",
      ),
    );
  });

  test("the page path cannot be mistaken for a schedule id", () => {
    // schedules/:modelId would swallow "schedules/timeline".
    expect(routeMap).not.toContain(compact('"schedules/timeline"'));
  });

  test("the team page is at teams/:modelId/on-call-schedules", () => {
    expect(routeMap).toContain(
      compact(
        "[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES]: `${RouteParams.ModelID}/on-call-schedules`",
      ),
    );
    expect(routeMap).toContain(
      compact(
        "[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES]: new Route( `/dashboard/${RouteParams.ProjectID}/teams/${ TeamsRoutePath[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES] }`",
      ),
    );
  });
});

describe("Routes", () => {
  test("OnCallDutyRoutes mounts the Schedule Timeline page", () => {
    const routes: string = readDashboardCode("Routes", "OnCallDutyRoutes.tsx");

    expect(routes).toContain(
      compact(
        'import OnCallDutyScheduleTimeline from "../Pages/OnCallDuty/ScheduleTimeline"',
      ),
    );
    expect(routes).toContain(
      compact(
        'path={ OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE] || "" } element={ <OnCallDutyScheduleTimeline {...props} pageRoute={ RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE] as Route } /> }',
      ),
    );
  });

  test("TeamsRoutes mounts the team's On-Call Schedules page inside the team layout", () => {
    const routes: string = readDashboardCode("Routes", "TeamsRoutes.tsx");

    expect(routes).toContain(
      compact(
        'import TeamsViewOnCallSchedules from "../Pages/Teams/View/OnCallSchedules"',
      ),
    );
    expect(routes).toContain(
      compact(
        "path={RouteUtil.getLastPathForKey( PageMap.TEAM_VIEW_ON_CALL_SCHEDULES, )} element={ <TeamsViewOnCallSchedules {...props} pageRoute={RouteMap[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES] as Route} /> }",
      ),
    );

    const layoutIndex: number = routes.indexOf(
      compact("element={<TeamsViewLayout />}"),
    );
    const pageIndex: number = routes.indexOf("<TeamsViewOnCallSchedules");

    expect(layoutIndex).toBeGreaterThan(-1);
    expect(pageIndex).toBeGreaterThan(layoutIndex);
  });
});

describe("Pages", () => {
  test("the project-wide page renders the timeline unfiltered", () => {
    const page: string = readDashboardCode(
      "Pages",
      "OnCallDuty",
      "ScheduleTimeline.tsx",
    );

    expect(page).toContain("return<ScheduleTimeline/>;");
  });

  test("the team page locks the timeline to the team in the URL", () => {
    const page: string = readDashboardCode(
      "Pages",
      "Teams",
      "View",
      "OnCallSchedules.tsx",
    );

    expect(page).toContain(
      compact("const teamId: ObjectID = Navigation.getLastParamAsObjectID(1);"),
    );
    expect(page).toContain("<ScheduleTimelineteamId={teamId}/>");
  });

  test("the schedules list links to the timeline", () => {
    const page: string = readDashboardCode(
      "Pages",
      "OnCallDuty",
      "OnCallDutySchedules.tsx",
    );

    expect(page).toContain(compact('title: "Timeline View"'));
    expect(page).toContain(
      compact("RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE] as Route"),
    );
  });
});

describe("Breadcrumbs", () => {
  test("both pages have a trail", () => {
    const onCall: string = readDashboardCode(
      "Utils",
      "Breadcrumbs",
      "OnCallDutyBreadcrumbs.ts",
    );
    const teams: string = readDashboardCode(
      "Utils",
      "Breadcrumbs",
      "TeamsBreadcrumbs.ts",
    );

    expect(onCall).toContain(
      compact(
        '...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE, [ "Project", "On-Call Duty", "Schedule Timeline", ])',
      ),
    );
    expect(teams).toContain(
      compact(
        '...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_ON_CALL_SCHEDULES, [ "Project", "Teams", "View Team", "On-Call Schedules", ])',
      ),
    );
  });
});

describe("Side menus", () => {
  test("On-Call Duty lists Schedule Timeline in the Schedules section, right after the list", () => {
    const menu: string = readDashboardCode(
      "Pages",
      "OnCallDuty",
      "SideMenu.tsx",
    );

    const schedulesIndex: number = menu.indexOf(
      compact('{ title: "Schedules", items: ['),
    );
    const listIndex: number = menu.indexOf(
      compact('title: "On-Call Schedules"'),
    );
    const timelineIndex: number = menu.indexOf(
      compact('title: "Schedule Timeline"'),
    );
    const feedsIndex: number = menu.indexOf(compact('title: "Calendar Feeds"'));

    expect(schedulesIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeGreaterThan(schedulesIndex);
    expect(timelineIndex).toBeGreaterThan(listIndex);
    expect(feedsIndex).toBeGreaterThan(timelineIndex);

    expect(menu).toContain(
      compact(
        "RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE] as Route, ), }, icon: IconProp.ViewColumns,",
      ),
    );
  });

  test("a team's menu has an On-Call section with its schedules", () => {
    const menu: string = readDashboardCode(
      "Pages",
      "Teams",
      "View",
      "SideMenu.tsx",
    );

    expect(menu).toContain(
      compact(
        '{ title: "On-Call", items: [ { link: { title: "On-Call Schedules", to: RouteUtil.populateRouteParams( RouteMap[PageMap.TEAM_VIEW_ON_CALL_SCHEDULES] as Route, { modelId: props.modelId }, ), }, icon: IconProp.Calendar, }, ], }',
      ),
    );
  });
});

describe("API", () => {
  test("BaseAPI mounts the timeline router under the app prefix", () => {
    const baseApi: string = compact(
      stripComments(
        fs.readFileSync(
          path.join(APP_ROOT, "FeatureSet", "BaseAPI", "Index.ts"),
          "utf8",
        ),
      ),
    );

    expect(baseApi).toContain(
      compact(
        'import OnCallScheduleTimelineAPI from "Common/Server/API/OnCallScheduleTimelineAPI";',
      ),
    );
    expect(baseApi).toContain(
      compact(
        "app.use(`/${APP_NAME.toLocaleLowerCase()}`, OnCallScheduleTimelineAPI);",
      ),
    );
  });

  test("the dashboard calls the route the server registers", () => {
    const client: string = readDashboardCode(
      "Components",
      "OnCallPolicy",
      "ScheduleTimeline",
      "ScheduleTimelineAPI.ts",
    );
    const server: string = compact(
      fs.readFileSync(
        path.join(
          APP_ROOT,
          "..",
          "Common",
          "Server",
          "API",
          "OnCallScheduleTimelineAPI.ts",
        ),
        "utf8",
      ),
    );

    expect(client).toContain(".addRoute(SCHEDULE_TIMELINE_ROUTE)");
    expect(server).toContain("router.get(SCHEDULE_TIMELINE_ROUTE,");
  });
});

describe("Locales", () => {
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

  // Strings rendered through translateString (menus, card and empty-state copy).
  const KEYS: Array<string> = [
    "Schedule Timeline",
    "Timeline View",
    "Every on-call schedule in this project side by side: who is on call, who is covering for whom, and where nobody is.",
    "Who is on call on every schedule this team owns, week by week or month by month.",
    "No on-call schedules yet",
    "Create an on-call schedule and every rotation in this project will show up here, side by side.",
    "This team does not own any on-call schedules yet",
    "Add this team as an owner on a schedule's Owners tab and its rotations will show up here.",
  ];

  test.each(LOCALES)(
    "%s has a non-empty entry for every new string",
    (locale: string) => {
      const bundle: Record<string, unknown> = JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>;

      for (const key of KEYS) {
        expect(typeof bundle[key]).toBe("string");
        expect((bundle[key] as string).trim().length).toBeGreaterThan(0);
      }
    },
  );

  test("English is the identity mapping", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "en.json"), "utf8"),
    ) as Record<string, unknown>;

    for (const key of KEYS) {
      expect(english[key]).toBe(key);
    }
  });

  test("the copy the locales translate is the copy the code renders", () => {
    const component: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "OnCallPolicy",
        "ScheduleTimeline",
        "ScheduleTimeline.tsx",
      ),
      "utf8",
    );
    const flattened: string = component.replace(/\s+/g, " ");

    for (const key of KEYS.slice(2)) {
      expect(flattened).toContain(key);
    }
  });
});
