import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_COMPONENT_EXAMPLE,
  DASHBOARD_VIEW_CONFIG_EXAMPLE,
} from "../../../FeatureSet/APIReference/Utils/DashboardDataTypeExamples";
import StoredDashboardViewConfig from "Common/Utils/Dashboard/StoredDashboardViewConfig";
import { isDashboardComponentType } from "Common/Types/Dashboard/DashboardComponentType";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "Common/Types/Dashboard/DashboardViewConfig";
import {
  DASHBOARD_TIME_RANGES,
  DASHBOARD_TIME_RANGE_FALLBACK,
  getDashboardTimeRangeProblem,
} from "Common/Types/Dashboard/DashboardTimeRange";
import { getDashboardAutoRefreshProblem } from "Common/Types/Dashboard/DashboardAutoRefresh";
import TimeRange from "Common/Types/Time/TimeRange";
import JSONFunctions from "Common/Types/JSONFunctions";
import { JSONObject } from "Common/Types/JSON";

/*
 * Issue #4571. The reference's DashboardViewConfig example wrapped the
 * widgets in `{"_type": "DashboardViewConfig", "value": {...}}`, and its
 * DashboardComponent example wrapped the widget the same way. A dashboard
 * config is stored as it is sent and never unwrapped, so a config written
 * from the example had its widgets under `value` - and the dashboard did not
 * open: "Cannot read properties of undefined (reading 'length')".
 *
 * The dashboard now reads that shape too (StoredDashboardViewConfig), but the
 * reference should show the shape the dashboard itself saves. These read
 * each example back through the dashboard's own reader: what comes back must
 * be the example, unchanged.
 */

const DATA_TYPE_DETAIL: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "APIReference",
  "Service",
  "DataTypeDetail.ts",
);

/*
 * The JSON the dashboard would save for a config or a widget, for comparing.
 * The example writes a widget's id as the plain UUID an API user has to hand
 * (the dashboard saves it as `{"_type": "ObjectID", "value": ...}`, and reads
 * both as the same id), so ids are compared as the id they name.
 */
