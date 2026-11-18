import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const FEATURE_SETS: string = path.resolve(
  COMMON_ROOT,
  "..",
  "App",
  "FeatureSet",
);

/*
 * WHAT EVERY DASHBOARD PAGE LOADS FOR THE ASK AI PANEL (issue #9335).
 *
 * The Dashboard mounts the Ask AI panel at its root (App.tsx), so what the
 * panel imports statically is in the first load of every page. It drew an
 * answer's charts through a static import of ChartWidget, which brought
 * recharts and Common's chart library: some 183 KiB gzipped of every page's
 * first load, though most pages are read without a chat that draws a chart.
 * The chart is a file of its own now (LazyChartWidget), asked for as the
 * panel opens.
 *
 * Built as the Dashboard builds (the shared esbuild config, for
 * production), with the panel as the entry (Helpers/FirstLoadBuild). Its
 * sources read "Common/..." and their packages through Common, which is all
 * this suite installs.
 */

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: [
      `export { default as AskAiPanel } from ${JSON.stringify(
        path.join(FEATURE_SETS, "Dashboard/src/Components/AIChat/AskAiPanel"),
      )};`,
    ],
    serviceName: "Dashboard",
    publicPath: "/dashboard/dist/",
    additionalAlias: { Common: COMMON_ROOT },
    nodePaths: [path.join(COMMON_ROOT, "node_modules")],
  });
}, 300000);

const WIDGETS: string = "Dashboard/src/Components/AIChat/Widgets";

describe("the Ask AI panel's first load, in every Dashboard page", () => {
  test("has the panel's answers and the place a chart is drawn in", () => {
    expect(
      inputsUnder(
        built!.firstLoad,
        "Dashboard/src/Components/AIChat/AskAiPanel.tsx",
      ).length,
    ).toBe(1);
    expect(
      inputsUnder(built!.firstLoad, `${WIDGETS}/WidgetRenderer.tsx`).length,
    ).toBe(1);
    expect(
      inputsUnder(built!.firstLoad, `${WIDGETS}/LazyChartWidget.tsx`).length,
    ).toBe(1);
  });

  test.each([
    ["the chart an answer draws", `${WIDGETS}/ChartWidget.tsx`],
    ["recharts", "node_modules/recharts/"],
    [
      "Common's line chart",
      "UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx",
    ],
    [
      "Common's bar chart",
      "UI/Components/Charts/ChartLibrary/BarChart/BarChart.tsx",
    ],
  ])(
    "leaves out %s, which loads when an answer draws a chart",
    (_name: string, file: string) => {
      expect(inputsUnder(built!.firstLoad, file)).toEqual([]);
      expect(inputsUnder(built!.loadedLater, file).length).toBeGreaterThan(0);
    },
  );
});
