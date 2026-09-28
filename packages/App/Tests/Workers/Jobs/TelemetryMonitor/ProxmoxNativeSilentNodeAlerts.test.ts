import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "Common/Types/Probe/ProbeApiIngestResponse";
import {
  ProxmoxAlertTemplate,
  getProxmoxAlertTemplateById,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import {
  PROXMOX_INFERRED_ATTRIBUTE,
  PROXMOX_INFERRED_NOT_REPORTING,
  PROXMOX_SIBLING_REPORT_SCOPE_NAME,
} from "Common/Server/Utils/Telemetry/ProxmoxNativePush";
import {
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  ProxmoxNodeLiveness,
  clearProxmoxNodeRosterCache,
  isAliveProxmoxNode,
  isEligibleProxmoxReporter,
  isProxmoxSilentNodeDetectionEnabled,
  nextProxmoxNodeLiveness,
  parseProxmoxNodeLiveness,
} from "Common/Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import { monitorProxmox } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  NativePushKind,
  NodeStatusPushRecord,
  ProxmoxNativeClusterSimulator,
  SimulatedAggregateByArgs,
  SimulatedCleanupRun,
  SimulatedFindByArgs,
  SimulatedIngestOutage,
  SimulatedMetricRow,
  SimulatedMetricTable,
  SimulatedNodeRow,
  SimulatedProcessingBursts,
  SimulatedRedis,
  TimeRange,
} from "./ProxmoxNativeClusterSimulator";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Node Offline and Cluster Quorum at Risk on the Proxmox VE native
 * OpenTelemetry push — the alert math end to end.
 * ------------------------------------------------------------------
 *
 * On the native push a dead node goes quiet; its live siblings report
 * it (pve_up = 0 plus a pve_node_info weight of D ÷ L per push) so the
 * UNCHANGED templates fire. This suite runs whole clusters for tens of
 * simulated minutes and asks the real monitor, every 30 s, what it
 * would do.
 *
 * REAL (production code, unmodified):
 *   - the templates: getProxmoxAlertTemplateById("pve-node-offline" /
 *     "pve-quorum-risk").getMonitorStep(...), criteria included;
 *   - the ingest-side translation: normalizeProxmoxNativePushInPlace,
 *     readProxmoxNativeNodeStatus, recordProxmoxNodePushAndFindSilentNodes
 *     (so nextProxmoxNodeLiveness, isAliveProxmoxNode,
 *     isEligibleProxmoxReporter, decideProxmoxSilentNodes and the 30 s
 *     roster cache),
 *     appendProxmoxSiblingReportsInPlace / splitProxmoxSiblingInfoWeights,
 *     isProxmoxSilentNodeDetectionEnabled, TelemetryUtil's attribute
 *     flattening;
 *   - the worker: monitorProxmox — Node Offline through the grouped
 *     raw-row path (findBy LIMIT 10000 time DESC →
 *     aggregatePerSeriesFromRawMetrics Min per id per minute →
 *     buildSeriesBreakdown), Quorum through MetricService.aggregateBy
 *     (Sum per minute) → appendFormulaResults / MetricFormulaEvaluator;
 *     the affected-resource scans; unit handling;
 *   - the verdict: MonitorCriteriaEvaluator.processMonitorStep, the
 *     call MonitorResource makes on the worker's response (per-series
 *     fan-out, AllValues over the window's minute buckets, first-match
 *     status).
 *
 * STAND-INS (ProxmoxNativeClusterSimulator.ts):
 *   - the Proxmox nodes (pvestatd pushing node / qemu / lxc / storage
 *     every ~10 s with phase, jitter, clock skew and network delay), and
 *     when OneUptime processes each request (at once, after an outage,
 *     or in bursts while it is behind on one node);
 *   - OtelMetricsIngestService's per-block order, mirrored step for step
 *     (its appendProxmoxSilentNodeReports is private);
 *   - MetricService.findBy / aggregateBy: an in-memory Metric table
 *     that filters and aggregates like the ClickHouse statements do;
 *   - MetricTypeService.findBy: no declared units (the derived pve_*
 *     series carry none);
 *   - GlobalCache.getString / getStrings / setString: an in-memory Redis
 *     with EX expiry;
 *   - the inventory's Node rows (lastSeenAt, isNativePush — the roster
 *     source), the cluster's heartbeat, and the Proxmox:CleanupStaleResources
 *     cron every 5 minutes: markDisconnectedClusters, then
 *     deleteStaleForCluster's predicate — native Node rows kept for the
 *     retention window — with the service's real cutoff helpers;
 *   - the clock: Date is faked and moved to each request's receive time,
 *     then to each evaluation time.
 *
 * NOT covered here: the inventory Offline flip (markNodesNotReporting),
 * the SQL of the prune itself (ProxmoxResourceService.test.ts), the
 * pages, what MonitorResource does with a verdict (incidents, alerts,
 * auto-resolve), and the ingest service's own batching / routing
 * (OtelMetricsIngestProxmoxNativePush.test.ts covers the service).
 *
 * Every evaluation is also checked against an ORACLE computed from the
 * push log alone — which node pushed when (its own point time, and when
 * OneUptime processed it) — and the cron's prunes, in two steps. First
 * the design's rules are replayed over the log (replayReports): which
 * pushes report which siblings, and with what L — every LIVE node
 * reports, once the cluster has an ESTABLISHED node (a streak of 2
 * minutes, still unbroken now), with L = the live nodes — and every
 * push's actual report must equal the replay's. Then the closed form: each
 * push adds 1 to Σpve_up and 1 + ceil(D·65536/L)/65536 to
 * Σpve_node_info; a node's minute is down when its lowest pve_up in
 * that minute is 0. The oracle applies the templates' own thresholds,
 * read from the criteria (Quorum's healthy side is > 55 %, the recovery
 * band). The evaluator's verdict and its availability numbers must
 * equal the oracle's exactly.
 *
 * Seeds are fixed; the scenario assertions were also run against 24
 * other seed sets while writing this, to be sure none of them holds by
 * luck of the jitter.
 * ------------------------------------------------------------------
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

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const MINUTE_MS: number = 60_000;
// Both templates evaluate RollingTime.Past5Minutes.
const WINDOW_MS: number = 5 * MINUTE_MS;
const EVALUATION_STEP_MS: number = 30_000;
const SIM_START_MS: number = Date.UTC(2026, 8, 28, 12, 0, 0);
// Evaluations land 7 s past the minute and the half minute.
const FIRST_EVALUATION_MS: number = SIM_START_MS + WINDOW_MS + 7_000;
// When a node "dies" (true time); its last push is the one before.
const DEATH_MS: number = SIM_START_MS + 20 * MINUTE_MS;
const NEVER_MS: number = Number.MAX_SAFE_INTEGER;

const NODE_OFFLINE: string = "pve-node-offline";
const QUORUM_RISK: string = "pve-quorum-risk";

// ProxmoxNativeNodeLiveness's Redis namespace (module-private there).
const LIVENESS_NAMESPACE: string = "proxmox-native-node-live";

const projectId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();

const templateArgs: {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "PVE",
};

// The one Redis and the Metric table the current scenario ingests into.
const redis: SimulatedRedis = new SimulatedRedis((): number => {
  return Date.now();
});
let activeTable: SimulatedMetricTable | null = null;

function requireTable(): SimulatedMetricTable {
  if (!activeTable) {
    throw new Error("No scenario is running");
  }
  return activeTable;
}

beforeAll(() => {
  /*
   * Only Date is faked: it is the one clock everything reads — the
   * receive clock of the ingest, Redis expiry, the roster cache, and the
   * monitor's rolling window.
   */
  jest.useFakeTimers({
    doNotFake: [
      "nextTick",
      "performance",
      "hrtime",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  jest.setSystemTime(SIM_START_MS);

  metricFindBy.mockImplementation(async (args: unknown) => {
    return requireTable().findBy(args as SimulatedFindByArgs);
  });
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    return requireTable().aggregateBy(args as SimulatedAggregateByArgs);
  });
  metricTypeFindBy.mockResolvedValue([]);

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        return redis.getString(namespace, key);
      },
    );
  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(
      async (
        namespace: string,
        keys: Array<string>,
      ): Promise<Array<string | null>> => {
        return redis.getStrings(namespace, keys);
      },
    );
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number | undefined } | undefined,
      ): Promise<void> => {
        redis.setString(namespace, key, value, options);
      },
    );
});

afterAll(() => {
  activeTable = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---- one evaluation of one template ---------------------------------

interface FormulaPoint {
  timestampMs: number;
  value: number;
}

interface TemplateEvaluation {
  // The monitor's status criteria is the template's offline criteria.
  fires: boolean;
  // The monitor's status criteria is the template's healthy criteria.
  healthy: boolean;
  // Grouped (Node Offline): the node ids each criteria matched.
  offlineIds: Array<string>;
  healthyIds: Array<string>;
  // How many series the grouped worker path produced.
  seriesCount: number;
  // Quorum: node availability % per minute bucket, oldest first.
  formulaPoints: Array<FormulaPoint>;
  rootCause: string;
}

interface Tick {
  atMs: number;
  nodeOffline: TemplateEvaluation;
  quorum: TemplateEvaluation;
}

function idsMatchedBy(
  result: ProbeApiIngestResponse,
  criteriaId: string,
): Array<string> {
  const matched: MatchedCriteriaResult | undefined = (
    result.matchedCriteria || []
  ).find((entry: MatchedCriteriaResult) => {
    return entry.criteriaId === criteriaId;
  });
  return (matched?.perSeriesMatches || [])
    .map((match: PerSeriesCriteriaMatch) => {
      return String(match.labels["id"]);
    })
    .sort();
}

/*
 * What the telemetry worker does for one monitor on one tick —
 * processTelemetryMonitorEvaluationFromQueue minus the Monitor lookup:
 * monitorProxmox, then MonitorCriteriaEvaluator.processMonitorStep on
 * its response. A fresh step per tick, as the worker loads it from the
 * database each time.
 */
async function evaluateTemplate(data: {
  templateId: string;
  clusterName: string;
}): Promise<TemplateEvaluation> {
  const template: ProxmoxAlertTemplate | undefined =
    getProxmoxAlertTemplateById(data.templateId);
  if (!template) {
    throw new Error(`${data.templateId} template missing`);
  }

  const monitorStep: MonitorStep = template.getMonitorStep({
    ...templateArgs,
    clusterIdentifier: data.clusterName,
  });
  const criteria: Array<MonitorCriteriaInstance> =
    monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || [];
  // buildProxmoxMonitorStep puts the offline criteria first.
  const offlineCriteriaId: string = String(criteria[0]?.data?.id);
  const healthyCriteriaId: string = String(criteria[1]?.data?.id);

  const response: MetricMonitorResponse = await monitorProxmox({
    monitorStep: monitorStep,
    monitorId: monitorId,
    projectId: projectId,
  });

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId.toString();
  monitor.projectId = projectId;
  monitor.monitorType = MonitorType.Proxmox;
  monitor.name = `${data.clusterName} - ${template.name}`;

  const result: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: { monitorId: monitorId, rootCause: null },
      evaluationSummary: {
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
      },
    });

  const queryCount: number =
    MonitorStep.getMetricsViewConfig(monitorStep)?.queryConfigs.length || 0;
  const formulaPoints: Array<FormulaPoint> = (
    response.metricResult[queryCount]?.data || []
  )
    .map((row: AggregatedModel) => {
      return {
        timestampMs: new Date(row.timestamp).getTime(),
        value: row.value,
      };
    })
    .sort((a: FormulaPoint, b: FormulaPoint) => {
      return a.timestampMs - b.timestampMs;
    });

  return {
    fires: result.criteriaMetId === offlineCriteriaId,
    healthy: result.criteriaMetId === healthyCriteriaId,
    offlineIds: idsMatchedBy(result, offlineCriteriaId),
    healthyIds: idsMatchedBy(result, healthyCriteriaId),
    seriesCount: response.seriesBreakdown?.length || 0,
    formulaPoints: formulaPoints,
    rootCause: result.rootCause || "",
  };
}

// ---- one scenario --------------------------------------------------

interface ScenarioInput {
  seed: number;
  nodeCount: number;
  durationMinutes: number;
  // Per node name: true-time ranges in which the node is down.
  downRanges?: Dictionary<Array<TimeRange>> | undefined;
  // Per node name: OneUptime processes its requests in bursts.
  processingBursts?: Dictionary<SimulatedProcessingBursts> | undefined;
  outage?: SimulatedIngestOutage | undefined;
  // Trims a big cluster: fewer requests per pass, fewer stored series.
  pushKinds?: Array<NativePushKind> | undefined;
  storedMetricNames?: Array<string> | undefined;
  evaluateFromMs?: number | undefined;
  // A counterfactual: the cron prunes without the native-Node keep.
  withoutNativeNodeKeep?: boolean | undefined;
}

