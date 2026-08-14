import { beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import TimeRange from "Common/Types/Time/TimeRange";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
} from "Common/Utils/Metrics/MetricExplorerUrl";
/*
 * Sibling-relative like the util under test: the `Common` specifier
 * resolves through App/node_modules, which may symlink a checkout that
 * predates this branch's CrossSignalScope module.
 */
import { CrossSignalQueryParams } from "../../../Common/Utils/Telemetry/CrossSignalScope";

/*
 * MetricsCrossSignalPivot imports ModelAPI (service-name resolution) and
 * ProjectUtil, both of which transitively load Common/UI/Config — which
 * reads `window` at import time and throws in this node test environment.
 * Mocking both keeps the import graph browser-free and doubles as the
 * seam for the resolver tests (same pattern as
 * DeviceMonitorLookupUtil.test.ts).
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
import {
  EXEMPLAR_LOGS_FALLBACK_PAD_MS,
  MetricCrossSignalScopeResult,
  MetricScopeFilterExtraction,
  SERVICE_NAME_ATTRIBUTE_KEY,
  SEVERITY_TEXT_ATTRIBUTE_KEY,
  buildCrossSignalScopeFromMetricViewData,
  buildExemplarLogsPivotParams,
  buildMetricExplorerPivotParams,
  extractScopeFiltersFromQueryConfigs,
  formatDroppedScopeHint,
  getExemplarTraceQueryParams,
  resolveServiceIdsByNames,
} from "../../FeatureSet/Dashboard/src/Utils/MetricsCrossSignalPivot";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getCurrentProjectIdMock: jest.Mock =
  ProjectUtil.getCurrentProjectId as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "9f1b6b0e-0000-4000-8000-0000000000aa",
);

function makeQueryConfig(
  attributes: Dictionary<unknown>,
  metricName: string = "cpu.usage",
): MetricQueryConfigData {
  return {
    metricQueryData: {
      filterData: {
        metricName: metricName,
        attributes: attributes,
        aggegationType: MetricsAggregationType.Avg,
      },
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

function parseFilters(params: Dictionary<string>): Array<[string, unknown]> {
  return JSON.parse(params["filters"] || "[]");
}

describe("extractScopeFiltersFromQueryConfigs", () => {
  test("merges and dedupes equality attributes across queries", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ env: "prod", region: "us-east-1" }),
        makeQueryConfig({ env: "prod", tier: "web" }, "memory.usage"),
      ]);

    expect(extraction.attributes).toEqual({
      env: "prod",
      region: "us-east-1",
      tier: "web",
    });
    expect(extraction.droppedFilterKeys).toEqual([]);
    expect(extraction.serviceNames).toEqual([]);
    expect(extraction.severityTexts).toEqual([]);
  });

  test("conflicting equality values across queries drop the key", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ env: "prod", host: "a1" }),
        makeQueryConfig({ env: "staging" }),
      ]);

    expect(extraction.attributes).toEqual({ host: "a1" });
    expect(extraction.droppedFilterKeys).toEqual(["env"]);
  });

  test("service-name equality moves to serviceNames, not attributes", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ [SERVICE_NAME_ATTRIBUTE_KEY]: "cart" }),
      ]);

    expect(extraction.serviceNames).toEqual(["cart"]);
    expect(extraction.attributes).toEqual({});
    expect(extraction.droppedFilterKeys).toEqual([]);
  });

  test("multi-value service membership carries every name, deduped", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({
          [SERVICE_NAME_ATTRIBUTE_KEY]: new Includes(["cart", "checkout"]),
        }),
        makeQueryConfig({ [SERVICE_NAME_ATTRIBUTE_KEY]: "cart" }),
      ]);

    expect(extraction.serviceNames).toEqual(["cart", "checkout"]);
  });

  test("severityText equality and membership merge into severityTexts", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ [SEVERITY_TEXT_ATTRIBUTE_KEY]: "error" }),
        makeQueryConfig({
          [SEVERITY_TEXT_ATTRIBUTE_KEY]: new Includes(["error", "Warning"]),
        }),
      ]);

    expect(extraction.severityTexts).toEqual(["error", "Warning"]);
    expect(extraction.attributes).toEqual({});
  });

  test("single-value membership on an ordinary key becomes equality; multi-value drops", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({
          zone: new Includes(["us-east-1a"]),
          cluster: new Includes(["blue", "green"]),
        }),
      ]);

    expect(extraction.attributes).toEqual({ zone: "us-east-1a" });
    expect(extraction.droppedFilterKeys).toEqual(["cluster"]);
  });

  test("an empty membership means All and is skipped silently", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ zone: new Includes([]) }),
      ]);

    expect(extraction.attributes).toEqual({});
    expect(extraction.droppedFilterKeys).toEqual([]);
  });

  test("non-equality operators are reported dropped, never carried", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({
          env: new NotEqual<string>("prod"),
          path: new Search<string>("checkout"),
          owner: new IsNull(),
        }),
      ]);

    expect(extraction.attributes).toEqual({});
    expect(extraction.droppedFilterKeys).toEqual(["env", "path", "owner"]);
  });

  test("raw _type-tagged EqualTo JSON (stored shape) is treated as equality", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ env: { _type: "EqualTo", value: "prod" } }),
      ]);

    expect(extraction.attributes).toEqual({ env: "prod" });
    expect(extraction.droppedFilterKeys).toEqual([]);
  });

  test("empty keys, empty values, and nullish values are skipped silently", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({
          "": "orphan",
          "   ": "blank-key",
          env: "",
          region: null,
          zone: undefined,
        }),
      ]);

    expect(extraction.attributes).toEqual({});
    expect(extraction.droppedFilterKeys).toEqual([]);
  });

  test("number and boolean equality values are stringified", () => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs([
        makeQueryConfig({ replicas: 3, canary: true }),
      ]);

    expect(extraction.attributes).toEqual({ replicas: "3", canary: "true" });
  });

  test("tolerates malformed query configs and empty input", () => {
    expect(extractScopeFiltersFromQueryConfigs([]).attributes).toEqual({});

    const malformed: Array<MetricQueryConfigData> = [
      {} as MetricQueryConfigData,
      { metricQueryData: {} } as unknown as MetricQueryConfigData,
      {
        metricQueryData: { filterData: {} },
      } as unknown as MetricQueryConfigData,
    ];

    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs(malformed);

    expect(extraction.attributes).toEqual({});
    expect(extraction.droppedFilterKeys).toEqual([]);
  });
});

describe("buildCrossSignalScopeFromMetricViewData", () => {
  const START: Date = new Date("2026-08-14T10:00:00.000Z");
  const END: Date = new Date("2026-08-14T11:00:00.000Z");

  test("maps a Date window onto the scope", () => {
    const result: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: makeViewData({
          queryConfigs: [makeQueryConfig({ env: "prod" })],
          startAndEndDate: new InBetween<Date>(START, END),
        }),
      });

    expect(result.scope.startTime).toEqual(START);
    expect(result.scope.endTime).toEqual(END);
    expect(result.scope.attributes).toEqual({ env: "prod" });
    expect(result.droppedFilterKeys).toEqual([]);
  });

  test("coerces an ISO-string window (stored snapshot shape) into Dates", () => {
    const result: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: makeViewData({
          queryConfigs: [makeQueryConfig({})],
          startAndEndDate: new InBetween<Date>(
            START.toISOString() as unknown as Date,
            END.toISOString() as unknown as Date,
          ),
        }),
      });

    expect(result.scope.startTime instanceof Date).toBe(true);
    expect(result.scope.endTime instanceof Date).toBe(true);
    expect((result.scope.startTime as Date).getTime()).toBe(START.getTime());
    expect((result.scope.endTime as Date).getTime()).toBe(END.getTime());
  });

  test("no window at all leaves startTime/endTime unset", () => {
    const result: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: makeViewData({
          queryConfigs: [makeQueryConfig({ env: "prod" })],
          startAndEndDate: null,
        }),
      });

    expect(result.scope.startTime).toBeUndefined();
    expect(result.scope.endTime).toBeUndefined();
  });

  test("full service-name resolution populates serviceIds and drops the name attribute", () => {
    const result: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: makeViewData({
          queryConfigs: [
            makeQueryConfig({
              [SERVICE_NAME_ATTRIBUTE_KEY]: new Includes(["cart", "checkout"]),
            }),
          ],
          startAndEndDate: new InBetween<Date>(START, END),
        }),
        serviceIdsByName: {
          cart: "id-cart",
          checkout: "id-checkout",
        },
      });

    expect(result.scope.serviceIds).toEqual(["id-cart", "id-checkout"]);
    expect(result.scope.attributes).toBeUndefined();
    expect(result.droppedFilterKeys).toEqual([]);
  });

  test("failed resolution with one name falls back to attribute passthrough", () => {
    const result: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: makeViewData({
          queryConfigs: [
            makeQueryConfig({ [SERVICE_NAME_ATTRIBUTE_KEY]: "cart" }),
          ],
        }),
        serviceIdsByName: {},
      });

    expect(result.scope.serviceIds).toBeUndefined();
    expect(result.scope.attributes).toEqual({
      [SERVICE_NAME_ATTRIBUTE_KEY]: "cart",
    });
    expect(result.droppedFilterKeys).toEqual([]);
  });

  test("partially-resolved multiple names report the service key dropped", () => {
    const result: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: makeViewData({
          queryConfigs: [
            makeQueryConfig({
              [SERVICE_NAME_ATTRIBUTE_KEY]: new Includes(["cart", "checkout"]),
            }),
          ],
        }),
        serviceIdsByName: { cart: "id-cart" },
      });

    expect(result.scope.serviceIds).toBeUndefined();
    expect(result.scope.attributes).toBeUndefined();
    expect(result.droppedFilterKeys).toEqual([SERVICE_NAME_ATTRIBUTE_KEY]);
  });
});

describe("resolveServiceIdsByNames", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getCurrentProjectIdMock.mockReset();
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  });

  function serviceRow(name: string, id: string): unknown {
    return {
      name: name,
      id: new ObjectID(id),
    };
  }

  test("maps names to ids through a single list call", async () => {
    getListMock.mockResolvedValue({
      data: [
        serviceRow("alpha-a", "3f1b6b0e-0000-4000-8000-0000000000a1"),
        serviceRow("alpha-b", "3f1b6b0e-0000-4000-8000-0000000000a2"),
      ],
      count: 2,
    });

    const mapping: Dictionary<string> = await resolveServiceIdsByNames([
      "alpha-a",
      "alpha-b",
      "alpha-a",
    ]);

    expect(mapping).toEqual({
      "alpha-a": "3f1b6b0e-0000-4000-8000-0000000000a1",
      "alpha-b": "3f1b6b0e-0000-4000-8000-0000000000a2",
    });
    expect(getListMock).toHaveBeenCalledTimes(1);

    const callArgs: { query: Record<string, unknown> } =
      getListMock.mock.calls[0]![0];
    expect(callArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(callArgs.query["name"]).toBeInstanceOf(Includes);
    expect((callArgs.query["name"] as Includes).values).toEqual([
      "alpha-a",
      "alpha-b",
    ]);
  });

  test("a successful resolution is cached; the second pivot skips the network", async () => {
    getListMock.mockResolvedValue({
      data: [serviceRow("beta-a", "3f1b6b0e-0000-4000-8000-0000000000b1")],
      count: 1,
    });

    const first: Dictionary<string> = await resolveServiceIdsByNames([
      "beta-a",
    ]);
    const second: Dictionary<string> = await resolveServiceIdsByNames([
      "beta-a",
    ]);

    expect(first).toEqual(second);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("failures return an empty mapping and are not cached", async () => {
    getListMock.mockRejectedValueOnce(new Error("network down"));

    const failed: Dictionary<string> = await resolveServiceIdsByNames([
      "gamma-a",
    ]);
    expect(failed).toEqual({});

    getListMock.mockResolvedValue({
      data: [serviceRow("gamma-a", "3f1b6b0e-0000-4000-8000-0000000000c1")],
      count: 1,
    });

    const retried: Dictionary<string> = await resolveServiceIdsByNames([
      "gamma-a",
    ]);
    expect(retried).toEqual({
      "gamma-a": "3f1b6b0e-0000-4000-8000-0000000000c1",
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("no current project resolves to an empty mapping without a network call", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    const mapping: Dictionary<string> = await resolveServiceIdsByNames([
      "delta-a",
    ]);

    expect(mapping).toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("blank and empty name lists never hit the network", async () => {
    expect(await resolveServiceIdsByNames([])).toEqual({});
    expect(await resolveServiceIdsByNames(["", "   "])).toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("buildMetricExplorerPivotParams", () => {
  const START: Date = new Date("2026-08-14T10:00:00.000Z");
  const END: Date = new Date("2026-08-14T11:00:00.000Z");

  test("logs pivot carries window, attributes, canonicalized severity and service ids", () => {
    const pivot: CrossSignalQueryParams = buildMetricExplorerPivotParams({
      target: "logs",
      metricViewData: makeViewData({
        queryConfigs: [
          makeQueryConfig({
            env: "prod",
            [SEVERITY_TEXT_ATTRIBUTE_KEY]: "error",
            [SERVICE_NAME_ATTRIBUTE_KEY]: "cart",
          }),
        ],
        startAndEndDate: new InBetween<Date>(START, END),
      }),
      serviceIdsByName: { cart: "id-cart" },
    });

    expect(pivot.dropped).toEqual([]);
    expect(pivot.params["range"]).toBe(TimeRange.CUSTOM);
    expect(pivot.params["start"]).toBe(OneUptimeDate.toString(START));
    expect(pivot.params["end"]).toBe(OneUptimeDate.toString(END));

    const filters: Array<[string, unknown]> = parseFilters(pivot.params);
    expect(filters).toContainEqual(["severityText", ["Error"]]);
    expect(filters).toContainEqual(["primaryEntityId", ["id-cart"]]);
    expect(filters).toContainEqual(["attributes.env", ["prod"]]);
  });

  test("traces pivot merges scope-construction drops with serializer drops, deduped", () => {
    const pivot: CrossSignalQueryParams = buildMetricExplorerPivotParams({
      target: "traces",
      metricViewData: makeViewData({
        queryConfigs: [
          makeQueryConfig({
            env: "prod",
            path: new Search<string>("checkout"),
            [SEVERITY_TEXT_ATTRIBUTE_KEY]: "error",
            [SERVICE_NAME_ATTRIBUTE_KEY]: "cart",
          }),
        ],
        startAndEndDate: new InBetween<Date>(START, END),
      }),
      serviceIdsByName: { cart: "id-cart" },
    });

    // Search on `path` cannot be carried; spans have no severity dimension.
    expect(pivot.dropped).toEqual(["path", "severityTexts"]);
    expect(pivot.params["search"]).toBe("@env:prod");
    expect(JSON.parse(pivot.params["filters"] || "[]")).toContainEqual([
      "primaryEntityId",
      "id-cart",
    ]);
    expect(pivot.params["range"]).toBe(TimeRange.CUSTOM);
  });

  test("a formula/group-by view degrades to window+attributes and never throws", () => {
    const viewData: MetricViewData = {
      queryConfigs: [
        {
          metricQueryData: {
            filterData: {
              metricName: "cpu.usage",
              attributes: { env: "prod" },
              aggegationType: MetricsAggregationType.Avg,
            },
            groupByAttributeKeys: ["host.name"],
          },
        } as unknown as MetricQueryConfigData,
      ],
      formulaConfigs: [
        {
          metricFormulaData: { metricFormula: "a / 100" },
        } as unknown as MetricViewData["formulaConfigs"][0],
      ],
      startAndEndDate: new InBetween<Date>(START, END),
    } as MetricViewData;

    const pivot: CrossSignalQueryParams = buildMetricExplorerPivotParams({
      target: "logs",
      metricViewData: viewData,
    });

    expect(pivot.dropped).toEqual([]);
    expect(parseFilters(pivot.params)).toEqual([["attributes.env", ["prod"]]]);
    expect(pivot.params["range"]).toBe(TimeRange.CUSTOM);
  });

  test("does not mutate the metric view data it reads", () => {
    const viewData: MetricViewData = makeViewData({
      queryConfigs: [
        makeQueryConfig({ env: "prod", [SERVICE_NAME_ATTRIBUTE_KEY]: "cart" }),
      ],
      startAndEndDate: new InBetween<Date>(START, END),
    });
    const snapshot: string = JSON.stringify(viewData);

    buildMetricExplorerPivotParams({
      target: "logs",
      metricViewData: viewData,
      serviceIdsByName: { cart: "id-cart" },
    });

    expect(JSON.stringify(viewData)).toBe(snapshot);
  });
});

describe("exemplar pivot builders", () => {
  const EXEMPLAR_TIME: Date = new Date("2026-08-14T10:30:00.000Z");
  const WINDOW_START: Date = new Date("2026-08-14T10:00:00.000Z");
  const WINDOW_END: Date = new Date("2026-08-14T11:00:00.000Z");

  test("trace query params carry the span when present and stay empty otherwise", () => {
    expect(getExemplarTraceQueryParams({ spanId: "span-1" })).toEqual({
      spanId: "span-1",
    });
    expect(getExemplarTraceQueryParams({})).toEqual({});
    expect(getExemplarTraceQueryParams({ spanId: "" })).toEqual({});
    expect(getExemplarTraceQueryParams({ spanId: "   " })).toEqual({});
  });

  test("logs pivot uses the chart window and carries the trace id", () => {
    const pivot: CrossSignalQueryParams = buildExemplarLogsPivotParams({
      traceId: "trace-abc",
      exemplarTime: EXEMPLAR_TIME,
      chartWindow: new InBetween<Date>(WINDOW_START, WINDOW_END),
    });

    expect(parseFilters(pivot.params)).toEqual([["traceId", ["trace-abc"]]]);
    expect(pivot.params["range"]).toBe(TimeRange.CUSTOM);
    expect(pivot.params["start"]).toBe(OneUptimeDate.toString(WINDOW_START));
    expect(pivot.params["end"]).toBe(OneUptimeDate.toString(WINDOW_END));
    expect(pivot.dropped).toEqual([]);
  });

  test("without a chart window the pivot pads around the exemplar timestamp", () => {
    const pivot: CrossSignalQueryParams = buildExemplarLogsPivotParams({
      traceId: "trace-abc",
      exemplarTime: EXEMPLAR_TIME,
      chartWindow: null,
    });

    const expectedStart: Date = new Date(
      EXEMPLAR_TIME.getTime() - EXEMPLAR_LOGS_FALLBACK_PAD_MS,
    );
    const expectedEnd: Date = new Date(
      EXEMPLAR_TIME.getTime() + EXEMPLAR_LOGS_FALLBACK_PAD_MS,
    );

    expect(pivot.params["range"]).toBe(TimeRange.CUSTOM);
    expect(pivot.params["start"]).toBe(OneUptimeDate.toString(expectedStart));
    expect(pivot.params["end"]).toBe(OneUptimeDate.toString(expectedEnd));
  });

  test("an ISO-string chart window (stored snapshot shape) still resolves", () => {
    const pivot: CrossSignalQueryParams = buildExemplarLogsPivotParams({
      traceId: "trace-abc",
      exemplarTime: EXEMPLAR_TIME,
      chartWindow: new InBetween<Date>(
        WINDOW_START.toISOString() as unknown as Date,
        WINDOW_END.toISOString() as unknown as Date,
      ),
    });

    expect(pivot.params["start"]).toBe(OneUptimeDate.toString(WINDOW_START));
    expect(pivot.params["end"]).toBe(OneUptimeDate.toString(WINDOW_END));
  });

  test("no window and an invalid exemplar time emit trace filters only", () => {
    const pivot: CrossSignalQueryParams = buildExemplarLogsPivotParams({
      traceId: "trace-abc",
      exemplarTime: new Date(NaN),
      chartWindow: null,
    });

    expect(parseFilters(pivot.params)).toEqual([["traceId", ["trace-abc"]]]);
    expect(pivot.params["range"]).toBeUndefined();
    expect(pivot.params["start"]).toBeUndefined();
    expect(pivot.params["end"]).toBeUndefined();
    expect(pivot.dropped).toEqual([]);
  });
});

describe("formatDroppedScopeHint", () => {
  test("maps scope field names to friendly labels and keeps attribute keys verbatim", () => {
    expect(formatDroppedScopeHint(["serviceIds", "severityTexts", "env"])).toBe(
      "Not carried over: service, severity, env.",
    );
  });

  test("collapses the window endpoints into one label and dedupes", () => {
    expect(formatDroppedScopeHint(["startTime", "endTime", "startTime"])).toBe(
      "Not carried over: time window.",
    );
  });

  test("returns an empty string when nothing was dropped", () => {
    expect(formatDroppedScopeHint([])).toBe("");
    expect(formatDroppedScopeHint(["", "   "])).toBe("");
  });
});

/*
 * No-regression pins on the metric explorer's OWN URL serialization —
 * the pivot must not disturb the params the explorer round-trips through
 * MetricExplorerUrl (deep links, saved views, monitor-create seeding).
 */
