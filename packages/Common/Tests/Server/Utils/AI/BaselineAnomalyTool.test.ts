import { BaselineAnomalyTool } from "../../../../Server/Utils/AI/Toolbox/MetricTools";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MetricBaselineService from "../../../../Server/Services/MetricBaselineService";
import MetricService from "../../../../Server/Services/MetricService";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import ObjectID from "../../../../Types/ObjectID";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * baseline_anomaly judges a metric's recent average against its learned
 * hour-of-week baseline band (mean ± sigma·stddev — the same math the anomaly
 * monitors use via sigmaForSensitivity). These tests mock the baseline and
 * metric services (no ClickHouse) to lock in:
 *   (a) missing/unreliable baselines report "insufficient baseline data" and
 *       never render a normal/anomalous verdict (a missing baseline must not
 *       read as "not anomalous");
 *   (b) above-band / below-band / within-band classification at Medium (3σ);
 *   (c) a metric with no recent data points is flagged as possibly having
 *       stopped reporting, not judged normal;
 *   (d) a zero-stddev baseline still classifies (band collapses to the mean).
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

function mockBaseline(data: {
  mean: number;
  stddev: number;
  sampleCount?: number;
  isReliable?: boolean;
}): void {
  jest.spyOn(MetricBaselineService, "getBaseline").mockResolvedValue({
    sampleCount: data.sampleCount ?? 50,
    mean: data.mean,
    stddev: data.stddev,
    median: data.mean,
    p95: data.mean + 2 * data.stddev,
    minObserved: data.mean - 3 * data.stddev,
    maxObserved: data.mean + 3 * data.stddev,
    isReliable: data.isReliable ?? true,
    windowDays: 14,
    hourOfWeek: 10,
  });
}

function mockCurrentValues(values: Array<number>): void {
  jest.spyOn(MetricService, "aggregateBy").mockResolvedValue({
    data: values.map((value: number) => {
      return { timestamp: new Date(), value };
    }),
  } as unknown as AggregatedResult);
}

function mockEmptyBand(): void {
  jest.spyOn(MetricBaselineService, "getBandSeries").mockResolvedValue([]);
}

describe("BaselineAnomalyTool", () => {
  beforeEach(() => {
    // Default: project-wide telemetry access (null = unrestricted).
    jest
      .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("requires metricName", async () => {
    await expect(BaselineAnomalyTool.execute({}, ctx)).rejects.toThrow(
      "metricName is required",
    );
  });

  test("rejects an unparseable atTime", async () => {
    await expect(
      BaselineAnomalyTool.execute(
        { metricName: "cpu.usage", atTime: "yesterday-ish" },
        ctx,
      ),
    ).rejects.toThrow("not a valid ISO 8601 timestamp");
  });

  test("no baseline reports insufficient data and never queries the metric", async () => {
    jest.spyOn(MetricBaselineService, "getBaseline").mockResolvedValue(null);
    jest.spyOn(MetricBaselineService, "getCoverage").mockResolvedValue({
      totalSamples: 3,
      oldestDay: new Date(),
    });
    const aggregateBy: jest.SpyInstance = jest.spyOn(
      MetricService,
      "aggregateBy",
    );

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("insufficient baseline data");
    expect(result.dataForLlm).not.toContain("ANOMALOUS");
    expect(aggregateBy).not.toHaveBeenCalled();
  });

  test("unreliable baseline (too few samples) also reports insufficient data", async () => {
    mockBaseline({ mean: 100, stddev: 10, sampleCount: 2, isReliable: false });
    jest.spyOn(MetricBaselineService, "getCoverage").mockResolvedValue({
      totalSamples: 2,
      oldestDay: null,
    });

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("insufficient baseline data");
    expect(result.dataForLlm).toContain("only 2 sample(s)");
  });

  test("value above the 3-sigma band is anomalous (above)", async () => {
    mockBaseline({ mean: 100, stddev: 10 });
    mockCurrentValues([150]);
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("ANOMALOUS — above");
  });

  test("value below the 3-sigma band is anomalous (below)", async () => {
    mockBaseline({ mean: 100, stddev: 10 });
    mockCurrentValues([30]);
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("ANOMALOUS — below");
  });

  test("value inside the band is normal", async () => {
    mockBaseline({ mean: 100, stddev: 10 });
    mockCurrentValues([120]);
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("normal — within the expected range");
  });

  test("High sensitivity (2 sigma) flags what Medium would call normal", async () => {
    mockBaseline({ mean: 100, stddev: 10 });
    mockCurrentValues([125]); // z = 2.5: inside 3σ, outside 2σ
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage", sensitivity: "High" },
      ctx,
    );

    expect(result.dataForLlm).toContain("ANOMALOUS — above");
  });

  test("no recent data points is flagged as possibly stopped reporting", async () => {
    mockBaseline({ mean: 100, stddev: 10 });
    mockCurrentValues([]);
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("STOPPED reporting");
    expect(result.dataForLlm).not.toContain("normal — within");
  });

  test("zero-stddev baseline refuses to classify, matching the anomaly monitors", async () => {
    mockBaseline({ mean: 100, stddev: 0 });
    mockCurrentValues([101]);
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage" },
      ctx,
    );

    expect(result.dataForLlm).toContain("cannot judge");
    expect(result.dataForLlm).toContain("zero variance");
    expect(result.dataForLlm).not.toContain("ANOMALOUS");
  });

  test("a label-scoped user without entityId is refused (baseline SQL skips the owned-scope filter)", async () => {
    jest
      .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
      .mockResolvedValue([ObjectID.generate()]);
    const getBaseline: jest.SpyInstance = jest.spyOn(
      MetricBaselineService,
      "getBaseline",
    );

    await expect(
      BaselineAnomalyTool.execute({ metricName: "cpu.usage" }, ctx),
    ).rejects.toThrow("scoped to specific services");
    expect(getBaseline).not.toHaveBeenCalled();
  });

  test("a label-scoped user asking about another service's entity is refused", async () => {
    jest
      .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
      .mockResolvedValue([ObjectID.generate()]);

    await expect(
      BaselineAnomalyTool.execute(
        {
          metricName: "cpu.usage",
          entityId: ObjectID.generate().toString(),
        },
        ctx,
      ),
    ).rejects.toThrow("scoped to specific services");
  });

  test("a label-scoped user pinned to their own service proceeds", async () => {
    const ownServiceId: ObjectID = ObjectID.generate();
    jest
      .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
      .mockResolvedValue([ownServiceId]);
    mockBaseline({ mean: 100, stddev: 10 });
    mockCurrentValues([120]);
    mockEmptyBand();

    const result: { dataForLlm: string } = await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage", entityId: ownServiceId.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("normal — within the expected range");
  });
});
