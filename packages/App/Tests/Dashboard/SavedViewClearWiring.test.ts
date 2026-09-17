import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Picking a saved view on the Traces explorer was a one-way door: the dropdown
 * checkmarked it and offered nothing that meant "none", so the only way back
 * to the unfiltered explorer was a hard reload
 * (github.com/OneUptime/oneuptime/issues/3189).
 *
 * The dropdown half of the fix is exercised for real in
 * Common/Tests/UI/Components/*SavedViewsDropdown.test.tsx. What those cannot
 * reach is the host wiring: whether the explorers actually hand a clear
 * handler down, and whether that handler resets everything applying a view
 * set. The App suite has no renderer, so — as in
 * SavedViewFilterTupleWiring.test.ts — the wiring is checked by reading the
 * sources.
 *
 * The last describe here is the one that earns its keep over time: it derives
 * the fields "clear" must touch from the fields "apply" writes, so a field
 * added to apply later fails this file until clear undoes it too.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMPONENTS_DIR: string = path.join(DASHBOARD_SRC, "Components");

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

const CONTROL_CODE: string = readCode(
  "Components",
  "Telemetry",
  "TelemetrySavedViewsControl.tsx",
);
const TRACES_CODE: string = readCode(
  "Components",
  "Traces",
  "TracesViewer.tsx",
);
const METRICS_CODE: string = readCode(
  "Components",
  "Metrics",
  "MetricsViewer.tsx",
);
const METRIC_EXPLORER_CODE: string = readCode(
  "Components",
  "Metrics",
  "MetricExplorer.tsx",
);
const LOGS_CODE: string = readCode("Components", "Logs", "LogsViewer.tsx");

/*
 * The body of a `const name: ... = useCallback((...) => { ... }, [deps]);`,
 * read out of the squashed source so the assertions below can be scoped to
 * one function instead of the whole 2000-line viewer.
 */
function callbackBody(code: string, name: string): string {
  const start: number = code.indexOf(`const ${name}:`);

  if (start < 0) {
    throw new Error(`${name} is not declared in this file`);
  }

  const depsStart: number = code.indexOf("}, [", start);

  if (depsStart < 0) {
    throw new Error(`could not find the end of ${name}`);
  }

  /*
   * Prettier closes the deps array as `]);`, or — when the argument list is
   * wide enough to wrap — as `],` on its own line before `);`, which squashes
   * to `], );`. Matching only the first spelling silently ran the slice on
   * into the NEXT callback, quietly widening whatever it was scoped to.
   */
  const end: number = code
    .slice(depsStart)
    .search(/\]\s*\)\s*;|\]\s*,\s*\)\s*;/);

  if (end < 0) {
    throw new Error(`could not find the deps array of ${name}`);
  }

  return code.slice(start, depsStart + end);
}

function stateSettersIn(body: string): Array<string> {
  return Array.from(new Set(body.match(/set[A-Z]\w*\(/g) || [])).sort();
}

describe("the shared saved-views control offers a way out", () => {
  test("the dropdown is given a clear handler", () => {
    expect(CONTROL_CODE).toContain("onClear={clearSavedView}");
  });

  test("clearing drops the selection and resets the explorer", () => {
    /*
     * An empty state is what every host already treats as "nothing saved" —
     * each applyState substitutes its own defaults for the missing fields.
     */
    expect(CONTROL_CODE).toContain(
      squash("setSelectedSavedViewId(null); applyState({});"),
    );
  });

  test("clearing does not re-arm the default-view auto-apply", () => {
    /*
     * The default view is applied once, behind hasAppliedInitialDefault.
     * Resetting that ref on clear would re-apply the very view the user just
     * dismissed the next time savedViews changed.
     */
    expect(CONTROL_CODE).not.toContain(
      "hasAppliedInitialDefault.current=false",
    );
    expect(CONTROL_CODE).not.toContain(
      "hasAppliedInitialDefault.current = false",
    );
  });
});

describe("every explorer mounting the control inherits clearing", () => {
  function findFilesMounting(control: string): Array<string> {
    const matches: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.name.endsWith(".tsx")) {
          continue;
        }

        if (readCodeAt(fullPath).includes(`<${control}`)) {
          matches.push(fullPath);
        }
      }
    };

    walk(COMPONENTS_DIR);

    return matches;
  }

  /*
   * Listed rather than counted so that a fourth explorer shows up here as a
   * failure — its applyState has to tolerate an empty state before it can be
   * cleared, which is what the next block checks.
   */
  test("the known hosts are the ones this file pins", () => {
    const hosts: Array<string> = findFilesMounting(
      "TelemetrySavedViewsControl",
    ).map((file: string): string => {
      return path.basename(file);
    });

    expect(hosts.sort()).toEqual([
      "MetricExplorer.tsx",
      "MetricsViewer.tsx",
      "TracesViewer.tsx",
    ]);
  });

  test("no host reads a saved-view field without tolerating its absence", () => {
    /*
     * Clearing calls applyState({}), so any bare property access on a field
     * of the stored state throws the moment the field is missing — the same
     * class of crash a corrupt saved view already caused once.
     */
    for (const file of findFilesMounting("TelemetrySavedViewsControl")) {
      const code: string = readCodeAt(file);

      expect(code).not.toMatch(/state\.search\./);
      expect(code).not.toMatch(/state\.filters\./);
      expect(code).not.toMatch(/state\.timeRange\./);
      expect(code).not.toMatch(/state\.explorerConfig\./);
    }
  });
});

