import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * WHAT A STATUS PAGE DRAWS ITS RESOURCES WITH, WITHOUT THE RULE FOR A FIRST
 * CHECK THAT IS LATE (issue #8899) OR THE DASHBOARD'S RESOURCES SCREEN.
 *
 * A status page's overview draws each resource Not monitored, Not monitored
 * yet or in its status by the rules of FrozenMonitorResources and
 * ResourceUptime, which it loads before it draws, and FrozenMonitorResources
 * reads MonitorFirstCheck: whether anything has measured a monitor, and
 * whether its status is still the one it started in. MonitorFirstCheck also
 * held the rule for a first check that is overdue - "No results yet" on the
 * Monitors list and the Monitor List widget (MonitorRowStatus) - which reads
 * the monitor's schedule and every monitor type's family and metrics, and
 * brought them all into every status page's first load: some 90 KB before
 * gzip that a status page never runs, which put it over its ceiling in
 * packages/Common/Scripts/first-load-budgets.js. That rule is a module of
 * its own (Utils/Monitor/MonitorFirstCheckOverdue), which only the lists
 * load.
 *
 * The overview lays its groups out by GroupNestingLayout, which draws a grid
 * group with no rows or columns yet as a list (#9476). It read a grid's axis
 * values through the Dashboard's Resources screen's model (ResourceExplorer)
 * and so brought that model, and the group hierarchy its navigator draws
 * (GroupHierarchyView), into every status page's first load - 3.6 KiB
 * gzipped, which put it over its ceiling. The page and the Resources screen
 * both read them from Utils/StatusPage/GridAxisValues now.
 *
 * Built as the status page builds (the shared esbuild config, for
 * production), with the modules its overview draws resources with as the
 * entry (Helpers/FirstLoadBuild).
 */

const MODULES: ReadonlyArray<string> = [
  "Utils/StatusPage/FrozenMonitorResources",
  "Utils/StatusPage/ResourceUptime",
  "Utils/StatusPage/GroupNestingLayout",
];

const NOT_BUILT: ReadonlyArray<[string, string]> = [
  [
    "the rule for a first check that is overdue",
    "Utils/Monitor/MonitorFirstCheckOverdue.ts",
  ],
  ["a monitor's schedule", "Utils/Monitor/MonitorCheckScheduleUtil.ts"],
  ["the cron reader", "Utils/CronTab.ts"],
  ["the monitor types' families", "Utils/Monitor/MonitorTypeFamily.ts"],
  ["the monitor overview's layout", "Utils/Monitor/MonitorOverviewFamily.ts"],
  ["every monitor type's metrics", "Utils/Monitor/MonitorMetricType.ts"],
  ["the database metric catalog", "Types/Monitor/DatabaseMetricCatalog.ts"],
  [
    "the Dashboard's Resources screen's model",
    "Utils/StatusPage/ResourceExplorer.ts",
  ],
  [
    "the Dashboard's group hierarchy navigator",
    "Utils/StatusPage/GroupHierarchyView.ts",
  ],
];

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: MODULES.map((module: string, index: number): string => {
      return `export { default as Module${index} } from ${JSON.stringify(
        path.join(COMMON_ROOT, module),
      )};`;
    }),
    serviceName: "StatusPage",
    publicPath: "/status-page/dist/",
  });
}, 300000);

describe("a browser build of what a status page draws its resources with", () => {
  test.each(
    MODULES.map((module: string): [string] => {
      return [module];
    }),
  )("has %s in its first load", (module: string) => {
    expect(inputsUnder(built!.firstLoad, `${module}.ts`).length).toBe(1);
  });

  test("has MonitorFirstCheck's rules in its first load, which tell a monitor nothing has checked yet", () => {
    expect(
      inputsUnder(built!.firstLoad, "Utils/Monitor/MonitorFirstCheck.ts")
        .length,
    ).toBe(1);
  });

  test.each(NOT_BUILT)(
    "does not build %s at all",
    (_name: string, file: string) => {
      expect(
        inputsUnder([...built!.firstLoad, ...built!.loadedLater], file),
      ).toEqual([]);
    },
  );
});
