import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Inventory half of the locked-pill wiring. An Inventory item's Logs /
 * Traces / Metrics / Exceptions / Profiles pages scope their viewer by
 * `hasAny(entityKeys, [item key])`, and until the pill they showed a filtered
 * list under an empty chip bar. The pure halves are pinned in
 * InventoryTelemetryScope.test.ts, LockedEntityKeyChips.test.ts and
 * LockedTelemetryScope.test.ts; what this suite owns is that the pages
 * actually CONNECT them:
 *
 *  - the shell builds ONE display map per item — its name and the identifying
 *    attributes its search syntax is spelled with — memoised on the fields
 *    it reads, ahead of every early return, and hands it to every page;
 *  - every page gives its viewer the map on the SAME element that carries
 *    the entity-key scope, so a name never travels without its scope and a
 *    scope never travels without its name;
 *  - every viewer the pages hand the map to declares it (each viewer's own
 *    wiring suite pins that its chip builder reads it);
 *  - the modules the pill is built from stay free of the browser at load.
 *
 * What the shared chip bar does with a locked chip (no remove button, a
 * tooltip holding its search syntax or the reason there is none) belongs to
 * Common, and is pinned there in
 * Common/Tests/UI/Components/LockedFilterChip.test.tsx and
 * TelemetryActiveFilterChipsLockedFilters.test.tsx.
 *
 * The App suite runs in plain Node with no renderer, so these read source.
 * They check MEMBERSHIP inside a balanced slice — never the position of a
 * prop among its neighbours — so unrelated edits to these files leave them
 * green while the connection they guard is intact.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadFromFunction = (root: string, relativeParts: Array<string>) => string;

/*
 * Source with comments removed and whitespace squashed to single spaces. The
 * line-comment rule skips `://`, so a URL in a string survives.
 */
