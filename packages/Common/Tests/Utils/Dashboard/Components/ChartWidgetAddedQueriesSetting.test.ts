import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardChartComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import DashboardChartComponentUtil from "../../../../Utils/Dashboard/Components/DashboardChartComponent";
import MetricQueryOverlay from "../../../../Utils/Metrics/MetricQueryOverlay";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
} from "../../../Helpers/DashboardLocales";

/*
 * ISSUE #10044: THE CHART WIDGET'S "ADDITIONAL QUERIES" SETTING SAID IT
 * OVERLAYS.
 *
 * Its description was "Overlay more metrics on the same chart". Each added
 * query draws a chart of its own, though, unless its "Overlay with previous
 * query" switch is on (issue #9961). The settings form never draws this
 * setting's name or description - it draws the added queries as Query 2,
 * Query 3 cards with an Add Query button - but the words are translated in
 * every language, so the next page to draw them would have said something
 * false.
 *
 * The setting is not dead: it is the one the settings form reads to draw
 * the added queries at all, and the one the widget stores them under. Its
 * description now says what happens.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

const SETTINGS_FORM: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm.tsx",
);

const DESCRIPTION: string =
  "More metric queries, each drawn on a chart of its own unless overlaid on the previous query's chart";

// The longest description under a field the UX rulebook allows.
const DESCRIPTION_MAX_LENGTH: number = 150;

function addedQueriesSetting(): ComponentArgument<DashboardChartComponent> {
  const setting: ComponentArgument<DashboardChartComponent> | undefined =
    DashboardChartComponentUtil.getComponentConfigArguments().find(
      (argument: ComponentArgument<DashboardChartComponent>): boolean => {
        return argument.type === ComponentInputType.MetricsQueryConfigs;
      },
    );

  expect(setting).toBeDefined();
  return setting!;
}

describe("the Chart widget's added queries setting", () => {
  test("is the one setting that holds the added queries, under metricQueryConfigs", () => {
    const setting: ComponentArgument<DashboardChartComponent> =
      addedQueriesSetting();

    expect(setting.id).toBe("metricQueryConfigs");
    expect(setting.name).toBe("Additional Queries");
    expect(setting.required).toBe(false);
    expect(
      DashboardChartComponentUtil.getComponentConfigArguments().filter(
        (argument: ComponentArgument<DashboardChartComponent>): boolean => {
          return argument.type === ComponentInputType.MetricsQueryConfigs;
        },
      ),
    ).toHaveLength(1);
  });

  test("is read by the settings form, which draws the added queries only for it", () => {
    const form: string = fs.readFileSync(SETTINGS_FORM, "utf8");

    // The added queries are drawn because the widget has this setting...
    expect(form).toContain(
      "return arg.type === ComponentInputType.MetricsQueryConfigs;",
    );
    expect(form).toContain("if (!hasMultiQueryArg || !multiQueryArg) {");
    // ...and stored under its id.
    expect(form).toContain('"metricQueryConfigs"');
  });

  test("says what happens: a chart per added query, unless overlaid", () => {
    expect(addedQueriesSetting().description).toBe(DESCRIPTION);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });

  test("no longer says it overlays the queries", () => {
    const description: string = addedQueriesSetting().description || "";

    expect(description).not.toBe("Overlay more metrics on the same chart");
    expect(description).not.toMatch(/^Overlay/);
  });

  test("says what the charts draw: a chart per added query, one when overlaid", () => {
    const withoutOverlay: Array<MetricQueryConfigData> = [
      {} as MetricQueryConfigData,
      {} as MetricQueryConfigData,
      {} as MetricQueryConfigData,
    ];
    const overlaid: Array<MetricQueryConfigData> = [
      {} as MetricQueryConfigData,
      { overlayWithPreviousQuery: true } as MetricQueryConfigData,
    ];

    // "each drawn on a chart of its own"
    expect(MetricQueryOverlay.getChartCount(withoutOverlay, 0)).toBe(3);
    // "unless overlaid on the previous query's chart"
    expect(MetricQueryOverlay.getChartCount(overlaid, 0)).toBe(1);
  });

  test("is worded in every Dashboard language", () => {
    const unworded: Array<string> = DASHBOARD_LANGUAGES.filter(
      (language: string): boolean => {
        return !isWordedInDashboardLocale(DESCRIPTION, language);
      },
    );

    expect(unworded).toEqual([]);
  });
});
