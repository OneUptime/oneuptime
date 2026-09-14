import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The traces explorer's locked chips — a service page's entity, a
 * snapshot's stored query, a resource page's attribute filters — carry a
 * LockedFilterDetail that the shared chip renders as its tooltip, and the
 * "Copy filter" / "Open in Traces" actions are built from those chips.
 *
 * The describers and builders are unit-tested in LockedTelemetryScope.test.ts
 * and TracesEntityDisplay.test.ts. What this suite pins is the WIRING in
 * TracesViewer.tsx, which is where the detail is most easily lost: the viewer
 * rebuilds each stored-query chip as a fresh object literal, so a detail that
 * is not attached at that literal never reaches the chip, and nothing would
 * fail — the tooltip would simply go back to saying "(applied filter)".
 *
 * Assertions are on MEMBERSHIP inside a sliced block (this memo, this call),
 * never on the exact text of a whole dependency array, import list or run of
 * JSX props: those are shared files that other features edit, and a name
 * added next to one of these must not read as this wiring being undone.
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
 * say "inside THIS memo" rather than "somewhere in the file".
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

  const start: number = source.indexOf(opener, markerAt);

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

/* The `import { … }` list that precedes `from "<moduleSpecifier>"`. */
function importListFrom(source: string, moduleSpecifier: string): string {
  const fromIndex: number = source.indexOf(`from "${moduleSpecifier}"`);

  if (fromIndex < 0) {
    throw new Error(`No import from ${moduleSpecifier}`);
  }

  return source.slice(source.lastIndexOf("import", fromIndex), fromIndex);
}

/*
 * The dependency array of the hook whose declaration starts at `marker`:
 * the `[…]` that follows the LAST `}, [` before the hook's closing `);`.
 */
function dependenciesOf(source: string, marker: string): string {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const end: number = source.indexOf("]);", markerAt);
  const start: number = source.lastIndexOf("}, [", end);

  return source.slice(start + "}, [".length, end);
}

const TRACES_VIEWER: string = readSource(
  "Components",
  "Traces",
  "TracesViewer.tsx",
);

const TRACES_ENTITY_DISPLAY: string = readSource(
  "Components",
  "Traces",
  "TracesEntityDisplay.ts",
);

describe("TracesViewer imports the locked-scope helpers", () => {
  test("describers come from the pure utility, the link builder from its route-aware sibling, and the stored-query dispatcher from the display module", () => {
    const pureImports: string = importListFrom(
      TRACES_VIEWER,
      "../../Utils/LockedTelemetryScope",
    );

    for (const name of [
      "buildLockedScopeCopyText",
      "describeLockedAttributeFilter",
      "describeLockedEntityFilter",
    ]) {
      expect(pureImports).toContain(name);
    }

    expect(
      importListFrom(TRACES_VIEWER, "../../Utils/LockedTelemetryScopeLink"),
    ).toContain("buildLockedScopeExplorerLink");

    const displayImports: string = importListFrom(
      TRACES_VIEWER,
      "./TracesEntityDisplay",
    );

    for (const name of [
      "describeStoredQueryChip",
      "entityScopeForAttributeKey",
      "buildLockedAttributeChip",
    ]) {
      expect(displayImports).toContain(name);
    }
  });

  test("the renderer-free display module never loads the explorer link builder — it reads `window` at load", () => {
    /*
     * TracesEntityDisplay.test.ts runs in plain Node. The link builder pulls
     * RouteMap → Common/UI/Config, which throws "window is not defined"
     * before a single test runs; the describers are pure and may be imported.
     */
    expect(TRACES_ENTITY_DISPLAY).not.toContain("LockedTelemetryScopeLink");
    expect(TRACES_ENTITY_DISPLAY).toContain(
      'from "../../Utils/LockedTelemetryScope"',
    );
  });
});

