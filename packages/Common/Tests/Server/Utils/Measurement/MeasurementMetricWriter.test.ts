import MeasurementMetricWriter, {
  MeasurementMetricPoint,
} from "../../../../Server/Utils/Measurement/MeasurementMetricWriter";
import MutableMetric from "../../../../Models/AnalyticsModels/MutableMetric";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import MutableMetricService from "../../../../Server/Services/MutableMetricService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
/*
 * `jest` deliberately comes from the global scope, not @jest/globals — the
 * imported value would shadow the global `jest` NAMESPACE and break the
 * `jest.Mock` type annotations below (house convention).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Services/MutableMetricService", () => {
  return {
    __esModule: true,
    default: {
      replaceEntityMetrics: jest.fn(),
      tombstoneEntityMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getAttributeKeys: jest.fn((): Array<string> => {
        return [];
      }),
      indexMetricNameServiceNameMap: jest.fn((): Promise<void> => {
        return Promise.resolve();
      }),
    },
  };
});

const DEFAULT_RETENTION_DAYS: number = 180;

const replaceEntityMetricsMock: jest.Mock =
  MutableMetricService.replaceEntityMetrics as unknown as jest.Mock;
const tombstoneEntityMetricsMock: jest.Mock =
  MutableMetricService.tombstoneEntityMetrics as unknown as jest.Mock;
const findOneByMock: jest.Mock =
  GlobalConfigService.findOneBy as unknown as jest.Mock;
const indexMetricNameServiceNameMapMock: jest.Mock =
  TelemetryUtil.indexMetricNameServiceNameMap as unknown as jest.Mock;

const PROJECT_ID: ObjectID = ObjectID.generate();
const ENTITY_ID: ObjectID = ObjectID.generate();

function point(
  overrides: Partial<MeasurementMetricPoint> = {},
): MeasurementMetricPoint {
  return {
    metricName: "checkout.latency",
    measurementId: "meas-1",
    measurementKey: "checkout_latency",
    measurementName: "Checkout Latency",
    valueInSeconds: 3.5,
    time: OneUptimeDate.getCurrentDate(),
    ...overrides,
  };
}

function lastReplaceCall(): Record<string, unknown> {
  const calls: Array<Array<unknown>> = replaceEntityMetricsMock.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  replaceEntityMetricsMock.mockReset();
  replaceEntityMetricsMock.mockResolvedValue(undefined);
  tombstoneEntityMetricsMock.mockReset();
  tombstoneEntityMetricsMock.mockResolvedValue(undefined);
  findOneByMock.mockReset();
  findOneByMock.mockResolvedValue(null);
  indexMetricNameServiceNameMapMock.mockReset();
  indexMetricNameServiceNameMapMock.mockResolvedValue(undefined);
});

describe("MeasurementMetricWriter.write short-circuits", () => {
  test("no metric names: nothing is written or tombstoned", async () => {
    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: [],
      points: [point()],
      baseAttributes: {},
    });

    expect(replaceEntityMetricsMock).not.toHaveBeenCalled();
  });
});

describe("MeasurementMetricWriter.write builds mutable metrics", () => {
  test("maps a point onto a Sum metric with per-definition identity", async () => {
    const at: Date = OneUptimeDate.getCurrentDate();

    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["checkout.latency"],
      points: [
        point({
          metricName: "checkout.latency",
          measurementId: "meas-42",
          valueInSeconds: 7,
          time: at,
        }),
      ],
      baseAttributes: { "oneuptime.service.id": "svc-1" },
    });

    const metrics: Array<MutableMetric> = lastReplaceCall()[
      "metrics"
    ] as Array<MutableMetric>;

    expect(metrics).toHaveLength(1);
    const metric: MutableMetric = metrics[0]!;

    expect(metric.name).toBe("checkout.latency");
    // Per-definition identity keeps definitions from overwriting each other.
    expect(metric.metricPointId).toBe("measurement:meas-42");
    expect(metric.value).toBe(7);
    expect(metric.metricPointType).toBe(MetricPointType.Sum);
    expect(metric.time).toBe(at);
  });

  test("namespaces measurement attributes on top of the base attributes", async () => {
    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["checkout.latency"],
      points: [
        point({
          measurementId: "meas-9",
          measurementKey: "checkout_latency",
          measurementName: "Checkout Latency",
        }),
      ],
      baseAttributes: { "oneuptime.service.name": "web" },
    });

    const metrics: Array<MutableMetric> = lastReplaceCall()[
      "metrics"
    ] as Array<MutableMetric>;
    const attributes: Record<string, unknown> = metrics[0]!
      .attributes as Record<string, unknown>;

    // Base attribute is preserved.
    expect(attributes["oneuptime.service.name"]).toBe("web");
    // Measurement dimensions are namespaced so they cannot collide.
    expect(attributes["oneuptime.measurement.id"]).toBe("meas-9");
    expect(attributes["oneuptime.measurement.key"]).toBe("checkout_latency");
    expect(attributes["oneuptime.measurement.name"]).toBe("Checkout Latency");
  });

  test("one metric is built per point, in order", async () => {
    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["a", "b"],
      points: [
        point({ metricName: "a", measurementId: "id-a", valueInSeconds: 1 }),
        point({ metricName: "b", measurementId: "id-b", valueInSeconds: 2 }),
      ],
      baseAttributes: {},
    });

    const metrics: Array<MutableMetric> = lastReplaceCall()[
      "metrics"
    ] as Array<MutableMetric>;

    expect(
      metrics.map((m: MutableMetric) => {
        return m.metricPointId;
      }),
    ).toEqual(["measurement:id-a", "measurement:id-b"]);
  });
});

describe("MeasurementMetricWriter.write tombstone scope invariant", () => {
  test("replace is scoped to ALL measurement names, not just the points written", async () => {
    /*
     * The critical invariant: replaceEntityMetrics tombstones every live
     * point whose name is in metricNames but absent from `metrics`. The
     * writer must pass its OWN full measurement-name list so a disabled
     * definition's stale point is cleaned up — but must never leak these
     * names into the built-in refresh's replace list.
     */
    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      // Two definitions exist; only one currently has a value.
      allMeasurementMetricNames: ["enabled.metric", "disabled.metric"],
      points: [point({ metricName: "enabled.metric", measurementId: "en" })],
      baseAttributes: {},
    });

    const call: Record<string, unknown> = lastReplaceCall();
    expect(call["metricNames"]).toEqual(["enabled.metric", "disabled.metric"]);
    // Yet only the valued point is in the desired set.
    expect(call["metrics"]).toHaveLength(1);
  });
});

