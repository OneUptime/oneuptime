// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A CHART'S LEGEND THAT WRAPS GROWS THE CHART, NEVER SQUEEZES ITS PLOT
 * (issues #6562, #7125).
 *
 * The shared line, area and bar charts draw their legend inside the height
 * they are given. A legend that wrapped onto a second or third line took
 * those lines from the plot: Product Analytics' Active users card went from
 * a 78px plot to 30px on a phone, and a Host's, a Kubernetes cluster's or a
 * VMware host's Network chart (In and Out, in German, beside the side menu)
 * read a line shorter than the CPU chart beside it. Every chart drawn at a
 * fixed height now grows by its legend's lines past the first
 * (UseLegendGrowth). This guard holds the Dashboard to that:
 *
 *   1. A dashboard widget draws inside a box of its own size, which cannot
 *      grow: every shared chart a widget draws at a fixed height draws no
 *      legend, or says it keeps its box (growsWhenLegendWraps={false}).
 *   2. No other chart keeps its box unless it is listed in KEEPS_ITS_BOX
 *      with its reason - the list is empty, and an entry that no longer
 *      opts out fails, so it only shrinks.
 *   3. The infrastructure overviews draw their charts in rows of cards that
 *      share a hover line (sync). A card grows with its chart's legend, so
 *      each card is a column with its chart at its foot (mt-auto), as
 *      ChartCard's is: the row grows to its tallest card and the plots and
 *      time axes still line up.
 *
 * The growth itself is drawn by real recharts in
 * Common/Tests/UI/Components/Charts/ChartLegendRows.test.tsx.
 */

const DASHBOARD_ROOT: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

// Where the dashboard widgets live: each draws in a box the canvas sizes.
const WIDGETS_ROOT: string = path.join(
  DASHBOARD_ROOT,
  "Components",
  "Dashboard",
);

/*
 * A chart outside the widgets that keeps its box when its legend wraps, by
 * the file it is in, with the reason. Empty: say why before adding one.
 */
const KEEPS_ITS_BOX: Record<string, string> = {};

// The overviews whose chart cards sit side by side and share a hover line.
const INFRASTRUCTURE_OVERVIEWS: Array<string> = [
  "Pages/Host/View/Overview.tsx",
  "Pages/Host/View/ProcessView.tsx",
  "Pages/Docker/View/Overview.tsx",
  "Pages/Podman/View/Overview.tsx",
  "Pages/Kubernetes/View/Index.tsx",
  "Pages/VMware/View/Index.tsx",
  "Pages/Proxmox/View/Index.tsx",
];

const SHARED_CHART_MODULE: RegExp =
  /import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+"Common\/UI\/Components\/Charts\/(?:Line\/LineChart|Area\/AreaChart|Bar\/BarChart)"/g;

function listTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_ROOT, file).split(path.sep).join("/");
}

/*
 * Each opening tag of a shared line, area or bar chart in `source`, from
 * "<Name" to the end of its tag: by the names the file imports the charts
 * under, braces counted so a prop's arrow function does not end the tag.
 */
function sharedChartElements(source: string): Array<string> {
  const names: Array<string> = [];

  for (const match of source.matchAll(SHARED_CHART_MODULE)) {
    names.push(match[1]!);
  }

  const elements: Array<string> = [];

  for (const name of names) {
    const opening: RegExp = new RegExp(`<${name}\\b`, "g");

    for (const match of source.matchAll(opening)) {
      const start: number = match.index!;
      let depth: number = 0;
      let end: number = source.length;

      for (let index: number = start + 1; index < source.length; index++) {
        const character: string = source[index]!;

        if (character === "{") {
          depth++;
        } else if (character === "}") {
          depth--;
        } else if (character === ">" && depth === 0) {
          end = index + 1;
          break;
        }
      }

      elements.push(source.slice(start, end));
    }
  }

  return elements;
}