describe("every locked chip carries its explanation", () => {
  const lockedChipsMemo: string = blockAfter(
    TRACES_VIEWER,
    "const lockedChips: Array<ActiveFilter> = useMemo(",
    "{",
    "}",
  );

  test("the service / RUM application scope chip is described AFTER its label resolves", () => {
    /*
     * Resolving first is what turns "Service: <id>" into
     * "RUM Application: checkout-web"; the explanation must name the latter.
     */
    const entityBranch: string = blockAfter(
      lockedChipsMemo,
      "if (props.primaryEntityId)",
      "{",
      "}",
    );

    expect(entityBranch).toContain(
      "const resolved: ActiveFilter = resolveChipDisplay(",
    );
    expect(entityBranch).toContain(
      'lockedDetail: describeLockedEntityFilter({ signal: "traces", entityTypeLabel: resolved.displayKey, id: entityId, name: resolved.displayValue, })',
    );
  });

  test("the stored-query chips get their detail at the literal that rebuilds them — the drop point — with the columns the scope matches as substrings", () => {
    /*
     * A single stored span name / status message is compiled as a
     * substring match; only the scope knows which columns took that path,
     * so the context comes from spanScope, not from the chip.
     */
    expect(lockedChipsMemo).toContain(
      'substringColumns: new Set<string>([ ...(spanScope.spanNameSearch ? ["name"] : []), ...(spanScope.statusMessageSearch ? ["statusMessage"] : []), ]),',
    );

    const spanScopeLoop: string = blockAfter(
      lockedChipsMemo,
      "for (const chip of spanScope.chips as Array<SpanScopeChip>)",
      "{",
      "}",
    );

    expect(spanScopeLoop).toContain(
      "const resolved: ActiveFilter = resolveChipDisplay(",
    );
    expect(spanScopeLoop).toContain(
      "base.push({ ...resolved, lockedDetail: describeStoredQueryChip(resolved, storedQueryContext), });",
    );
  });

  test("the attribute scope chips are explained from the built label, with the entity scope only where its key matches", () => {
    const attributeLoop: string = blockAfter(
      lockedChipsMemo,
      "for (const [key, value] of Object.entries(props.attributeFilters))",
      "{",
      "}",
    );

    expect(attributeLoop).toContain(
      "const attributeChip: ActiveFilter = buildLockedAttributeChip(",
    );
    expect(attributeLoop).toContain(
      'lockedDetail: describeLockedAttributeFilter({ signal: "traces", attributeKey: key, rawValue: value, displayKey: attributeChip.displayKey, displayValue: attributeChip.displayValue, entityScope: entityScopeForAttributeKey(props.entityScope, key), })',
    );
  });

  test("a scope change re-renders the chip bar", () => {
    const dependencies: string = dependenciesOf(
      TRACES_VIEWER,
      "const lockedChips: Array<ActiveFilter> = useMemo(",
    );

    for (const dependency of [
      "props.primaryEntityId",
      "props.attributeFilters",
      "props.attributeFilterDisplayKeys",
      "props.attributeFilterDisplayValues",
      "props.entityScope",
      "spanScope",
      "activeFilters",
      "submittedSearch",
      "resolveChipDisplay",
    ]) {
      expect(dependencies).toContain(dependency);
    }
  });

  test("the chip bar is the locked chips first, then the user's, then the root-only marker", () => {
    expect(TRACES_VIEWER).toContain(
      "return [ ...lockedChips, ...activeFilters.map(resolveChipDisplay), ...spanTypeChip, ];",
    );
  });
});

describe("Copy filter / Open in Traces", () => {
  const actionsMemo: string = blockAfter(
    TRACES_VIEWER,
    "const lockedFilterActions: LockedFilterActionOptions | undefined =",
    "{",
    "}",
  );

  test("are built from the LOCKED chips alone, plus the current window", () => {
    expect(actionsMemo).toContain(
      "if (lockedChips.length === 0) { return undefined; }",
    );
    expect(actionsMemo).toContain(
      'const copyText: string = buildLockedScopeCopyText("traces", lockedChips);',
    );

    const linkCall: string = blockAfter(
      actionsMemo,
      "buildLockedScopeExplorerLink(",
      "{",
      "}",
    );

    expect(linkCall).toContain('signal: "traces"');
    expect(linkCall).toContain("timeRange");
    // The link is built from facetKey / value pairs, never from display text.
    expect(linkCall).toContain(
      "return { facetKey: chip.facetKey, value: chip.value };",
    );

    expect(actionsMemo).toContain("openExplorerRoute: link.url");
    expect(actionsMemo).toContain("notCarried: link.notCarried");

    const dependencies: string = dependenciesOf(
      TRACES_VIEWER,
      "const lockedFilterActions: LockedFilterActionOptions | undefined =",
    );

    expect(dependencies).toContain("lockedChips");
    expect(dependencies).toContain("timeRange");
  });

  test("a link builder that cannot resolve the project route degrades to copy only, never to a crashed chip bar", () => {
    expect(actionsMemo).toContain("catch { return { copyText }; }");
  });

  test("reach the shared viewer under the traces signal", () => {
    /*
     * The JSX element cannot be sliced by brace balancing (its props hold
     * arrow functions and nested elements), so the check is positional: each
     * prop appears exactly once, after the element opens and before the
     * component returns.
     */
    const elementStart: number = TRACES_VIEWER.indexOf("<TelemetryViewer");
    const componentEnd: number = TRACES_VIEWER.lastIndexOf(
      "export default TracesViewer;",
    );

    expect(elementStart).toBeGreaterThanOrEqual(0);
    expect(componentEnd).toBeGreaterThan(elementStart);

    for (const prop of [
      'lockedFilterSignal="traces"',
      "lockedFilterActions={lockedFilterActions}",
    ]) {
      expect(TRACES_VIEWER.split(prop).length - 1).toBe(1);

      const propIndex: number = TRACES_VIEWER.indexOf(prop);

      expect(propIndex).toBeGreaterThan(elementStart);
      expect(propIndex).toBeLessThan(componentEnd);
    }
  });
});

describe("the Logs / Metrics pivots know the entity scope is carried by its attribute", () => {
  test("buildTracesPivotScope receives the attribute half of the page's entityScope", () => {
    const pivotCall: string = blockAfter(
      TRACES_VIEWER,
      "return buildTracesPivotScope(",
      "{",
      "}",
    );

    expect(pivotCall).toContain(
      "entityScope: props.entityScope ? { attributeKey: props.entityScope.attributeKey, attributeValue: props.entityScope.attributeValue, } : undefined,",
    );
    // The legacy flag is still passed, so an entityKeys-only scope is still reported.
    expect(pivotCall).toContain("hasEntityScope: Boolean(");
    expect(pivotCall).toContain("props.entityKeysFilter");
  });
});
