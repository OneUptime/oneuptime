import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
} from "Common/Types/Probe/ProbeApiIngestResponse";
import { getDockerSwarmAlertTemplateById } from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Node Not Ready and Service Replicas Mismatch, from the readings the
 * Docker Swarm agent's poller sends to the verdict the worker reaches.
 *
 * Swarm had no alert for a node that went down or a service that ran short:
 * the agent sent only docker_stats' container series, and a down node's
 * containers simply stop reporting. From files 0.161.3 the poller reads
 * `docker node ls` and `docker service ls` from a manager every minute and
 * sends, per node, docker.swarm.node.ready (1 while ready, else 0) and, per
 * replicated or global service, docker.swarm.service.replicas.desired and
 * .running - each on a resource named `docker.swarm.node.name` /
 * `docker.swarm.service.name`, which the collector stamps with the
 * cluster's name (agents/DockerSwarmAgent/inventory-snapshot.sh, metrics()).
 *
 * Driven through the worker's real Docker Swarm read and the real criteria
 * evaluator, over rows folded per minute as ClickHouse folds them
 * (SqlGroupedFold).
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { monitorDockerSwarm } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  FoldedReadArgs,
  StoredMetricRow,
  foldRowsAsSqlRead,
} from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const MINUTE: number = 60_000;
const WINDOW_END_MS: number = Date.UTC(2026, 10, 2, 12, 0, 0);

const CLUSTER: string = "swarm-prod";
const CLUSTER_KEY: string = "resource.docker.swarm.cluster.name";
const NODE_KEY: string = "resource.docker.swarm.node.name";
const SERVICE_KEY: string = "resource.docker.swarm.service.name";

const NODE_READY: string = "docker.swarm.node.ready";
const DESIRED: string = "docker.swarm.service.replicas.desired";
const RUNNING: string = "docker.swarm.service.replicas.running";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const templateArgs: {
  clusterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  clusterIdentifier: CLUSTER,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: CLUSTER,
};

interface AggregateArgs extends FoldedReadArgs {
  query: { name: string; attributes?: Dictionary<unknown> };
  startTimestamp: Date;
  endTimestamp: Date;
}

let reads: Array<AggregateArgs> = [];

// Every read: the stored rows of its metric its filters select, in its window, folded per minute.
function givenStored(rows: Dictionary<Array<StoredMetricRow>>): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: AggregateArgs = args as AggregateArgs;
    reads.push(read);

    const selected: Array<StoredMetricRow> = (
      rows[read.query.name] || []
    ).filter((row: StoredMetricRow): boolean => {
      return (
        row.time.getTime() >= read.startTimestamp.getTime() &&
        row.time.getTime() <= read.endTimestamp.getTime() &&
        Object.entries(read.query.attributes || {}).every(
          ([key, value]: [string, unknown]): boolean => {
            if (value instanceof NotNull) {
              return typeof row.attributes[key] === "string";
            }
            return row.attributes[key] === value;
          },
        )
      );
    });

    return foldRowsAsSqlRead(selected, read);
  });
}

/*
 * The poller's one reading a minute, at :05 past each minute, for the
 * `minutes` before the window's end: `valueAt(minutesBeforeEnd)`.
 */
function everyMinute(input: {
  minutes: number;
  attributes: JSONObject;
  valueAt: (minutesBeforeEnd: number) => number;
}): Array<StoredMetricRow> {
  const rows: Array<StoredMetricRow> = [];
  for (let before: number = input.minutes; before >= 1; before--) {
    rows.push({
      time: new Date(WINDOW_END_MS - before * MINUTE + 5_000),
      value: input.valueAt(before),
      attributes: { [CLUSTER_KEY]: CLUSTER, ...input.attributes },
    });
  }
  return rows;
}

function nodeRows(
  node: string,
  valueAt: (minutesBeforeEnd: number) => number,
  cluster: string = CLUSTER,
): Array<StoredMetricRow> {
  return everyMinute({
    minutes: 20,
    attributes: {
      [CLUSTER_KEY]: cluster,
      [NODE_KEY]: node,
      "resource.docker.swarm.node.role": "worker",
    },
    valueAt,
  });
}

function serviceRows(
  service: string,
  desired: number,
  runningAt: (minutesBeforeEnd: number) => number,
): { desired: Array<StoredMetricRow>; running: Array<StoredMetricRow> } {
  const attributes: JSONObject = {
    [SERVICE_KEY]: service,
    "resource.docker.swarm.service.mode": "replicated",
  };
  return {
    desired: everyMinute({
      minutes: 20,
      attributes,
      valueAt: (): number => {
        return desired;
      },
    }),
    running: everyMinute({ minutes: 20, attributes, valueAt: runningAt }),
  };
}

interface Verdict {
  fires: boolean;
  recovers: boolean;
}

