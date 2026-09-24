import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Includes from "Common/Types/BaseDatabase/Includes";
import type Dictionary from "Common/Types/Dictionary";
import type { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
/*
 * Pure modules, imported statically: the same chip builders and glue the
 * viewer's base-chips memo calls, so a scenario's token (or reason) is
 * checked on real chips, not re-derived.
 */
import { buildAttributeFilterChips } from "../../FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";
import {
  LOGS_SIGNAL,
  attachLogsLockedFilterDetails,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsLockedScope";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  ENTITY_KEYS_FACET_KEY,
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * The logs viewer's wiring for the locked chips' search syntax. The pure
 * halves are pinned elsewhere (LogsLockedScope.test.ts,
 * LockedTelemetryScope.test.ts, LogsHistogramRequest.test.ts); what this
 * suite owns is that the viewer actually CALLS them, from the right place,
 * with the right inputs:
 *
 *  - every base chip carries its search syntax (or the reason there is none)
 *    from what the page hands over — the entity-key chips from the builder
 *    that reads the display map naming their keys, every other locked chip
 *    from the decoration step that reads its pinned attributes — and the
 *    page's entity scope, which only shapes the list query, is not a chip
 *    input;
 *  - the Common viewer is told the signal name, and nothing else about the
 *    locked scope: each chip's own tooltip is the only place its search
 *    syntax is offered;
 *  - the typed search reaches the histogram and the facets requests through
 *    a value-keyed slice of the list query, the page's pinned attributes
 *    survive a typed attribute search, and the applied chips win over it;
 *  - a superseded facets response is never painted.
 *
 * Each of these is a connection that a refactor could drop without any test
 * of a helper noticing, and each would cost the reader a filter (or a chip's
 * search syntax) with no visible error.
 *
 * The assertions check MEMBERSHIP inside a balanced slice — this import is
 * present, that dependency is listed — never the position of a name among
 * its neighbours. LogsViewer.tsx is edited by many features, and a wiring
 * test that pins the exact shape of a dependency array breaks on unrelated
 * work while the connection it guards is still intact.
 *
 * Where a scenario depends on what the memo hands the chip steps, the real
 * steps are also run with exactly those inputs (`viewerLockedChips`), and
 * the chip's exact token or reason is asserted.
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

interface ViewerLockedChipsInput {
  // `logQuery.attributes`, as pinned.
  logQueryAttributes?: Dictionary<DictionaryEntryValue> | undefined;
  // `logQuery.entityKeys`, whoever pinned them.
  entityKeys?: Array<string> | undefined;
  entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
}

type ViewerLockedChipsFunction = (
  input: ViewerLockedChipsInput,
) => Array<ActiveFilter>;

/*
 * The base-chips memo's entity-key, attribute and decoration steps, called
 * with exactly the arguments the source assertions below pin — and with
 * nothing the memo does not hand them.
 */
const viewerLockedChips: ViewerLockedChipsFunction = (
  input: ViewerLockedChipsInput,
): Array<ActiveFilter> => {
  const filters: Array<ActiveFilter> = [
    ...buildLockedEntityKeyChips({
      rows: LOGS_SIGNAL,
      entityKeys: input.entityKeys,
      displays: input.entityKeyDisplays,
    }),
    ...buildAttributeFilterChips(input.logQueryAttributes, {
      displayKeys: input.attributeFilterDisplayKeys,
      displayValues: input.attributeFilterDisplayValues,
    }),
  ];

  return attachLogsLockedFilterDetails(filters, {
    logQueryAttributes: input.logQueryAttributes,
  });
};

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "aaaaaaaaaaaaaaaa";

// An Inventory item's display map: the pod's name and identifying attributes.
const POD_DISPLAYS: LockedEntityKeyDisplayMap = {
  [POD_KEY]: {
    displayKey: "Kubernetes Pod",
    displayValue: "checkout-7d9f",
    searchAttributes: {
      "k8s.cluster.name": "prod",
      "k8s.namespace.name": "shop",
      "k8s.pod.name": "checkout-7d9f",
    },
  },
};
const POD_SEARCH_TOKEN: string =
  "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

describe("locked chips carry their search syntax", () => {
  test("the viewer imports the logs glue and the typed-filter helpers", () => {
    const glue: Array<string> = importedNames(LOGS_VIEWER, "./LogsLockedScope");

    expect(glue).toContain("attachLogsLockedFilterDetails");
    expect(glue).not.toContain("buildLogsLockedFilterActions");

    const helpers: Array<string> = importedNames(
      LOGS_VIEWER,
      "./LogsHistogramRequest",
    );

    expect(helpers).toContain("applyTypedLogFilterToRequest");
    expect(helpers).toContain("preserveBaseAttributesInTypedFilter");
    expect(helpers).toContain("pickTypedLogFilter");
    expect(helpers).toContain("serializeTypedLogFilter");
  });

  test("the base chips are decorated from the page's pinned attributes before they leave the memo", () => {
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

    // The memo re-runs when the pinned attributes change.
    expect(dependencyList(memo)).toContain("logQueryAttributes");

    /*
     * The pinned map as pinned is what the tokens are spelled from: an
     * operator value only reaches its chip as display text.
     */
    const chips: Array<ActiveFilter> = viewerLockedChips({
      logQueryAttributes: {
        "resource.host.name": "web-01",
        "k8s.namespace.name": new Includes(["payments", "checkout"]),
      },
    });

    expect(
      chips.map((chip: ActiveFilter): unknown => {
        return chip.lockedDetail;
      }),
    ).toEqual([
      { searchToken: "@resource.host.name:web-01" },
      { searchToken: "@k8s.namespace.name:(payments OR checkout)" },
    ]);
  });
});

describe("each locked chip carries its own search syntax, with no scope-wide actions", () => {
  test("the viewer builds no actions for the whole locked scope, and imports nothing that would", () => {
    for (const removed of [
      "lockedFilterActions",
      "LockedFilterActions",
      "LockedFilterActionOptions",
      "buildLogsLockedFilterActions",
      "buildLockedScopeFilterActions",
      "LockedTelemetryScopeLink",
    ]) {
      expect({ removed, present: LOGS_VIEWER.includes(removed) }).toEqual({
        removed,
        present: false,
      });
    }
  });

  test("the Common viewer receives the signal the chips' tooltips name, and no actions", () => {
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
    expect(mount).not.toContain("lockedFilterActions");
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
      "const fetchHistogramBuckets: () => Promise<LogsHistogramData> = useCallback(",
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
 * attribute chip already stands for its entity keys.
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

    // The signal the attach step describes with, so both spell one syntax.
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
        "const fetchHistogramBuckets: () => Promise<LogsHistogramData> = useCallback(",
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

  test("whoever pinned the keys, the chip carries the item's search syntax when the page names its attributes, and the reason when it does not", () => {
    /*
     * Log monitors write `logQuery.entityKeys` from their stored query, so an
     * incident's log snapshot reaches this memo with keys and no display map,
     * while an Inventory item's Logs tab hands over the item's identifying
     * attributes. The display map is the only difference the chips see.
     */
    const inventoryItem: Array<ActiveFilter> = viewerLockedChips({
      entityKeys: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(inventoryItem).toEqual([
      {
        facetKey: ENTITY_KEYS_FACET_KEY,
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: { searchToken: POD_SEARCH_TOKEN },
      },
    ]);

    const monitorSnapshot: Array<ActiveFilter> = viewerLockedChips({
      entityKeys: [POD_KEY],
    });

    expect(monitorSnapshot).toEqual([
      {
        facetKey: ENTITY_KEYS_FACET_KEY,
        value: POD_KEY,
        displayKey: DEFAULT_ENTITY_KEY_DISPLAY_KEY,
        displayValue: POD_KEY,
        readOnly: true,
        lockedDetail: {
          searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
        },
      },
    ]);
  });

  test("only the builder is handed the display map — the decoration step is not, and an item's search syntax survives it", () => {
    /*
     * The display map carries the identifying resource attributes the chip's
     * search syntax is spelled with, and buildLockedEntityKeyChips spells it.
     * attachLogsLockedFilterDetails has no describer for the entity-key
     * column, so it passes those chips through untouched and needs no map.
     * The pass-through is pinned in LogsLockedScope.test.ts.
     */
    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );

    expect(blockAfter(memo, "buildLockedEntityKeyChips(", "(", ")")).toContain(
      "displays: props.entityKeyDisplays",
    );

    const decorate: string = blockAfter(
      memo,
      "return attachLogsLockedFilterDetails(",
      "(",
      ")",
    );

    expect(decorate).toContain("logQueryAttributes");
    expect(decorate).not.toContain("entityKeyDisplays");
    // The builder still reads the map, so the memo still re-runs on it.
    expect(dependencyList(memo)).toContain("props.entityKeyDisplays");

    /*
     * A page pinning several keys: each chip keeps the syntax of its OWN
     * key through the decoration, and a key the map names no attributes for
     * keeps its reason.
     */
    const chips: Array<ActiveFilter> = viewerLockedChips({
      entityKeys: [POD_KEY, NODE_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(
      chips.map((chip: ActiveFilter): unknown => {
        return chip.lockedDetail;
      }),
    ).toEqual([
      { searchToken: POD_SEARCH_TOKEN },
      { searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON },
    ]);
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

  test("the entity scope reaches the list query and not the chips: the attribute chip beside it is spelled from the pinned attribute alone", () => {
    expect(
      blockAfter(
        LOGS_VIEWER,
        "function buildBaseQuery(props: ComponentProps): Query<Log> {",
        "{",
        "}",
      ),
    ).toContain('(query as any)["entityScope"] = props.entityScope;');

    const memo: string = blockAfter(
      LOGS_VIEWER,
      "const baseActiveFilters: Array<ActiveFilter> = useMemo(",
      "(",
      ")",
    );

    // Neither built, described nor re-run from the entity scope.
    expect(memo).not.toContain("entityScope");

    /*
     * A Kubernetes cluster's Logs tab: `entityScope` carries the cluster's
     * entity key and attribute fallback, and `logQuery.attributes` pins the
     * same attribute, read as "Cluster: production". That one chip stands
     * for the scope, and its token is the attribute's.
     */
    const chips: Array<ActiveFilter> = viewerLockedChips({
      logQueryAttributes: { "resource.k8s.cluster.name": "prod-eks-01" },
      attributeFilterDisplayKeys: { "resource.k8s.cluster.name": "Cluster" },
      attributeFilterDisplayValues: {
        "resource.k8s.cluster.name": "production",
      },
    });

    expect(chips).toEqual([
      {
        facetKey: "attributes.resource.k8s.cluster.name",
        value: "prod-eks-01",
        displayKey: "Cluster",
        displayValue: "production",
        readOnly: true,
        lockedDetail: { searchToken: "@resource.k8s.cluster.name:prod-eks-01" },
      },
    ]);
  });
});
