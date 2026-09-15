import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The metrics explorer's locked chips explain themselves, each with the
 * search syntax that reproduces it on the main /metrics page. The
 * explanation text is owned by LockedTelemetryScope.test.ts and the chip
 * builders' behaviour by MetricsEntityChipDisplay.test.ts; what is left is
 * structural — that the viewer hands its entity scope to the builders, that
 * the chips reach the shared TelemetryViewer with the signal the Common
 * layer reads to word their tooltip, and that the viewer builds no
 * locked-filter actions of its own. None of that is observable from a unit
 * test of a helper, and each of them silently degrades the feature (a chip
 * with no tooltip, a tooltip pointing at the wrong explorer) rather than
 * failing, so this suite reads the source and pins the arrangement.
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

type BlockAfterFunction = (
  source: string,
  marker: string,
  opener: string,
  closer: string,
) => string;

/*
 * The balanced `opener`..`closer` region that follows `marker`, so a test
 * can say "inside THIS call" instead of matching a string that happens to
 * appear somewhere else in a 1,700-line component.
 */
const blockAfter: BlockAfterFunction = (
  source: string,
  marker: string,
  opener: string,
  closer: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const start: number = source.indexOf(opener, markerIndex);

  expect(start).toBeGreaterThanOrEqual(0);

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (character === opener) {
      depth++;
    } else if (character === closer) {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced block after marker: ${marker}`);
};

type BodyAfterFunction = (source: string, marker: string) => string;

/*
 * The body of the arrow function declared after `marker`. The builders are
 * typed `const f: (data: {...}) => T = (data: {...}): T => { ... }`, so the
 * first brace after the name opens the TYPE of the parameter, not the body;
 * the body is the balanced block after the `=> {` that follows.
 */
const bodyAfter: BodyAfterFunction = (
  source: string,
  marker: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const arrowIndex: number = source.indexOf("=> {", markerIndex);

  expect(arrowIndex).toBeGreaterThanOrEqual(0);

  return blockAfter(source.slice(arrowIndex), "=> {", "{", "}");
};

const METRICS_VIEWER: string = readSource(
  "Components",
  "Metrics",
  "MetricsViewer.tsx",
);

const CHIP_DISPLAY: string = readSource("Utils", "MetricsEntityChipDisplay.ts");

describe("MetricsViewer explains its locked chips", () => {
  test("hands the page's entity scope to the chip builders", () => {
    const call: string = blockAfter(
      METRICS_VIEWER,
      "buildMetricsActiveFilterChips(",
      "{",
      "}",
    );

    expect(call).toContain("entityScope: props.entityScope,");
  });

  test("the chip builders attach an explanation through the shared describers", () => {
    expect(CHIP_DISPLAY).toContain('from "./LockedTelemetryScope"');

    const attributeChips: string = bodyAfter(
      CHIP_DISPLAY,
      "export const buildMetricsLockedAttributeChips",
    );

    expect(attributeChips).toContain(
      'lockedDetail: describeLockedAttributeFilter({ signal: "metrics",',
    );
    // The scope belongs to exactly one attribute; it is attached to that one.
    expect(attributeChips).toContain(
      "data.entityScope && data.entityScope.attributeKey === key ? data.entityScope : undefined",
    );

    const scopeChips: string = bodyAfter(
      CHIP_DISPLAY,
      "export const buildMetricsLockedScopeChips",
    );

    // Described after display resolution so the entity label is the chip's.
    expect(scopeChips).toContain(
      'lockedDetail: describeLockedEntityFilter({ signal: "metrics", entityTypeLabel: resolved.displayKey,',
    );
  });
});

describe("MetricsViewer hands its locked chips to the shared viewer and builds no locked-filter actions", () => {
  test("the chips and the metrics signal reach the shared viewer under the prop names the Common layer reads", () => {
    /*
     * The chip tooltip reads the signal to say which explorer's search bar
     * the syntax is pasted into. The JSX element cannot be sliced by brace
     * balancing (its props hold arrow functions and nested elements), so the
     * check is positional: each prop appears exactly once, after the element
     * opens and before the component returns.
     */
    const elementStart: number = METRICS_VIEWER.indexOf(
      "<TelemetryViewer<MetricType>",
    );
    const componentEnd: number = METRICS_VIEWER.lastIndexOf(
      "export default MetricsViewer;",
    );

    expect(elementStart).toBeGreaterThanOrEqual(0);
    expect(componentEnd).toBeGreaterThan(elementStart);

    for (const prop of [
      "activeFilters={mergedActiveFilters}",
      'lockedFilterSignal="metrics"',
    ]) {
      expect(METRICS_VIEWER.split(prop).length - 1).toBe(1);

      const propIndex: number = METRICS_VIEWER.indexOf(prop);

      expect(propIndex).toBeGreaterThan(elementStart);
      expect(propIndex).toBeLessThan(componentEnd);
    }
  });

  test("the viewer builds no locked-filter actions, explorer link or scope-wide copy text", () => {
    /*
     * Each locked chip's search syntax lives on the chip itself, so nothing
     * here derives a second, scope-wide affordance from the chip bar.
     */
    for (const removed of [
      "lockedFilterActions",
      "LockedFilterActions",
      "LockedFilterActionOptions",
      "buildLockedScopeFilterActions",
      "buildLockedScopeExplorerLink",
      "buildLockedScopeCopyText",
      "buildLogsLockedFilterActions",
      "LockedTelemetryScopeLink",
    ]) {
      expect(METRICS_VIEWER).not.toContain(removed);
    }
  });
});

/*
 * An Inventory item's Metrics page scopes the list by entity key alone, and
 * the chip bar used to stay empty. The chip itself, its explanation and its
 * search syntax are unit-tested in MetricsEntityChipDisplay.test.ts; what is
 * left is what only the source can show — that the viewer accepts the
 * page's names, hands the
 * bare entity-key scope (and never the entityScope's keys) to the builder,
 * recomputes when either changes, and that the chip array stays display
 * only: nothing that builds a query, the URL or a saved view reads it.
 */
describe("MetricsViewer pins an entity-key scope as a locked chip", () => {
  type ImportListFromFunction = (
    source: string,
    moduleSpecifier: string,
  ) => string;

  const importListFrom: ImportListFromFunction = (
    source: string,
    moduleSpecifier: string,
  ): string => {
    const fromIndex: number = source.indexOf(`from "${moduleSpecifier}"`);

    expect(fromIndex).toBeGreaterThanOrEqual(0);

    return source.slice(source.lastIndexOf("import", fromIndex), fromIndex);
  };

  type IndexesOfFunction = (source: string, needle: string) => Array<number>;

  const indexesOf: IndexesOfFunction = (
    source: string,
    needle: string,
  ): Array<number> => {
    const indexes: Array<number> = [];
    let index: number = source.indexOf(needle);

    while (index >= 0) {
      indexes.push(index);
      index = source.indexOf(needle, index + needle.length);
    }

    return indexes;
  };

  type ContextAtFunction = (source: string, index: number) => string;

  // Enough of the surroundings to name the offending line in a failure.
  const contextAt: ContextAtFunction = (
    source: string,
    index: number,
  ): string => {
    return source.slice(Math.max(0, index - 80), index + 60);
  };

  type DependenciesOfFunction = (memo: string) => Array<string>;

  /*
   * A memo's dependency list, sliced from its closing `]);` back to the last
   * `}, [` — not from a return statement, which a memo body can repeat.
   */
  const dependenciesOf: DependenciesOfFunction = (
    memo: string,
  ): Array<string> => {
    const close: number = memo.lastIndexOf("]);");
    const open: number = memo.lastIndexOf("}, [", close);

    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);

    return memo
      .slice(open + "}, [".length, close)
      .split(",")
      .map((dependency: string): string => {
        return dependency.trim();
      })
      .filter((dependency: string): boolean => {
        return dependency.length > 0;
      });
  };

  /*
   * The chip memo, from its declaration through the `]);` that closes its
   * dependency list — the builder call inside it holds no `]);` of its own.
   */
  const MEMO_MARKER: string =
    "const mergedActiveFilters: Array<ActiveFilter> = useMemo(";
  const memoStart: number = METRICS_VIEWER.indexOf(MEMO_MARKER);
  const memoEnd: number =
    METRICS_VIEWER.indexOf("]);", memoStart) + "]);".length;
  const MEMO: string = METRICS_VIEWER.slice(memoStart, memoEnd);

  test("the chip memo is where the slices below expect it", () => {
    expect(memoStart).toBeGreaterThanOrEqual(0);
    expect(memoEnd).toBeGreaterThan(memoStart);
    expect(MEMO).toContain("buildMetricsActiveFilterChips({");
  });

  test("declares the display map next to the entity-key filter, typed from the shared chip module", () => {
    const props: string = blockAfter(
      METRICS_VIEWER,
      "interface Props",
      "{",
      "}",
    );

    expect(props).toContain("entityKeysFilter?: Array<string> | undefined;");
    expect(props).toContain(
      "entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;",
    );
    expect(
      importListFrom(METRICS_VIEWER, "../../Utils/LockedEntityKeyChips"),
    ).toContain("LockedEntityKeyDisplayMap");
  });

  test("hands the bare entity-key scope and its names to the chip builder, alongside the entity scope", () => {
    const call: string = blockAfter(
      MEMO,
      "buildMetricsActiveFilterChips(",
      "{",
      "}",
    );

    expect(call).toContain("entityKeysFilter: props.entityKeysFilter,");
    expect(call).toContain("entityKeyDisplays: props.entityKeyDisplays,");
    expect(call).toContain("entityScope: props.entityScope,");

    /*
     * REGRESSION: a Kubernetes / host / Docker page's entityScope carries
     * entity keys too, but its attribute chip already explains them. Handing
     * those keys to the entity-key chip would give every such page a second
     * pill that reads like a second, AND-ed filter.
     */
    expect(call).not.toContain("entityScope.entityKeys");
    expect(call).not.toContain("entityScope?.entityKeys");
  });

  test("recomputes the chips when the entity keys or their names change", () => {
    const dependencies: Array<string> = dependenciesOf(MEMO);

    expect(dependencies).toContain("props.entityKeysFilter");
    expect(dependencies).toContain("props.entityKeyDisplays");
    expect(dependencies).toContain("props.entityScope");
  });

  test("the page's names reach the chip builder and nothing else", () => {
    const uses: Array<number> = indexesOf(
      METRICS_VIEWER,
      "props.entityKeyDisplays",
    );

    expect(uses.length).toBeGreaterThan(0);

    const outsideTheChipMemo: Array<string> = uses
      .filter((index: number): boolean => {
        return index < memoStart || index >= memoEnd;
      })
      .map((index: number): string => {
        return contextAt(METRICS_VIEWER, index);
      });

    expect(outsideTheChipMemo).toEqual([]);
  });

  test("the chip array is display only: it reaches the chip bar, and nothing that builds a query, the URL or a saved view", () => {
    const chipBarPropIndex: number = METRICS_VIEWER.indexOf(
      "activeFilters={mergedActiveFilters}",
    );

    expect(chipBarPropIndex).toBeGreaterThanOrEqual(0);

    const chipBarReference: number =
      chipBarPropIndex + "activeFilters={".length;

    /*
     * Every read of the chip array is either its own memo or the chip bar
     * prop. The metric list query, the metric-name and sparkline loads, the
     * URL mirror, the saved-view capture, the facet include and the row
     * click all read the `activeFilters` state instead — which the locked
     * chips never enter.
     */
    const unexpectedReads: Array<string> = indexesOf(
      METRICS_VIEWER,
      "mergedActiveFilters",
    )
      .filter((index: number): boolean => {
        const inChipMemo: boolean = index >= memoStart && index < memoEnd;

        return !inChipMemo && index !== chipBarReference;
      })
      .map((index: number): string => {
        return contextAt(METRICS_VIEWER, index);
      });

    expect(unexpectedReads).toEqual([]);
    expect(METRICS_VIEWER).not.toContain(
      "setActiveFilters(mergedActiveFilters",
    );
  });

  test("the chip builder adds the entity-key chips through the shared builder, for the metrics rows", () => {
    expect(importListFrom(CHIP_DISPLAY, "./LockedEntityKeyChips")).toContain(
      "buildLockedEntityKeyChips",
    );

    const body: string = bodyAfter(
      CHIP_DISPLAY,
      "export const buildMetricsActiveFilterChips",
    );
    const call: string = blockAfter(
      body,
      "buildLockedEntityKeyChips(",
      "{",
      "}",
    );

    expect(call).toContain('rows: "metrics",');
    expect(call).toContain("entityKeys: data.entityKeysFilter,");
    expect(call).toContain("displays: data.entityKeyDisplays,");

    // The same regression, one layer down.
    expect(body).not.toContain("entityScope.entityKeys");
    expect(body).not.toContain("entityScope?.entityKeys");
  });
});

type MemoDependenciesFunction = (hook: string) => Array<string>;

/*
 * A hook's dependency list, sliced from its closing `]);` back to the last
 * `}, [` — not from a return statement, which a hook body can repeat.
 */
const memoDependencies: MemoDependenciesFunction = (
  hook: string,
): Array<string> => {
  const close: number = hook.lastIndexOf("]);");
  const open: number = hook.lastIndexOf("}, [", close);

  expect(open).toBeGreaterThanOrEqual(0);
  expect(close).toBeGreaterThan(open);

  return hook
    .slice(open + "}, [".length, close)
    .split(",")
    .map((dependency: string): string => {
      return dependency.trim();
    })
    .filter((dependency: string): boolean => {
      return dependency.length > 0;
    });
};

type HookFromFunction = (source: string, marker: string) => string;

// A hook from its declaration through the `]);` closing its dependency list.
const hookFrom: HookFromFunction = (source: string, marker: string): string => {
  const start: number = source.indexOf(marker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start, source.indexOf("]);", start) + "]);".length);
};

/*
 * An Inventory item's Metrics page pins `entityKeysFilter` alone, and the
 * viewer used to treat that as the unscoped explorer: a project-wide Service
 * facet with project-wide counts (picking a service the item does not emit
 * AND-ed the list down to nothing), and the project's saved views with its
 * DEFAULT view auto-applying over the item's scope. A Kubernetes / Host page
 * (entityScope) never had any of that. `isScoped` is the switch for both, so
 * this pins that the entity-key scope throws it, and that each thing it
 * controls gives the scoped-page behaviour. The project's service list is NOT
 * one of them: a typed `service:` token still needs it on that page.
 */
describe("an entity-key scope makes the metrics list a scoped page, as an entity scope does", () => {
  const IS_SCOPED_MARKER: string = "const isScoped: boolean = useMemo(";

  test("a non-empty entity-key filter counts, beside the entity scope", () => {
    const memo: string = hookFrom(METRICS_VIEWER, IS_SCOPED_MARKER);

    expect(memo).toContain("props.entityKeysFilter");
    expect(memo).toContain(".length > 0");

    const returned: string = memo.slice(
      memo.lastIndexOf("return"),
      memo.lastIndexOf("}, ["),
    );

    expect(returned).toContain("hasEntityKeysFilter");
    expect(returned).toContain("Boolean(props.entityScope)");
  });

  test("recomputes when the entity keys change", () => {
    const dependencies: Array<string> = memoDependencies(
      hookFrom(METRICS_VIEWER, IS_SCOPED_MARKER),
    );

    expect(dependencies).toContain("props.entityKeysFilter");
    expect(dependencies).toContain("props.entityScope");
  });

  test("scoped, the Service facet is not offered: no facet configs and no sidebar", () => {
    const facetConfigsMemo: string = blockAfter(
      METRICS_VIEWER,
      "const facetConfigs: Array<FacetConfig> = useMemo(",
      "{",
      "}",
    );

    expect(facetConfigsMemo).toContain("if (isScoped) { return []; }");
    expect(METRICS_VIEWER).toContain("showFacetSidebar={!isScoped}");
  });

  test("scoped, the project-wide facet request is never made, so no scope has to be threaded through it", () => {
    const FETCH_FACETS_MARKER: string =
      "const fetchFacets: () => Promise<void> = useCallback(";
    const GUARD: string = "if (isScoped) { setFacetData({}); return; }";

    const body: string = blockAfter(
      METRICS_VIEWER,
      FETCH_FACETS_MARKER,
      "{",
      "}",
    );
    const parts: Array<string> = body.split(GUARD);

    expect(parts).toHaveLength(2);
    expect(parts[0]).not.toContain("postApi(");
    expect(parts[1]).toContain("postApi(");
    expect(parts[1]).toContain('"/telemetry/metrics/facets"');

    expect(
      memoDependencies(hookFrom(METRICS_VIEWER, FETCH_FACETS_MARKER)),
    ).toContain("isScoped");
  });

  test("the project's services still load under an entity-key scope, so a typed service: token is applied rather than dropped", () => {
    /*
     * A `service:<name>` token applies only once the service list has
     * loaded. Gating that load on `isScoped` made the Inventory item's
     * Metrics page ignore a submitted `service:checkout` while still offering
     * the token, so the load has its own flag, which the entity-key scope
     * does not throw.
     */
    const loadServicesAt: number = METRICS_VIEWER.indexOf(
      "const loadServices: () => Promise<void> = async () =>",
    );

    expect(loadServicesAt).toBeGreaterThanOrEqual(0);

    const effect: string = hookFrom(
      METRICS_VIEWER.slice(
        METRICS_VIEWER.lastIndexOf("useEffect(", loadServicesAt),
      ),
      "useEffect(",
    );
    const guard: string = effect.slice(0, effect.indexOf("const loadServices"));

    expect(guard).toContain("if (skipsServiceList)");
    expect(guard).not.toContain("isScoped");
    expect(memoDependencies(effect)).toContain("skipsServiceList");

    const flag: string = hookFrom(
      METRICS_VIEWER,
      "const skipsServiceList: boolean = useMemo(",
    );

    for (const scope of [
      "props.serviceIds",
      "props.attributeFilters",
      "props.entityScope",
    ]) {
      expect(flag).toContain(scope);
    }

    expect(flag).not.toContain("entityKeysFilter");
    expect(flag).not.toContain("isScoped");
  });

  test("scoped, no saved views are offered, so the project's default view cannot apply over the page's scope", () => {
    expect(METRICS_VIEWER.split("<TelemetrySavedViewsControl").length - 1).toBe(
      1,
    );

    const toolbar: string = blockAfter(
      METRICS_VIEWER,
      "toolbarLeadingActions={",
      "{",
      "}",
    );

    expect(toolbar).toContain("isScoped");
    expect(toolbar).toContain("<TelemetrySavedViewsControl");
  });
});
