import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How Scheduled Maintenance gets its calendar - a page of its own under a
 * Calendar section of the side menu, with Calendar Settings in the folded
 * Settings - and nothing else does. None of this wiring is reachable from a
 * component test of the calendar: the page that draws the calendar, the
 * lists that must stay lists (All Events, a monitor's or a host's Scheduled
 * Maintenance tab), the side menu's sections, the routes, Subscribe to
 * calendar and the external calendars' ⋯ item, and the create page reading
 * the day the calendar's + sends. So these read the sources and pin the
 * expressions, as the on-call calendar feed's wiring test does.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WHITESPACE_RUN: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /^\s*\/\/.*$/gm;

function read(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE_RUN, " ");
}

function walk(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

const TABLE: string = read(
  "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
);
const SIDE_MENU: string = read("Pages/ScheduledMaintenanceEvents/SideMenu.tsx");
const ROUTES: string = read("Routes/ScheduleMaintenanceEventsRoutes.tsx");
const ROUTE_MAP: string = read("Utils/RouteMap.ts");
const CALENDAR_PAGE: string = read(
  "Pages/ScheduledMaintenanceEvents/Calendar.tsx",
);
const ALL_EVENTS_PAGE: string = read(
  "Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents.tsx",
);

describe("which pages draw the calendar", () => {
  test("the Maintenance Calendar page draws the events as a calendar", () => {
    expect(CALENDAR_PAGE).toContain("view={ScheduledMaintenanceView.Calendar}");
    expect(CALENDAR_PAGE).toContain("title={MAINTENANCE_CALENDAR_TITLE}");
  });

  test("no other page does: All Events, and a monitor's or a host's list of events, stay lists", () => {
    const calendars: Array<string> = walk(path.join(DASHBOARD_SRC, "Pages"))
      .filter((file: string) => {
        return fs
          .readFileSync(file, "utf8")
          .includes("ScheduledMaintenanceView.Calendar");
      })
      .map((file: string) => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(calendars).toEqual([
      path.join("Pages", "ScheduledMaintenanceEvents", "Calendar.tsx"),
    ]);
    expect(ALL_EVENTS_PAGE).not.toContain("view=");
  });

  test("the table draws a list unless it is asked for the calendar", () => {
    expect(TABLE).toContain(
      "const view: ScheduledMaintenanceView = props.view || ScheduledMaintenanceView.List;",
    );
    expect(TABLE).toContain(
      "view === ScheduledMaintenanceView.Calendar ? ( <ScheduledMaintenanceCalendar",
    );
  });

  test("the List | Calendar switch is gone from the list, and nothing remembers it", () => {
    expect(TABLE).not.toContain("ViewSwitch");
    expect(TABLE).not.toContain("useRememberedView");
    expect(TABLE).not.toContain("filterBarEnd");
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "ScheduledMaintenance",
          "ScheduledMaintenanceViewChoice.ts",
        ),
      ),
    ).toBe(false);
  });

  test("a reader who had left the list on its calendar is taken to the calendar's page once", () => {
    expect(ALL_EVENTS_PAGE).toContain("if (takePreviousCalendarChoice()) {");
    expect(ALL_EVENTS_PAGE).toContain(
      "RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR] as Route",
    );
    expect(ALL_EVENTS_PAGE).toContain("{ replace: true }");
  });

  test("the calendar reads the same chips as the list", () => {
    expect(TABLE).toContain("query={mergeFiltersIntoQuery(props.query) || {}}");
    expect(TABLE).toContain("topContent={filterBar}");
  });
});

describe("the side menu", () => {
  test("has a Calendar section of its own, right after Overview and open, holding the Maintenance Calendar", () => {
    const overview: number = SIDE_MENU.indexOf('title: "Overview"');
    const calendar: number = SIDE_MENU.indexOf('title: "Calendar"');
    const workspace: number = SIDE_MENU.indexOf("workspaceSection ?");

    expect(overview).toBeGreaterThan(-1);
    expect(calendar).toBeGreaterThan(overview);
    expect(workspace).toBeGreaterThan(calendar);

    const section: string = SIDE_MENU.slice(calendar, workspace);

    expect(section).toContain('title: "Maintenance Calendar"');
    expect(section).toContain(
      "RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR] as Route",
    );
    expect(section).toContain("icon: IconProp.Calendar");
    expect(section).not.toContain("defaultCollapsed");
  });

  test("keeps Calendar Settings in the folded Settings section, right before Numbering", () => {
    const settings: number = SIDE_MENU.indexOf('title: "Settings"');
    const calendarSettings: number = SIDE_MENU.indexOf(
      'title: "Calendar Settings"',
    );
    const numbering: number = SIDE_MENU.indexOf('title: "Numbering"');

    expect(settings).toBeGreaterThan(-1);
    expect(calendarSettings).toBeGreaterThan(settings);
    expect(SIDE_MENU.slice(settings, calendarSettings)).toContain(
      "defaultCollapsed: true",
    );
    expect(SIDE_MENU.slice(calendarSettings, numbering)).toContain(
      "PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR",
    );
    expect(SIDE_MENU.slice(calendarSettings, numbering)).toContain(
      "icon: IconProp.Calendar",
    );
    /*
     * Numbering is next, and every product's last Settings entry
     * (NumberingPagesWiring): nothing comes after it in the section.
     */
    expect(numbering).toBeGreaterThan(calendarSettings);
    expect(
      SIDE_MENU.slice(
        calendarSettings + 'title: "Calendar Settings"'.length,
        numbering,
      ),
    ).not.toContain("title: ");
    expect(
      SIDE_MENU.slice(numbering + 'title: "Numbering"'.length),
    ).not.toContain("title: ");
  });
});