const FIXED_HEIGHT: RegExp = /\bheightInPx=\{/;
const NO_LEGEND: RegExp = /\bshowLegend=\{false\}/;
const KEEPS_ITS_BOX_PROP: RegExp = /\bgrowsWhenLegendWraps=\{false\}/;

function hasFixedHeight(element: string): boolean {
  return FIXED_HEIGHT.test(element);
}

function drawsNoLegend(element: string): boolean {
  return NO_LEGEND.test(element);
}

function keepsItsBox(element: string): boolean {
  return KEEPS_ITS_BOX_PROP.test(element);
}

describe("sharedChartElements", () => {
  test("finds each shared chart by the name its file imports it under, to the end of its tag", () => {
    const source: string = [
      'import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";',
      'import Bars from "Common/UI/Components/Charts/Bar/BarChart";',
      'import Other from "Common/UI/Components/Charts/Other";',
      "const a = <LineChartElement heightInPx={180} formatter={(v) => { return v > 1; }} showLegend={false} />;",
      "const b = <Bars data={x} />;",
      "const c = <Other heightInPx={10} />;",
    ].join("\n");

    expect(sharedChartElements(source)).toEqual([
      "<LineChartElement heightInPx={180} formatter={(v) => { return v > 1; }} showLegend={false} />",
      "<Bars data={x} />",
    ]);
  });

  test("a chart that keeps its box, or draws no legend, is told apart", () => {
    expect(keepsItsBox("<C growsWhenLegendWraps={false} />")).toBe(true);
    expect(keepsItsBox("<C growsWhenLegendWraps={true} />")).toBe(false);
    expect(drawsNoLegend("<C showLegend={false} />")).toBe(true);
    expect(drawsNoLegend("<C showLegend={series.length > 1} />")).toBe(false);
    expect(hasFixedHeight("<C heightInPx={180} />")).toBe(true);
    expect(hasFixedHeight("<C />")).toBe(false);
  });
});

describe("a chart's legend that wraps grows the chart, never squeezes its plot", () => {
  test("every shared chart a dashboard widget draws at a fixed height draws no legend, or keeps its box", () => {
    const offenders: Array<string> = [];
    let charts: number = 0;

    for (const file of listTsxFiles(WIDGETS_ROOT)) {
      for (const element of sharedChartElements(
        fs.readFileSync(file, "utf8"),
      )) {
        charts++;

        if (
          hasFixedHeight(element) &&
          !drawsNoLegend(element) &&
          !keepsItsBox(element)
        ) {
          offenders.push(`${relative(file)}: ${element.slice(0, 80)}`);
        }
      }
    }

    // The SLO widget draws one: the scan reads the widgets it is for.
    expect(charts).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("no chart outside the widgets keeps its box unless it says why (KEEPS_ITS_BOX), and the list only shrinks", () => {
    const keepingTheirBox: Set<string> = new Set<string>();

    for (const file of listTsxFiles(DASHBOARD_ROOT)) {
      if (file.startsWith(WIDGETS_ROOT + path.sep)) {
        continue;
      }

      for (const element of sharedChartElements(
        fs.readFileSync(file, "utf8"),
      )) {
        if (keepsItsBox(element)) {
          keepingTheirBox.add(relative(file));
        }
      }
    }

    expect(Array.from(keepingTheirBox).sort()).toEqual(
      Object.keys(KEEPS_ITS_BOX).sort(),
    );
  });

  test.each(INFRASTRUCTURE_OVERVIEWS)(
    "%s: its chart card is a column with the chart at its foot, so a row's plots line up",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_ROOT, file),
        "utf8",
      );
      const charts: Array<string> = sharedChartElements(source);

      expect(charts.length).toBeGreaterThan(0);

      for (const chart of charts) {
        // It grows with its legend: nothing keeps it to its box.
        expect(keepsItsBox(chart)).toBe(false);

        const at: number = source.indexOf(chart);
        const before: string = source.slice(0, at);

        // The chart's own wrapper, right above it, puts it at the card's foot.
        expect(before.trimEnd().endsWith('<div className="mt-auto">')).toBe(
          true,
        );

        // And the card it is drawn in is a column.
        const cards: Array<RegExpMatchArray> = Array.from(
          before.matchAll(
            /<div className="([^"]*\brounded-xl border border-gray-200 bg-white p-4 shadow-sm[^"]*)">/g,
          ),
        );

        expect(cards.length).toBeGreaterThan(0);
        expect(cards[cards.length - 1]![1]).toMatch(/\bflex flex-col\b/);
      }
    },
  );
});
