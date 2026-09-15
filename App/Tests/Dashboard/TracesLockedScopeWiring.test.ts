import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The traces explorer's locked chips — a service page's entity, a
 * snapshot's stored query, a resource page's attribute filters, an Inventory
 * item's entity key — carry a LockedFilterDetail whose search syntax the
 * shared chip shows as its tooltip.
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
  test("describers come from the pure utility and the stored-query dispatcher from the display module", () => {
    const pureImports: string = importListFrom(
      TRACES_VIEWER,
      "../../Utils/LockedTelemetryScope",
    );

    for (const name of [
      "describeLockedAttributeFilter",
      "describeLockedEntityFilter",
    ]) {
      expect(pureImports).toContain(name);
    }

    const displayImports: string = importListFrom(
      TRACES_VIEWER,
      "./TracesEntityDisplay",
    );

    for (const name of [
      "describeStoredQueryChip",
      "entityScopeForAttributeKey",
      "buildLockedAttributeChip",
      "buildTracesLockedEntityKeyChips",
    ]) {
      expect(displayImports).toContain(name);
    }
  });

  test("the entity-key chip names arrive as the shared display map, and the display module builds the chip through the shared entity-key builder", () => {
    expect(
      importListFrom(TRACES_VIEWER, "../../Utils/LockedEntityKeyChips"),
    ).toContain("LockedEntityKeyDisplayMap");

    const sharedImports: string = importListFrom(
      TRACES_ENTITY_DISPLAY,
      "../../Utils/LockedEntityKeyChips",
    );

    expect(sharedImports).toContain("buildLockedEntityKeyChips");
    expect(sharedImports).toContain("LockedEntityKeyDisplayMap");
  });

  test("the renderer-free display module takes its describers from the pure utility and never loads the route map", () => {
    /*
     * TracesEntityDisplay.test.ts runs in plain Node. RouteMap pulls
     * Common/UI/Config, which throws "window is not defined" before a single
     * test runs; the describers are pure and may be imported.
     */
    expect(TRACES_ENTITY_DISPLAY).not.toContain("RouteMap");
    expect(TRACES_ENTITY_DISPLAY).toContain(
      'from "../../Utils/LockedTelemetryScope"',
    );
  });

  test("the viewer imports neither the removed locked-filter actions nor their link builder", () => {
    for (const removed of [
      "LockedFilterActions",
      "LockedFilterActionOptions",
      "LockedTelemetryScopeLink",
      "buildLockedScopeFilterActions",
      "buildLogsLockedFilterActions",
    ]) {
      expect(TRACES_VIEWER).not.toContain(removed);
    }
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

describe("the locked chips reach the shared viewer under the traces signal", () => {
  test("the signal names the explorer the tooltip's search syntax is for", () => {
    /*
     * The JSX element cannot be sliced by brace balancing (its props hold
     * arrow functions and nested elements), so the check is positional: the
     * prop appears exactly once, after the element opens and before the
     * component returns.
     */
    const prop: string = 'lockedFilterSignal="traces"';
    const elementStart: number = TRACES_VIEWER.indexOf("<TelemetryViewer");
    const componentEnd: number = TRACES_VIEWER.lastIndexOf(
      "export default TracesViewer;",
    );

    expect(elementStart).toBeGreaterThanOrEqual(0);
    expect(componentEnd).toBeGreaterThan(elementStart);
    expect(TRACES_VIEWER.split(prop).length - 1).toBe(1);

    const propIndex: number = TRACES_VIEWER.indexOf(prop);

    expect(propIndex).toBeGreaterThan(elementStart);
    expect(propIndex).toBeLessThan(componentEnd);
  });

  test("the viewer builds no actions, link or copy text from the locked chips, and hands none to the shared viewer", () => {
    for (const removed of [
      "lockedFilterActions",
      "buildLockedScopeExplorerLink",
      "buildLockedScopeCopyText",
      "buildSearchTextForFilters",
    ]) {
      expect(TRACES_VIEWER).not.toContain(removed);
    }
  });
});

/*
 * Where `pattern` occurs in `source`, so an assertion can say "only inside
 * these regions" about an identifier.
 */
function indexesOf(source: string, pattern: RegExp): Array<number> {
  const global: RegExp = new RegExp(pattern.source, "g");
  const indexes: Array<number> = [];
  let match: RegExpExecArray | null = global.exec(source);

  while (match) {
    indexes.push(match.index);
    match = global.exec(source);
  }

  return indexes;
}

/*
 * The span of a hook from its declaration to the `]);` that closes its
 * dependency array.
 */
function hookRegion(source: string, marker: string): [number, number] {
  const start: number = source.indexOf(marker);

  if (start < 0) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  return [start, source.indexOf("]);", start) + "]);".length];
}

describe("an entity-key scope (an Inventory item's Traces tab) gets its locked chip", () => {
  /*
   * The Inventory pages scope the viewer by `entityKeysFilter` alone, which
   * the server compiles to `hasAny(entityKeys, [item key])`. The viewer only
   * built chips from entity ids, stored queries and attribute filters, so the
   * list was narrowed behind an empty chip bar. The chip's wording and its
   * duplicate rule are unit-tested in TracesEntityDisplay.test.ts; what this
   * pins is that the viewer builds it, from the right inputs, and that it
   * stays display only.
   */
  const LOCKED_CHIPS_MARKER: string =
    "const lockedChips: Array<ActiveFilter> = useMemo(";

  const lockedChipsMemo: string = blockAfter(
    TRACES_VIEWER,
    LOCKED_CHIPS_MARKER,
    "{",
    "}",
  );

  const entityKeyCall: string = blockAfter(
    lockedChipsMemo,
    "buildTracesLockedEntityKeyChips(",
    "{",
    "}",
  );

  test("the viewer declares the display map next to the filter it names", () => {
    const props: string = blockAfter(
      TRACES_VIEWER,
      "interface Props",
      "{",
      "}",
    );

    expect(props).toContain("entityKeysFilter?: Array<string> | undefined;");
    expect(props).toContain(
      "entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;",
    );
  });

  test("the chip joins the locked chips, built from the page's filter, its names and the stored scope", () => {
    expect(lockedChipsMemo).toContain(
      "base.push( ...buildTracesLockedEntityKeyChips({",
    );

    for (const argument of [
      "entityKeysFilter: props.entityKeysFilter",
      "displays: props.entityKeyDisplays",
      "storedQueryEntityKeys: spanScope.entityKeys",
      "lockedChips: base",
    ]) {
      expect(entityKeyCall).toContain(argument);
    }
  });

  test("the chip is built AFTER the stored query's chips, so the duplicate check sees them", () => {
    /*
     * `lockedChips: base` is how a key the stored query's own chip already
     * shows is kept from rendering twice. Called before that loop, `base`
     * would not hold those chips yet and the check would silently pass
     * everything, so the order is the invariant here.
     */
    const loopMarker: string =
      "for (const chip of spanScope.chips as Array<SpanScopeChip>)";
    const loopAt: number = lockedChipsMemo.indexOf(loopMarker);
    const loopBody: string = blockAfter(lockedChipsMemo, loopMarker, "{", "}");
    const loopEnd: number =
      lockedChipsMemo.indexOf(loopBody, loopAt) + loopBody.length;

    expect(loopAt).toBeGreaterThanOrEqual(0);
    expect(
      lockedChipsMemo.indexOf("buildTracesLockedEntityKeyChips("),
    ).toBeGreaterThan(loopEnd);
  });

  test("REGRESSION: a Kubernetes / Host page's entityScope is never turned into an entity-key chip", () => {
    /*
     * Those pages pass `entityScope` (entity keys OR attribute) next to the
     * attribute filter, and the attribute chip already explains both halves.
     * A second "Resource: <key>" pill would claim a filter the attribute
     * chip already describes.
     */
    expect(entityKeyCall).not.toContain("entityScope");
    expect(lockedChipsMemo).not.toContain("entityScope.entityKeys");
  });

  test("a new filter or new names re-render the chip bar", () => {
    const dependencies: string = dependenciesOf(
      TRACES_VIEWER,
      LOCKED_CHIPS_MARKER,
    );

    for (const dependency of [
      "props.entityKeysFilter",
      "props.entityKeyDisplays",
      "spanScope",
    ]) {
      expect(dependencies).toContain(dependency);
    }
  });

  test("display only: the names reach nothing but the locked chips", () => {
    const [start, end]: [number, number] = hookRegion(
      TRACES_VIEWER,
      LOCKED_CHIPS_MARKER,
    );
    const uses: Array<number> = indexesOf(
      TRACES_VIEWER,
      /props\.entityKeyDisplays\b/,
    );

    // The call and the dependency array.
    expect(uses.length).toBeGreaterThanOrEqual(2);

    for (const index of uses) {
      expect(index).toBeGreaterThan(start);
      expect(index).toBeLessThan(end);
    }
  });

  test("display only: nothing but the chip bar reads the locked chips", () => {
    /*
     * The list query, the chart payload, URL state and saved views are all
     * built from props, `spanScope` and the user's own `activeFilters`. A
     * new reader of `lockedChips` is a place the new chip could leak into a
     * query, so it has to be one of these two.
     */
    const regions: Array<[number, number]> = [
      hookRegion(TRACES_VIEWER, LOCKED_CHIPS_MARKER),
      hookRegion(
        TRACES_VIEWER,
        "const mergedActiveFilters: Array<ActiveFilter> = useMemo(",
      ),
    ];

    const uses: Array<number> = indexesOf(TRACES_VIEWER, /\blockedChips\b/);

    expect(uses.length).toBeGreaterThan(0);

    for (const index of uses) {
      expect(
        regions.some(([start, end]: [number, number]): boolean => {
          return index >= start && index < end;
        }),
      ).toBe(true);
    }
  });

  test("the locked chips reach the bar as built, never re-labelled by the chip resolver", () => {
    const mergedMemo: string = blockAfter(
      TRACES_VIEWER,
      "const mergedActiveFilters: Array<ActiveFilter> = useMemo(",
      "{",
      "}",
    );

    expect(mergedMemo).toContain("...lockedChips,");
    expect(mergedMemo).not.toContain("lockedChips.map(");
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

/*
 * The Inventory item's Traces tab pins `entityKeysFilter` alone. Offering
 * Saved Views there let the project's DEFAULT view auto-apply over the
 * item's scope a tick after mount — only the mounted control resolves and
 * applies one. The service / host / Kubernetes pages are protected by the
 * same gate, and they do NOT count as host-owned: their URL state survives
 * refresh and Back, and the Inventory tab's must too.
 */
describe("an entity-key scope keeps saved views away, exactly as an entity id or an entity scope does", () => {
  const ENABLE_MARKER: string = "const enableSavedViews: boolean =";

  type StatementAfterFunction = (source: string, marker: string) => string;

  // From the marker to the `;` ending the statement (comments are stripped).
  const statementAfter: StatementAfterFunction = (
    source: string,
    marker: string,
  ): string => {
    const start: number = source.indexOf(marker);

    if (start < 0) {
      throw new Error(`Marker not found in source: ${marker}`);
    }

    return source.slice(start, source.indexOf(";", start) + 1);
  };

  interface ScopeMentions {
    entityKeys: boolean;
    primaryEntityId: boolean;
    entityScope: boolean;
  }

  type ScopeMentionsOfFunction = (region: string) => ScopeMentions;

  const scopeMentionsOf: ScopeMentionsOfFunction = (
    region: string,
  ): ScopeMentions => {
    return {
      entityKeys:
        region.includes("props.entityKeysFilter") ||
        region.includes("hasEntityKeysScope"),
      primaryEntityId: region.includes("props.primaryEntityId"),
      entityScope: region.includes("props.entityScope"),
    };
  };

  test("the entity-key scope is counted by its length, like the page's other array scopes", () => {
    const hasEntityKeysScope: string = statementAfter(
      TRACES_VIEWER,
      "const hasEntityKeysScope: boolean =",
    );

    expect(hasEntityKeysScope).toContain("props.entityKeysFilter");
    expect(hasEntityKeysScope).toContain(".length > 0");
  });

  test("saved views are withheld for it, in the same gate as the entity id and the entity scope", () => {
    const enableSavedViews: string = statementAfter(
      TRACES_VIEWER,
      ENABLE_MARKER,
    );

    for (const condition of [
      "!hasEntityKeysScope",
      "!props.primaryEntityId",
      "!props.entityScope",
    ]) {
      expect(enableSavedViews).toContain(condition);
    }
  });

  test("the saved-views control, the only thing that applies a default view, mounts once and behind that gate", () => {
    expect(TRACES_VIEWER.split("<TelemetrySavedViewsControl").length - 1).toBe(
      1,
    );

    const toolbar: string = blockAfter(
      TRACES_VIEWER,
      "toolbarLeadingActions={",
      "{",
      "}",
    );

    expect(toolbar).toContain("enableSavedViews");
    expect(toolbar).toContain("<TelemetrySavedViewsControl");
  });

  test("the URL-ownership gates give the entity-key scope whatever they give the entity id and the entity scope", () => {
    expect(
      scopeMentionsOf(statementAfter(TRACES_VIEWER, ENABLE_MARKER)),
    ).toEqual({ entityKeys: true, primaryEntityId: true, entityScope: true });

    const [initialStart, initialEnd]: [number, number] = hookRegion(
      TRACES_VIEWER,
      "const hasInitialUrlState: boolean = useMemo(",
    );

    const gates: Array<[string, string]> = [
      [
        "hostOwnsView",
        blockAfter(
          TRACES_VIEWER,
          "const hostOwnsView: boolean = Boolean",
          "(",
          ")",
        ),
      ],
      ["hasInitialUrlState", TRACES_VIEWER.slice(initialStart, initialEnd)],
    ];

    for (const [gate, region] of gates) {
      const mentions: ScopeMentions = scopeMentionsOf(region);

      // The gate name rides along so a failure says which one diverged.
      expect({ gate, entityKeys: mentions.entityKeys }).toEqual({
        gate,
        entityKeys: mentions.primaryEntityId,
      });
      expect({ gate, entityKeys: mentions.entityKeys }).toEqual({
        gate,
        entityKeys: mentions.entityScope,
      });
    }
  });
});
