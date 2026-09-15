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

/*
 * Non-overlapping occurrences of `needle` — for "built in exactly one place"
 * assertions, which a second, unguarded call site would break.
 */
function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

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

/*
 * An Inventory item's Logs page pins `logQuery.entityKeys` and nothing else,
 * so its list was filtered under an empty chip bar. The viewer now builds a
 * locked chip for that scope — display only, from the same key list the
 * requests carry, and never for a Kubernetes-style `entityScope`, whose
 * attribute chip already explains its entity keys.
 */
describe("an entity-key scope has a locked chip", () => {
  test("the viewer imports the shared entity-key chip builder, its display map type and the logs signal name", () => {
    const chips: Array<string> = importedNames(
      LOGS_VIEWER,
      "../../Utils/LockedEntityKeyChips",
    );

    expect(chips).toContain("buildLockedEntityKeyChips");
    expect(chips).toContain("LockedEntityKeyDisplayMap");
    expect(importedNames(LOGS_VIEWER, "./LogsLockedScope")).toContain(
      "LOGS_SIGNAL",
    );
  });

  test("the viewer accepts the display map as an optional prop", () => {
    const props: string = blockAfter(
      LOGS_VIEWER,
      "export interface ComponentProps {",
      "{",
      "}",
    );

    expect(props).toContain(
      "entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;",
    );
  });

  test("the base chips memo builds the entity-key chips from the pinned logQuery keys and the page's display map", () => {
    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );

    expect(memo).toContain("filters.push( ...buildLockedEntityKeyChips(");

    const call: string = blockAfter(
      memo,
      "buildLockedEntityKeyChips(",
      "(",
      ")",
    );

    // The same rows noun the attach step describes with, so the two agree.
    expect(call).toContain("rows: LOGS_SIGNAL");
    expect(call).toContain("entityKeys: logQueryEntityKeys");
    expect(call).toContain("displays: props.entityKeyDisplays");
  });

  test("the entity-key chips are in the list before the memo decorates and returns it", () => {
    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );

    const builtAt: number = memo.indexOf("buildLockedEntityKeyChips(");
    const returnedAt: number = memo.indexOf(
      "return attachLogsLockedFilterDetails(",
    );

    expect(builtAt).toBeGreaterThan(-1);
    expect(returnedAt).toBeGreaterThan(builtAt);
  });

  test("the memo re-runs when the pinned keys or the display map change", () => {
    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );
    const deps: string = dependencyList(memo);

    expect(deps).toContain("logQueryEntityKeys");
    expect(deps).toContain("props.entityKeyDisplays");
  });

  test("the chip shows the key list the histogram and facets requests filter by — never a different one", () => {
    const keys: string = blockAfter(
      LOGS_VIEWER,
      "const logQueryEntityKeys: Array<string> | undefined = useMemo(",
      "(",
      ")",
    );

    expect(keys).toContain('(props.logQuery as any)["entityKeys"]');
    expect(dependencyList(keys)).toContain("props.logQuery");

    const histogram: string = blockAfter(
      LOGS_VIEWER,
      "buildLogsHistogramRequest({",
      "{",
      "}",
    );

    expect(histogram).toContain("entityKeys: logQueryEntityKeys");

    const facets: string = blockAfter(
      LOGS_VIEWER,
      "const fetchFacets: () => Promise<void> = useCallback(",
      "(",
      ")",
    );

    expect(facets).toContain(
      '(requestData as any)["entityKeys"] = logQueryEntityKeys;',
    );
  });

  test("the display map and the base chips never reach a request or the list query", () => {
    const queryPaths: Array<string> = [
      blockAfter(
        LOGS_VIEWER,
        "function buildBaseQuery(props: ComponentProps): Query<Log> {",
        "{",
        "}",
      ),
      blockAfter(
        LOGS_VIEWER,
        "const fetchHistogramBuckets: () => Promise<Array<HistogramBucket>> = useCallback(",
        "(",
        ")",
      ),
      blockAfter(
        LOGS_VIEWER,
        "const fetchFacets: () => Promise<void> = useCallback(",
        "(",
        ")",
      ),
      blockAfter(
        LOGS_VIEWER,
        "const handleFilterChanged: (newFilter: Query<Log>) => void = useCallback(",
        "(",
        ")",
      ),
    ];

    for (const queryPath of queryPaths) {
      expect(queryPath).not.toContain("entityKeyDisplays");
      expect(queryPath).not.toContain("baseActiveFilters");
      expect(queryPath).not.toContain("buildLockedEntityKeyChips");
    }
  });

  test("the chips say who pinned the keys — the page only when the page says so — and the decoration step keeps that source", () => {
    /*
     * Log monitors write `logQuery.entityKeys` from their stored query, so an
     * incident's log snapshot reaches this memo with keys no page pinned.
     * attachLogsLockedFilterDetails re-describes every entity-key chip, so
     * the source must reach it as well as the builder, or the decoration
     * quietly restores "Pinned by this page". The wording is pinned in
     * LockedTelemetryScope.test.ts and the pass-through in
     * LogsLockedScope.test.ts.
     */
    expect(
      blockAfter(LOGS_VIEWER, "export interface ComponentProps {", "{", "}"),
    ).toContain("entityKeysPinnedByPage?: boolean | undefined;");

    const sources: Array<string> = importedNames(
      LOGS_VIEWER,
      "../../Utils/LockedTelemetryScope",
    );

    expect(sources).toContain("LOCKED_FILTER_SOURCE_PAGE");
    expect(sources).toContain("LOCKED_FILTER_SOURCE_STORED_QUERY");

    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );

    const declaredAt: number = memo.indexOf("const entityKeysSource: string =");

    expect(declaredAt).toBeGreaterThan(-1);

    const declaration: string = memo.slice(
      declaredAt,
      memo.indexOf(";", declaredAt) + 1,
    );
    const whenPinnedByPage: string = declaration.slice(
      declaration.indexOf("?") + 1,
      declaration.lastIndexOf(":"),
    );

    expect(declaration).toContain("props.entityKeysPinnedByPage");
    expect(whenPinnedByPage).toContain("LOCKED_FILTER_SOURCE_PAGE");
    expect(whenPinnedByPage).not.toContain("LOCKED_FILTER_SOURCE_STORED_QUERY");

    expect(blockAfter(memo, "buildLockedEntityKeyChips(", "(", ")")).toContain(
      "source: entityKeysSource",
    );
    expect(
      blockAfter(memo, "return attachLogsLockedFilterDetails(", "(", ")"),
    ).toContain("entityKeysSource");
    expect(dependencyList(memo)).toContain("props.entityKeysPinnedByPage");
  });
});

describe("a Kubernetes-style entity scope never becomes an entity-key chip", () => {
  test("the entity-key chips are built in exactly one place, and not from entityScope", () => {
    expect(occurrences(LOGS_VIEWER, "buildLockedEntityKeyChips(")).toBe(1);

    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );
    const call: string = blockAfter(
      memo,
      "buildLockedEntityKeyChips(",
      "(",
      ")",
    );

    expect(call).not.toContain("entityScope");

    // The key list itself is read from logQuery alone.
    const keys: string = blockAfter(
      LOGS_VIEWER,
      "const logQueryEntityKeys: Array<string> | undefined = useMemo(",
      "(",
      ")",
    );

    expect(keys).not.toContain("entityScope");
    expect(dependencyList(keys)).not.toContain("entityScope");
  });

  test("the entity scope still reaches the attribute chip that explains it", () => {
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

    expect(decorate).toContain("entityScope: props.entityScope");
  });
});
