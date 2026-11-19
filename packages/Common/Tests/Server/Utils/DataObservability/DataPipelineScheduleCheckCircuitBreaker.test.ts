import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataPipelineScheduleCheck, {
  getCircuitBreakerValue,
} from "../../../../Server/Utils/DataObservability/DataPipelineScheduleCheck";
import OpenLineageIngest from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import { DataPipelineMetricName } from "../../../../Types/DataObservability/DataPipelineMetric";
import { MAX_LATENESS_WATCH_IN_SECONDS } from "../../../../Types/DataObservability/DataPipelineSchedule";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";

/*
 * A PIPELINE'S CIRCUIT BREAKER, EVERY FIVE MINUTES (#9683).
 *
 * The circuit breaker writes its answer as a metric as it gives it - 1 for
 * a stop, 0 for a go (DataCircuitBreaker) - but a pipeline stopped at
 * midnight asks again only at its next run. So every five minutes the
 * schedule check writes the answer each pipeline keeps: 1 while a stop is
 * kept, 0 once the circuit breaker said go or a run started, for a pipeline
 * whose circuit breaker was asked in the last thirty days. The recommended
 * monitor "Pipeline Stopped by Circuit Breaker" stays open while the
 * pipeline's page says it is stopped, and clears once it does not. Not
 * while Data Observability is switched off on the server: the circuit
 * breaker answers go then and keeps nothing, so a stop kept before is not
 * the pipeline's answer.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MINUTE: number = 60 * 1000;
const WATCH: number = MAX_LATENESS_WATCH_IN_SECONDS * 1000;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function pipelineWith(data: Partial<DataPipeline>): DataPipeline {
  const pipeline: DataPipeline = new DataPipeline();
  pipeline.id = ObjectID.generate();
  pipeline.projectId = PROJECT;
  pipeline.jobName = "load_orders";
  pipeline.jobNamespace = "airflow://prod";
  Object.assign(pipeline, data);
  return pipeline;
}

describe("getCircuitBreakerValue", () => {
  test("a stop kept writes 1", () => {
    expect(
      getCircuitBreakerValue({
        pipeline: pipelineWith({
          circuitBreakerCheckedAt: ago(10 * MINUTE),
          circuitBreakerStoppedAt: ago(10 * MINUTE),
        }),
        now: NOW,
      }),
    ).toEqual({
      metricName: DataPipelineMetricName.CircuitBreakerStopped,
      value: 1,
    });
  });

  test("a stop kept since days ago, asked again since, still writes 1", () => {
    expect(
      getCircuitBreakerValue({
        pipeline: pipelineWith({
          circuitBreakerCheckedAt: ago(5 * MINUTE),
          circuitBreakerStoppedAt: ago(3 * 24 * 60 * MINUTE),
        }),
        now: NOW,
      })?.value,
    ).toBe(1);
  });

  test("a go, or a run that started since, writes 0", () => {
    // Asked lately, and no stop kept: the go, or the run, cleared it.
    expect(
      getCircuitBreakerValue({
        pipeline: pipelineWith({
          circuitBreakerCheckedAt: ago(10 * MINUTE),
        }),
        now: NOW,
      }),
    ).toEqual({
      metricName: DataPipelineMetricName.CircuitBreakerStopped,
      value: 0,
    });
  });

  test("a stop kept for longer than thirty days is retired: 0, as Needs Attention retires it", () => {
    expect(
      getCircuitBreakerValue({
        pipeline: pipelineWith({
          circuitBreakerCheckedAt: ago(MINUTE),
          circuitBreakerStoppedAt: ago(WATCH + MINUTE),
        }),
        now: NOW,
      })?.value,
    ).toBe(0);
  });

  test("a circuit breaker never asked, or not asked for thirty days, writes nothing", () => {
    expect(
      getCircuitBreakerValue({ pipeline: pipelineWith({}), now: NOW }),
    ).toBeNull();
    expect(
      getCircuitBreakerValue({
        pipeline: pipelineWith({
          circuitBreakerCheckedAt: ago(WATCH + MINUTE),
          circuitBreakerStoppedAt: ago(WATCH + MINUTE),
        }),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("DataPipelineScheduleCheck.checkAll", () => {
  let queries: Array<Record<string, unknown>>;
  let rows: Array<JSONObject>;
  let offReason: ServerProductOffReason | null;

  // A pipeline that runs on time, and one its circuit breaker keeps stopped.
  const onTime: DataPipeline = pipelineWith({
    lastRunState: "COMPLETE",
    lastRunStartedAt: ago(30 * MINUTE),
    expectedRunIntervalInSeconds: 3600,
  });
  const stopped: DataPipeline = pipelineWith({
    lastRunState: "COMPLETE",
    lastRunStartedAt: ago(26 * 60 * MINUTE),
    circuitBreakerCheckedAt: ago(20 * MINUTE),
    circuitBreakerStoppedAt: ago(20 * MINUTE),
  });

  beforeEach(() => {
    queries = [];
    rows = [];
    offReason = null;

    jest
      .spyOn(MonitorMetricUtil, "getRetentionDays")
      .mockResolvedValue(15 as never);
    jest
      .spyOn(ServerProducts, "getOffReasonOfServerWork")
      .mockImplementation((async (product: ProductKey) => {
        return product === ProductKey.DataObservability ? offReason : null;
      }) as never);
    jest.spyOn(DataPipelineService, "findBy").mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      queries.push(data.query);

      // The schedule pass reads the pipelines started lately, the circuit breaker's those asked lately.
      return "circuitBreakerCheckedAt" in data.query ? [stopped] : [onTime];
    }) as never);
    jest.spyOn(OpenLineageIngest, "writeMetricRows").mockImplementation((async (
      _projectId: ObjectID,
      written: Array<JSONObject>,
    ) => {
      rows.push(...written);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function namesAndValues(): Array<string> {
    return rows.map((row: JSONObject): string => {
      return `${String(row["primaryEntityId"]) === stopped.id!.toString() ? "stopped" : "on time"}: ${String(row["name"])} = ${String(row["value"])}`;
    });
  }

  test("writes each asked pipeline's kept answer beside the schedule's metrics", async () => {
    const written: number = await DataPipelineScheduleCheck.checkAll(NOW);

    expect(namesAndValues()).toEqual([
      `on time: ${DataPipelineMetricName.OverdueSeconds} = 0`,
      `stopped: ${DataPipelineMetricName.CircuitBreakerStopped} = 1`,
    ]);
    expect(written).toBe(2);

    // Each pass reads only what has been seen in the last thirty days.
    expect(queries).toHaveLength(2);
    expect(Object.keys(queries[0]!)).toEqual(["lastRunStartedAt"]);
    expect(Object.keys(queries[1]!)).toEqual(["circuitBreakerCheckedAt"]);
  });

  test("writes nothing of the circuit breaker while Data Observability is switched off, and the schedule's metrics as before", async () => {
    offReason = ServerProductOffReason.SwitchedOff;

    const written: number = await DataPipelineScheduleCheck.checkAll(NOW);

    expect(namesAndValues()).toEqual([
      `on time: ${DataPipelineMetricName.OverdueSeconds} = 0`,
    ]);
    expect(written).toBe(1);
    expect(queries).toHaveLength(1);
    expect(Object.keys(queries[0]!)).toEqual(["lastRunStartedAt"]);
  });
});
