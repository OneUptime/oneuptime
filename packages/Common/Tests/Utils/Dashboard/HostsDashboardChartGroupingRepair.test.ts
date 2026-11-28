import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import { JSONObject } from "../../../Types/JSON";
import HostsDashboardChartGroupingRepair, {
  HOST_GROUP_BY_KEY,
  HostsDashboardChartGroupingRepairResult,
  LEGACY_HOST_GROUP_BY_KEY,
} from "../../../Utils/Dashboard/HostsDashboardChartGroupingRepair";
import { describe, expect, test } from "@jest/globals";

/*
 * The Hosts Dashboard's charts by host on a dashboard made before they
 * grouped by resource.host.name: which charts are regrouped, and that
 * nothing else of the dashboard changes. The walk over Postgres is in
 * App's GroupHostsDashboardChartsByHostPostgres.
 */

// The Hosts template as stored, its charts by host grouped as they used to be.
function madeBeforeTheFix(): JSONObject {
  const stored: JSONObject = JSON.parse(
    JSON.stringify(getTemplateConfig(DashboardTemplateType.Host)!),
  );

  for (const component of stored["components"] as Array<JSONObject>) {
    const metricQueryData: JSONObject | undefined = (
      (component["arguments"] as JSONObject | undefined)?.[
        "metricQueryConfig"
      ] as JSONObject | undefined
    )?.["metricQueryData"] as JSONObject | undefined;

    if (
      JSON.stringify(metricQueryData?.["groupByAttributeKeys"]) ===
      JSON.stringify([HOST_GROUP_BY_KEY])
    ) {
      metricQueryData!["groupByAttributeKeys"] = [LEGACY_HOST_GROUP_BY_KEY];
    }
  }

  return stored;
}

function groupingsOf(config: JSONObject): Array<[string, unknown]> {
  return (config["components"] as Array<JSONObject>).flatMap(
    (component: JSONObject): Array<[string, unknown]> => {
      const args: JSONObject = (component["arguments"] || {}) as JSONObject;
      const keys: unknown = (
        (args["metricQueryConfig"] as JSONObject | undefined)?.[
          "metricQueryData"
        ] as JSONObject | undefined
      )?.["groupByAttributeKeys"];

      return keys ? [[String(args["chartTitle"]), keys]] : [];
    },
  );
}

// A chart of a person's own, grouped by a datapoint attribute host.name.
function ownChart(title: string, metricName: string): JSONObject {
  return {
    _type: "DashboardComponent",
    componentType: "Chart",
    componentId: { _type: "ObjectID", value: "own-chart" },
    arguments: {
      chartTitle: title,
      metricQueryConfig: {
        metricQueryData: {
          filterData: { metricName },
          groupByAttributeKeys: [LEGACY_HOST_GROUP_BY_KEY],
        },
      },
    },
  };
}

