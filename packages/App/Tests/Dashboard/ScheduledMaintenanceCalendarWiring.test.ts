import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How Scheduled Maintenance > Events gets its calendar, and nothing else
 * does. None of this wiring is reachable from a component test of the
 * calendar: the page that turns the calendar on, the lists that must stay
 * lists (a monitor's, a host's Scheduled Maintenance tab), the switch at the
 * end of the filter bar, Subscribe to calendar beside the list and under the
 * calendar, and the create page reading the day the calendar's + sends. So
 * these read the sources and pin the expressions, as the on-call calendar
 * feed's wiring test does.
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

describe("which lists of events get the calendar", () => {
  test("Scheduled Maintenance > Events turns it on", () => {
    expect(
      read("Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents.tsx"),
    ).toContain("showCalendarView={true}");
  });

  test("no other page does: a monitor's or a host's list of events stays a list", () => {
    const turnedOn: Array<string> = walk(path.join(DASHBOARD_SRC, "Pages"))
      .filter((file: string) => {
        return fs.readFileSync(file, "utf8").includes("showCalendarView");
      })
      .map((file: string) => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(turnedOn).toEqual([
      path.join(
        "Pages",
        "ScheduledMaintenanceEvents",
        "ScheduledMaintenanceEvents.tsx",
      ),
    ]);
  });

  test("the table shows the remembered view only where the calendar is on", () => {
    expect(TABLE).toContain(
      "useRememberedView<ScheduledMaintenanceView>( scheduledMaintenanceViewChoice, )",
    );
    expect(TABLE).toContain(
      "const view: ScheduledMaintenanceView = props.showCalendarView ? rememberedView : ScheduledMaintenanceView.List;",
    );
    expect(TABLE).toContain(
      "view === ScheduledMaintenanceView.Calendar ? ( <ScheduledMaintenanceCalendar",
    );
  });
});

describe("the List | Calendar switch", () => {
  test("sits at the end of the filter bar, where it stays when the view changes", () => {
    expect(TABLE).toContain("filterBarEnd: viewSwitch,");
    expect(TABLE).toContain(
      "if (!props.showCalendarView) { return undefined; }",
    );
    expect(TABLE).toContain("topContent={filterBar}");
  });

  test("the filter bar draws it after Clear all, at the bar's right end", () => {
    const hook: string = read(
      "Components/ResourceOwners/useResourceOwners.tsx",
    );

    const clearAll: number = hook.indexOf(
      'translator.translateText("Clear all")',
    );
    const end: number = hook.indexOf('data-testid="filter-bar-end"');

    expect(clearAll).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(clearAll);
    expect(hook).toContain("{options.filterBarEnd}");
    expect(hook).toContain('hasActiveFilters ? "" : "ml-auto"');
  });

  test("the calendar reads the same chips as the list", () => {
    expect(TABLE).toContain("query={mergeFiltersIntoQuery(props.query) || {}}");
  });
});

describe("Subscribe to calendar", () => {
  test("is in the list's buttons only where the calendar is on", () => {
    expect(TABLE).toContain(
      "buttons: props.showCalendarView ? [...cardbuttons, subscribeButton] : cardbuttons,",
    );
  });

  test("the list's button and the calendar's open the same dialog", () => {
    expect(TABLE).toContain("setShowSubscribeModal(true);");
    expect(TABLE).toContain(
      "{showSubscribeModal ? ( <MaintenanceCalendarSubscribeModal",
    );
    expect(TABLE).toContain(
      "onSubscribe={() => { setShowSubscribeModal(true); }}",
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