function savedForm(value: unknown): unknown {
  const saved: unknown = JSON.parse(
    JSON.stringify(JSONFunctions.serializeValue(value as JSONObject)),
  );

  const withIdsAsText: (node: unknown) => unknown = (
    node: unknown,
  ): unknown => {
    if (Array.isArray(node)) {
      return node.map(withIdsAsText);
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    const copy: JSONObject = {};

    for (const [key, child] of Object.entries(node as JSONObject)) {
      copy[key] =
        key === "componentId"
          ? StoredDashboardViewConfig.getComponentIdString(child)
          : (withIdsAsText(child) as JSONObject);
    }

    return copy;
  };

  return withIdsAsText(saved);
}

describe("the API reference's dashboard examples are the shape the dashboard saves", () => {
  test("the config example has its widgets at the top, not in a `value`", () => {
    expect(DASHBOARD_VIEW_CONFIG_EXAMPLE["value"]).toBeUndefined();
    expect(Array.isArray(DASHBOARD_VIEW_CONFIG_EXAMPLE["components"])).toBe(
      true,
    );
    expect(
      (DASHBOARD_VIEW_CONFIG_EXAMPLE["components"] as Array<JSONObject>).length,
    ).toBeGreaterThan(0);
  });

  test("the widget example is the widget, not a `value` envelope around it", () => {
    expect(DASHBOARD_COMPONENT_EXAMPLE["value"]).toBeUndefined();
    expect(
      isDashboardComponentType(DASHBOARD_COMPONENT_EXAMPLE["componentType"]),
    ).toBe(true);
  });

  test("the config example reads back through the dashboard's reader unchanged", () => {
    const read: DashboardViewConfig = StoredDashboardViewConfig.read(
      DASHBOARD_VIEW_CONFIG_EXAMPLE,
    );

    expect(savedForm(read)).toEqual(
      savedForm(
        JSONFunctions.deserializeValue(
          DASHBOARD_VIEW_CONFIG_EXAMPLE,
        ) as JSONObject,
      ),
    );
  });

  test("the widget example, as a dashboard's one widget, reads back unchanged", () => {
    const read: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [DASHBOARD_COMPONENT_EXAMPLE],
    });

    expect(read.components).toHaveLength(1);
    expect(savedForm(read.components[0])).toEqual(
      savedForm(DASHBOARD_COMPONENT_EXAMPLE),
    );
  });

  test("every widget in the config example is one the dashboard draws, with its settings", () => {
    for (const component of StoredDashboardViewConfig.read(
      DASHBOARD_VIEW_CONFIG_EXAMPLE,
    ).components) {
      expect(isDashboardComponentType(component.componentType)).toBe(true);
      expect(Object.keys(component.arguments || {}).length).toBeGreaterThan(0);
    }
  });

  /*
   * Issue #5080: a dashboard's defaults - the time range and auto-refresh it
   * opens on - are part of its config, for the API and Terraform alike.
   */
  test("the config example sets both defaults, as values the server saves", () => {
    expect(DASHBOARD_VIEW_CONFIG_EXAMPLE["timeRange"]).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(DASHBOARD_VIEW_CONFIG_EXAMPLE["refreshInterval"]).toBe(
      AutoRefreshInterval.ONE_MINUTE,
    );
    expect(
      getDashboardTimeRangeProblem(DASHBOARD_VIEW_CONFIG_EXAMPLE["timeRange"]),
    ).toBeNull();
    expect(
      getDashboardAutoRefreshProblem(
        DASHBOARD_VIEW_CONFIG_EXAMPLE["refreshInterval"],
      ),
    ).toBeNull();

    const read: DashboardViewConfig = StoredDashboardViewConfig.read(
      DASHBOARD_VIEW_CONFIG_EXAMPLE,
    );

    expect(read.timeRange).toBe(TimeRange.PAST_ONE_DAY);
    expect(read.refreshInterval).toBe(AutoRefreshInterval.ONE_MINUTE);
  });

  test("the reference names every time range and interval the server saves, and what leaving each out means", () => {
    const source: string = fs.readFileSync(DATA_TYPE_DETAIL, "utf8");
    const timeRangeEntry: string = source.slice(
      source.indexOf('name: "timeRange"'),
      source.indexOf('name: "refreshInterval"'),
    );
    const refreshEntry: string = source.slice(
      source.indexOf('name: "refreshInterval"'),
      source.indexOf('name: "variables"'),
    );

    expect(timeRangeEntry.length).toBeGreaterThan(0);
    expect(refreshEntry.length).toBeGreaterThan(0);

    for (const range of DASHBOARD_TIME_RANGES) {
      expect(timeRangeEntry).toContain(range);
    }

    expect(timeRangeEntry).not.toContain(TimeRange.CUSTOM);
    expect(timeRangeEntry).toContain(
      `Left out, it opens on ${DASHBOARD_TIME_RANGE_FALLBACK}.`,
    );

    for (const interval of Object.values(AutoRefreshInterval)) {
      expect(refreshEntry).toContain(interval);
    }

    expect(refreshEntry).toContain("Left out, it is off.");
  });

  test("the reference page shows these examples, and no envelope of its own", () => {
    const source: string = fs
      .readFileSync(DATA_TYPE_DETAIL, "utf8")
      .replace(/\s+/g, "");

    expect(source).toContain(
      "jsonExample:JSON.stringify(DASHBOARD_COMPONENT_EXAMPLE,null,2)",
    );
    expect(source).toContain(
      "jsonExample:JSON.stringify(DASHBOARD_VIEW_CONFIG_EXAMPLE,null,2)",
    );
    expect(source).not.toContain('_type:"DashboardViewConfig",value:');
    expect(source).not.toContain('_type:"DashboardComponent",value:');
  });
});