describe("an empty view state lands each explorer on its defaults", () => {
  test("traces: no search, no filter chips, the default hour, all spans, page one", () => {
    expect(TRACES_CODE).toContain(
      'const nextSearch: string = state.search || ""',
    );
    expect(TRACES_CODE).toContain("readSavedViewFilters(state.filters)");
    expect(TRACES_CODE).toContain(
      "setTimeRange(deserializeSavedViewTimeRange(state.timeRange))",
    );
    // Root-spans-only is a filter too: clearing has to let all spans back in.
    expect(TRACES_CODE).toContain("setRootOnly(state.rootOnly ?? false)");
    expect(TRACES_CODE).toContain("setPage(1)");
    expect(TRACES_CODE).toContain(
      "setPageSize(state.pageSize || DEFAULT_PAGE_SIZE)",
    );
  });

  test("metrics list: no search, no filter chips, the default hour, page one", () => {
    expect(METRICS_CODE).toContain(
      'const nextSearch: string = state.search || ""',
    );
    expect(METRICS_CODE).toContain("readSavedViewFilters(state.filters)");
    expect(METRICS_CODE).toContain(
      "setTimeRange(deserializeSavedViewTimeRange(state.timeRange))",
    );
    expect(METRICS_CODE).toContain("setPage(1)");
    expect(METRICS_CODE).toContain(
      "setPageSize(state.pageSize || DEFAULT_PAGE_SIZE)",
    );
  });

  test("no field is left behind a truthiness guard", () => {
    /*
     * `if (state.pageSize) { setPageSize(...) }` is the shape that broke this
     * once: every other field defaulted, and page size alone survived the
     * clear — visible both in the rows-per-page control and, through the URL
     * mirror, in the query string of a supposedly cleared explorer.
     */
    for (const code of [TRACES_CODE, METRICS_CODE]) {
      expect(code).not.toMatch(/if \(state\.\w+\) \{/);
    }
  });

  test("metric explorer: one empty query builder row and the default hour", () => {
    expect(METRIC_EXPLORER_CODE).toContain(
      squash("(state.explorerConfig || {}) as JSONObject"),
    );
    expect(METRIC_EXPLORER_CODE).toContain("getDefaultEmptyQueryConfig()");
    expect(METRIC_EXPLORER_CODE).toContain("TimeRange.PAST_ONE_HOUR");
  });
});

describe("the logs explorer offers the same way out", () => {
  const CLEAR_BODY: string = callbackBody(LOGS_CODE, "clearSavedView");
  const APPLY_BODY: string = callbackBody(LOGS_CODE, "applySavedView");

  test("the viewer is given a clear handler", () => {
    expect(LOGS_CODE).toContain("onClearSavedView={clearSavedView}");
  });

  test("the two callback bodies really are separate", () => {
    /*
     * They sit next to each other in the file, and an earlier version of
     * callbackBody ran off the end of applySavedView straight into
     * clearSavedView — which would have made the parity test below compare a
     * set against itself.
     */
    expect(APPLY_BODY).not.toContain("buildClearedLogsViewState");
    expect(CLEAR_BODY).not.toContain("resolveLogSavedViewTimeRange");
  });

  test("clearing goes through the shared defaults builder", () => {
    // Unit-tested for real in LogsViewerDefaults.test.ts.
    expect(CLEAR_BODY).toContain("buildClearedLogsViewState({");
    expect(CLEAR_BODY).toContain("baseQuery: buildBaseQuery(props)");
  });

  test("clearing keeps the window the embedding page pinned", () => {
    /*
     * An incident or alert page pins the moment it is about, and the entity
     * hub drives a controlled cursor. Neither came from the saved view, so
     * neither is the saved view's to take away — the same reason the default
     * view is not auto-applied for those hosts.
     */
    expect(CLEAR_BODY).toContain(
      "hostTimeRange: pinnedTimeRange || props.timeRangeOverride",
    );
  });

  test("clearing drops the selection", () => {
    expect(CLEAR_BODY).toContain("setSelectedSavedViewId(null)");
  });

  test("clearing stops live tailing, as applying a view does", () => {
    /*
     * Live mode pins the window to "now" and keeps re-querying. Leaving it on
     * would immediately move the window the clear just reset.
     */
    expect(CLEAR_BODY).toContain("disableLiveMode()");
  });

  test("clearing undoes every piece of state applying a view sets", () => {
    /*
     * The point of this file. Applying a saved log view writes nine separate
     * pieces of state; a clear that misses one leaves the explorer still
     * wearing part of the view. Deriving the list from applySavedView rather
     * than hard-coding it means a tenth field added there fails here.
     */
    const applied: Array<string> = stateSettersIn(APPLY_BODY);
    const cleared: Array<string> = stateSettersIn(CLEAR_BODY);

    expect(applied.length).toBeGreaterThan(0);

    const missing: Array<string> = applied.filter((setter: string): boolean => {
      return !cleared.includes(setter);
    });

    expect(missing).toEqual([]);
  });

  test("the fields clearing resets are the ones a saved view can carry", () => {
    // A readable spelling of the same contract, so a failure above is legible.
    for (const setter of [
      "setTimeRange(",
      "setAppliedFacetFilters(",
      "setFilterOptions(",
      "setPage(",
      "setPageSize(",
      "setSortField(",
      "setSortOrder(",
      "setSelectedColumns(",
      "setSelectedSavedViewId(",
    ]) {
      expect(CLEAR_BODY).toContain(setter);
    }
  });
});
