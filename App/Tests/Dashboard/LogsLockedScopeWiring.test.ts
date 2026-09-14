import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The logs viewer's wiring for the locked-filter explainer. The pure halves
 * are pinned elsewhere (LogsLockedScope.test.ts, LockedTelemetryScope.test.ts,
 * LogsHistogramRequest.test.ts); what this suite owns is that the viewer
 * actually CALLS them, from the right place, with the right inputs:
 *
 *  - every base chip is decorated with its explanation, and the page's
 *    entity scope reaches the decorator;
 *  - the "Copy filter" / "Open in Logs" actions are built from those chips
 *    and handed to the Common viewer together with the signal name;
 *  - the typed search reaches the histogram and the facets requests through
 *    a value-keyed slice of the list query, the page's pinned attributes
 *    survive a typed attribute search, and the applied chips win over it;
 *  - a superseded facets response is never painted.
 *
 * Each of these is a connection that a refactor could drop without any test
 * of a helper noticing, and each would cost the reader a filter (or an
 * explanation) with no visible error.
 *
 * The assertions check MEMBERSHIP inside a balanced slice — this import is
 * present, that dependency is listed — never the position of a name among
 * its neighbours. LogsViewer.tsx is edited by many features, and a wiring
 * test that pins the exact shape of a dependency array breaks on unrelated
 * work while the connection it guards is still intact.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/*
 * The balanced `opener`..`closer` region after `marker`, so an assertion can
 * say "inside THIS call" rather than "somewhere in the file".
 */
function blockAfter(
  source: string,
  marker: string,
  opener: string,
  closer: string,
): string {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  /*
   * A marker that ENDS with the opener names the region itself (`useCallback(`);
   * searching from the marker's start would catch an opener inside the
   * marker — the `(` of a `() =>` type annotation — and slice an empty pair.
   */
  const start: number = marker.endsWith(opener)
    ? markerAt + marker.length - 1
    : source.indexOf(opener, markerAt);

  if (start < 0) {
    throw new Error(`No "${opener}" after marker: ${marker}`);
  }

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (character === opener) {
      depth++;
    } else if (character === closer) {
      depth--;

      if (depth === 0) {
        return source.slice(start + 1, index);
      }
    }
  }

  throw new Error(`Unbalanced "${opener}" after marker: ${marker}`);
}

/*
 * The dependency array of a hook whose whole call is `hookBody`: the text
 * between the LAST `},[` and the closing `]`. Located from the end, so the
 * body's final statement can change without the array "vanishing".
 */
function dependencyList(hookBody: string): string {
  const depsStart: number = hookBody.lastIndexOf("}, [");

  if (depsStart < 0) {
    throw new Error("No dependency array in hook body");
  }

  const depsEnd: number = hookBody.indexOf("]", depsStart);

  if (depsEnd < 0) {
    throw new Error("Unterminated dependency array in hook body");
  }

  return hookBody.slice(depsStart + "}, [".length, depsEnd);
}

/*
 * The names imported from one module, whatever order or line breaks the
 * import statement uses.
 */
function importedNames(source: string, moduleSpecifier: string): Array<string> {
  const statementEnd: number = source.indexOf(`} from "${moduleSpecifier}";`);

  if (statementEnd < 0) {
    throw new Error(`No import from ${moduleSpecifier}`);
  }

  const statementStart: number = source.lastIndexOf("import {", statementEnd);

  return source
    .slice(statementStart + "import {".length, statementEnd)
    .split(",")
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

const LOGS_VIEWER: string = readSource("Components", "Logs", "LogsViewer.tsx");

describe("locked chips are explained", () => {
  test("the viewer imports the logs glue and the typed-filter helpers", () => {
    const glue: Array<string> = importedNames(LOGS_VIEWER, "./LogsLockedScope");

    expect(glue).toContain("attachLogsLockedFilterDetails");
    expect(glue).toContain("buildLogsLockedFilterActions");

    const helpers: Array<string> = importedNames(
      LOGS_VIEWER,
      "./LogsHistogramRequest",
    );

    expect(helpers).toContain("applyTypedLogFilterToRequest");
    expect(helpers).toContain("preserveBaseAttributesInTypedFilter");
    expect(helpers).toContain("pickTypedLogFilter");
    expect(helpers).toContain("serializeTypedLogFilter");
  });

  test("the base chips are decorated with the page's entity scope before they leave the memo", () => {
    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );
    const decorate: string = blockAfter(
      memo,
      "return attachLogsLockedFilterDetails(",
      "(",
      ")",
    );

    expect(decorate).toContain("filters,");
    expect(decorate).toContain("logQueryAttributes");
    expect(decorate).toContain("entityScope: props.entityScope");

    // The memo re-runs when the scope changes.
    expect(dependencyList(memo)).toContain("props.entityScope");
  });
});

describe("the whole locked scope travels together", () => {
  test("the actions are built from the base chips and the current window", () => {
    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const lockedFilterActions: LockedFilterActionOptions | undefined = useMemo(",
      "(",
      ")",
    );
    const build: string = blockAfter(
      memo,
      "return buildLogsLockedFilterActions(",
      "(",
      ")",
    );

    expect(build).toContain("chips: baseActiveFilters");
    expect(build).toContain("logQueryAttributes");
    expect(build).toContain("timeRange");

    const deps: string = dependencyList(memo);

    expect(deps).toContain("baseActiveFilters");
    expect(deps).toContain("logQueryAttributes");
    expect(deps).toContain("timeRange");
  });

  test("the Common viewer receives the signal and the actions", () => {
    /*
     * The JSX props of the one <LogsViewer …/> mount. Angle brackets are not
     * balanced inside props (`=>` in every callback), so the slice runs to
     * the self-closing tag instead.
     */
    const mountAt: number = LOGS_VIEWER.indexOf("<LogsViewer ");
    const mountEnd: number = LOGS_VIEWER.indexOf("/>", mountAt);

    expect(mountAt).toBeGreaterThan(-1);
    expect(mountEnd).toBeGreaterThan(mountAt);

    const mount: string = LOGS_VIEWER.slice(mountAt, mountEnd);

    expect(mount).toContain('lockedFilterSignal="logs"');
    expect(mount).toContain("lockedFilterActions={lockedFilterActions}");
  });
});