interface ScenarioRun {
  clusterName: string;
  proxmoxClusterId: ObjectID;
  nodeNames: Array<string>;
  // PVE_NATIVE_NODE_SILENCE_DETECTION as the run saw it.
  silenceDetection: boolean;
  simulator: ProxmoxNativeClusterSimulator;
  table: SimulatedMetricTable;
  ticks: Array<Tick>;
  findByCalls: Array<SimulatedFindByArgs>;
  aggregateByCalls: Array<SimulatedAggregateByArgs>;
}

function nodeNamesOf(count: number): Array<string> {
  const names: Array<string> = [];
  for (let index: number = 1; index <= count; index++) {
    names.push(`pve${index}`);
  }
  return names;
}

async function runScenario(input: ScenarioInput): Promise<ScenarioRun> {
  const clusterName: string = `pve-sim-${input.seed}`;
  const proxmoxClusterId: ObjectID = ObjectID.generate();
  const nodeNames: Array<string> = nodeNamesOf(input.nodeCount);
  const table: SimulatedMetricTable = new SimulatedMetricTable(
    input.seed,
    input.storedMetricNames,
  );

  activeTable = table;
  redis.flushAll();
  clearProxmoxNodeRosterCache();
  metricFindBy.mockClear();
  metricAggregateBy.mockClear();
  jest.setSystemTime(SIM_START_MS);

  const simulator: ProxmoxNativeClusterSimulator =
    new ProxmoxNativeClusterSimulator({
      plan: {
        clusterName: clusterName,
        seed: input.seed,
        startMs: SIM_START_MS,
        endMs: SIM_START_MS + input.durationMinutes * MINUTE_MS,
        nodes: nodeNames.map((name: string) => {
          return {
            name: name,
            downRanges: input.downRanges?.[name],
            processingBursts: input.processingBursts?.[name],
          };
        }),
        outage: input.outage,
        pushKinds: input.pushKinds,
        withoutNativeNodeKeep: input.withoutNativeNodeKeep,
      },
      projectId: projectId,
      proxmoxClusterId: proxmoxClusterId,
      metricTable: table,
      redis: redis,
      setClock: (ms: number): void => {
        jest.setSystemTime(ms);
      },
    });

  const endMs: number = SIM_START_MS + input.durationMinutes * MINUTE_MS;
  const ticks: Array<Tick> = [];
  for (
    let atMs: number = input.evaluateFromMs ?? FIRST_EVALUATION_MS;
    atMs <= endMs;
    atMs += EVALUATION_STEP_MS
  ) {
    await simulator.advanceTo(atMs);
    jest.setSystemTime(atMs);
    ticks.push({
      atMs: atMs,
      nodeOffline: await evaluateTemplate({
        templateId: NODE_OFFLINE,
        clusterName: clusterName,
      }),
      quorum: await evaluateTemplate({
        templateId: QUORUM_RISK,
        clusterName: clusterName,
      }),
    });
  }

  return {
    clusterName: clusterName,
    proxmoxClusterId: proxmoxClusterId,
    nodeNames: nodeNames,
    silenceDetection: isProxmoxSilentNodeDetectionEnabled(),
    simulator: simulator,
    table: table,
    ticks: ticks,
    findByCalls: metricFindBy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as SimulatedFindByArgs;
    }),
    aggregateByCalls: metricAggregateBy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as SimulatedAggregateByArgs;
      },
    ),
  };
}

// ---- the oracle, step 1: who reports what, replayed from the push log

// ProxmoxNativeNodeLiveness's roster cache lifetime (module-private there).
const ROSTER_CACHE_TTL_MS: number = 30_000;

// What one node-status push reports under the design's rules.
interface ExpectedReport {
  // Sorted; empty when the push reports nothing.
  silentNodes: Array<string>;
  // L, the live nodes; 0 when the push reports nothing.
  reporterCount: number;
  // How long the reporter had been pushing without a gap (receive clock).
  reporterStreakMs: number;
}

// Whether one node's liveness makes the cluster ESTABLISHED at nowMs.
type EstablishedRule = (
  liveness: ProxmoxNodeLiveness | null,
  nowMs: number,
) => boolean;

/*
 * The ESTABLISHED rule before the streak also had to be unbroken NOW:
 * alive with a streak of at least SILENCE_MS, however old its last push.
 * Never the design — only for showing that a scenario would catch a
 * return to it.
 */
function isEstablishedByAnyLiveStreak(
  liveness: ProxmoxNodeLiveness | null,
  nowMs: number,
): boolean {
  return Boolean(
    liveness &&
      isAliveProxmoxNode(liveness, nowMs) &&
      nowMs - liveness.streakStartMs >= PROXMOX_NODE_SILENCE_MS,
  );
}

interface NodePrune {
  atMs: number;
  nodeName: string;
}

/*
 * The design's rules replayed over the push log, in the order OneUptime
 * processed it — no Redis, no roster cache, no decideProxmoxSilentNodes.
 * Each node's own state goes through the REAL per-node functions
 * (nextProxmoxNodeLiveness, isAliveProxmoxNode, and for ESTABLISHED
 * isEligibleProxmoxReporter — a streak of at least SILENCE_MS whose last
 * push is at most STREAK_GAP_MS old — unless `established` swaps in
 * another rule); the replay supplies what they are applied to and how
 * the cluster combines them:
 *   - a node's key lives SILENCE_MS after its last write, and is gone
 *     when Redis loses every key in an outage — a push with no key
 *     starts a new streak;
 *   - the roster: the inventory's Node rows as they stood when it was
 *     last loaded — every push loads it once the 30 s cache has run
 *     out, warming up or not — less the rows the cleanup cron pruned;
 *   - SILENT: a sibling in the roster, not alive, last seen before the
 *     reporter's own push time minus SILENCE_MS;
 *   - a push reports its silent siblings when it has any and the cluster
 *     has an established node — itself or any other; a live node still
 *     warming up reports too — with L = the live nodes among the roster
 *     and itself.
 */
function replayReports(
  run: ScenarioRun,
  established: EstablishedRule = isEligibleProxmoxReporter,
): Map<NodeStatusPushRecord, ExpectedReport> {
  const expected: Map<NodeStatusPushRecord, ExpectedReport> = new Map();
  const liveness: Map<string, ProxmoxNodeLiveness> = new Map();
  // The inventory's lastSeenAt per node, on the node's own clock.
  const lastSeenAt: Map<string, number> = new Map();
  let roster: Map<string, number> | null = null;
  let rosterLoadedAtMs: number = 0;
  const lostAtMs: Array<number> = [...run.simulator.livenessLostAtMs];
  const prunes: Array<NodePrune> = [];
  for (const cleanupRun of run.simulator.cleanupRuns) {
    for (const nodeName of cleanupRun.prunedNodes) {
      prunes.push({ atMs: cleanupRun.atMs, nodeName: nodeName });
    }
  }

  for (const push of run.simulator.nodeStatusPushes) {
    const nowMs: number = push.receiveMs;
    // Keys lost and rows pruned at an instant go after the pushes at it.
    while (lostAtMs.length > 0 && lostAtMs[0]! < nowMs) {
      liveness.clear();
      lostAtMs.shift();
    }
    while (prunes.length > 0 && prunes[0]!.atMs < nowMs) {
      lastSeenAt.delete(prunes[0]!.nodeName);
      prunes.shift();
    }

    // The node's key as Redis returns it: gone SILENCE_MS after its write.
    const keyOf: (nodeName: string) => ProxmoxNodeLiveness | null = (
      nodeName: string,
    ): ProxmoxNodeLiveness | null => {
      const entry: ProxmoxNodeLiveness | undefined = liveness.get(nodeName);
      return entry && nowMs - entry.lastPushMs < PROXMOX_NODE_SILENCE_MS
        ? entry
        : null;
    };

    const report: ExpectedReport = {
      silentNodes: [],
      reporterCount: 0,
      reporterStreakMs: 0,
    };

    if (run.silenceDetection) {
      const current: ProxmoxNodeLiveness = nextProxmoxNodeLiveness(
        keyOf(push.nodeName),
        nowMs,
      );
      liveness.set(push.nodeName, current);
      report.reporterStreakMs = nowMs - current.streakStartMs;

      if (!roster || nowMs > rosterLoadedAtMs + ROSTER_CACHE_TTL_MS) {
        roster = new Map(lastSeenAt);
        rosterLoadedAtMs = nowMs;
      }
      const rosterNow: Map<string, number> = roster;

      let liveCount: number = 0;
      let isEstablished: boolean = false;
      for (const nodeName of new Set<string>([
        ...rosterNow.keys(),
        push.nodeName,
      ])) {
        const entry: ProxmoxNodeLiveness | null = keyOf(nodeName);
        if (isAliveProxmoxNode(entry, nowMs)) {
          liveCount++;
        }
        if (established(entry, nowMs)) {
          isEstablished = true;
        }
      }

      const silentBeforeMs: number = push.pushTimeMs - PROXMOX_NODE_SILENCE_MS;
      const silentNodes: Array<string> = Array.from(rosterNow.keys())
        .filter((nodeName: string) => {
          return (
            nodeName !== push.nodeName &&
            !isAliveProxmoxNode(keyOf(nodeName), nowMs) &&
            rosterNow.get(nodeName)! < silentBeforeMs
          );
        })
        .sort();

      if (isEstablished && silentNodes.length > 0) {
        report.silentNodes = silentNodes;
        report.reporterCount = liveCount;
      }
    }

    expected.set(push, report);
    // The inventory fold runs after the report: newest point time wins.
    lastSeenAt.set(
      push.nodeName,
      Math.max(
        lastSeenAt.get(push.nodeName) ?? push.pushTimeMs,
        push.pushTimeMs,
      ),
    );
  }

  return expected;
}

function replayedReportOf(
  replay: Map<NodeStatusPushRecord, ExpectedReport>,
  push: NodeStatusPushRecord,
): ExpectedReport {
  const report: ExpectedReport | undefined = replay.get(push);
  if (!report) {
    throw new Error(`${push.nodeName}'s push was not replayed`);
  }
  return report;
}

// Every push reported exactly what the replayed rules say it should.
function expectReportsMatchReplay(
  run: ScenarioRun,
  replay: Map<NodeStatusPushRecord, ExpectedReport>,
): void {
  // Collected, then asserted once: thousands of pushes on a big cluster.
  const problems: Array<string> = [];
  for (const push of run.simulator.nodeStatusPushes) {
    const expected: ExpectedReport = replayedReportOf(replay, push);
    const actual: string = `${push.silentNodes.join(",")} / L=${push.reporterCount}`;
    const wanted: string = `${expected.silentNodes.join(",")} / L=${expected.reporterCount}`;
    if (actual !== wanted) {
      problems.push(
        `${push.nodeName} at ${new Date(push.receiveMs).toISOString()}: reported ${actual}, expected ${wanted}`,
      );
    }
  }
  expect({ count: problems.length, first: problems.slice(0, 20) }).toEqual({
    count: 0,
    first: [],
  });
}

// ---- the oracle, step 2: the design's closed form over the reports ---

// One criteria's comparison, read from the template itself.
interface CriteriaThreshold {
  filterType: FilterType | undefined;
  value: number;
  overTime: EvaluateOverTimeType | undefined;
}

interface TemplateThresholds {
  offline: CriteriaThreshold;
  healthy: CriteriaThreshold;
}

function thresholdsOf(templateId: string): TemplateThresholds {
  const template: ProxmoxAlertTemplate | undefined =
    getProxmoxAlertTemplateById(templateId);
  if (!template) {
    throw new Error(`${templateId} template missing`);
  }
  const criteria: Array<MonitorCriteriaInstance> =
    template.getMonitorStep({
      ...templateArgs,
      clusterIdentifier: "thresholds",
    }).data?.monitorCriteria.data?.monitorCriteriaInstanceArray || [];

  const read: (
    instance: MonitorCriteriaInstance | undefined,
  ) => CriteriaThreshold = (
    instance: MonitorCriteriaInstance | undefined,
  ): CriteriaThreshold => {
    const filters: Array<CriteriaFilter> = instance?.data?.filters || [];
    if (filters.length !== 1) {
      throw new Error(`${templateId}: expected one filter per criteria`);
    }
    return {
      filterType: filters[0]!.filterType,
      value: Number(filters[0]!.value),
      overTime: filters[0]!.metricMonitorOptions?.metricAggregationType,
    };
  };

  return { offline: read(criteria[0]), healthy: read(criteria[1]) };
}

const NODE_OFFLINE_THRESHOLDS: TemplateThresholds = thresholdsOf(NODE_OFFLINE);
const QUORUM_THRESHOLDS: TemplateThresholds = thresholdsOf(QUORUM_RISK);

