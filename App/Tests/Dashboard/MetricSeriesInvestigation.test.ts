import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import ObjectID from "Common/Types/ObjectID";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";

/*
 * MetricSeriesInvestigation imports ModelAPI (host/cluster/service
 * lookups) and ProjectUtil, both of which transitively load
 * Common/UI/Config — which reads `window` at import time and throws in
 * this node test environment. Mocking both keeps the import graph
 * browser-free and doubles as the seam for the resolver tests (same
 * pattern as MetricsCrossSignalPivot.test.ts).
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
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import {
  SeriesResourceTarget,
  SeriesScopedViewData,
  buildSeriesExceptionsPivotParams,
  getGroupByKeysForViewData,
  getSeriesResourceTargets,
  parseSeriesLabels,
  resolveSeriesResourceModelId,
  scopeViewDataToSeries,
  splitSeriesNameIntoSegments,
} from "../../FeatureSet/Dashboard/src/Utils/MetricSeriesInvestigation";
import { CrossSignalQueryParams } from "../../FeatureSet/Dashboard/src/Utils/MetricsCrossSignalPivot";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getCurrentProjectIdMock: jest.Mock =
  ProjectUtil.getCurrentProjectId as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "3c1b6b0e-0000-4000-8000-0000000000bb",
);

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T11:00:00.000Z");

function makeQueryConfig(input: {
  attributes?: Dictionary<unknown>;
  groupByAttributeKeys?: Array<string>;
  metricName?: string;
}): MetricQueryConfigData {
  return {
    metricQueryData: {
      filterData: {
        metricName: input.metricName || "cpu.usage",
        attributes: input.attributes || {},
        aggegationType: MetricsAggregationType.Avg,
      },
      ...(input.groupByAttributeKeys
        ? { groupByAttributeKeys: input.groupByAttributeKeys }
        : {}),
    },
  } as unknown as MetricQueryConfigData;
}

function makeViewData(input: {
  queryConfigs: Array<MetricQueryConfigData>;
  startAndEndDate?: InBetween<Date> | null;
}): MetricViewData {
  return {
    queryConfigs: input.queryConfigs,
    formulaConfigs: [],
    startAndEndDate:
      input.startAndEndDate === undefined ? null : input.startAndEndDate,
  } as MetricViewData;
}

function getScopedAttributes(
  viewData: MetricViewData,
  queryIndex: number = 0,
): Dictionary<unknown> {
  return ((
    viewData.queryConfigs[queryIndex]?.metricQueryData.filterData as Record<
      string,
      unknown
    >
  )?.["attributes"] || {}) as Dictionary<unknown>;
}

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
});

describe("splitSeriesNameIntoSegments", () => {
  test("single group key never splits, even on a comma in the value", () => {
    expect(
      splitSeriesNameIntoSegments("region=us-east, extra", ["region"]),
    ).toEqual(["region=us-east, extra"]);
  });

  test("multi-key names split at known key= prefixes only", () => {
    expect(
      splitSeriesNameIntoSegments(
        "host.name=prod-01, tags=a, b, service.name=api",
        ["host.name", "tags", "service.name"],
      ),
    ).toEqual(["host.name=prod-01", "tags=a, b", "service.name=api"]);
  });
});

describe("parseSeriesLabels", () => {
  test("recovers key=value labels from a composed series name", () => {
    expect(
      parseSeriesLabels({
        seriesName: "host.name=prod-01, service.name=api",
        groupByKeys: ["host.name", "service.name"],
      }),
    ).toEqual({ "host.name": "prod-01", "service.name": "api" });
  });

  test("keeps a comma-containing value intact on a single-key group-by", () => {
    expect(
      parseSeriesLabels({
        seriesName: "query=select a, b from t",
        groupByKeys: ["query"],
      }),
    ).toEqual({ query: "select a, b from t" });
  });

  test('maps the "(unset)" display value back to empty (is-empty filter)', () => {
    expect(
      parseSeriesLabels({
        seriesName: "host.name=(unset)",
        groupByKeys: ["host.name"],
      }),
    ).toEqual({ "host.name": "" });
  });

  test("yields nothing for names that carry no known key (overlay prefixes)", () => {
    expect(
      parseSeriesLabels({
        seriesName: "api: host.name=prod-01",
        groupByKeys: ["host.name", "pod"],
      }),
    ).toEqual({});
    expect(
      parseSeriesLabels({ seriesName: "cpu.usage", groupByKeys: [] }),
    ).toEqual({});
  });
});

describe("getGroupByKeysForViewData", () => {
  test("unions group keys across queries in first-seen order", () => {
    const viewData: MetricViewData = makeViewData({
      queryConfigs: [
        makeQueryConfig({ groupByAttributeKeys: ["host.name", "pod"] }),
        makeQueryConfig({ groupByAttributeKeys: ["pod", "container"] }),
        makeQueryConfig({}),
      ],
    });
    expect(getGroupByKeysForViewData(viewData)).toEqual([
      "host.name",
      "pod",
      "container",
    ]);
  });
});

describe("scopeViewDataToSeries", () => {
  test("pushes the series labels into the grouping query's attribute filters", () => {
    const viewData: MetricViewData = makeViewData({
      queryConfigs: [
        makeQueryConfig({
          attributes: { env: "prod" },
          groupByAttributeKeys: ["host.name"],
        }),
      ],
    });

    const scoped: SeriesScopedViewData = scopeViewDataToSeries({
      metricViewData: viewData,
      seriesName: "host.name=prod-01",
    });

    expect(scoped.didNarrow).toBe(true);
    expect(scoped.seriesLabels).toEqual({ "host.name": "prod-01" });
    expect(getScopedAttributes(scoped.scopedViewData)).toEqual({
      env: "prod",
      "host.name": "prod-01",
    });
    // The input view data must stay untouched (identity-preserving util).
    expect(getScopedAttributes(viewData)).toEqual({ env: "prod" });
  });

  test('an "(unset)" series narrows with the is-empty operator', () => {
    const viewData: MetricViewData = makeViewData({
      queryConfigs: [makeQueryConfig({ groupByAttributeKeys: ["host.name"] })],
    });

    const scoped: SeriesScopedViewData = scopeViewDataToSeries({
      metricViewData: viewData,
      seriesName: "host.name=(unset)",
    });

    expect(scoped.didNarrow).toBe(true);
    expect(
      getScopedAttributes(scoped.scopedViewData)["host.name"],
    ).toBeInstanceOf(IsNull);
  });

  test("a query that does not group by the label's key stays untouched", () => {
    const viewData: MetricViewData = makeViewData({
      queryConfigs: [makeQueryConfig({})],
    });

    const scoped: SeriesScopedViewData = scopeViewDataToSeries({
      metricViewData: viewData,
      seriesName: "host.name=prod-01",
      groupByKeys: ["host.name"],
    });

    expect(scoped.didNarrow).toBe(false);
    expect(scoped.scopedViewData).toBe(viewData);
  });

  test("explicit panel group keys win over the view-wide union", () => {
    const viewData: MetricViewData = makeViewData({
      queryConfigs: [makeQueryConfig({ groupByAttributeKeys: ["host.name"] })],
    });

    const scoped: SeriesScopedViewData = scopeViewDataToSeries({
      metricViewData: viewData,
      // "pod" is not in this panel's keys — the label must not parse.
      seriesName: "host.name=prod-01",
      groupByKeys: ["pod"],
    });

    expect(scoped.didNarrow).toBe(false);
  });
});

describe("getSeriesResourceTargets", () => {
  test("detects a host from the series labels", () => {
    const targets: Array<SeriesResourceTarget> = getSeriesResourceTargets({
      seriesLabels: { "host.name": "Prod-01" } as JSONObject,
      queryConfigs: [],
    });

    expect(targets).toEqual([
      {
        kind: "host",
        label: 'Open host "Prod-01"',
        attributeKey: "host.name",
        attributeValue: "Prod-01",
      },
    ]);
  });

  test("resource-prefixed keys take precedence within a kind", () => {
    const targets: Array<SeriesResourceTarget> = getSeriesResourceTargets({
      seriesLabels: {
        "resource.host.name": "a-host",
        "host.name": "b-host",
      } as JSONObject,
      queryConfigs: [],
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]?.attributeValue).toBe("a-host");
  });

  test("falls back to the queries' equality attribute filters", () => {
    const targets: Array<SeriesResourceTarget> = getSeriesResourceTargets({
      seriesLabels: {},
      queryConfigs: [makeQueryConfig({ attributes: { "host.name": "web-1" } })],
    });

    expect(targets).toEqual([
      {
        kind: "host",
        label: 'Open host "web-1"',
        attributeKey: "host.name",
        attributeValue: "web-1",
      },
    ]);
  });

  test("detects a service through the extractor's peeled service names", () => {
    const targets: Array<SeriesResourceTarget> = getSeriesResourceTargets({
      seriesLabels: {},
      queryConfigs: [
        makeQueryConfig({
          attributes: { "resource.service.name": "checkout" },
        }),
      ],
    });

    expect(targets).toEqual([
      {
        kind: "service",
        label: 'Open service "checkout"',
        attributeKey: "resource.service.name",
        attributeValue: "checkout",
      },
    ]);
  });

  test("an unset (empty) label never becomes a target", () => {
    expect(
      getSeriesResourceTargets({
        seriesLabels: { "host.name": "" } as JSONObject,
        queryConfigs: [],
      }),
    ).toEqual([]);
  });

  test("reports one target per kind, together", () => {
    const targets: Array<SeriesResourceTarget> = getSeriesResourceTargets({
      seriesLabels: {
        "host.name": "prod-01",
        "k8s.cluster.name": "cluster-a",
        networkDeviceId: "aaaaaaaa-0000-4000-8000-000000000001",
      } as JSONObject,
      queryConfigs: [
        makeQueryConfig({
          attributes: { "resource.service.name": "checkout-two" },
        }),
      ],
    });

    expect(
      targets.map((target: SeriesResourceTarget) => {
        return target.kind;
      }),
    ).toEqual(["host", "service", "kubernetesCluster", "networkDevice"]);
    expect(
      targets.find((target: SeriesResourceTarget) => {
        return target.kind === "networkDevice";
      })?.label,
    ).toBe("Open network device");
  });
});

describe("buildSeriesExceptionsPivotParams", () => {
  test("carries service ids, the window, and status=all", () => {
    const pivot: CrossSignalQueryParams = buildSeriesExceptionsPivotParams({
      metricViewData: makeViewData({
        queryConfigs: [makeQueryConfig({})],
        startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
      }),
      serviceIds: ["service-id-1", "service-id-2"],
    });

    expect(pivot.params["status"]).toBe("all");
    expect(JSON.parse(pivot.params["filters"] || "[]")).toEqual([
      ["primaryEntityId", "service-id-1"],
      ["primaryEntityId", "service-id-2"],
    ]);
    expect(pivot.params["range"]).toBe(TimeRange.CUSTOM);
    expect(pivot.params["start"]).toBeTruthy();
    expect(pivot.params["end"]).toBeTruthy();
    expect(pivot.dropped).toEqual([]);
  });

  test("reports attribute filters as dropped — the exceptions grammar has no attribute facets", () => {
    const pivot: CrossSignalQueryParams = buildSeriesExceptionsPivotParams({
      metricViewData: makeViewData({
        queryConfigs: [
          makeQueryConfig({
            attributes: { "host.name": "prod-01", severityText: "Error" },
          }),
        ],
      }),
      serviceIds: [],
    });

    expect(pivot.params["filters"]).toBeUndefined();
    expect(pivot.params["range"]).toBeUndefined();
    expect(pivot.dropped).toContain("host.name");
    expect(pivot.dropped).toContain("severityTexts");
  });

  test("reports unresolvable service names as dropped instead of filtering on nothing", () => {
    const pivot: CrossSignalQueryParams = buildSeriesExceptionsPivotParams({
      metricViewData: makeViewData({
        queryConfigs: [
          makeQueryConfig({
            attributes: { "resource.service.name": "unresolved-svc" },
          }),
        ],
      }),
      serviceIds: [],
    });

    expect(pivot.params["filters"]).toBeUndefined();
    expect(pivot.dropped).toContain("serviceIds");
  });
});

describe("resolveSeriesResourceModelId", () => {
  test("resolves a host by its canonicalized identifier and caches the hit", async () => {
    getListMock.mockResolvedValue({ data: [{ _id: "host-object-id-1" }] });

    const target: SeriesResourceTarget = {
      kind: "host",
      label: 'Open host "  Prod-01 "',
      attributeKey: "host.name",
      attributeValue: "  Prod-01 ",
    };

    const first: string | null = await resolveSeriesResourceModelId(target);
    expect(first).toBe("host-object-id-1");

    const callArgs: Record<string, unknown> = getListMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs["modelType"]).toBe(Host);
    expect(callArgs["query"]).toEqual({
      projectId: PROJECT_ID,
      // trim + lowercase, matching how Host.hostIdentifier is stored.
      hostIdentifier: "prod-01",
    });
    expect(callArgs["limit"]).toBe(1);

    const second: string | null = await resolveSeriesResourceModelId(target);
    expect(second).toBe("host-object-id-1");
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("resolves a Kubernetes cluster by clusterIdentifier", async () => {
    getListMock.mockResolvedValue({ data: [{ _id: "cluster-object-id-1" }] });

    const resolved: string | null = await resolveSeriesResourceModelId({
      kind: "kubernetesCluster",
      label: 'Open Kubernetes cluster "Cluster-A"',
      attributeKey: "k8s.cluster.name",
      attributeValue: "Cluster-A",
    });

    expect(resolved).toBe("cluster-object-id-1");
    const callArgs: Record<string, unknown> = getListMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs["modelType"]).toBe(KubernetesCluster);
    expect(callArgs["query"]).toEqual({
      projectId: PROJECT_ID,
      clusterIdentifier: "cluster-a",
    });
  });

  test("misses are not cached — the next click retries", async () => {
    getListMock.mockResolvedValue({ data: [] });

    const target: SeriesResourceTarget = {
      kind: "host",
      label: 'Open host "ghost"',
      attributeKey: "host.name",
      attributeValue: "ghost-host-never-seen",
    };

    expect(await resolveSeriesResourceModelId(target)).toBeNull();
    expect(await resolveSeriesResourceModelId(target)).toBeNull();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("returns null without a network call when no project is selected", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    expect(
      await resolveSeriesResourceModelId({
        kind: "host",
        label: 'Open host "x"',
        attributeKey: "host.name",
        attributeValue: "some-host-no-project",
      }),
    ).toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("resolves a service through the shared name resolver", async () => {
    getListMock.mockResolvedValue({
      data: [
        { name: "series-invest-svc", id: new ObjectID("service-object-id-9") },
      ],
    });

    const resolved: string | null = await resolveSeriesResourceModelId({
      kind: "service",
      label: 'Open service "series-invest-svc"',
      attributeKey: "resource.service.name",
      attributeValue: "series-invest-svc",
    });

    expect(resolved).toBe("service-object-id-9");
  });

  test("a network device target carries its own ObjectID", async () => {
    expect(
      await resolveSeriesResourceModelId({
        kind: "networkDevice",
        label: "Open network device",
        attributeKey: "networkDeviceId",
        attributeValue: "bbbbbbbb-0000-4000-8000-000000000002",
      }),
    ).toBe("bbbbbbbb-0000-4000-8000-000000000002");
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("blank values resolve to null", async () => {
    expect(
      await resolveSeriesResourceModelId({
        kind: "host",
        label: "Open host",
        attributeKey: "host.name",
        attributeValue: "   ",
      }),
    ).toBeNull();
  });
});

/*
 * Wiring pins: the pure utils above are only useful if the UI actually
 * mounts them. App's node test environment cannot render React, so — like
 * MetricsCrossSignalPivot.test.ts — these read the component sources and
 * pin the load-bearing wiring as (whitespace-squashed) strings.
 */