describe("metric explorer URL serialization (no regression)", () => {
  const START: Date = new Date("2026-08-14T10:00:00.000Z");
  const END: Date = new Date("2026-08-14T11:00:00.000Z");

  test("a pinned window still serializes metricQueries + absolute times, no range token", () => {
    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(
        makeViewData({
          queryConfigs: [makeQueryConfig({ env: "prod" }, "cpu.usage")],
          startAndEndDate: new InBetween<Date>(START, END),
        }),
      );

    const queries: Array<{ metricName: string; attributes?: unknown }> =
      JSON.parse(params[MetricExplorerUrlParam.MetricQueries] || "[]");

    expect(queries).toHaveLength(1);
    expect(queries[0]!.metricName).toBe("cpu.usage");
    expect(queries[0]!.attributes).toEqual({ env: "prod" });
    expect(params[MetricExplorerUrlParam.StartTime]).toBe(
      OneUptimeDate.toString(START),
    );
    expect(params[MetricExplorerUrlParam.EndTime]).toBe(
      OneUptimeDate.toString(END),
    );
    expect(params[MetricExplorerUrlParam.Range]).toBeUndefined();
  });

  test("a rolling window still serializes its range token alongside the absolute window", () => {
    const viewData: MetricViewData = {
      ...makeViewData({
        queryConfigs: [makeQueryConfig({}, "cpu.usage")],
        startAndEndDate: new InBetween<Date>(START, END),
      }),
      rangeToken: TimeRange.PAST_ONE_HOUR,
    };

    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(viewData);

    expect(params[MetricExplorerUrlParam.Range]).toBe(TimeRange.PAST_ONE_HOUR);
    expect(params[MetricExplorerUrlParam.StartTime]).toBe(
      OneUptimeDate.toString(START),
    );
  });
});