function meets(value: number, threshold: CriteriaThreshold): boolean {
  switch (threshold.filterType) {
    case FilterType.LessThan:
      return value < threshold.value;
    case FilterType.LessThanOrEqualTo:
      return value <= threshold.value;
    case FilterType.GreaterThan:
      return value > threshold.value;
    case FilterType.GreaterThanOrEqualTo:
      return value >= threshold.value;
    default:
      throw new Error(`The oracle does not model ${threshold.filterType}`);
  }
}

// AllValues: every minute bucket of the window meets it, and there is one.
function allMeet(values: Array<number>, threshold: CriteriaThreshold): boolean {
  return (
    values.length > 0 &&
    values.every((value: number) => {
      return meets(value, threshold);
    })
  );
}

function minuteOf(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

// Node-status pushes whose rows the window at `atMs` holds.
function pushesInWindow(
  run: ScenarioRun,
  atMs: number,
): Array<NodeStatusPushRecord> {
  const startMs: number = atMs - WINDOW_MS;
  return run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
    return (
      push.receiveMs <= atMs &&
      push.pushTimeMs >= startMs &&
      push.pushTimeMs <= atMs
    );
  });
}

/*
 * D ÷ L rounded UP to whole 2^-16 units: the pve_node_info one report
 * adds (L·weight >= D, so a cluster exactly half down never reads above
 * 50 %).
 */
function reportInfoWeight(report: {
  silentNodes: Array<string>;
  reporterCount: number;
}): number {
  if (report.silentNodes.length === 0) {
    return 0;
  }
  return (
    Math.ceil((report.silentNodes.length * 65536) / report.reporterCount) /
    65536
  );
}

interface ExpectedQuorum {
  points: Array<FormulaPoint>;
  fires: boolean;
  healthy: boolean;
}

function expectedQuorum(data: {
  run: ScenarioRun;
  replay: Map<NodeStatusPushRecord, ExpectedReport>;
  atMs: number;
}): ExpectedQuorum {
  const buckets: Map<number, { online: number; total: number }> = new Map();
  for (const push of pushesInWindow(data.run, data.atMs)) {
    const bucketMs: number = minuteOf(push.pushTimeMs);
    const bucket: { online: number; total: number } = buckets.get(bucketMs) || {
      online: 0,
      total: 0,
    };
    bucket.online += 1;
    bucket.total += 1 + reportInfoWeight(replayedReportOf(data.replay, push));
    buckets.set(bucketMs, bucket);
  }

  const points: Array<FormulaPoint> = Array.from(buckets.entries())
    .map(
      ([timestampMs, bucket]: [number, { online: number; total: number }]) => {
        return {
          timestampMs: timestampMs,
          value: (bucket.online / bucket.total) * 100,
        };
      },
    )
    .sort((a: FormulaPoint, b: FormulaPoint) => {
      return a.timestampMs - b.timestampMs;
    });

  const values: Array<number> = points.map((point: FormulaPoint) => {
    return point.value;
  });
  const fires: boolean = allMeet(values, QUORUM_THRESHOLDS.offline);

  return {
    points: points,
    fires: fires,
    // Ungrouped: the healthy criteria is only reached when offline is not met.
    healthy: !fires && allMeet(values, QUORUM_THRESHOLDS.healthy),
  };
}

interface ExpectedNodeOffline {
  offlineIds: Array<string>;
  healthyIds: Array<string>;
}

function expectedNodeOffline(data: {
  run: ScenarioRun;
  replay: Map<NodeStatusPushRecord, ExpectedReport>;
  atMs: number;
}): ExpectedNodeOffline {
  // id → minute → lowest pve_up in it.
  const lowest: Map<string, Map<number, number>> = new Map();
  const note: (id: string, pushTimeMs: number, value: number) => void = (
    id: string,
    pushTimeMs: number,
    value: number,
  ): void => {
    const byMinute: Map<number, number> = lowest.get(id) || new Map();
    const bucketMs: number = minuteOf(pushTimeMs);
    const held: number | undefined = byMinute.get(bucketMs);
    byMinute.set(bucketMs, held === undefined ? value : Math.min(held, value));
    lowest.set(id, byMinute);
  };

  for (const push of pushesInWindow(data.run, data.atMs)) {
    note(`node/${push.nodeName}`, push.pushTimeMs, 1);
    for (const silentNode of replayedReportOf(data.replay, push).silentNodes) {
      note(`node/${silentNode}`, push.pushTimeMs, 0);
    }
  }

  const offlineIds: Array<string> = [];
  const healthyIds: Array<string> = [];
  for (const [id, byMinute] of lowest) {
    const minima: Array<number> = Array.from(byMinute.values());
    if (allMeet(minima, NODE_OFFLINE_THRESHOLDS.offline)) {
      offlineIds.push(id);
    }
    // Grouped: every criteria is evaluated for every series.
    if (allMeet(minima, NODE_OFFLINE_THRESHOLDS.healthy)) {
      healthyIds.push(id);
    }
  }
  return { offlineIds: offlineIds.sort(), healthyIds: healthyIds.sort() };
}

function expectMatchesOracle(run: ScenarioRun): void {
  expect(run.ticks.length).toBeGreaterThan(0);

  const replay: Map<NodeStatusPushRecord, ExpectedReport> = replayReports(run);
  expectReportsMatchReplay(run, replay);

  for (const tick of run.ticks) {
    const nodeOffline: ExpectedNodeOffline = expectedNodeOffline({
      run,
      replay,
      atMs: tick.atMs,
    });
    const quorum: ExpectedQuorum = expectedQuorum({
      run,
      replay,
      atMs: tick.atMs,
    });
    const context: string = `at ${new Date(tick.atMs).toISOString()}`;

    expect({ context, ids: tick.nodeOffline.offlineIds }).toEqual({
      context,
      ids: nodeOffline.offlineIds,
    });
    expect({ context, ids: tick.nodeOffline.healthyIds }).toEqual({
      context,
      ids: nodeOffline.healthyIds,
    });
    expect({ context, fires: tick.nodeOffline.fires }).toEqual({
      context,
      fires: nodeOffline.offlineIds.length > 0,
    });

    // Exact: every weight is a multiple of 2^-16, so any order sums exactly.
    expect({ context, points: tick.quorum.formulaPoints }).toEqual({
      context,
      points: quorum.points,
    });
    expect({ context, fires: tick.quorum.fires }).toEqual({
      context,
      fires: quorum.fires,
    });
    expect({ context, healthy: tick.quorum.healthy }).toEqual({
      context,
      healthy: quorum.healthy,
    });
  }
}

// ---- scenario helpers ----------------------------------------------

function sameMembers(a: Array<string>, b: Array<string>): boolean {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

function reportingPushes(run: ScenarioRun): Array<NodeStatusPushRecord> {
  return run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
    return push.silentNodes.length > 0;
  });
}

/*
 * A window is "fully post-death" when every push in it is a survivor's
 * push reporting exactly the dead nodes with every survivor counted live
 * (L = the survivors) — the steady state the design's L ÷ (L + D)
 * describes.
 */
function isSteadyTick(data: {
  run: ScenarioRun;
  tick: Tick;
  deadNodes: Array<string>;
}): boolean {
  const survivors: number = data.run.nodeNames.length - data.deadNodes.length;
  const pushes: Array<NodeStatusPushRecord> = pushesInWindow(
    data.run,
    data.tick.atMs,
  );
  return (
    pushes.length > 0 &&
    pushes.every((push: NodeStatusPushRecord) => {
      return (
        !data.deadNodes.includes(push.nodeName) &&
        sameMembers(push.silentNodes, data.deadNodes) &&
        push.reporterCount === survivors
      );
    })
  );
}

function steadyTicks(run: ScenarioRun, deadNodes: Array<string>): Array<Tick> {
  return run.ticks.filter((tick: Tick) => {
    return isSteadyTick({ run, tick, deadNodes });
  });
}

/*
 * The evaluations among `ticks` at which Quorum at Risk did NOT fire,
 * each with its minutes' availability — a readable failure message.
 */
function quorumQuietAt(ticks: Array<Tick>): Array<string> {
  return ticks
    .filter((tick: Tick) => {
      return !tick.quorum.fires;
    })
    .map((tick: Tick) => {
      const points: string = tick.quorum.formulaPoints
        .map((point: FormulaPoint) => {
          return point.value.toFixed(2);
        })
        .join(" ");
      return `${new Date(tick.atMs).toISOString()}: ${points}`;
    });
}

/*
 * Quorum at Risk with half the cluster down: it starts firing within
 * 9 minutes of the deaths and — `mustFireBeforeMs` included — never
 * stops; every one of those windows is steady and reads exactly 50 %
 * in every minute.
 */
function expectQuorumFiresThroughout(data: {
  run: ScenarioRun;
  deadNodes: Array<string>;
  mustFireBeforeMs: number;
}): void {
  const first: Tick | undefined = firstTick(data.run, (tick: Tick) => {
    return tick.quorum.fires;
  });
  expect(first).toBeDefined();
  expect(first!.atMs).toBeLessThanOrEqual(DEATH_MS + 9 * MINUTE_MS);
  expect(first!.atMs).toBeLessThan(data.mustFireBeforeMs);

  const after: Array<Tick> = ticksFrom(data.run, first!.atMs);
  expect(after.length).toBeGreaterThan(30);
  expect(quorumQuietAt(after)).toEqual([]);

  expect(steadyTicks(data.run, data.deadNodes)).toEqual(after);
  for (const tick of after) {
    expect(tick.quorum.formulaPoints.length).toBeGreaterThanOrEqual(5);
    for (const point of tick.quorum.formulaPoints) {
      expect(point.value).toBe(50);
    }
  }
}

function lastOwnPushBefore(
  run: ScenarioRun,
  nodeName: string,
  beforeMs: number,
): NodeStatusPushRecord {
  const pushes: Array<NodeStatusPushRecord> = run.simulator
    .ownPushes(nodeName)
    .filter((push: NodeStatusPushRecord) => {
      return push.pushTimeMs < beforeMs;
    });
  const last: NodeStatusPushRecord | undefined = pushes[pushes.length - 1];
  if (!last) {
    throw new Error(`${nodeName} never pushed before ${beforeMs}`);
  }
  return last;
}

function firstTick(
  run: ScenarioRun,
  predicate: (tick: Tick) => boolean,
): Tick | undefined {
  return run.ticks.find(predicate);
}

function ticksFrom(run: ScenarioRun, fromMs: number): Array<Tick> {
  return run.ticks.filter((tick: Tick) => {
    return tick.atMs >= fromMs;
  });
}

function nodeScopeRows(
  run: ScenarioRun,
  name: string,
): Array<SimulatedMetricRow> {
  return run.table.rowsNamed(name).filter((row: SimulatedMetricRow) => {
    return (
      row.attributes["pve.scope"] === "node" &&
      row.attributes["resource.proxmox.cluster.name"] === run.clusterName
    );
  });
}

/*
 * Every report, read back from the stored rows: one pve_up = 0 and one
 * pve_node_info per silent node at the report's own time, the weights
 * whole 2^-16 units at most one unit apart, adding up to exactly
 * ceil(D·65536/L)/65536.
 */
function expectReportRowsAddUp(run: ScenarioRun): void {
  const key: (row: SimulatedMetricRow) => string = (
    row: SimulatedMetricRow,
  ): string => {
    return `${String(row.attributes["resource.proxmox.node"])}|${row.time.getTime()}`;
  };
  const inferred: (name: string) => Map<string, Array<SimulatedMetricRow>> = (
    name: string,
  ): Map<string, Array<SimulatedMetricRow>> => {
    const byPush: Map<string, Array<SimulatedMetricRow>> = new Map();
    for (const row of nodeScopeRows(run, name)) {
      if (row.attributes[PROXMOX_INFERRED_ATTRIBUTE] === undefined) {
        continue;
      }
      const rows: Array<SimulatedMetricRow> = byPush.get(key(row)) || [];
      rows.push(row);
      byPush.set(key(row), rows);
    }
    return byPush;
  };

  const upByPush: Map<string, Array<SimulatedMetricRow>> = inferred("pve_up");
  const infoByPush: Map<string, Array<SimulatedMetricRow>> = inferred(
    "pve_node_info",
  );
  const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
  expect(upByPush.size).toBe(reports.length);
  expect(infoByPush.size).toBe(reports.length);

  const unit: number = 1 / 65536;
  const idsOf: (rows: Array<SimulatedMetricRow>) => string = (
    rows: Array<SimulatedMetricRow>,
  ): string => {
    return rows
      .map((row: SimulatedMetricRow) => {
        return String(row.attributes["id"]);
      })
      .sort()
      .join(",");
  };

  // Collected, then asserted once: thousands of reports on a big cluster.
  const problems: Array<string> = [];
  for (const report of reports) {
    const pushKey: string = `${report.nodeName}|${report.pushTimeMs}`;
    const expectedIds: string = report.silentNodes
      .map((name: string) => {
        return `node/${name}`;
      })
      .sort()
      .join(",");
    const upRows: Array<SimulatedMetricRow> = upByPush.get(pushKey) || [];
    const infoRows: Array<SimulatedMetricRow> = infoByPush.get(pushKey) || [];
    const weights: Array<number> = infoRows.map((row: SimulatedMetricRow) => {
      return row.value;
    });
    const total: number = weights.reduce((sum: number, weight: number) => {
      return sum + weight;
    }, 0);

    if (idsOf(upRows) !== expectedIds || idsOf(infoRows) !== expectedIds) {
      problems.push(`${pushKey}: rows for the wrong nodes`);
    }
    if (
      upRows.some((row: SimulatedMetricRow) => {
        return row.value !== 0;
      })
    ) {
      problems.push(`${pushKey}: a report of pve_up that is not 0`);
    }
    if (
      weights.some((weight: number) => {
        return !Number.isInteger(weight / unit);
      }) ||
      Math.max(...weights) - Math.min(...weights) > unit
    ) {
      problems.push(
        `${pushKey}: weights ${weights.join(" ")} not an even 2^-16 split`,
      );
    }
    if (total !== reportInfoWeight(report)) {
      problems.push(
        `${pushKey}: weights add up to ${total}, not ${reportInfoWeight(report)}`,
      );
    }
  }
  expect(problems).toEqual([]);
}

