import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The App suite runs in plain Node with no renderer, and App/tsconfig.json
 * excludes FeatureSet/Dashboard, so these pin the Processes pages' wiring by
 * reading their sources (the render tests live in
 * Common/Tests/App/Dashboard/HostProcessesSearchSort.test.tsx). Sources are
 * whitespace-squashed and comment-stripped first, so a Prettier reflow or a
 * comment explaining a removal cannot make a check pass or fail.
 */

const HOST_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Host",
);

function readCode(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(HOST_DIR, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const LIST: string = readCode("View", "Processes.tsx");
const DETAIL: string = readCode("View", "ProcessView.tsx");

describe("the Processes pages share one contract", () => {
  test.each([
    ["the list", LIST],
    ["the detail page", DETAIL],
  ])(
    "%s takes the process attribute keys from the shared module",
    (_page: string, source: string) => {
      /*
       * Two copies of "resource.process.pid" is two places to get the
       * prefix wrong, and the wrong one matches nothing without erroring -
       * or links a row's View button to a page that cannot find it.
       */
      expect(source).toContain('from "../Utils/Processes"');
      for (const key of [
        '"resource.process.pid"',
        '"resource.process.executable.name"',
        '"resource.process.command"',
        '"resource.process.owner"',
      ]) {
        expect(source).not.toContain(key);
      }
    },
  );

  test("the list names its metrics through the module too", () => {
    expect(LIST).not.toContain('"process.cpu.utilization"');
    expect(LIST).not.toContain('"process.memory.usage"');
    expect(LIST).toContain("PROCESS_CPU_UTILIZATION_METRIC_NAME");
    expect(LIST).toContain("PROCESS_MEMORY_USAGE_METRIC_NAME");
  });
});

describe("the Processes list", () => {
  test("leaves the reading, searching and sorting rules to the tested module", () => {
    expect(LIST).toContain("buildProcessRows({");
    expect(LIST).toContain("filterProcessRows(rows, searchText)");
    expect(LIST).toContain("sortProcessRows(");
    expect(LIST).toContain("resolveProcessSort({");
    expect(LIST).toContain(
      "isProcessFetchCutOff(cpuDatapoints, PROCESS_FETCH_LIMIT) || isProcessFetchCutOff(memoryDatapoints, PROCESS_FETCH_LIMIT)",
    );
  });

  test("lets every data column sort; only the actions column cannot", () => {
    const columns: string = LIST.slice(
      LIST.indexOf("const tableColumns:"),
      LIST.indexOf("const actionButtons:"),
    );

    expect(columns.split("disableSort: true").length - 1).toBe(1);
    for (const key of [
      'key: "executable"',
      'key: "pid"',
      'key: "user"',
      'key: "cpuPercent"',
      'key: "memoryBytes"',
    ]) {
      expect(columns).toContain(key);
    }
  });

  test("honours the page size the footer's picker asks for", () => {
    /*
     * The shared footer always offers a rows-per-page picker and reports the
     * pick as onNavigateToPage's second argument; dropping it leaves a
     * control that does nothing.
     */
    expect(LIST).toContain(
      "onNavigateToPage={(page: number, itemsOnPage: number) => {",
    );
    expect(LIST).toContain("setPageSize(itemsOnPage);");
    expect(LIST).toContain("itemsOnPage={pageSize}");
  });

  test("keeps its table id, which the render tests and the browser rely on", () => {
    expect(LIST).toContain('id="host-processes-table"');
  });
});