/*
 * Wiring pins: the App test suite runs in plain Node with no renderer, so
 * the component-side hookup — the explorer's pivot buttons carrying scope
 * and the exemplar dots opening the pivot menu — is pinned by reading the
 * sources (whitespace-squashed so a prettier re-wrap cannot fake a
 * regression), the way IncidentMetricSeriesScope.test.ts pins its pages.
 */
describe("metrics cross-signal pivot wiring", () => {
  const METRICS_COMPONENTS_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Metrics",
  );

  function readSquashedSource(fileName: string): string {
    return fs
      .readFileSync(path.join(METRICS_COMPONENTS_DIR, fileName), "utf8")
      .replace(/\s+/g, " ");
  }

  test("MetricExplorer's signal buttons pivot with the full scope, not window-only", () => {
    const source: string = readSquashedSource("MetricExplorer.tsx");

    expect(source).toContain("buildMetricExplorerPivotParams");
    expect(source).toContain("resolveServiceIdsByNames");
    expect(source).toContain("extractScopeFiltersFromQueryConfigs");
    expect(source).toContain("formatDroppedScopeHint");
    expect(source).toContain("ShowToastNotification");
    expect(source).not.toContain("window-only — no filter mapping");
  });

  test("MetricCharts' exemplar click opens the trace/logs pivot menu", () => {
    const source: string = readSquashedSource("MetricCharts.tsx");

    expect(source).toContain("buildExemplarLogsPivotParams");
    expect(source).toContain("getExemplarTraceQueryParams");
    expect(source).toContain('role="menu"');
    expect(source).toContain('text="View trace"');
    expect(source).toContain('text="View logs"');
    expect(source).toContain("useComponentOutsideClick");
  });
});