describe("investigation wiring", () => {
  function readSquashedSource(relativePath: string): string {
    return fs
      .readFileSync(
        path.join(__dirname, "../../FeatureSet/Dashboard/src", relativePath),
        "utf8",
      )
      .replace(/\s+/g, " ");
  }

  test("MetricCharts mounts the per-series investigate menu", () => {
    const source: string = readSquashedSource(
      "Components/Metrics/MetricCharts.tsx",
    );

    expect(source).toContain("openSeriesMenu");
    expect(source).toContain("Investigate this series");
    expect(source).toContain("scopeViewDataToSeries");
    expect(source).toContain("getSeriesResourceTargets");
    expect(source).toContain("resolveSeriesResourceModelId");
    expect(source).toContain("buildSeriesExceptionsPivotParams");
    expect(source).toContain('text="View exceptions"');
    expect(source).toContain("enableSeriesActions");
    // Read-only hosts deep-link out; read-write hosts filter in place.
    expect(source).toContain('text="Filter to this series"');
    expect(source).toContain('text="Open in Metric Explorer"');
  });

  test("the dashboard chart widget wires zoom, series actions, and a rolling range token", () => {
    const source: string = readSquashedSource(
      "Components/Dashboard/Components/DashboardChartComponent.tsx",
    );

    expect(source).toContain("setZoomWindow(new InBetween<Date>(");
    expect(source).toContain("enableSeriesActions={enableSeriesActions}");
    expect(source).toContain(
      "onTimeRangeSelect={ enableChartZoom ? handleChartTimeRangeSelect : undefined }",
    );
    expect(source).toContain("rangeToken: zoomWindow ? undefined :");
  });

  test("MetricView only claims the query-config write path when a parent can persist it", () => {
    const source: string = readSquashedSource(
      "Components/Metrics/MetricView.tsx",
    );

    expect(source).toContain(
      "props.onChange ? (queryConfigs: Array<MetricQueryConfigData>) =>",
    );
  });
});