async function judge(input: {
  templateId: string;
  labelKey: string;
  rows: Dictionary<Array<StoredMetricRow>>;
}): Promise<{
  verdicts: Dictionary<Verdict>;
  response: MetricMonitorResponse;
}> {
  givenStored(input.rows);
  const step: MonitorStep = getDockerSwarmAlertTemplateById(
    input.templateId,
  )!.getMonitorStep(templateArgs);

  const response: MetricMonitorResponse = await monitorDockerSwarm({
    monitorStep: step,
    monitorId: monitorId,
    projectId: projectId,
    evaluateUntil: new Date(WINDOW_END_MS),
  });

  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  const firingId: string = instances[0]!.data!.id!.toString();
  const recoveringId: string =
    instances[instances.length - 1]!.data!.id!.toString();

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId.toString();
  monitor.monitorType = MonitorType.DockerSwarm;
  monitor.name = CLUSTER;

  const result: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: { monitorId: monitorId, rootCause: null },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });

  const verdicts: Dictionary<Verdict> = {};
  for (const series of response.seriesBreakdown || []) {
    verdicts[String(series.labels[input.labelKey] ?? "")] = {
      fires: false,
      recovers: false,
    };
  }
  for (const matched of (result.matchedCriteria ||
    []) as Array<MatchedCriteriaResult>) {
    const key: keyof Verdict | null =
      matched.criteriaId === firingId
        ? "fires"
        : matched.criteriaId === recoveringId
          ? "recovers"
          : null;
    if (!key) {
      continue;
    }
    for (const match of matched.perSeriesMatches) {
      const name: string = String((match.labels || {})[input.labelKey] ?? "");
      const verdict: Verdict = verdicts[name] || {
        fires: false,
        recovers: false,
      };
      verdict[key] = true;
      verdicts[name] = verdict;
    }
  }

  return { verdicts, response };
}

beforeEach(() => {
  reads = [];
  metricAggregateBy.mockReset();
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Node Not Ready", () => {
  test("a node not ready for the whole window fires; a ready one recovers", async () => {
    const { verdicts } = await judge({
      templateId: "docker-swarm-node-not-ready",
      labelKey: NODE_KEY,
      rows: {
        [NODE_READY]: [
          ...nodeRows("worker-1", (): number => {
            return 1;
          }),
          ...nodeRows("worker-2", (): number => {
            return 0;
          }),
        ],
      },
    });

    expect(verdicts).toEqual({
      "worker-1": { fires: false, recovers: true },
      "worker-2": { fires: true, recovers: false },
    });
  });

  test("a node down for two minutes of five, then ready again, does not fire", async () => {
    const { verdicts } = await judge({
      templateId: "docker-swarm-node-not-ready",
      labelKey: NODE_KEY,
      rows: {
        [NODE_READY]: nodeRows("worker-3", (before: number): number => {
          return before >= 4 && before <= 5 ? 0 : 1;
        }),
      },
    });

    expect(verdicts["worker-3"]!.fires).toBe(false);
  });

  test("a node that is ready again recovers: its 1 meets the recovery exactly (no 1.1 dead band)", async () => {
    const { verdicts } = await judge({
      templateId: "docker-swarm-node-not-ready",
      labelKey: NODE_KEY,
      rows: {
        [NODE_READY]: nodeRows("worker-2", (before: number): number => {
          return before > 5 ? 0 : 1;
        }),
      },
    });

    expect(verdicts["worker-2"]).toEqual({ fires: false, recovers: true });
  });

  test("it reads this swarm's nodes only, and every node: never tasks only", async () => {
    await judge({
      templateId: "docker-swarm-node-not-ready",
      labelKey: NODE_KEY,
      rows: {
        [NODE_READY]: [
          ...nodeRows("worker-1", (): number => {
            return 1;
          }),
          ...nodeRows(
            "other-node",
            (): number => {
              return 0;
            },
            "swarm-staging",
          ),
        ],
      },
    });

    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.query.attributes?.[CLUSTER_KEY]).toBe(CLUSTER);
      expect(
        Object.values(read.query.attributes || {}).some((value: unknown) => {
          return value instanceof NotNull;
        }),
      ).toBe(false);
      expect(read.groupByAttributeKeys).toEqual([NODE_KEY]);
    }
  });
});

describe("Service Replicas Mismatch", () => {
  test("a service short of a replica for 15 minutes fires; a full one recovers", async () => {
    const web: {
      desired: Array<StoredMetricRow>;
      running: Array<StoredMetricRow>;
    } = serviceRows("shop_web", 3, (): number => {
      return 2;
    });
    const api: {
      desired: Array<StoredMetricRow>;
      running: Array<StoredMetricRow>;
    } = serviceRows("shop_api", 2, (): number => {
      return 2;
    });

    const { verdicts } = await judge({
      templateId: "docker-swarm-service-replicas-mismatch",
      labelKey: SERVICE_KEY,
      rows: {
        [DESIRED]: [...web.desired, ...api.desired],
        [RUNNING]: [...web.running, ...api.running],
      },
    });

    expect(verdicts).toEqual({
      shop_web: { fires: true, recovers: false },
      shop_api: { fires: false, recovers: true },
    });
  });

  test("a rolling update that runs short for six minutes does not page", async () => {
    const web: {
      desired: Array<StoredMetricRow>;
      running: Array<StoredMetricRow>;
    } = serviceRows("shop_web", 3, (before: number): number => {
      return before >= 4 && before <= 9 ? 2 : 3;
    });

    const { verdicts } = await judge({
      templateId: "docker-swarm-service-replicas-mismatch",
      labelKey: SERVICE_KEY,
      rows: { [DESIRED]: web.desired, [RUNNING]: web.running },
    });

    expect(verdicts["shop_web"]!.fires).toBe(false);
  });

  test("a service none of whose replicas run fires, and the shortfall is the formula's", async () => {
    const db: {
      desired: Array<StoredMetricRow>;
      running: Array<StoredMetricRow>;
    } = serviceRows("shop_db", 1, (): number => {
      return 0;
    });

    const { verdicts, response } = await judge({
      templateId: "docker-swarm-service-replicas-mismatch",
      labelKey: SERVICE_KEY,
      rows: { [DESIRED]: db.desired, [RUNNING]: db.running },
    });

    expect(verdicts["shop_db"]!.fires).toBe(true);
    // Both series read per service, so the formula pairs each service's two.
    for (const read of reads) {
      expect(read.groupByAttributeKeys).toEqual([SERVICE_KEY]);
    }
    expect(response.metricResult.length).toBe(3);
  });
});