describe("what the search bar typed reaches every panel", () => {
  test("the aggregate slice of the list query is keyed by value, not by the query object", () => {
    /*
     * The list query is rebuilt on every base-scope pass. Keying the chart
     * and the facets on the object itself refetched both twice per mount and
     * once with the previous scope on every host prop change.
     */
    expect(LOGS_VIEWER).toContain(
      "const typedAggregateFilterKey: string = serializeTypedLogFilter(",
    );

    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const typedAggregateFilter: Record<string, unknown> | undefined = useMemo(",
      "(",
      ")",
    );

    expect(memo).toContain("return pickTypedLogFilter(");
    expect(dependencyList(memo)).toContain("typedAggregateFilterKey");
    expect(dependencyList(memo)).not.toContain("filterOptions");
  });

  test("the histogram request carries the aggregate slice and re-fetches when it changes", () => {
    const call: string = blockAfter(
      LOGS_VIEWER,
      "buildLogsHistogramRequest({",
      "{",
      "}",
    );

    expect(call).toContain("typedFilter: typedAggregateFilter");

    const histogramCallback: string = blockAfter(
      LOGS_VIEWER,
      "const fetchHistogramBuckets: () => Promise<Array<HistogramBucket>> = useCallback(",
      "(",
      ")",
    );
    const deps: string = dependencyList(histogramCallback);

    expect(deps).toContain("typedAggregateFilter");
    // Not the whole query object — that is the double-fetch.
    expect(deps).not.toContain("filterOptions");
  });

  test("the facets request carries the aggregate slice, before it goes out, and re-fetches when it changes", () => {
    const facetsCallback: string = blockAfter(
      LOGS_VIEWER,
      "const fetchFacets: () => Promise<void> = useCallback(",
      "(",
      ")",
    );

    expect(facetsCallback).toContain(
      "applyTypedLogFilterToRequest(requestData, typedAggregateFilter)",
    );
    expect(
      facetsCallback.indexOf("applyTypedLogFilterToRequest("),
    ).toBeLessThan(facetsCallback.indexOf('postApi( "/telemetry/logs/facets"'));

    const deps: string = dependencyList(facetsCallback);

    expect(deps).toContain("typedAggregateFilter");
    expect(deps).not.toContain("filterOptions");
  });

  test("a superseded facets response is dropped, and does not switch off the live request's loader", () => {
    const facetsCallback: string = blockAfter(
      LOGS_VIEWER,
      "const fetchFacets: () => Promise<void> = useCallback(",
      "(",
      ")",
    );

    expect(facetsCallback).toContain(
      "const sequence: number = ++facetRequestSequence.current;",
    );

    // The guard sits between the response and every state write.
    const responseAt: number = facetsCallback.indexOf(
      'postApi( "/telemetry/logs/facets"',
    );
    const guardAt: number = facetsCallback.indexOf(
      "if (!isCurrent()) { return; }",
      responseAt,
    );
    const paintAt: number = facetsCallback.indexOf("setFacetData(facets)");

    expect(guardAt).toBeGreaterThan(responseAt);
    expect(paintAt).toBeGreaterThan(guardAt);

    const finallyBlock: string = blockAfter(
      facetsCallback,
      "finally {",
      "{",
      "}",
    );

    expect(finallyBlock).toContain(
      "if (isCurrent()) { setFacetLoading(false); }",
    );
  });

  test("a typed search keeps the page's pinned attributes underneath and the applied chips on top", () => {
    const handler: string = blockAfter(
      LOGS_VIEWER,
      "const handleFilterChanged: (newFilter: Query<Log>) => void = useCallback(",
      "(",
      ")",
    );
    const update: string = blockAfter(handler, "setFilterOptions(", "(", ")");

    /*
     * Order matters: pinned attributes go under the typed ones, then the
     * chips are applied over both — a chip the user can see wins its own
     * column, typed values on other keys survive.
     */
    expect(update).toContain("applyLogsFacetFiltersToQuery(");
    expect(update).toContain(
      "preserveBaseAttributesInTypedFilter(newFilter, logQueryAttributes)",
    );
    expect(update.indexOf("applyLogsFacetFiltersToQuery(")).toBeLessThan(
      update.indexOf("preserveBaseAttributesInTypedFilter("),
    );
    expect(update).toContain("appliedFacetFilters");

    const deps: string = dependencyList(handler);

    expect(deps).toContain("logQueryAttributes");
    expect(deps).toContain("appliedFacetFilters");
  });
});

describe("the page's pinned attributes are never written into", () => {
  test("the base query copies the host's attributes map", () => {
    const base: string = blockAfter(
      LOGS_VIEWER,
      "function buildBaseQuery(props: ComponentProps): Query<Log> {",
      "{",
      "}",
    );

    /*
     * Chips land in `attributes[<key>]`. Sharing the host's object turned
     * every applied attribute chip into a permanent part of the page's scope.
     */
    expect(base).toContain(
      "(query as any).attributes = { ...(pinnedAttributes",
    );
  });
});
