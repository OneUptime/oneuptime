import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The metrics explorer's locked chips explain themselves and can be copied
 * or opened on the main /metrics page. The explanation text is owned by
 * LockedTelemetryScope.test.ts and the chip builders' behaviour by
 * MetricsEntityChipDisplay.test.ts; what is left is structural — that the
 * viewer hands its entity scope to the builders, that the actions are
 * derived from the LOCKED chips only, and that both reach the shared
 * TelemetryViewer under the prop names the Common layer reads. None of that
 * is observable from a unit test of a helper, and each of them silently
 * degrades the feature (a chip with no tooltip, an actions group that
 * copies the user's own chips) rather than failing, so this suite reads
 * the source and pins the arrangement.
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

describe("MetricsViewer offers Copy filter / Open in Metrics for the locked scope", () => {
  const actions: string = blockAfter(
    METRICS_VIEWER,
    "const lockedFilterActions: LockedFilterActionOptions | undefined =",
    "(",
    ")",
  );

  test("imports the copy text from the pure scope util and the link from its route-aware sibling", () => {
    /*
     * Membership, not the exact import statement: another feature adding a
     * name to either list must not read as this wiring having been undone.
     */
    const importListFrom: (moduleSpecifier: string) => string = (
      moduleSpecifier: string,
    ): string => {
      const fromIndex: number = METRICS_VIEWER.indexOf(
        `from "${moduleSpecifier}"`,
      );

      expect(fromIndex).toBeGreaterThanOrEqual(0);

      return METRICS_VIEWER.slice(
        METRICS_VIEWER.lastIndexOf("import", fromIndex),
        fromIndex,
      );
    };

    expect(importListFrom("../../Utils/LockedTelemetryScope")).toContain(
      "buildLockedScopeCopyText",
    );
    expect(importListFrom("../../Utils/LockedTelemetryScopeLink")).toContain(
      "buildLockedScopeExplorerLink",
    );
  });

  test("derives the actions from the locked chips only", () => {
    expect(actions).toContain("mergedActiveFilters.filter(");
    expect(actions).toContain("return Boolean(chip.readOnly);");
    expect(actions).toContain(
      "if (lockedChips.length === 0) { return undefined; }",
    );
  });

  test("builds the copy text and the explorer link for the metrics signal, with the current window", () => {
    const copyCall: string = blockAfter(
      actions,
      "buildLockedScopeCopyText(",
      "(",
      ")",
    );
    expect(copyCall).toContain('"metrics"');
    expect(copyCall).toContain("lockedChips");

    const linkCall: string = blockAfter(
      actions,
      "buildLockedScopeExplorerLink(",
      "{",
      "}",
    );
    expect(linkCall).toContain('signal: "metrics",');
    expect(linkCall).toContain("timeRange,");
    // The link is built from facetKey / value pairs, never from display text.
    expect(linkCall).toContain(
      "return { facetKey: chip.facetKey, value: chip.value };",
    );

    expect(actions).toContain("openExplorerRoute: link.url,");
    expect(actions).toContain("notCarried: link.notCarried,");
  });

  test("a host that cannot resolve the explorer route still gets the copyable text", () => {
    expect(actions).toContain("try {");
    expect(actions).toContain("catch { return { copyText }; }");
  });

  test("recomputes when the locked chips or the window change", () => {
    expect(METRICS_VIEWER).toContain("}, [mergedActiveFilters, timeRange]);");
  });

  test("both reach the shared viewer under the prop names the Common layer reads", () => {
    /*
     * The JSX element cannot be sliced by brace balancing (its props hold
     * arrow functions and nested elements), so the check is positional: the
     * two props appear exactly once each, after the element opens and before
     * the component returns.
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
      'lockedFilterSignal="metrics"',
      "lockedFilterActions={lockedFilterActions}",
    ]) {
      expect(METRICS_VIEWER.split(prop).length - 1).toBe(1);

      const propIndex: number = METRICS_VIEWER.indexOf(prop);

      expect(propIndex).toBeGreaterThan(elementStart);
      expect(propIndex).toBeLessThan(componentEnd);
    }
  });
});