const readFrom: ReadFromFunction = (
  root: string,
  relativeParts: Array<string>,
): string => {
  return fs
    .readFileSync(path.join(root, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
};

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return readFrom(DASHBOARD_SRC, relativeParts);
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
   * A marker that ENDS with the opener names the region itself (`useMemo(`);
   * searching from the marker's start would catch an opener inside the
   * marker and slice the wrong pair.
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
 * The dependency array of the hook whose declaration starts at `marker`:
 * the `[…]` after the LAST `}, [` before the hook's closing `]);`. Located
 * from the end, so the body can change without the array "vanishing".
 */
function dependenciesOf(source: string, marker: string): string {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  const end: number = source.indexOf("]);", markerAt);
  const start: number = source.lastIndexOf("}, [", end);

  if (end < 0 || start < markerAt) {
    throw new Error(`No dependency array for hook: ${marker}`);
  }

  return source.slice(start + "}, [".length, end);
}

/** The named-import list of the `import … from "<module>"` statement. */
function importListFrom(source: string, moduleSpecifier: string): string {
  const fromIndex: number = source.indexOf(`from "${moduleSpecifier}"`);

  if (fromIndex < 0) {
    throw new Error(`No import from ${moduleSpecifier}`);
  }

  return source.slice(source.lastIndexOf("import", fromIndex), fromIndex);
}

/*
 * The attributes of the JSX element opened at `marker` (`<LogsViewer`), up
 * to its closing `>` / `/>`. Braces are balanced and quoted attribute values
 * skipped, so an arrow function or a `>` inside a prop does not end it — and
 * a prop of a DIFFERENT element can never be mistaken for one of this one.
 */
function elementAttributes(source: string, marker: string): string {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Element not found in source: ${marker}`);
  }

  const start: number = markerAt + marker.length;
  let depth: number = 0;
  let quote: string | null = null;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (depth === 0 && (character === '"' || character === "'")) {
      quote = character;
    } else if (depth === 0 && character === ">") {
      return source.slice(start, index);
    }
  }

  throw new Error(`Unterminated element: ${marker}`);
}

type CountFunction = (source: string, needle: string) => number;

const countOf: CountFunction = (source: string, needle: string): number => {
  return source.split(needle).length - 1;
};

const SHELL: string = readSource(
  "Pages",
  "Inventory",
  "View",
  "InventorySignalPage.tsx",
);

const DISPLAYS_MEMO_MARKER: string =
  "const entityKeyDisplays: LockedEntityKeyDisplayMap = useMemo(";

describe("the signal-page shell names the scope once, for every page", () => {
  test("imports the pure display builder and the map type", () => {
    expect(
      importListFrom(
        SHELL,
        "../../../Components/Inventory/InventoryTelemetryScope",
      ),
    ).toContain("buildInventoryEntityKeyDisplays");
    expect(
      importListFrom(SHELL, "../../../Utils/LockedEntityKeyChips"),
    ).toContain("LockedEntityKeyDisplayMap");
  });

  test("builds the map from the loaded item's key, type and name", () => {
    const memo: string = blockAfter(SHELL, DISPLAYS_MEMO_MARKER, "(", ")");
    const builderCall: string = blockAfter(
      memo,
      "buildInventoryEntityKeyDisplays(",
      "{",
      "}",
    );

    for (const field of [
      "entityKey: item?.entityKey",
      "entityType: item?.entityType",
      "displayName: item?.displayName",
    ]) {
      expect(builderCall).toContain(field);
    }
  });

  test("hands the builder the item's identifying and descriptive attributes, which spell the pill's search syntax", () => {
    /*
     * Without the identifying attributes every pill says the resource has
     * nothing to search by; without the descriptive ones a pod's name is
     * spelled in the lowercased form ingest hashed, which the explorers'
     * exact match would miss.
     */
    const memo: string = blockAfter(SHELL, DISPLAYS_MEMO_MARKER, "(", ")");
    const builderCall: string = blockAfter(
      memo,
      "buildInventoryEntityKeyDisplays(",
      "{",
      "}",
    );

    for (const field of [
      "identifyingAttributes: item?.identifyingAttributes",
      "descriptiveAttributes: item?.descriptiveAttributes",
    ]) {
      expect(builderCall).toContain(field);
    }
  });

  test("re-memoises when any of those fields changes — a renamed, retyped or re-identified item re-renders its pill", () => {
    /*
     * The viewers list the map in their chip memos, so the map must be stable
     * across renders (memoised) and must change when the name or the
     * attributes its search syntax is spelled with do (listed).
     */
    const dependencies: string = dependenciesOf(SHELL, DISPLAYS_MEMO_MARKER);

    for (const dependency of [
      "item?.entityKey",
      "item?.entityType",
      "item?.displayName",
      "item?.identifyingAttributes",
      "item?.descriptiveAttributes",
    ]) {
      expect(dependencies).toContain(dependency);
    }
  });

  test("the map is built exactly once, by the memo — never inline in the render call", () => {
    expect(countOf(SHELL, "buildInventoryEntityKeyDisplays(")).toBe(1);
    expect(blockAfter(SHELL, "return props.render(", "{", "}")).not.toContain(
      "buildInventoryEntityKeyDisplays",
    );
  });

  test("the memo runs ahead of the loading, error and not-found returns", () => {
    /*
     * Not a neighbour-order check: a hook behind a conditional return runs
     * on the loaded render but not on the loading one, and React throws on
     * the changed hook count. The guards are the control flow it must lead.
     */
    const memoAt: number = SHELL.indexOf(DISPLAYS_MEMO_MARKER);

    expect(memoAt).toBeGreaterThan(-1);

    for (const guard of [
      "if (isLoading)",
      "if (error)",
      "if (!item?.entityKey)",
    ]) {
      const guardAt: number = SHELL.indexOf(guard);

      expect(guardAt).toBeGreaterThan(-1);
      expect(memoAt).toBeLessThan(guardAt);
    }
  });

  test("the render props declare the map as required and carry it", () => {
    const renderProps: string = blockAfter(
      SHELL,
      "export interface InventorySignalRenderProps",
      "{",
      "}",
    );

    expect(renderProps).toContain(
      "entityKeyDisplays: LockedEntityKeyDisplayMap;",
    );

    const renderCall: string = blockAfter(
      SHELL,
      "return props.render(",
      "{",
      "}",
    );

    expect(renderCall).toMatch(/(^|[\s,{])entityKeyDisplays(\s*[,:}]|\s*$)/);
    expect(renderCall).toContain("entityKey: item.entityKey");
  });
});

/*
 * Each page, the viewer element it renders, and the entity-key scope that
 * element must carry.
 */
const SIGNAL_PAGES: ReadonlyArray<[string, string, string]> = [
  ["Logs.tsx", "<LogsViewer", "entityKeys: new Includes([signal.entityKey])"],
  ["Traces.tsx", "<TracesViewer", "entityKeysFilter={[signal.entityKey]}"],
  ["Metrics.tsx", "<MetricsViewer", "entityKeysFilter={[signal.entityKey]}"],
  [
    "Exceptions.tsx",
    "<ExceptionsViewer",
    "entityKeysFilter={[signal.entityKey]}",
  ],
  ["Profiles.tsx", "<ProfileTable", "entityKeys={[signal.entityKey]}"],
];

describe("every signal page gives its viewer the name on the element that carries the scope", () => {
  test.each(SIGNAL_PAGES)(
    "%s renders exactly one %s, inside the shell's render prop",
    (file: string, element: string) => {
      const page: string = readSource("Pages", "Inventory", "View", file);
      const arrow: string =
        "render={(signal: InventorySignalRenderProps): ReactElement =>";
      const arrowAt: number = page.indexOf(arrow);

      expect(countOf(page, element)).toBe(1);
      expect(arrowAt).toBeGreaterThan(-1);

      // The render arrow's block body: the first balanced `{…}` after `=>`.
      const body: string = blockAfter(
        page.slice(arrowAt + arrow.length),
        "{",
        "{",
        "}",
      );

      expect(body).toContain(element);
    },
  );

  test.each(SIGNAL_PAGES)(
    "%s: %s carries the entity-key scope and the shell's display map together",
    (file: string, element: string, scope: string) => {
      const attributes: string = elementAttributes(
        readSource("Pages", "Inventory", "View", file),
        element,
      );

      expect(attributes).toContain(scope);
      expect(attributes).toContain(
        "entityKeyDisplays={signal.entityKeyDisplays}",
      );
    },
  );

  test.each(SIGNAL_PAGES)(
    "%s takes the map from the shell rather than building its own",
    (file: string) => {
      /*
       * One map, built in one place: five pages each naming the item their
       * own way is how the five pills would drift apart.
       */
      const page: string = readSource("Pages", "Inventory", "View", file);

      expect(page).not.toContain("buildInventoryEntityKeyDisplays");
      expect(page).not.toContain("buildLockedEntityKeyChips");
    },
  );

  test.each(SIGNAL_PAGES)(
    "%s: %s is scoped by entity key alone, so no other scope rides beside the entity-key pill",
    (file: string, element: string) => {
      /*
       * A Kubernetes cluster's page pins an attribute AND its entity keys
       * through `entityScope`, and its one attribute chip stands for both.
       * An Inventory item has no attribute counterpart — reading its
       * telemetry through an attribute or the primary owner returns nothing
       * for a pod (InventoryDetailPageInvariants) — so none may ride along
       * to displace or contradict the pill.
       *
       * It also keeps the viewers' scoped-page gates honest: the metrics
       * viewer's `isScoped` and the traces viewer's saved-views gate are
       * pinned (in their wiring suites) to count the entity-key scope, and
       * that is only what hides saved views here if no service, stored query,
       * URL-sync or window override rides along to hide them for another
       * reason.
       */
      const attributes: string = elementAttributes(
        readSource("Pages", "Inventory", "View", file),
        element,
      );

      for (const otherScope of [
        "entityScope=",
        "attributeFilters=",
        "primaryEntityId=",
        "serviceIds=",
        "spanQuery=",
        "disableUrlSync",
        "timeRangeOverride=",
      ]) {
        expect(attributes).not.toContain(otherScope);
      }
    },
  );
});

/*
 * The viewer each page hands the map to, as a path under the Dashboard
 * source root.
 */
const VIEWERS: ReadonlyArray<[string, Array<string>]> = [
  ["LogsViewer", ["Components", "Logs", "LogsViewer.tsx"]],
  ["TracesViewer", ["Components", "Traces", "TracesViewer.tsx"]],
  ["MetricsViewer", ["Components", "Metrics", "MetricsViewer.tsx"]],
  ["ExceptionsViewer", ["Components", "Exceptions", "ExceptionsViewer.tsx"]],
  ["ProfileTable", ["Components", "Profiles", "ProfileTable.tsx"]],
];

describe("every viewer a page hands the map to declares it", () => {
  test.each(VIEWERS)(
    "%s declares entityKeyDisplays with the shared map type",
    (_viewer: string, relativeParts: Array<string>) => {
      /*
       * The App typecheck does not cover Dashboard .tsx, so the prop the
       * pages pass has to exist under this name and type. That each viewer's
       * chip builder is handed it is pinned inside that call by the viewer's
       * own wiring suite (Logs, Traces, Metrics, Exceptions, Profiles).
       */
      const viewer: string = readSource(...relativeParts);

      expect(viewer).toContain(
        "entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;",
      );
      expect(
        importListFrom(viewer, "../../Utils/LockedEntityKeyChips"),
      ).toContain("LockedEntityKeyDisplayMap");
    },
  );
});

/*
 * A module whose import chain reads `window` the moment it loads (the route
 * map, the page map, navigation, the UI config) cannot be loaded by the
 * renderer-free chip builders or their plain-Node suites. This suite is the
 * one place that scans them.
 */
const WINDOW_AT_LOAD_IMPORT: RegExp =
  /from "[^"]*\/(RouteMap|PageMap|Navigation|Config)"/;

const PURE_MODULES: ReadonlyArray<Array<string>> = [
  ["Utils", "LockedTelemetryScope.ts"],
  ["Utils", "LockedEntityKeyChips.ts"],
  ["Utils", "ProfilesEntityDisplay.ts"],
  ["Utils", "ExceptionsEntityChipDisplay.ts"],
  ["Utils", "MetricsEntityChipDisplay.ts"],
  ["Components", "Inventory", "InventoryTelemetryScope.ts"],
  ["Components", "Inventory", "InventoryTypeCatalog.ts"],
];

describe("the modules the pill is built from stay free of the browser at load", () => {
  test.each(PURE_MODULES)(
    "%s/%s imports nothing that reads window at load",
    (...relativeParts: Array<string>) => {
      expect(readSource(...relativeParts)).not.toMatch(WINDOW_AT_LOAD_IMPORT);
    },
  );
});