describe("the routes", () => {
  test("the calendar is at /calendar and Calendar Settings at /settings/calendar", () => {
    expect(ROUTE_MAP).toContain(
      '[PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR]: "calendar",',
    );
    expect(ROUTE_MAP).toContain(
      '[PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR]: "settings/calendar",',
    );
  });

  test("both pages are served under the Scheduled Maintenance layout", () => {
    expect(ROUTES).toContain(
      "<ScheduledMaintenanceCalendarPage {...props} pageRoute={ RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR] as Route }",
    );
    expect(ROUTES).toContain(
      "<ScheduledMaintenanceSettingsCalendar {...props}",
    );
    expect(ROUTES).toContain(
      'import ScheduledMaintenanceSettingsCalendar from "../Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings";',
    );
  });

  test("both pages say where they are in the trail", () => {
    const trail: string = read(
      "Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs.ts",
    );

    // The calendar by the name its side menu entry and its card give it.
    expect(trail).toContain(
      'PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR, ["Project", "Scheduled Maintenance Events", "Maintenance Calendar"]',
    );
    expect(trail).toContain(
      'PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR, ["Project", "Scheduled Maintenance", "Settings", "Calendar Settings"]',
    );
  });
});

describe("Subscribe to calendar", () => {
  test("is the calendar's, no longer in the list's ⋯", () => {
    expect(TABLE).toContain("buttons: cardbuttons,");
    expect(TABLE).not.toContain("subscribeButton");
  });

  test("the calendar opens the dialog", () => {
    expect(TABLE).toContain(
      "{showSubscribeModal ? ( <MaintenanceCalendarSubscribeModal",
    );
    expect(TABLE).toContain(
      "onSubscribe={() => { setShowSubscribeModal(true); }}",
    );
  });
});

describe("external calendars", () => {
  test("the calendar's ⋯ offers Add External Calendar, to whoever may add one", () => {
    expect(TABLE).toContain('title: "Add External Calendar"');
    expect(TABLE).toContain(
      "new ScheduledMaintenanceExternalCalendar(), ModelAction.Create,",
    );
    expect(TABLE).toContain(
      "...(externalCalendarButton ? [externalCalendarButton] : []),",
    );
  });

  test("Add External Calendar opens Calendar Settings with its Add dialog open, and the page takes the ask out of its address", () => {
    expect(TABLE).toContain(
      "Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[ PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR ] as Route, ).addQueryParams(getAddExternalCalendarQuery()), );",
    );

    const settings: string = read(
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings.tsx",
    );

    // Opened once, for whoever may add one.
    expect(settings).toContain(
      "const [isAddAsked] = useState<boolean>((): boolean => { return ( isAddExternalCalendarAsked(Navigation.getQueryString()) && PermissionGate.check( new ScheduledMaintenanceExternalCalendar(), ModelAction.Create, ).isAllowed ); });",
    );
    expect(settings).toContain("showCreateForm={isAddAsked}");

    // Then out of the address: a refresh or Back does not open it again.
    expect(settings).toContain(
      "Navigation.setQueryString({ [EXTERNAL_CALENDAR_OPEN_QUERY_PARAM]: null, });",
    );
  });

  test("the toggles under the calendar link to Calendar Settings", () => {
    expect(TABLE).toContain(
      "externalCalendarSettingsRoute={RouteUtil.populateRouteParams( RouteMap[ PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR ] as Route, )}",
    );
  });
});

describe("schedule maintenance on a day", () => {
  test("only for whoever may create events, and never where creating is off", () => {
    expect(TABLE).toContain(
      "const canCreateEvents: boolean = !props.disableCreate && PermissionGate.check(new ScheduledMaintenance(), ModelAction.Create) .isAllowed;",
    );
    expect(TABLE).toContain("canCreate={canCreateEvents}");
  });

  test("opens the create page with the day's start in its address, which the form reads", () => {
    expect(TABLE).toContain("startsAt: startsAt.toISOString(),");
    expect(TABLE).toContain("PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE");
    expect(read("Pages/ScheduledMaintenanceEvents/Create.tsx")).toContain(
      'getDefaultMaintenanceStartsAt( Navigation.getQueryStringByName("startsAt"), )',
    );
  });

  test("an event's block opens the event's own page", () => {
    expect(TABLE).toContain(
      "RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route",
    );
  });
});