describe("MeasurementMetricWriter.write registers metric types", () => {
  test("registers the metric name with description/unit defaults", async () => {
    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["checkout.latency"],
      points: [
        point({
          metricName: "checkout.latency",
          measurementName: "Checkout Latency",
          description: undefined,
          unit: undefined,
        }),
      ],
      baseAttributes: {},
    });

    expect(indexMetricNameServiceNameMapMock).toHaveBeenCalledTimes(1);
    const arg: Record<string, unknown> = indexMetricNameServiceNameMapMock.mock
      .calls[0]![0] as Record<string, unknown>;
    const map: Record<string, { description?: string; unit?: string }> = arg[
      "metricNameServiceNameMap"
    ] as Record<string, { description?: string; unit?: string }>;

    expect(map["checkout.latency"]!.unit).toBe("seconds");
    expect(map["checkout.latency"]!.description).toContain("Checkout Latency");
  });

  test("no points: replace still runs (to tombstone) but no types are registered", async () => {
    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["stale.metric"],
      points: [],
      baseAttributes: {},
    });

    // Replace runs so stale points get tombstoned...
    expect(replaceEntityMetricsMock).toHaveBeenCalledTimes(1);
    expect(lastReplaceCall()["metrics"]).toHaveLength(0);
    // ...but there is nothing to register in the chart picker.
    expect(indexMetricNameServiceNameMapMock).not.toHaveBeenCalled();
  });
});

describe("MeasurementMetricWriter retention resolution", () => {
  test("uses the global config retention when set", async () => {
    findOneByMock.mockResolvedValue({
      monitorMetricRetentionInDays: 30,
    });

    const before: Date = OneUptimeDate.getCurrentDate();

    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["m"],
      points: [point({ metricName: "m" })],
      baseAttributes: {},
    });

    const retentionDate: Date = lastReplaceCall()["retentionDate"] as Date;
    const daysOut: number = OneUptimeDate.getDaysBetweenTwoDates(
      before,
      retentionDate,
    );

    expect(daysOut).toBe(30);
  });

  test("falls back to the default retention when global config is absent", async () => {
    findOneByMock.mockResolvedValue(null);

    const before: Date = OneUptimeDate.getCurrentDate();

    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["m"],
      points: [point({ metricName: "m" })],
      baseAttributes: {},
    });

    const retentionDate: Date = lastReplaceCall()["retentionDate"] as Date;
    const daysOut: number = OneUptimeDate.getDaysBetweenTwoDates(
      before,
      retentionDate,
    );

    expect(daysOut).toBe(DEFAULT_RETENTION_DAYS);
  });

  test("falls back to the default retention when the config lookup throws", async () => {
    findOneByMock.mockRejectedValue(new Error("db down"));

    const before: Date = OneUptimeDate.getCurrentDate();

    await MeasurementMetricWriter.write({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["m"],
      points: [point({ metricName: "m" })],
      baseAttributes: {},
    });

    const retentionDate: Date = lastReplaceCall()["retentionDate"] as Date;
    const daysOut: number = OneUptimeDate.getDaysBetweenTwoDates(
      before,
      retentionDate,
    );

    expect(daysOut).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("MeasurementMetricWriter.tombstoneAll", () => {
  test("no metric names: nothing is tombstoned", async () => {
    await MeasurementMetricWriter.tombstoneAll({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: [],
    });

    expect(tombstoneEntityMetricsMock).not.toHaveBeenCalled();
  });

  test("tombstones the full measurement-name list for the entity", async () => {
    await MeasurementMetricWriter.tombstoneAll({
      projectId: PROJECT_ID,
      primaryEntityId: ENTITY_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      allMeasurementMetricNames: ["a", "b"],
    });

    expect(tombstoneEntityMetricsMock).toHaveBeenCalledTimes(1);
    const arg: Record<string, unknown> = tombstoneEntityMetricsMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(arg["metricNames"]).toEqual(["a", "b"]);
    expect(arg["primaryEntityId"]).toBe(ENTITY_ID);
  });
});