describe("HostsDashboardChartGroupingRepair", () => {
  test("knows the template's six charts by host, by title and metric", () => {
    expect(HostsDashboardChartGroupingRepair.getTemplateCharts()).toEqual([
      {
        title: "CPU Utilization by Host",
        metricName: "system.cpu.utilization",
      },
      { title: "Memory Usage by Host", metricName: "system.memory.usage" },
      {
        title: "Filesystem Usage by Host",
        metricName: "system.filesystem.usage",
      },
      { title: "Disk I/O by Host", metricName: "system.disk.io" },
      { title: "Network I/O by Host", metricName: "system.network.io" },
      {
        title: "Process Count by Host",
        metricName: "system.processes.count",
      },
    ]);
  });

  test("regroups each of them by the key hosts' rows carry, and changes nothing else", () => {
    const stored: JSONObject = madeBeforeTheFix();
    const before: string = JSON.stringify(stored);

    const repair: HostsDashboardChartGroupingRepairResult | null =
      HostsDashboardChartGroupingRepair.repair(stored);

    expect(repair!.regroupedChartCount).toBe(6);
    expect(JSON.stringify(stored)).toBe(before);

    // The board as the template makes it now, its own ids and all.
    const expected: JSONObject = JSON.parse(before);
    for (const component of expected["components"] as Array<JSONObject>) {
      const metricQueryData: JSONObject | undefined = (
        (component["arguments"] as JSONObject | undefined)?.[
          "metricQueryConfig"
        ] as JSONObject | undefined
      )?.["metricQueryData"] as JSONObject | undefined;

      if (
        JSON.stringify(metricQueryData?.["groupByAttributeKeys"]) ===
        JSON.stringify([LEGACY_HOST_GROUP_BY_KEY])
      ) {
        metricQueryData!["groupByAttributeKeys"] = [HOST_GROUP_BY_KEY];
      }
    }

    expect(repair!.config).toEqual(expected);
    expect(
      groupingsOf(repair!.config).every(([, keys]: [string, unknown]) => {
        return JSON.stringify(keys) === JSON.stringify([HOST_GROUP_BY_KEY]);
      }),
    ).toBe(true);
  });

  test("a second run finds nothing to do", () => {
    const repair: HostsDashboardChartGroupingRepairResult | null =
      HostsDashboardChartGroupingRepair.repair(madeBeforeTheFix());

    expect(HostsDashboardChartGroupingRepair.repair(repair!.config)).toBeNull();
    expect(
      HostsDashboardChartGroupingRepair.repair(
        JSON.parse(
          JSON.stringify(getTemplateConfig(DashboardTemplateType.Host)!),
        ),
      ),
    ).toBeNull();
  });

  test("leaves a person's own chart grouped by host.name, and one of the template's they regrouped", () => {
    const stored: JSONObject = madeBeforeTheFix();
    const components: Array<JSONObject> = stored[
      "components"
    ] as Array<JSONObject>;

    components.push(ownChart("Queue depth by host", "queue.depth"));
    // The template's title on a metric of their own: not the template's chart.
    components.push(ownChart("CPU Utilization by Host", "app.cpu"));

    const regrouped: JSONObject = components.find((component: JSONObject) => {
      return (
        (component["arguments"] as JSONObject | undefined)?.["chartTitle"] ===
        "Disk I/O by Host"
      );
    })!;
    (
      (
        (regrouped["arguments"] as JSONObject)[
          "metricQueryConfig"
        ] as JSONObject
      )["metricQueryData"] as JSONObject
    )["groupByAttributeKeys"] = [LEGACY_HOST_GROUP_BY_KEY, "device"];

    const repair: HostsDashboardChartGroupingRepairResult | null =
      HostsDashboardChartGroupingRepair.repair(stored);

    expect(repair!.regroupedChartCount).toBe(5);

    const groupings: Array<[string, unknown]> = groupingsOf(repair!.config);

    expect(groupings).toContainEqual([
      "Queue depth by host",
      [LEGACY_HOST_GROUP_BY_KEY],
    ]);
    expect(groupings).toContainEqual([
      "CPU Utilization by Host",
      [LEGACY_HOST_GROUP_BY_KEY],
    ]);
    expect(groupings).toContainEqual([
      "Disk I/O by Host",
      [LEGACY_HOST_GROUP_BY_KEY, "device"],
    ]);
  });

  test("a board with no such chart, or not a board at all, is left alone", () => {
    expect(
      HostsDashboardChartGroupingRepair.repair({
        components: [ownChart("Queue depth by host", "queue.depth")],
      }),
    ).toBeNull();
    expect(HostsDashboardChartGroupingRepair.repair(undefined)).toBeNull();
    expect(HostsDashboardChartGroupingRepair.repair("components")).toBeNull();
    expect(
      HostsDashboardChartGroupingRepair.repair({ components: "none" }),
    ).toBeNull();
  });

  test("asks Postgres for a dashboard holding a chart grouped by host.name alone", () => {
    expect(HostsDashboardChartGroupingRepair.getContainment()).toEqual({
      components: [
        {
          componentType: "Chart",
          arguments: {
            metricQueryConfig: {
              metricQueryData: { groupByAttributeKeys: ["host.name"] },
            },
          },
        },
      ],
    });
  });
});
