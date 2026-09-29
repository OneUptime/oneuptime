import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "Common/Types/Dictionary";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";

/*
 * ModelAPI / ProjectUtil transitively load Common/UI/Config, which reads
 * `window` at import time — mock them (they double as the resolver seam).
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "../../../Common/Utils/Metrics/MetricExplorerUrl";
import {
  CrossSignalQueryParams,
  toMetricsExplorerQueryParams,
} from "../../../Common/Utils/Telemetry/CrossSignalScope";
import { resolveServiceNamesByIds } from "../../FeatureSet/Dashboard/src/Utils/MetricsCrossSignalPivot";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getCurrentProjectIdMock: jest.Mock =
  ProjectUtil.getCurrentProjectId as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "8d1b6b0e-0000-4000-8000-0000000000ff",
);

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
});

describe("MetricExplorerUrl.parseServicesParam", () => {
  test("parses a JSON array of ids, deduped, capped, garbage-safe", () => {
    expect(
      MetricExplorerUrl.parseServicesParam('["a", "b", "a", "", 5]'),
    ).toEqual(["a", "b"]);
    expect(MetricExplorerUrl.parseServicesParam("not-json")).toEqual([]);
    expect(MetricExplorerUrl.parseServicesParam('{"a": 1}')).toEqual([]);
    expect(
      MetricExplorerUrl.parseServicesParam(
        JSON.stringify(
          Array.from({ length: 50 }, (_: unknown, index: number) => {
            return `id-${index}`;
          }),
        ),
      ).length,
    ).toBeLessThanOrEqual(20);
  });
});

describe("multi-value attribute round trip", () => {
  test("Includes instances survive build -> JSON -> parse as Includes again", () => {
    const query: SerializedMetricQuery = {
      metricName: "cpu.usage",
      attributes: {
        "resource.service.name": new Includes(["checkout", "payments"]),
        env: "prod",
      },
    };

    const parsed: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(JSON.stringify([query]));

    const attributes: Dictionary<unknown> = (parsed[0]?.attributes ||
      {}) as Dictionary<unknown>;
    expect(attributes["env"]).toBe("prod");
    expect(attributes["resource.service.name"]).toBeInstanceOf(Includes);
    expect((attributes["resource.service.name"] as Includes).values).toEqual([
      "checkout",
      "payments",
    ]);
  });

  test("garbage membership shapes are dropped, not corrupted", () => {
    const parsed: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(
        JSON.stringify([
          {
            metricName: "cpu.usage",
            attributes: {
              ok: { _type: "Includes", value: ["a"] },
              empty: { _type: "Includes", value: [] },
              wrongShape: { _type: "Includes", value: "not-an-array" },
              nested: { deep: true },
            },
          },
        ]),
      );

    const attributes: Dictionary<unknown> = (parsed[0]?.attributes ||
      {}) as Dictionary<unknown>;
    expect(attributes["ok"]).toBeInstanceOf(Includes);
    expect(attributes["empty"]).toBeUndefined();
    expect(attributes["nested"]).toBeUndefined();
  });
});

describe("toMetricsExplorerQueryParams service scope", () => {
  test("serviceIds ride the services param instead of being dropped", () => {
    const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(
      {
        serviceIds: ["id-1", "id-2", "id-1", ""],
        startTime: new Date("2026-08-20T10:00:00.000Z"),
        endTime: new Date("2026-08-20T11:00:00.000Z"),
      },
      "cpu.usage",
    );

    expect(
      JSON.parse(result.params[MetricExplorerUrlParam.Services] || "[]"),
    ).toEqual(["id-1", "id-2"]);
    expect(result.dropped).not.toContain("serviceIds");
  });

  test("no services -> no param", () => {
    const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(
      {},
      "cpu.usage",
    );
    expect(result.params[MetricExplorerUrlParam.Services]).toBeUndefined();
  });
});

describe("resolveServiceNamesByIds", () => {
  test("resolves ids to names through one list call and caches the hit", async () => {
    getListMock.mockResolvedValue({
      data: [
        {
          name: "checkout",
          id: new ObjectID("11111111-aaaa-4aaa-8aaa-111111111111"),
        },
        {
          name: "payments",
          id: new ObjectID("22222222-bbbb-4bbb-8bbb-222222222222"),
        },
      ],
    });

    const ids: Array<string> = [
      "11111111-aaaa-4aaa-8aaa-111111111111",
      "22222222-bbbb-4bbb-8bbb-222222222222",
    ];

    const mapping: Dictionary<string> = await resolveServiceNamesByIds(ids);
    expect(mapping[ids[0] as string]).toBe("checkout");
    expect(mapping[ids[1] as string]).toBe("payments");

    await resolveServiceNamesByIds(ids);
    expect(getListMock).toHaveBeenCalledTimes(1);

    const callArgs: Record<string, unknown> = getListMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    const query: Record<string, unknown> = callArgs["query"] as Record<
      string,
      unknown
    >;
    expect(query["_id"]).toBeInstanceOf(Includes);
  });

  test("degrades to an empty mapping without a project or on failure", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);
    expect(await resolveServiceNamesByIds(["some-unresolvable-id"])).toEqual(
      {},
    );
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("explorer + chart-sync wiring", () => {
  function readSquashed(relative: string): string {
    return fs
      .readFileSync(path.join(__dirname, "../../..", relative), "utf8")
      .replace(/\s+/g, " ");
  }

  test("the explorer consumes the one-shot services param", () => {
    const explorer: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx",
    );
    expect(explorer).toContain("MetricExplorerUrl.parseServicesParam");
    expect(explorer).toContain("resolveServiceNamesByIds");
    expect(explorer).toContain("SERVICE_NAME_ATTRIBUTE_KEY");
    // Consumed on write-back so the param never lingers.
    expect(explorer).toContain(
      "params.delete(MetricExplorerUrlParam.Services)",
    );
    // A pure service deep link must not be clobbered by the default view.
    expect(explorer).toContain(
      "Navigation.getQueryStringByName(MetricExplorerUrlParam.Services)",
    );
  });

  test("dashboards share one crosshair-sync channel across widgets", () => {
    expect(
      readSquashed("Common/UI/Components/Charts/ChartGroup/ChartGroup.tsx"),
    ).toContain("props.syncId || fallbackSyncId");
    expect(
      readSquashed(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx",
      ),
    ).toContain("chartSyncId={props.dashboardId.toString()}");
    for (const widget of [
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx",
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent.tsx",
    ]) {
      expect(readSquashed(widget)).toContain("chartSyncId={props.chartSyncId}");
    }
    // "" must never become an accidental page-wide sync channel.
    for (const lib of [
      "Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx",
      "Common/UI/Components/Charts/ChartLibrary/AreaChart/AreaChart.tsx",
      "Common/UI/Components/Charts/ChartLibrary/BarChart/BarChart.tsx",
    ]) {
      expect(readSquashed(lib)).toContain(
        "{...(props.syncid ? { syncId: props.syncid.toString() } : {})}",
      );
    }
  });
});