// ---- the scenarios ---------------------------------------------------

describe("the thresholds the oracle applies are the templates' own", () => {
  test("Node Offline: fires when every minute's lowest pve_up is < 1, healthy when every one is >= 1", () => {
    expect(NODE_OFFLINE_THRESHOLDS).toEqual({
      offline: {
        filterType: FilterType.LessThan,
        value: 1,
        overTime: EvaluateOverTimeType.AllValues,
      },
      healthy: {
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        overTime: EvaluateOverTimeType.AllValues,
      },
    });
  });

  test("Quorum: fires when every minute is <= 50 %, healthy only above the 55 % recovery band", () => {
    expect(QUORUM_THRESHOLDS).toEqual({
      offline: {
        filterType: FilterType.LessThanOrEqualTo,
        value: 50,
        overTime: EvaluateOverTimeType.AllValues,
      },
      healthy: {
        filterType: FilterType.GreaterThan,
        value: 55,
        overTime: EvaluateOverTimeType.AllValues,
      },
    });
  });
});

describe("Proxmox VE native push: Node Offline and Quorum at Risk end to end", () => {
  describe("3 nodes, all alive", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({ seed: 11, nodeCount: 3, durationMinutes: 35 });
    });

    test("no node ever reports a sibling", () => {
      expect(reportingPushes(run)).toEqual([]);
      expect(
        nodeScopeRows(run, "pve_up").filter((row: SimulatedMetricRow) => {
          return row.value !== 1;
        }),
      ).toEqual([]);
    });

    test("neither template fires on any evaluation", () => {
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.fires).toBe(false);
        expect(tick.nodeOffline.offlineIds).toEqual([]);
        expect(tick.quorum.fires).toBe(false);
      }
    });

    test("every node is healthy and availability is 100 % in every minute", () => {
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.healthyIds).toEqual([
          "node/pve1",
          "node/pve2",
          "node/pve3",
        ]);
        expect(tick.quorum.healthy).toBe(true);
        expect(tick.quorum.formulaPoints.length).toBeGreaterThanOrEqual(5);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(100);
        }
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("3 nodes, pve3 dies", () => {
    let run: ScenarioRun;
    let lastOwnPush: NodeStatusPushRecord;

    beforeAll(async () => {
      run = await runScenario({
        seed: 23,
        nodeCount: 3,
        durationMinutes: 45,
        downRanges: { pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
      });
      lastOwnPush = lastOwnPushBefore(run, "pve3", NEVER_MS);
    });

    test("the worker takes the production paths: grouped raw rows for Node Offline, Sum buckets for Quorum", () => {
      const scope: Dictionary<string> = {
        "pve.scope": "node",
        "resource.proxmox.cluster.name": run.clusterName,
      };

      // Node Offline: pve_up raw rows, newest first, LIMIT_PER_PROJECT.
      const groupedReads: Array<SimulatedFindByArgs> = run.findByCalls.filter(
        (call: SimulatedFindByArgs) => {
          return call.limit === 10000;
        },
      );
      expect(groupedReads.length).toBe(run.ticks.length);
      for (const call of groupedReads) {
        expect(call.query["name"]).toBe("pve_up");
        expect(call.query["attributes"]).toEqual(scope);
        expect(call.sort).toEqual({ time: "DESC" });
      }

      // The rest of findBy is the limit-100 affected-resource scan.
      expect(
        run.findByCalls.every((call: SimulatedFindByArgs) => {
          return call.limit === 10000 || call.limit === 100;
        }),
      ).toBe(true);

      // Quorum: Σpve_up and Σpve_node_info per minute, ungrouped.
      expect(run.aggregateByCalls.length).toBe(2 * run.ticks.length);
      for (const call of run.aggregateByCalls) {
        expect(call.aggregationType).toBe(MetricsAggregationType.Sum);
        expect(["pve_up", "pve_node_info"]).toContain(call.query["name"]);
        expect(call.query["attributes"]).toEqual(scope);
        expect(call.groupBy).toBeUndefined();
        expect(
          call.endTimestamp.getTime() - call.startTimestamp.getTime(),
        ).toBe(WINDOW_MS);
      }
    });

    test("pve3 is reported about 2 minutes after its last push, by both survivors, and nothing else is", () => {
      const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
      expect(reports.length).toBeGreaterThan(100);

      for (const report of reports) {
        expect(report.silentNodes).toEqual(["pve3"]);
        expect(report.reporterCount).toBe(2);
        expect(["pve1", "pve2"]).toContain(report.nodeName);
      }
      expect(
        new Set(
          reports.map((report: NodeStatusPushRecord) => {
            return report.nodeName;
          }),
        ),
      ).toEqual(new Set(["pve1", "pve2"]));

      const firstReportMs: number = reports[0]!.pushTimeMs;
      expect(firstReportMs).toBeGreaterThan(
        lastOwnPush.pushTimeMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(firstReportMs).toBeLessThanOrEqual(
        lastOwnPush.pushTimeMs + PROXMOX_NODE_SILENCE_MS + 20_000,
      );
    });

    test("every report's rows add up to D ÷ L", () => {
      expectReportRowsAddUp(run);
    });

    test("the report rows carry pve3's own labels, marked inferred, in their own scope", () => {
      const downRows: Array<SimulatedMetricRow> = nodeScopeRows(
        run,
        "pve_up",
      ).filter((row: SimulatedMetricRow) => {
        return row.value === 0;
      });
      expect(downRows.length).toBe(reportingPushes(run).length);
      for (const row of downRows) {
        expect(row.attributes["id"]).toBe("node/pve3");
        expect(row.attributes["pve.type"]).toBe("node");
        expect(row.attributes["pve.id"]).toBe("pve3");
        expect(row.attributes[PROXMOX_INFERRED_ATTRIBUTE]).toBe(
          PROXMOX_INFERRED_NOT_REPORTING,
        );
        expect(row.attributes["scope.name"]).toBe(
          PROXMOX_SIBLING_REPORT_SCOPE_NAME,
        );
        expect(["pve1", "pve2"]).toContain(
          row.attributes["resource.proxmox.node"],
        );
      }

      const inferredInfo: Array<SimulatedMetricRow> = nodeScopeRows(
        run,
        "pve_node_info",
      ).filter((row: SimulatedMetricRow) => {
        return row.attributes[PROXMOX_INFERRED_ATTRIBUTE] !== undefined;
      });
      expect(inferredInfo.length).toBe(downRows.length);
      for (const row of inferredInfo) {
        // D ÷ L = 1 ÷ 2 per report.
        expect(row.value).toBe(0.5);
        expect(row.attributes["name"]).toBe("pve3");
      }
    });

    test("Node Offline fires for node/pve3 — and only it — 5 to 5.5 minutes after its last push", () => {
      const first: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.nodeOffline.fires;
      });
      expect(first).toBeDefined();

      // The window must hold none of pve3's own pve_up = 1 rows.
      expect(first!.atMs - lastOwnPush.pushTimeMs).toBeGreaterThan(WINDOW_MS);
      expect(first!.atMs - lastOwnPush.pushTimeMs).toBeLessThanOrEqual(
        WINDOW_MS + EVALUATION_STEP_MS,
      );

      // The headline: by t + 7 min, never before t + 4 min.
      expect(first!.atMs).toBeGreaterThan(DEATH_MS + 4 * MINUTE_MS);
      expect(first!.atMs).toBeLessThanOrEqual(DEATH_MS + 7 * MINUTE_MS);
      for (const tick of run.ticks) {
        if (tick.atMs < DEATH_MS + 4 * MINUTE_MS) {
          expect(tick.nodeOffline.offlineIds).toEqual([]);
        }
      }

      // From then on it fires on every evaluation, for pve3 alone.
      const after: Array<Tick> = ticksFrom(run, first!.atMs);
      expect(after.length).toBeGreaterThan(30);
      for (const tick of after) {
        expect(tick.nodeOffline.fires).toBe(true);
        expect(tick.nodeOffline.offlineIds).toEqual(["node/pve3"]);
        expect(tick.nodeOffline.healthyIds).toEqual(["node/pve1", "node/pve2"]);
      }
      for (const tick of run.ticks) {
        expect(
          tick.nodeOffline.offlineIds.filter((id: string) => {
            return id !== "node/pve3";
          }),
        ).toEqual([]);
      }

      expect(first!.nodeOffline.rootCause).toContain("node/pve3");
      expect(first!.nodeOffline.rootCause).not.toContain("node/pve1");
    });

    test("Quorum does not fire: availability settles at exactly 2 ÷ 3", () => {
      for (const tick of run.ticks) {
        expect(tick.quorum.fires).toBe(false);
      }

      const steady: Array<Tick> = steadyTicks(run, ["pve3"]);
      expect(steady.length).toBeGreaterThan(30);
      for (const tick of steady) {
        expect(tick.quorum.healthy).toBe(true);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBeCloseTo(200 / 3, 10);
        }
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("3 nodes, pve2 and pve3 die 25 s apart", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 37,
        nodeCount: 3,
        durationMinutes: 45,
        downRanges: {
          pve2: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve3: [{ fromMs: DEATH_MS + 25_000, toMs: NEVER_MS }],
        },
      });
    });

    test("the lone survivor reports both, weighing each as a whole node", () => {
      const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
      expect(reports.length).toBeGreaterThan(50);
      for (const report of reports) {
        expect(report.nodeName).toBe("pve1");
      }

      const full: Array<NodeStatusPushRecord> = reports.filter(
        (report: NodeStatusPushRecord) => {
          return sameMembers(report.silentNodes, ["pve2", "pve3"]);
        },
      );
      expect(full.length).toBeGreaterThan(50);
      for (const report of full) {
        // D ÷ L = 2 ÷ 1: one whole node each.
        expect(report.reporterCount).toBe(1);
      }

      /*
       * Before that, pve2 alone: pve3 died 25 s later, so for a while it
       * is not yet silent — still counted live (L = 2) until its own
       * 2 minutes run out.
       */
      const firstFullMs: number = full[0]!.receiveMs;
      const partial: Array<NodeStatusPushRecord> = reports.filter(
        (report: NodeStatusPushRecord) => {
          return !full.includes(report);
        },
      );
      expect(
        partial.some((report: NodeStatusPushRecord) => {
          return report.reporterCount === 2;
        }),
      ).toBe(true);
      for (const report of partial) {
        expect(report.silentNodes).toEqual(["pve2"]);
        expect([1, 2]).toContain(report.reporterCount);
        expect(report.receiveMs).toBeLessThan(firstFullMs);
      }
    });

    test("every report's rows add up to D ÷ L", () => {
      expectReportRowsAddUp(run);
    });

    test("Node Offline fires for node/pve2 and node/pve3 only", () => {
      const last: Tick = run.ticks[run.ticks.length - 1]!;
      expect(last.nodeOffline.offlineIds).toEqual(["node/pve2", "node/pve3"]);
      for (const tick of run.ticks) {
        expect(
          tick.nodeOffline.offlineIds.every((id: string) => {
            return id === "node/pve2" || id === "node/pve3";
          }),
        ).toBe(true);
      }
    });

    test("Quorum fires once a whole window has the reports, and keeps firing at 1 ÷ 3", () => {
      const first: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.quorum.fires;
      });
      expect(first).toBeDefined();
      // A minute of 1 ÷ 1 before the reports keeps it quiet for a window.
      expect(first!.atMs).toBeGreaterThan(DEATH_MS + 6 * MINUTE_MS);
      expect(first!.atMs).toBeLessThanOrEqual(DEATH_MS + 9 * MINUTE_MS);

      for (const tick of ticksFrom(run, first!.atMs)) {
        expect(tick.quorum.fires).toBe(true);
      }

      const steady: Array<Tick> = steadyTicks(run, ["pve2", "pve3"]);
      expect(steady.length).toBeGreaterThan(30);
      for (const tick of steady) {
        expect(tick.quorum.fires).toBe(true);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBeCloseTo(100 / 3, 10);
        }
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("4 nodes, pve3 and pve4 die (L = D = 2)", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 41,
        nodeCount: 4,
        durationMinutes: 45,
        downRanges: {
          pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve4: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
        },
      });
    });

    test("a full report is made by both survivors and weighs D ÷ L = 1, half a node each", () => {
      const fullReports: Array<NodeStatusPushRecord> = reportingPushes(
        run,
      ).filter((report: NodeStatusPushRecord) => {
        return report.silentNodes.length === 2;
      });
      expect(fullReports.length).toBeGreaterThan(100);
      for (const report of fullReports) {
        expect(report.silentNodes).toEqual(["pve3", "pve4"]);
        expect(report.reporterCount).toBe(2);
        expect(reportInfoWeight(report)).toBe(1);
      }

      /*
       * The two died in the same second, but their last pushes were up
       * to 10 s apart: for those seconds the later one is still counted
       * live (L = 3, or 2 once its key is gone but its last push is not
       * yet 2 minutes old) while the earlier one is reported alone.
       */
      const firstFullMs: number = fullReports[0]!.receiveMs;
      for (const report of reportingPushes(run)) {
        if (report.silentNodes.length === 1) {
          expect([2, 3]).toContain(report.reporterCount);
          expect(report.receiveMs).toBeLessThan(firstFullMs);
        }
      }
    });

    test("every report's rows add up to D ÷ L", () => {
      expectReportRowsAddUp(run);
    });

    test("Quorum fires on every evaluation once the window is fully post-death, at exactly 50 %", () => {
      const steady: Array<Tick> = steadyTicks(run, ["pve3", "pve4"]);
      expect(steady.length).toBeGreaterThan(30);
      expect(steady[0]!.atMs).toBeLessThanOrEqual(DEATH_MS + 9 * MINUTE_MS);

      // Every evaluation from the first steady one on is steady.
      expect(steady).toEqual(ticksFrom(run, steady[0]!.atMs));

      for (const tick of steady) {
        expect(tick.quorum.fires).toBe(true);
        expect(tick.quorum.formulaPoints.length).toBeGreaterThanOrEqual(5);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
      }

      // …and never while a pre-death or partial minute is in the window.
      for (const tick of run.ticks) {
        if (!steady.includes(tick)) {
          expect(tick.quorum.fires).toBe(false);
        }
      }
    });

    test("Node Offline fires for node/pve3 and node/pve4 only", () => {
      const last: Tick = run.ticks[run.ticks.length - 1]!;
      expect(last.nodeOffline.offlineIds).toEqual(["node/pve3", "node/pve4"]);
      expect(last.nodeOffline.healthyIds).toEqual(["node/pve1", "node/pve2"]);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("5 nodes, pve4 and pve5 die (3 of 5 online)", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 53,
        nodeCount: 5,
        durationMinutes: 45,
        downRanges: {
          pve4: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve5: [{ fromMs: DEATH_MS + 3_000, toMs: NEVER_MS }],
        },
      });
    });

    test("Quorum never fires: availability settles just under 60 %", () => {
      for (const tick of run.ticks) {
        expect(tick.quorum.fires).toBe(false);
      }

      // 2 ÷ 3 rounded up to 2^-16: 65536 ÷ (65536 + 43691) of the nodes.
      const settled: number = (65536 / (65536 + 43691)) * 100;
      const steady: Array<Tick> = steadyTicks(run, ["pve4", "pve5"]);
      expect(steady.length).toBeGreaterThan(30);
      for (const tick of steady) {
        expect(tick.quorum.healthy).toBe(true);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBeCloseTo(settled, 10);
          expect(point.value).toBeCloseTo(60, 2);
          expect(point.value).toBeGreaterThan(50);
        }
      }
    });

    test("every report's rows add up to D ÷ L (2 ÷ 3 splits unevenly by one 2^-16 unit)", () => {
      const full: Array<NodeStatusPushRecord> = reportingPushes(run).filter(
        (report: NodeStatusPushRecord) => {
          return report.silentNodes.length === 2 && report.reporterCount === 3;
        },
      );
      expect(full.length).toBeGreaterThan(100);
      expectReportRowsAddUp(run);
    });

    test("Node Offline fires for node/pve4 and node/pve5 only", () => {
      const last: Tick = run.ticks[run.ticks.length - 1]!;
      expect(last.nodeOffline.offlineIds).toEqual(["node/pve4", "node/pve5"]);
      expect(last.nodeOffline.healthyIds).toEqual([
        "node/pve1",
        "node/pve2",
        "node/pve3",
      ]);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("2 nodes, pve2 dies (L = D = 1)", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 61,
        nodeCount: 2,
        durationMinutes: 40,
        downRanges: { pve2: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
      });
    });

    test("Quorum fires at exactly 50 % and Node Offline for node/pve2", () => {
      const steady: Array<Tick> = steadyTicks(run, ["pve2"]);
      expect(steady.length).toBeGreaterThan(20);
      expect(steady).toEqual(ticksFrom(run, steady[0]!.atMs));
      for (const tick of steady) {
        expect(tick.quorum.fires).toBe(true);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
        expect(tick.nodeOffline.offlineIds).toEqual(["node/pve2"]);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("3 nodes, pve3 is down for 12 minutes and comes back", () => {
    const RETURN_MS: number = DEATH_MS + 12 * MINUTE_MS;
    let run: ScenarioRun;
    let returned: NodeStatusPushRecord;

    beforeAll(async () => {
      run = await runScenario({
        seed: 71,
        nodeCount: 3,
        durationMinutes: 50,
        downRanges: { pve3: [{ fromMs: DEATH_MS, toMs: RETURN_MS }] },
      });
      const back: NodeStatusPushRecord | undefined = run.simulator
        .ownPushes("pve3")
        .find((push: NodeStatusPushRecord) => {
          return push.pushTimeMs > DEATH_MS;
        });
      if (!back) {
        throw new Error("pve3 never came back");
      }
      returned = back;
    });

    test("Node Offline fires while pve3 is down", () => {
      const firing: Array<Tick> = run.ticks.filter((tick: Tick) => {
        return tick.nodeOffline.fires;
      });
      expect(firing.length).toBeGreaterThan(8);
      for (const tick of firing) {
        expect(tick.nodeOffline.offlineIds).toEqual(["node/pve3"]);
        expect(tick.atMs).toBeGreaterThan(DEATH_MS + 4 * MINUTE_MS);
      }
    });

    test("the survivors stop reporting pve3 as soon as its push is in", () => {
      for (const report of run.simulator.reportsOf("pve3")) {
        expect(report.receiveMs).toBeLessThan(returned.receiveMs);
      }
    });

    test("Node Offline stops matching within 2 minutes of pve3's first push back", () => {
      const cleared: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.atMs >= returned.receiveMs && !tick.nodeOffline.fires;
      });
      expect(cleared).toBeDefined();
      expect(cleared!.atMs).toBeLessThanOrEqual(
        returned.pushTimeMs + 2 * MINUTE_MS,
      );

      const settledFrom: number = returned.pushTimeMs + 2 * MINUTE_MS;
      const after: Array<Tick> = ticksFrom(run, cleared!.atMs);
      expect(ticksFrom(run, settledFrom).length).toBeGreaterThan(20);
      for (const tick of after) {
        expect(tick.nodeOffline.fires).toBe(false);
        expect(tick.nodeOffline.offlineIds).toEqual([]);
      }

      // A full window later every node is plainly healthy again.
      for (const tick of ticksFrom(
        run,
        returned.receiveMs + WINDOW_MS + MINUTE_MS,
      )) {
        expect(tick.nodeOffline.healthyIds).toEqual([
          "node/pve1",
          "node/pve2",
          "node/pve3",
        ]);
        expect(tick.quorum.healthy).toBe(true);
      }
    });

    /*
     * A node warming up may report (it is alive and its siblings are
     * established) — but it has nothing to report: every sibling is live.
     */
    test("the returning node reports nothing: none of its siblings is silent", () => {
      expect(
        run.simulator.ownPushes("pve3").filter((push: NodeStatusPushRecord) => {
          return push.silentNodes.length > 0;
        }),
      ).toEqual([]);
    });

    test("Quorum never fires", () => {
      for (const tick of run.ticks) {
        expect(tick.quorum.fires).toBe(false);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("3 nodes, the whole cluster goes silent at once", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 83,
        nodeCount: 3,
        durationMinutes: 45,
        downRanges: {
          pve1: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve2: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
        },
      });
    });

    test("nobody is left to report, so neither template ever fires", () => {
      expect(reportingPushes(run)).toEqual([]);
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.fires).toBe(false);
        expect(tick.nodeOffline.offlineIds).toEqual([]);
        expect(tick.quorum.fires).toBe(false);
      }
    });

    test("a window after the silence holds no data at all (the cluster turns Disconnected instead)", () => {
      const quiet: Array<Tick> = ticksFrom(
        run,
        DEATH_MS + WINDOW_MS + MINUTE_MS,
      );
      expect(quiet.length).toBeGreaterThan(20);
      for (const tick of quiet) {
        expect(tick.nodeOffline.seriesCount).toBe(0);
        expect(tick.quorum.formulaPoints).toEqual([]);
        expect(tick.nodeOffline.healthy).toBe(false);
        expect(tick.quorum.healthy).toBe(false);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("a standalone host", () => {
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 89,
        nodeCount: 1,
        durationMinutes: 35,
        downRanges: { pve1: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
      });
    });

    test("has nobody to speak for it: no report, no page", () => {
      expect(reportingPushes(run)).toEqual([]);
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.fires).toBe(false);
        expect(tick.quorum.fires).toBe(false);
      }
      expectMatchesOracle(run);
    });
  });

  describe("4 nodes, a 10-minute OneUptime outage, nodes back up to 100 s apart", () => {
    const OUTAGE_FROM_MS: number = SIM_START_MS + 20 * MINUTE_MS;
    const OUTAGE_TO_MS: number = OUTAGE_FROM_MS + 10 * MINUTE_MS;
    let run: ScenarioRun;

    beforeAll(async () => {
      run = await runScenario({
        seed: 97,
        nodeCount: 4,
        durationMinutes: 50,
        outage: {
          fromMs: OUTAGE_FROM_MS,
          toMs: OUTAGE_TO_MS,
          resumeDelayMsByNode: {
            pve1: 0,
            pve2: 33_000,
            pve3: 66_000,
            pve4: 100_000,
          },
        },
      });
    });

    test("the outage really was total: no rows in it, nodes resumed staggered", () => {
      for (const push of run.simulator.nodeStatusPushes) {
        const inOutage: boolean =
          push.receiveMs >= OUTAGE_FROM_MS && push.receiveMs < OUTAGE_TO_MS;
        expect(inOutage).toBe(false);
      }
      const firstBack: Array<number> = run.nodeNames.map((name: string) => {
        return run.simulator
          .ownPushes(name)
          .find((push: NodeStatusPushRecord) => {
            return push.receiveMs >= OUTAGE_TO_MS;
          })!.receiveMs;
      });
      expect(Math.max(...firstBack) - Math.min(...firstBack)).toBeGreaterThan(
        90_000,
      );

      // Some evaluation saw an empty window.
      expect(
        run.ticks.some((tick: Tick) => {
          return (
            tick.quorum.formulaPoints.length === 0 &&
            tick.nodeOffline.seriesCount === 0
          );
        }),
      ).toBe(true);
    });

    test("no node reports a sibling after the outage, so nothing fires", () => {
      expect(reportingPushes(run)).toEqual([]);
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.fires).toBe(false);
        expect(tick.nodeOffline.offlineIds).toEqual([]);
        expect(tick.quorum.fires).toBe(false);
      }
    });

    test("every node's streak restarted after the outage", () => {
      for (const name of run.nodeNames) {
        const liveness: ProxmoxNodeLiveness | null = parseProxmoxNodeLiveness(
          redis.getString(
            LIVENESS_NAMESPACE,
            `${projectId.toString()}:${run.proxmoxClusterId.toString()}:${name}`,
          ),
        );
        expect(liveness).not.toBeNull();
        expect(liveness!.streakStartMs).toBeGreaterThanOrEqual(OUTAGE_TO_MS);
      }
    });

    test("every node is healthy again at the end", () => {
      const last: Tick = run.ticks[run.ticks.length - 1]!;
      expect(last.nodeOffline.healthyIds).toEqual([
        "node/pve1",
        "node/pve2",
        "node/pve3",
        "node/pve4",
      ]);
      expect(last.quorum.healthy).toBe(true);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  /*
   * A OneUptime ingest outage a little shorter than the silence window,
   * and Redis rides it out: each key simply expires 2 minutes after the
   * node's last push before the outage. Nothing is received for 100 s;
   * then pve1 is back, and pve2, pve3 and pve4 over the next 19 s — every
   * node is away 100 to 119 s. pve5 died long before and is being
   * reported.
   *
   * Right after pve1 is back, the keys of the siblings not yet back
   * expire one by one, while the ones written just before the outage are
   * still alive — each with a streak minutes long. Were an alive key with
   * a long streak enough to make the cluster established, pve1 would
   * lean on such a stale key and report the expired siblings, live nodes
   * all, as not reporting. But a node is established only while its
   * streak is unbroken NOW — its last push at most STREAK_GAP_MS old —
   * and every push from before the outage is at least 100 s old: nobody
   * reports anything until a node has pushed for 2 minutes after the
   * outage, by when every live node has a key again.
   */
  describe("5 nodes, pve5 dead, a 100–119 s OneUptime outage that Redis rides out", () => {
    const OUTAGE_FROM_MS: number = SIM_START_MS + 30 * MINUTE_MS;
    const LIVE_NODES: Array<string> = ["pve1", "pve2", "pve3", "pve4"];

    /*
     * Nothing received for backAfterMs; then pve1 is back at once and
     * pve2 to pve4 one after another, the last 119 s after the outage
     * began. Redis keeps its keys.
     */
    function shortOutage(backAfterMs: number): SimulatedIngestOutage {
      const spreadMs: number = 119_000 - backAfterMs;
      return {
        fromMs: OUTAGE_FROM_MS,
        toMs: OUTAGE_FROM_MS + backAfterMs,
        resumeDelayMsByNode: {
          pve1: 0,
          pve2: Math.round(spreadMs / 3),
          pve3: Math.round((2 * spreadMs) / 3),
          pve4: spreadMs,
        },
        keepsLiveness: true,
      };
    }

    function shortOutageScenario(data: {
      seed: number;
      backAfterMs: number;
      evaluateFromMs?: number | undefined;
    }): ScenarioInput {
      return {
        seed: data.seed,
        nodeCount: 5,
        durationMinutes: 45,
        downRanges: { pve5: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
        outage: shortOutage(data.backAfterMs),
        evaluateFromMs: data.evaluateFromMs,
      };
    }

    // Replayed pushes that would report a live node under `established`.
    function pushesReportingLiveNodes(
      run: ScenarioRun,
      established: EstablishedRule,
    ): Array<NodeStatusPushRecord> {
      const replay: Map<NodeStatusPushRecord, ExpectedReport> = replayReports(
        run,
        established,
      );
      return run.simulator.nodeStatusPushes.filter(
        (push: NodeStatusPushRecord) => {
          return replayedReportOf(replay, push).silentNodes.some(
            (name: string) => {
              return LIVE_NODES.includes(name);
            },
          );
        },
      );
    }

    const outage: SimulatedIngestOutage = shortOutage(100_000);
    let run: ScenarioRun;
    // The first node-status push OneUptime processed after the outage.
    let firstBack: NodeStatusPushRecord;

    beforeAll(async () => {
      run = await runScenario(
        shortOutageScenario({ seed: 181, backAfterMs: 100_000 }),
      );
      const back: NodeStatusPushRecord | undefined =
        run.simulator.nodeStatusPushes.find((push: NodeStatusPushRecord) => {
          return push.receiveMs >= outage.toMs;
        });
      if (!back) {
        throw new Error("nothing was processed after the outage");
      }
      firstBack = back;
    });

    test("every live node was away 100 to 119 s, and Redis kept its keys", () => {
      expect(run.simulator.livenessLostAtMs).toEqual([]);

      for (const name of LIVE_NODES) {
        const resumeAtMs: number =
          outage.toMs + (outage.resumeDelayMsByNode?.[name] ?? 0);
        expect(resumeAtMs - OUTAGE_FROM_MS).toBeGreaterThanOrEqual(100_000);
        expect(resumeAtMs - OUTAGE_FROM_MS).toBeLessThanOrEqual(119_000);

        const pushes: Array<NodeStatusPushRecord> =
          run.simulator.ownPushes(name);
        expect(
          pushes.filter((push: NodeStatusPushRecord) => {
            return (
              push.receiveMs >= OUTAGE_FROM_MS && push.receiveMs < resumeAtMs
            );
          }),
        ).toEqual([]);
        // Back with its next status pass.
        const back: NodeStatusPushRecord | undefined = pushes.find(
          (push: NodeStatusPushRecord) => {
            return push.receiveMs >= resumeAtMs;
          },
        );
        expect(back).toBeDefined();
        expect(back!.receiveMs - resumeAtMs).toBeLessThan(12_000);
      }
    });

    test("no live node is ever reported; pve5's reports pause and resume only once a node has pushed unbroken for 2 minutes after the outage", () => {
      const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
      for (const report of reports) {
        expect(report.silentNodes).toEqual(["pve5"]);
        expect(report.reporterCount).toBe(4);
      }
      for (const name of LIVE_NODES) {
        expect(run.simulator.reportsOf(name)).toEqual([]);
      }

      // Reported up to the outage…
      expect(
        reports.some((report: NodeStatusPushRecord) => {
          return (
            report.receiveMs < OUTAGE_FROM_MS &&
            report.receiveMs >= OUTAGE_FROM_MS - 15_000
          );
        }),
      ).toBe(true);

      // …then not until a node back from it is established.
      const after: Array<NodeStatusPushRecord> = reports.filter(
        (report: NodeStatusPushRecord) => {
          return report.receiveMs >= OUTAGE_FROM_MS;
        },
      );
      expect(after.length).toBeGreaterThan(50);
      expect(after[0]!.receiveMs).toBeGreaterThanOrEqual(
        firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(after[0]!.receiveMs).toBeLessThan(
        firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS + 15_000,
      );
    });

    /*
     * The trap is really set: replayed with the rule that took any alive
     * key with a 2-minute streak as established, pushes right after the
     * outage report live nodes — the ones whose keys had just expired.
     * Whether a push lands in those few seconds is the draw's (this one
     * does; the sweep below counts how many do). The real pushes there
     * reported nothing.
     */
    test("an alive key from before the outage would have vouched for reports of live nodes; established now means an unbroken streak", () => {
      expect(pushesReportingLiveNodes(run, isEligibleProxmoxReporter)).toEqual(
        [],
      );

      const wouldReportLiveNodes: Array<NodeStatusPushRecord> =
        pushesReportingLiveNodes(run, isEstablishedByAnyLiveStreak);
      expect(wouldReportLiveNodes.length).toBeGreaterThan(0);
      for (const push of wouldReportLiveNodes) {
        // After the outage, while a key written before it was still alive.
        expect(push.receiveMs).toBeGreaterThanOrEqual(outage.toMs);
        expect(push.receiveMs).toBeLessThan(
          OUTAGE_FROM_MS + PROXMOX_NODE_SILENCE_MS,
        );
        expect(push.silentNodes).toEqual([]);
        expect(push.reporterCount).toBe(0);
      }
    });

    test("Node Offline never names a live node, and keeps firing for node/pve5 through the outage", () => {
      for (const tick of run.ticks) {
        for (const id of tick.nodeOffline.offlineIds) {
          expect(id).toBe("node/pve5");
        }
      }
      for (const tick of ticksFrom(run, DEATH_MS + 6 * MINUTE_MS)) {
        expect(tick.nodeOffline.offlineIds).toEqual(["node/pve5"]);
      }
    });

    test("Quorum never fires", () => {
      for (const tick of run.ticks) {
        expect(tick.quorum.fires).toBe(false);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });

    /*
     * The same outage over twelve more draws, pve1 back after 100, 105,
     * 110 or 115 s and the last node at 119 s: no push ever reports a
     * live node — so none of a live node's pve_up rows is ever 0, and
     * Node Offline cannot name it — while the rule that took any alive
     * key with a 2-minute streak as established would have, in several
     * of them. Reports only, evaluated once at the end: the scenario
     * above covers the verdicts.
     */
    test("over twelve more draws of the outage, no live node is ever reported — though an alive stale key would have vouched in several", async () => {
      const backAfterMs: Array<number> = [100_000, 105_000, 110_000, 115_000];
      const drawsWithTrap: Array<number> = [];

      for (let draw: number = 0; draw < 12; draw++) {
        const seed: number = 301 + draw;
        const sweep: ScenarioRun = await runScenario(
          shortOutageScenario({
            seed: seed,
            backAfterMs: backAfterMs[draw % backAfterMs.length]!,
            evaluateFromMs: SIM_START_MS + 45 * MINUTE_MS,
          }),
        );

        expectReportsMatchReplay(sweep, replayReports(sweep));
        for (const name of LIVE_NODES) {
          expect({ seed, reports: sweep.simulator.reportsOf(name) }).toEqual({
            seed,
            reports: [],
          });
        }
        // pve5 is reported again once a node is established.
        expect(sweep.simulator.reportsOf("pve5").length).toBeGreaterThan(100);

        if (
          pushesReportingLiveNodes(sweep, isEstablishedByAnyLiveStreak).length >
          0
        ) {
          drawsWithTrap.push(seed);
        }
      }

      // 5 of the 12 as drawn.
      expect(drawsWithTrap.length).toBeGreaterThanOrEqual(3);
    }, 120_000);
  });

  /*
   * pve3 dies a minute before a 20-minute OneUptime outage. Its last push
   * is only a minute old when OneUptime stops processing, so nobody has
   * reported it and its row was never marked Offline. Nothing at all is
   * processed during the outage — no rows — and the cluster turns
   * Disconnected. pve1 and pve2 are back from 39:00; their first push
   * reconnects the cluster with a fresh lastSeenAt, so the 40:00 cleanup
   * tick — in the 2-minute warm-up, before anyone may report — anchors
   * its cutoff 15 minutes back, well past pve3's last push.
   *
   * pve3's row must survive that tick: native-push Node rows ARE the
   * cluster's membership, the roster the live nodes report the silent
   * ones from. Kept (a native Node, last seen within the retention
   * window), it is reported as soon as a node is established, and Node
   * Offline fires. The counterfactual below prunes it at that tick
   * instead, and pve3 is never reported again.
   */
  describe("3 nodes, pve3 dies a minute before a 20-minute OneUptime outage", () => {
    const OUTAGE_FROM_MS: number = SIM_START_MS + 19 * MINUTE_MS;
    const OUTAGE_TO_MS: number = OUTAGE_FROM_MS + 20 * MINUTE_MS;
    const PVE3_DEATH_MS: number = OUTAGE_FROM_MS - MINUTE_MS;
    // The first cleanup tick after the outage.
    const WARM_UP_CLEANUP_MS: number = SIM_START_MS + 40 * MINUTE_MS;

    function scenario(withoutNativeNodeKeep: boolean): ScenarioInput {
      return {
        seed: 193,
        nodeCount: 3,
        durationMinutes: 55,
        downRanges: { pve3: [{ fromMs: PVE3_DEATH_MS, toMs: NEVER_MS }] },
        outage: { fromMs: OUTAGE_FROM_MS, toMs: OUTAGE_TO_MS },
        withoutNativeNodeKeep: withoutNativeNodeKeep,
      };
    }

    function firstPushBack(run: ScenarioRun): NodeStatusPushRecord {
      const back: NodeStatusPushRecord | undefined =
        run.simulator.nodeStatusPushes.find((push: NodeStatusPushRecord) => {
          return push.receiveMs >= OUTAGE_TO_MS;
        });
      if (!back) {
        throw new Error("nothing was processed after the outage");
      }
      return back;
    }

    function warmUpCleanup(run: ScenarioRun): SimulatedCleanupRun {
      const cleanup: SimulatedCleanupRun | undefined =
        run.simulator.cleanupRuns.find((entry: SimulatedCleanupRun) => {
          return entry.atMs === WARM_UP_CLEANUP_MS;
        });
      if (!cleanup) {
        throw new Error("the cleanup cron never ran at 40:00");
      }
      return cleanup;
    }

    describe("the inventory keeps pve3's row (native Node, within retention)", () => {
      let run: ScenarioRun;
      let lastOwnPush: NodeStatusPushRecord;
      let firstBack: NodeStatusPushRecord;

      beforeAll(async () => {
        run = await runScenario(scenario(false));
        lastOwnPush = lastOwnPushBefore(run, "pve3", NEVER_MS);
        firstBack = firstPushBack(run);
      });

      test("pve3 went quiet a minute before the outage, nobody reported it before it, and nothing was processed during it", () => {
        // Its own clock: up to 0.8 s of skew, whole seconds.
        expect(lastOwnPush.pushTimeMs).toBeLessThan(PVE3_DEATH_MS + 1_000);
        expect(lastOwnPush.pushTimeMs).toBeGreaterThanOrEqual(
          PVE3_DEATH_MS - 12_000,
        );
        for (const report of run.simulator.reportsOf("pve3")) {
          expect(report.receiveMs).toBeGreaterThanOrEqual(OUTAGE_TO_MS);
        }

        expect(
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return (
                push.receiveMs >= OUTAGE_FROM_MS &&
                push.receiveMs < OUTAGE_TO_MS
              );
            },
          ),
        ).toEqual([]);
        // Point times: a node's clock may run up to ~2 s off receive time.
        expect(
          run.table.rowsNamed("pve_up").filter((row: SimulatedMetricRow) => {
            const rowMs: number = row.time.getTime();
            return (
              rowMs >= OUTAGE_FROM_MS + 2_000 && rowMs < OUTAGE_TO_MS - 5_000
            );
          }),
        ).toEqual([]);
        expect(run.simulator.livenessLostAtMs).toEqual([OUTAGE_FROM_MS]);
      });

      test("the cluster turned Disconnected in the outage; the tick in the warm-up finds pve3's row stale but keeps it", () => {
        expect(
          run.simulator.cleanupRuns.some((entry: SimulatedCleanupRun) => {
            return (
              entry.atMs > OUTAGE_FROM_MS &&
              entry.atMs < OUTAGE_TO_MS &&
              !entry.connected
            );
          }),
        ).toBe(true);

        const cleanup: SimulatedCleanupRun = warmUpCleanup(run);
        // In the warm-up: after the first push back, before anyone reports.
        expect(cleanup.atMs).toBeGreaterThan(firstBack.receiveMs);
        expect(cleanup.atMs).toBeLessThan(
          firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS,
        );
        expect(
          reportingPushes(run).filter((push: NodeStatusPushRecord) => {
            return push.receiveMs <= cleanup.atMs;
          }),
        ).toEqual([]);

        // Reconnected, the cutoff anchored past pve3's last push…
        expect(cleanup.connected).toBe(true);
        expect(cleanup.cutoffMs).not.toBeNull();
        expect(cleanup.cutoffMs!).toBeGreaterThan(lastOwnPush.pushTimeMs);
        // …and the row kept all the same.
        expect(cleanup.keptNodes).toEqual(["pve3"]);
        expect(cleanup.prunedNodes).toEqual([]);

        for (const entry of run.simulator.cleanupRuns) {
          expect(entry.prunedNodes).toEqual([]);
        }
        const row: SimulatedNodeRow | null = run.simulator.nodeRow("pve3");
        expect(row).toEqual({
          lastSeenAt: new Date(lastOwnPush.pushTimeMs),
          isNativePush: true,
        });
      });

      test("once a node is established after the outage, both survivors report pve3 (L = 2)", () => {
        const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
        expect(reports.length).toBeGreaterThan(100);
        for (const report of reports) {
          expect(report.silentNodes).toEqual(["pve3"]);
          expect(report.reporterCount).toBe(2);
        }
        expect(
          new Set(
            reports.map((report: NodeStatusPushRecord) => {
              return report.nodeName;
            }),
          ),
        ).toEqual(new Set(["pve1", "pve2"]));

        expect(reports[0]!.receiveMs).toBeGreaterThanOrEqual(
          firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS,
        );
        expect(reports[0]!.receiveMs).toBeLessThan(
          firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS + 15_000,
        );
      });

      test("Node Offline fires for node/pve3 at the first evaluation after the first report, and keeps firing — never for pve1 or pve2", () => {
        const firstReport: NodeStatusPushRecord = reportingPushes(run)[0]!;
        const first: Tick | undefined = firstTick(run, (tick: Tick) => {
          return tick.nodeOffline.fires;
        });
        expect(first).toBeDefined();
        expect(first!.atMs).toBeGreaterThanOrEqual(firstReport.receiveMs);
        expect(first!.atMs).toBeLessThanOrEqual(
          firstReport.receiveMs + EVALUATION_STEP_MS,
        );

        const after: Array<Tick> = ticksFrom(run, first!.atMs);
        expect(after.length).toBeGreaterThan(20);
        for (const tick of after) {
          expect(tick.nodeOffline.fires).toBe(true);
          expect(tick.nodeOffline.offlineIds).toEqual(["node/pve3"]);
          expect(tick.nodeOffline.healthyIds).toEqual([
            "node/pve1",
            "node/pve2",
          ]);
        }
        expect(first!.nodeOffline.rootCause).toContain("node/pve3");
      });

      test("Quorum never fires", () => {
        for (const tick of run.ticks) {
          expect(tick.quorum.fires).toBe(false);
        }
      });

      test("the verdicts equal the oracle on every evaluation", () => {
        expectMatchesOracle(run);
      });
    });

    /*
     * Not the design — the gap it closes. Without the native-Node keep
     * the warm-up tick prunes pve3's row (never marked Offline, since
     * nobody could report it before the outage), the next roster load
     * no longer has it, and pve3 is never reported again: no Node
     * Offline, ever, for a node that is down.
     */
    describe("counterfactual: without the native-Node keep", () => {
      let run: ScenarioRun;

      beforeAll(async () => {
        run = await runScenario(scenario(true));
      });

      test("the warm-up tick prunes pve3's row before anyone could report it", () => {
        const cleanup: SimulatedCleanupRun = warmUpCleanup(run);
        expect(cleanup.atMs).toBeLessThan(
          firstPushBack(run).receiveMs + PROXMOX_NODE_SILENCE_MS,
        );
        expect(cleanup.prunedNodes).toEqual(["pve3"]);
        expect(run.simulator.nodeRow("pve3")).toBeNull();
      });

      test("pve3 is never reported and Node Offline never fires", () => {
        expect(reportingPushes(run)).toEqual([]);
        for (const tick of run.ticks) {
          expect(tick.nodeOffline.fires).toBe(false);
        }
      });

      test("the verdicts equal the oracle (which replays the prune) on every evaluation", () => {
        expectMatchesOracle(run);
      });
    });
  });

  /*
   * Every survivor reports every dead node on every push, so reports grow
   * as L × D. At corosync scale with half the cluster down, the window's
   * node pve_up rows outgrow the grouped read's LIMIT 10000 (newest
   * first) — the oldest minute drops out of the read, and the verdict
   * must not change. Node pushes only, and only the two series the
   * templates read, to keep the run small.
   */
  describe("36 nodes, pve19–pve36 die (L = D = 18): the raw read hits LIMIT 10000", () => {
    const deadNodes: Array<string> = nodeNamesOf(36).slice(18);
    const deadIds: Array<string> = deadNodes
      .map((name: string) => {
        return `node/${name}`;
      })
      .sort();
    let run: ScenarioRun;

    beforeAll(async () => {
      const downRanges: Dictionary<Array<TimeRange>> = {};
      for (const name of deadNodes) {
        downRanges[name] = [{ fromMs: DEATH_MS, toMs: NEVER_MS }];
      }
      run = await runScenario({
        seed: 131,
        nodeCount: 36,
        durationMinutes: 40,
        downRanges: downRanges,
        pushKinds: ["node"],
        storedMetricNames: ["pve_up", "pve_node_info"],
        evaluateFromMs: DEATH_MS - MINUTE_MS + 7_000,
      });
    }, 120_000);

    test("the steady window holds more node pve_up rows than the grouped read returns", () => {
      const last: Tick = run.ticks[run.ticks.length - 1]!;
      const inWindow: number = nodeScopeRows(run, "pve_up").filter(
        (row: SimulatedMetricRow) => {
          const rowMs: number = row.time.getTime();
          return rowMs >= last.atMs - WINDOW_MS && rowMs <= last.atMs;
        },
      ).length;
      expect(inWindow).toBeGreaterThan(10000);
    });

    test("Node Offline names exactly the 18 dead nodes, 5 minutes on, and never a live one", () => {
      const first: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.nodeOffline.fires;
      });
      expect(first).toBeDefined();
      expect(first!.atMs).toBeGreaterThan(DEATH_MS + 4 * MINUTE_MS);
      expect(first!.atMs).toBeLessThanOrEqual(DEATH_MS + 7 * MINUTE_MS);

      for (const tick of run.ticks) {
        for (const id of tick.nodeOffline.offlineIds) {
          expect(deadIds).toContain(id);
        }
      }
      for (const tick of ticksFrom(run, DEATH_MS + 6 * MINUTE_MS)) {
        expect(tick.nodeOffline.offlineIds).toEqual(deadIds);
        expect(tick.nodeOffline.healthyIds).toHaveLength(18);
      }
    });

    test("Quorum fires at exactly 50 % on every evaluation once the window is fully post-death", () => {
      const steady: Array<Tick> = steadyTicks(run, deadNodes);
      expect(steady.length).toBeGreaterThan(15);
      expect(steady).toEqual(ticksFrom(run, steady[0]!.atMs));
      for (const tick of steady) {
        expect(tick.quorum.fires).toBe(true);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
      }
    });

    test("every report's rows add up to D ÷ L = 1 (18 weights of 3640 or 3641 units)", () => {
      expectReportRowsAddUp(run);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  /*
   * A survivor that drops out for 60–120 s is never reported (its gap is
   * shorter than the silence window), but its streak restarts: for its
   * first 2 minutes back it is not established. It reports anyway —
   * every live node does, once the cluster has an established node — so
   * every push in the cluster carries D ÷ L with L = 2 throughout: pve1's
   * during the gap (pve2's key outlives it) and both survivors' after.
   * Every push then reads 1 ÷ (1 + D ÷ L) = 50 % on its own, and so does
   * any minute bucket, however unevenly the pushes fall into it.
   *
   * (When only established nodes reported, pve1 carried D ÷ 1 alone
   * while pve2 warmed up; a minute holding more pve2 pushes than pve1
   * pushes read above 50 %, and Quorum at Risk stopped matching for ~5
   * minutes — MonitorResource's "no criteria met" path auto-resolved its
   * alert and incident with half the cluster down all along.)
   */
  describe("4 nodes, pve3 and pve4 dead, then survivor pve2 drops out for 90 s", () => {
    const BLIP_FROM_MS: number = DEATH_MS + 12 * MINUTE_MS;
    const BLIP_TO_MS: number = BLIP_FROM_MS + 90_000;
    let run: ScenarioRun;
    let back: NodeStatusPushRecord;

    beforeAll(async () => {
      run = await runScenario({
        seed: 151,
        nodeCount: 4,
        durationMinutes: 50,
        downRanges: {
          pve2: [{ fromMs: BLIP_FROM_MS, toMs: BLIP_TO_MS }],
          pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve4: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
        },
      });
      const firstBack: NodeStatusPushRecord | undefined = run.simulator
        .ownPushes("pve2")
        .find((push: NodeStatusPushRecord) => {
          return push.pushTimeMs > BLIP_FROM_MS;
        });
      if (!firstBack) {
        throw new Error("pve2 never came back");
      }
      back = firstBack;
    });

    test("before the blip, Quorum is firing at exactly 50 %", () => {
      const steady: Array<Tick> = steadyTicks(run, ["pve3", "pve4"]);
      expect(steady.length).toBeGreaterThan(5);
      expect(steady[0]!.atMs).toBeLessThan(BLIP_FROM_MS);
      for (const tick of steady) {
        expect(tick.quorum.fires).toBe(true);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
      }
      // Firing on every evaluation from the first steady one to the blip.
      for (const tick of ticksFrom(run, steady[0]!.atMs)) {
        if (tick.atMs < BLIP_FROM_MS) {
          expect(tick.quorum.fires).toBe(true);
        }
      }
    });

    test("pve2 is never reported: its gap is shorter than the silence window", () => {
      expect(run.simulator.reportsOf("pve2")).toEqual([]);
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.offlineIds).not.toContain("node/pve2");
      }
    });

    test("Node Offline keeps firing for node/pve3 and node/pve4 throughout", () => {
      for (const tick of ticksFrom(run, DEATH_MS + 6 * MINUTE_MS)) {
        expect(tick.nodeOffline.offlineIds).toEqual(["node/pve3", "node/pve4"]);
      }
    });

    test("pve2 reports from its first push back, while warming up, and both survivors carry D ÷ 2", () => {
      const replay: Map<NodeStatusPushRecord, ExpectedReport> =
        replayReports(run);
      const warmUpEndMs: number =
        back.receiveMs + PROXMOX_NODE_SILENCE_MS - 5_000;

      // The gap outlasted PROXMOX_NODE_STREAK_GAP_MS: the streak restarted.
      expect(
        back.receiveMs - lastOwnPushBefore(run, "pve2", BLIP_FROM_MS).receiveMs,
      ).toBeGreaterThan(PROXMOX_NODE_STREAK_GAP_MS);
      expect(replayedReportOf(replay, back).reporterStreakMs).toBe(0);

      const returning: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve2")
        .filter((push: NodeStatusPushRecord) => {
          return (
            push.receiveMs >= back.receiveMs && push.receiveMs < warmUpEndMs
          );
        });
      expect(returning.length).toBeGreaterThan(8);
      for (const push of returning) {
        expect(replayedReportOf(replay, push).reporterStreakMs).toBeLessThan(
          PROXMOX_NODE_SILENCE_MS,
        );
        expect(push.silentNodes).toEqual(["pve3", "pve4"]);
        expect(push.reporterCount).toBe(2);
        expect(reportInfoWeight(push)).toBe(1);
      }

      // pve1 counts pve2 live all along: through the gap, and after.
      const alongside: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return push.receiveMs >= BLIP_FROM_MS && push.receiveMs < warmUpEndMs;
        });
      expect(alongside.length).toBeGreaterThan(15);
      for (const push of alongside) {
        expect(push.silentNodes).toEqual(["pve3", "pve4"]);
        expect(push.reporterCount).toBe(2);
        expect(reportInfoWeight(push)).toBe(1);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });

    test("Quorum at Risk keeps firing on every evaluation throughout, the blip included, at exactly 50 %", () => {
      expectQuorumFiresThroughout({
        run: run,
        deadNodes: ["pve3", "pve4"],
        mustFireBeforeMs: BLIP_FROM_MS,
      });
    });
  });

  /*
   * OneUptime falls behind on one survivor's requests: for 10 minutes
   * pve2's pushes are processed in bursts 50–70 s apart, each keeping its
   * own point time. Every processing gap over PROXMOX_NODE_STREAK_GAP_MS
   * restarts pve2's streak, so it is seldom established — it reports
   * anyway (it is alive), with L = 2, and pve1 keeps L = 2 because pve2's
   * key outlives every gap. pve2's rows reach their minute buckets late
   * and in lumps, yet every push reads 50 % on its own, so Quorum at Risk
   * keeps firing on every evaluation.
   */
  describe("4 nodes, pve3 and pve4 dead, survivor pve2's pushes processed every 50–70 s for 10 minutes", () => {
    const STALL_FROM_MS: number = DEATH_MS + 10 * MINUTE_MS;
    const STALL_TO_MS: number = STALL_FROM_MS + 10 * MINUTE_MS;
    let run: ScenarioRun;
    // pve2's burst times, oldest first.
    let bursts: Array<number>;

    beforeAll(async () => {
      run = await runScenario({
        seed: 163,
        nodeCount: 4,
        durationMinutes: 50,
        downRanges: {
          pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          pve4: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
        },
        processingBursts: {
          pve2: {
            fromMs: STALL_FROM_MS,
            toMs: STALL_TO_MS,
            minIntervalMs: 50_000,
            maxIntervalMs: 70_000,
          },
        },
      });

      // A burst processes several of pve2's pushes at one instant.
      const pushesAt: Map<number, number> = new Map();
      for (const push of run.simulator.ownPushes("pve2")) {
        pushesAt.set(push.receiveMs, (pushesAt.get(push.receiveMs) || 0) + 1);
      }
      bursts = Array.from(pushesAt.entries())
        .filter(([, count]: [number, number]) => {
          return count > 1;
        })
        .map(([receiveMs]: [number, number]) => {
          return receiveMs;
        })
        .sort((a: number, b: number) => {
          return a - b;
        });
    });

    test("pve2's pushes really were processed in bursts 50–70 s apart, some too far apart to keep its streak", () => {
      expect(bursts.length).toBeGreaterThanOrEqual(9);
      expect(bursts[0]!).toBeGreaterThanOrEqual(STALL_FROM_MS + 50_000);
      expect(bursts[bursts.length - 1]!).toBeGreaterThanOrEqual(STALL_TO_MS);

      const gaps: Array<number> = bursts
        .slice(1)
        .map((atMs: number, index: number) => {
          return atMs - bursts[index]!;
        });
      for (const gapMs of gaps) {
        expect(gapMs).toBeGreaterThanOrEqual(50_000);
        expect(gapMs).toBeLessThanOrEqual(70_000);
      }
      /*
       * A gap over PROXMOX_NODE_STREAK_GAP_MS restarts pve2's streak. How
       * many there are is the draw's (2 to 7 of ~10 across seeds); how
       * much pve2 reported while warming up is checked below.
       */
      expect(
        gaps.filter((gapMs: number) => {
          return gapMs > PROXMOX_NODE_STREAK_GAP_MS;
        }).length,
      ).toBeGreaterThan(0);

      // Nothing of pve2's is processed between the bursts while it is behind.
      for (const push of run.simulator.ownPushes("pve2")) {
        if (
          push.receiveMs >= STALL_FROM_MS &&
          push.receiveMs <= bursts[bursts.length - 1]!
        ) {
          expect(bursts).toContain(push.receiveMs);
        }
      }
    });

    test("every survivor push reports pve3 and pve4 with L = 2 — pve2's too, established or warming up", () => {
      const replay: Map<NodeStatusPushRecord, ExpectedReport> =
        replayReports(run);
      const stalled: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve2")
        .filter((push: NodeStatusPushRecord) => {
          return bursts.includes(push.receiveMs);
        });
      expect(stalled.length).toBeGreaterThan(50);

      // Pushes a node still warming up made: its streak under 2 minutes.
      const warmingUp: Array<NodeStatusPushRecord> = stalled.filter(
        (push: NodeStatusPushRecord) => {
          return (
            replayedReportOf(replay, push).reporterStreakMs <
            PROXMOX_NODE_SILENCE_MS
          );
        },
      );
      expect(warmingUp.length).toBeGreaterThan(20);

      const alongside: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return (
            push.receiveMs >= STALL_FROM_MS &&
            push.receiveMs <= bursts[bursts.length - 1]!
          );
        });
      expect(alongside.length).toBeGreaterThan(50);

      for (const push of [...stalled, ...alongside]) {
        expect(push.silentNodes).toEqual(["pve3", "pve4"]);
        expect(push.reporterCount).toBe(2);
        expect(reportInfoWeight(push)).toBe(1);
      }
    });

    test("Quorum at Risk keeps firing on every evaluation throughout, the bursts included, at exactly 50 %", () => {
      expectQuorumFiresThroughout({
        run: run,
        deadNodes: ["pve3", "pve4"],
        mustFireBeforeMs: STALL_FROM_MS,
      });
    });

    test("Node Offline fires for node/pve3 and node/pve4 only; pve1 and pve2 stay healthy", () => {
      for (const tick of ticksFrom(run, DEATH_MS + 6 * MINUTE_MS)) {
        expect(tick.nodeOffline.offlineIds).toEqual(["node/pve3", "node/pve4"]);
        expect(tick.nodeOffline.healthyIds).toEqual(["node/pve1", "node/pve2"]);
      }
      expect(run.simulator.reportsOf("pve2")).toEqual([]);
    });

    test("every report's rows add up to D ÷ L", () => {
      expectReportRowsAddUp(run);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  describe("PVE_NATIVE_NODE_SILENCE_DETECTION=false, 3 nodes, pve3 dies", () => {
    let run: ScenarioRun;
    let previous: string | undefined;

    beforeAll(async () => {
      previous = process.env["PVE_NATIVE_NODE_SILENCE_DETECTION"];
      process.env["PVE_NATIVE_NODE_SILENCE_DETECTION"] = "false";
      try {
        run = await runScenario({
          seed: 101,
          nodeCount: 3,
          durationMinutes: 40,
          downRanges: { pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
        });
      } finally {
        if (previous === undefined) {
          delete process.env["PVE_NATIVE_NODE_SILENCE_DETECTION"];
        } else {
          process.env["PVE_NATIVE_NODE_SILENCE_DETECTION"] = previous;
        }
      }
    });

    test("turns the reports off: the dead node goes quiet as before", () => {
      expect(reportingPushes(run)).toEqual([]);
      for (const tick of run.ticks) {
        expect(tick.nodeOffline.fires).toBe(false);
        expect(tick.quorum.fires).toBe(false);
      }
      expectMatchesOracle(run);
    });
  });
});

/*
 * The stand-in has to be right for the rest to mean anything: it reads
 * what the ClickHouse statements would read.
 */
describe("SimulatedMetricTable", () => {
  const table: SimulatedMetricTable = new SimulatedMetricTable(7);
  const project: string = projectId.toString();
  const base: Date = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));

  function row(data: {
    secondsIn: number;
    value: number;
    attributes: JSONObject;
  }): SimulatedMetricRow {
    return {
      projectId: project,
      name: "pve_test",
      time: new Date(base.getTime() + data.secondsIn * 1000),
      value: data.value,
      attributes: data.attributes as SimulatedMetricRow["attributes"],
    };
  }

  beforeAll(() => {
    table.insertRow(row({ secondsIn: 0, value: 1, attributes: { k: "a" } }));
    table.insertRow(
      row({ secondsIn: 30, value: 0.25, attributes: { k: "a" } }),
    );
    table.insertRow(row({ secondsIn: 59, value: 3, attributes: { k: "b" } }));
    table.insertRow(row({ secondsIn: 60, value: 5, attributes: {} }));
    table.insertRow(row({ secondsIn: 125, value: 7, attributes: { k: "a" } }));
  });

  function query(data: {
    fromSeconds: number;
    toSeconds: number;
    attributes?: Dictionary<string> | undefined;
  }): Dictionary<unknown> {
    return {
      projectId: projectId,
      name: "pve_test",
      time: new InBetween<Date>(
        new Date(base.getTime() + data.fromSeconds * 1000),
        new Date(base.getTime() + data.toSeconds * 1000),
      ),
      ...(data.attributes ? { attributes: data.attributes } : {}),
    };
  }

  test("findBy: inclusive window, attribute equality, newest first, LIMIT", () => {
    const rows: Array<JSONObject> = table.findBy({
      query: query({ fromSeconds: 30, toSeconds: 125, attributes: { k: "a" } }),
      sort: { time: "DESC" },
      limit: 10,
    });
    expect(
      rows.map((r: JSONObject) => {
        return r["value"];
      }),
    ).toEqual([7, 0.25]);

    const limited: Array<JSONObject> = table.findBy({
      query: query({ fromSeconds: 0, toSeconds: 200 }),
      sort: { time: "DESC" },
      limit: 2,
    });
    expect(
      limited.map((r: JSONObject) => {
        return r["value"];
      }),
    ).toEqual([7, 5]);

    // attributes['k'] = '' matches a row without the key, like ClickHouse.
    const missing: Array<JSONObject> = table.findBy({
      query: query({ fromSeconds: 0, toSeconds: 200, attributes: { k: "" } }),
      limit: 10,
    });
    expect(
      missing.map((r: JSONObject) => {
        return r["value"];
      }),
    ).toEqual([5]);
  });

  test("aggregateBy: minute buckets with Sum / Min, newest first", () => {
    const window: { fromSeconds: number; toSeconds: number } = {
      fromSeconds: 0,
      toSeconds: 200,
    };
    const common: Omit<SimulatedAggregateByArgs, "aggregationType"> = {
      query: query(window),
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date(base.getTime()),
      endTimestamp: new Date(base.getTime() + 200 * 1000),
      limit: 10000,
    };

    const sums: Array<AggregatedModel> = table.aggregateBy({
      ...common,
      aggregationType: MetricsAggregationType.Sum,
    }).data;
    expect(
      sums.map((r: AggregatedModel) => {
        return [r.timestamp.getTime() - base.getTime(), r.value];
      }),
    ).toEqual([
      [120_000, 7],
      [60_000, 5],
      [0, 4.25],
    ]);

    const minima: Array<AggregatedModel> = table.aggregateBy({
      ...common,
      aggregationType: MetricsAggregationType.Min,
    }).data;
    expect(
      minima.map((r: AggregatedModel) => {
        return r.value;
      }),
    ).toEqual([7, 5, 0.25]);
  });

  test("refuses a query shape it does not emulate", () => {
    expect(() => {
      table.findBy({
        query: { ...query({ fromSeconds: 0, toSeconds: 1 }), serviceId: "x" },
        limit: 1,
      });
    }).toThrow();
    expect(() => {
      table.aggregateBy({
        query: query({ fromSeconds: 0, toSeconds: 1 }),
        aggregationType: MetricsAggregationType.Sum,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: new Date(base.getTime()),
        endTimestamp: new Date(base.getTime() + 1000),
        limit: 1,
        groupBy: { attributes: true },
      });
    }).toThrow();
  });
});
