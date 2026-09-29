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
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  PROXMOX_ROSTER_CACHE_TTL_MS,
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
  RosterOfflineRow,
  SILENT_NODE_MARK_FENCE_SECONDS,
  SILENT_NODE_MARK_REFRESH_MS,
  SimulatedAdoption,
  SimulatedAggregateByArgs,
  SimulatedCleanupRun,
  SimulatedFindByArgs,
  SimulatedIngestOutage,
  SimulatedMetricRow,
  SimulatedMetricTable,
  SimulatedNodeRow,
  SimulatedOfflineMark,
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
 *     with EX expiry — the nodes' liveness keys — and SET NX EX for the
 *     flush's fences;
 *   - the inventory's Node rows (lastSeenAt, isUp — Online from the
 *     node's own push, Offline once the flush's markNodesNotReporting has
 *     marked it — isNativePush, notReportingMarkedAt — the mark: written
 *     only by markNodesNotReporting, on the ingest worker's clock
 *     (markedAt), refreshed at most once a minute while the node stays
 *     reported, cleared by the node's own fold, never written by the
 *     adoption — and updatedAt, every write of the row on the database's
 *     clock, which may be skewed from the workers': the roster source,
 *     isUp and the mark included, never updatedAt), the flush's fenced
 *     Offline mark and native-push adoption,
 *     the cluster's heartbeat, and the Proxmox:CleanupStaleResources cron
 *     every 5 minutes: markDisconnectedClusters, then
 *     deleteStaleForCluster's predicate — native Node rows kept for the
 *     retention window — with the service's real cutoff helpers;
 *   - the clock: Date is faked and moved to each request's receive time,
 *     then to each evaluation time.
 *
 * NOT covered here: the SQL of the mark, the adoption and the prune
 * (ProxmoxResourceService.test.ts), the pages, what MonitorResource does
 * with a verdict (incidents, alerts, auto-resolve), and the ingest
 * service's own batching / routing (OtelMetricsIngestProxmoxNativePush
 * .test.ts covers the service).
 *
 * Every evaluation is also checked against an ORACLE computed from the
 * push log alone — which node pushed when (its own point time, and when
 * OneUptime processed it) — and the cron's prunes, in two steps. First
 * the design's rules are replayed over the log (replayReports): which
 * pushes report which siblings, and with what L — every LIVE node
 * reports, once the cluster has an ESTABLISHED node (a streak of 2
 * minutes, still unbroken now); while none is established, every live
 * node still reports the silent siblings already OFFLINE in the inventory
 * and MARKED within the monitor window of the moment the roster was read
 * (the row's notReportingMarkedAt, which the reports' own marks refresh
 * at most once a minute, on the worker's clock; the roster is cached for
 * 30 s, and every push it serves takes the marks' age at its read); L =
 * every node of the roster and the reporter that the report does not name
 * (presumed live until reported) — and every push's actual report, the
 * Offline rows of the roster it read with their marks, and when that
 * roster was read, must equal the replay's.
 * Then the closed form: each
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
/*
 * A node down "from the start": a status pass may land up to 300 ms before
 * its 10 s slot (jitter), so the first one can fall just before
 * SIM_START_MS — down from a minute earlier covers it.
 */
const BEFORE_START_MS: number = SIM_START_MS - MINUTE_MS;
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
  // The Node rows an earlier collector left, before the first push.
  initialNodeRows?: Dictionary<SimulatedNodeRow> | undefined;
  // A counterfactual: the flush does not adopt Node rows as native.
  withoutNativeAdoption?: boolean | undefined;
  // The database's clock minus the ingest workers'; 0 when not given.
  databaseClockOffsetMs?: number | undefined;
  // A counterfactual: the adoption also stamps updatedAt (as it first shipped).
  adoptionStampsUpdatedAt?: boolean | undefined;
  // A counterfactual: the mark writes and guards on the database's now().
  markOnDatabaseClock?: boolean | undefined;
  // A counterfactual: the mark kept in updatedAt (before notReportingMarkedAt).
  markInUpdatedAt?: boolean | undefined;
}

interface ScenarioRun {
  clusterName: string;
  proxmoxClusterId: ObjectID;
  nodeNames: Array<string>;
  // PVE_NATIVE_NODE_SILENCE_DETECTION as the run saw it.
  silenceDetection: boolean;
  // How the run's inventory writes the mark — the replay writes it alike.
  databaseClockOffsetMs: number;
  adoptionStampsUpdatedAt: boolean;
  markOnDatabaseClock: boolean;
  markInUpdatedAt: boolean;
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
        initialNodeRows: input.initialNodeRows,
        withoutNativeAdoption: input.withoutNativeAdoption,
        databaseClockOffsetMs: input.databaseClockOffsetMs,
        adoptionStampsUpdatedAt: input.adoptionStampsUpdatedAt,
        markOnDatabaseClock: input.markOnDatabaseClock,
        markInUpdatedAt: input.markInUpdatedAt,
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
    databaseClockOffsetMs: input.databaseClockOffsetMs || 0,
    adoptionStampsUpdatedAt: Boolean(input.adoptionStampsUpdatedAt),
    markOnDatabaseClock: Boolean(input.markOnDatabaseClock),
    markInUpdatedAt: Boolean(input.markInUpdatedAt),
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

// ProxmoxResourceService.markNodesNotReporting's fence (see the simulator).
const MARK_FENCE_MS: number = SILENT_NODE_MARK_FENCE_SECONDS * 1000;

// What one node-status push reports under the design's rules.
interface ExpectedReport {
  // Sorted; empty when the push reports nothing.
  silentNodes: Array<string>;
  // L, the nodes presumed live; 0 when the push reports nothing.
  reporterCount: number;
  // How long the reporter had been pushing without a gap (receive clock).
  reporterStreakMs: number;
  // Whether the cluster had an established node when the push was made.
  established: boolean;
  /*
   * The Offline rows of the roster the push read, with their marks — the
   * continuation's gate (as NodeStatusPushRecord.offlineRosterRows) — and
   * when that roster was read; null when detection is off.
   */
  offlineRosterRows: Array<RosterOfflineRow>;
  rosterReadAtMs: number | null;
}

// Whether one node's liveness makes the cluster ESTABLISHED at nowMs.
type EstablishedRule = (
  liveness: ProxmoxNodeLiveness | null,
  nowMs: number,
) => boolean;

/*
 * How a report counts L:
 *   - "presumed-live": every node of the roster and the reporter that it
 *     does not report — a node is presumed live until it is reported;
 *   - "live-keys": only the nodes with a live Redis key (never the design
 *     now — the rule before, which undercounted a live sibling whose first
 *     push after a gap was not processed yet).
 */
type ReporterCountRule = "presumed-live" | "live-keys";

// The rules replayReports applies.
interface ReplayRules {
  established: EstablishedRule;
  /*
   * While no node is established, the silent siblings already Offline in
   * the inventory are still reported. Off only for showing what a
   * scenario would do without it: the rule before, when the established
   * gate held back every report.
   */
  continuesOffline: boolean;
  /*
   * The continuation reports only the Offline nodes marked within this
   * long — the row's mark, as the roster carried it. The design: the
   * monitor window. null for no such gate (any Offline row continues,
   * marked or not) — never the design, only for showing what a scenario
   * would do without it.
   */
  continuationWindowMs: number | null;
  /*
   * When the mark's age is taken:
   *   - "roster-read": when the roster was read — every push one cached
   *     roster serves decides alike (the design);
   *   - "push": at each push's own processing — never the design: a push
   *     served a roster cached before the mark was rewritten judges the
   *     older mark later than the push that loaded it.
   */
  markAgeAt: "roster-read" | "push";
  reporterCount: ReporterCountRule;
}

const DESIGN_RULES: ReplayRules = {
  established: isEligibleProxmoxReporter,
  continuesOffline: true,
  continuationWindowMs: PROXMOX_MONITOR_WINDOW_MS,
  markAgeAt: "roster-read",
  reporterCount: "presumed-live",
};

/*
 * Never the design: the mark's age taken at each push, against the bare
 * monitor window — a push reading a roster cached from before the mark was
 * rewritten judged the older mark past the window, while the push that
 * loaded it had judged it within.
 */
const MARK_AGE_AT_PUSH: ReplayRules = {
  ...DESIGN_RULES,
  markAgeAt: "push",
};

/*
 * Never the design: the mark's age taken at each push, against the monitor
 * window plus the roster cache's 30 s — the slack only moves the edge: a
 * first push back reading a mark 300 to 330 s old continues (a node back
 * in the meantime included), and the pushes its cached roster serves drop
 * the report once the same mark passes 330 s at their own time.
 */
const MARK_AGE_AT_PUSH_WITH_CACHE_SLACK: ReplayRules = {
  ...DESIGN_RULES,
  continuationWindowMs: PROXMOX_MONITOR_WINDOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS,
  markAgeAt: "push",
};

// Never the design: every report waits for an established node.
const EVERY_REPORT_WAITS_FOR_ESTABLISHED: ReplayRules = {
  ...DESIGN_RULES,
  continuesOffline: false,
};

/*
 * Never the design: the continuation as it first shipped — ungated, with
 * L = the nodes with a live key.
 */
const CONTINUATION_AS_FIRST_SHIPPED: ReplayRules = {
  ...DESIGN_RULES,
  continuationWindowMs: null,
  reporterCount: "live-keys",
};

// Never the design: one of the two fixes to it without the other.
const WITHOUT_WINDOW_GATE: ReplayRules = {
  ...DESIGN_RULES,
  continuationWindowMs: null,
};
const L_FROM_LIVE_KEYS: ReplayRules = {
  ...DESIGN_RULES,
  reporterCount: "live-keys",
};

// One Node row of the replay's inventory.
interface ReplayedNodeRow {
  // On the node's own clock.
  lastSeenAtMs: number;
  isUp: boolean | null;
  isNativePush: boolean | null;
  /*
   * The mark: written by the mark on the receive (worker) clock, cleared
   * by the fold, null when never reported.
   */
  notReportingMarkedAtMs: number | null;
  // Every write of the row, on the database's clock.
  updatedAtMs: number;
}

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
 * push is at most STREAK_GAP_MS old — unless `rules` swaps in another
 * rule); the replay supplies what they are applied to and how the
 * cluster combines them:
 *   - a node's key lives SILENCE_MS after its last write, and is gone
 *     when Redis loses every key in an outage — a push with no key
 *     starts a new streak;
 *   - the inventory: the rows it started with, then each push's own
 *     fold (newest point time wins; the node is Online and native, its
 *     mark cleared, the row written now on the database's clock), the
 *     native-push adoption wherever the flush ran it (the rows not yet
 *     native and last seen by the batch's newest point turn native, their
 *     mark and updatedAt untouched), then — when the push reported — the
 *     Offline mark of the reported nodes last seen before its own time
 *     minus SILENCE_MS, at most once per 30 s for the same set of nodes
 *     (the fence lives in Redis: an outage that loses the keys loses it
 *     too), which writes a row (Offline, native, marked at the worker's
 *     now) only when it is not both Offline and native yet, or its mark is
 *     missing or over a minute older than the worker's now; less the rows
 *     the cleanup cron pruned (the adoptionStampsUpdatedAt,
 *     markOnDatabaseClock and markInUpdatedAt counterfactuals write those
 *     as they first shipped);
 *   - the roster: the inventory's Node rows, Online / Offline and their
 *     marks included, as they stood when it was last loaded — every push
 *     loads it once the 30 s cache has run out, warming up or not;
 *   - SILENT: a sibling in the roster, not alive, last seen before the
 *     reporter's own push time minus SILENCE_MS;
 *   - a push reports its silent siblings when it has any and the cluster
 *     has an established node — itself or any other; a live node still
 *     warming up reports too; while none is established, it reports those
 *     already Offline in the roster and marked within the monitor window
 *     of the moment that roster was read — with L = the nodes of the
 *     roster and itself that it does not report.
 */
function replayReports(
  run: ScenarioRun,
  rules: ReplayRules = DESIGN_RULES,
): Map<NodeStatusPushRecord, ExpectedReport> {
  const expected: Map<NodeStatusPushRecord, ExpectedReport> = new Map();
  const liveness: Map<string, ProxmoxNodeLiveness> = new Map();
  // Mark fences: the set of nodes (sorted, joined) → when it expires.
  const markFences: Map<string, number> = new Map();

  const inventory: Map<string, ReplayedNodeRow> = new Map();
  for (const [nodeName, row] of run.simulator.initialNodeRows()) {
    inventory.set(nodeName, {
      lastSeenAtMs: row.lastSeenAt.getTime(),
      isUp: row.isUp,
      isNativePush: row.isNativePush,
      notReportingMarkedAtMs: row.notReportingMarkedAt
        ? row.notReportingMarkedAt.getTime()
        : null,
      updatedAtMs: row.updatedAt.getTime(),
    });
  }
  // A row's mark, where the run keeps it (updatedAt under markInUpdatedAt).
  const markOf: (row: ReplayedNodeRow) => number | null = (
    row: ReplayedNodeRow,
  ): number | null => {
    return run.markInUpdatedAt ? row.updatedAtMs : row.notReportingMarkedAtMs;
  };
  const snapshot: () => Map<string, ReplayedNodeRow> = (): Map<
    string,
    ReplayedNodeRow
  > => {
    const copy: Map<string, ReplayedNodeRow> = new Map();
    for (const [nodeName, row] of inventory) {
      copy.set(nodeName, { ...row });
    }
    return copy;
  };

  /*
   * The adoptions, where the flush ran them — after the first `count`
   * node-status pushes, inside the last one's flush or after it. When is
   * the simulator's record (the fence, and requests that are not node
   * status); which rows it takes is the replay's own.
   */
  const adoptions: Array<SimulatedAdoption> = [...run.simulator.adoptions];
  const adoptAt: (count: number, withinNodeStatusPush: boolean) => void = (
    count: number,
    withinNodeStatusPush: boolean,
  ): void => {
    while (
      adoptions.length > 0 &&
      adoptions[0]!.nodeStatusPushCount === count &&
      adoptions[0]!.withinNodeStatusPush === withinNodeStatusPush
    ) {
      const adoption: SimulatedAdoption = adoptions.shift()!;
      for (const row of inventory.values()) {
        if (
          row.isNativePush !== true &&
          row.lastSeenAtMs <= adoption.seenUpToMs
        ) {
          row.isNativePush = true;
          if (run.adoptionStampsUpdatedAt) {
            row.updatedAtMs = adoption.atMs + run.databaseClockOffsetMs;
          }
        }
      }
    }
  };
  adoptAt(0, false);

  let roster: Map<string, ReplayedNodeRow> | null = null;
  let rosterLoadedAtMs: number = 0;
  let processed: number = 0;
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
      markFences.clear();
      lostAtMs.shift();
    }
    while (prunes.length > 0 && prunes[0]!.atMs < nowMs) {
      inventory.delete(prunes[0]!.nodeName);
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
      established: false,
      offlineRosterRows: [],
      rosterReadAtMs: null,
    };

    if (run.silenceDetection) {
      const current: ProxmoxNodeLiveness = nextProxmoxNodeLiveness(
        keyOf(push.nodeName),
        nowMs,
      );
      liveness.set(push.nodeName, current);
      report.reporterStreakMs = nowMs - current.streakStartMs;

      if (!roster || nowMs > rosterLoadedAtMs + PROXMOX_ROSTER_CACHE_TTL_MS) {
        roster = snapshot();
        rosterLoadedAtMs = nowMs;
      }
      const rosterNow: Map<string, ReplayedNodeRow> = roster;
      report.rosterReadAtMs = rosterLoadedAtMs;
      report.offlineRosterRows = Array.from(rosterNow.entries())
        .filter(([, row]: [string, ReplayedNodeRow]) => {
          return row.isUp === false;
        })
        .map(([nodeName, row]: [string, ReplayedNodeRow]) => {
          return { nodeName: nodeName, markedAtMs: markOf(row) };
        })
        .sort((a: RosterOfflineRow, b: RosterOfflineRow) => {
          return a.nodeName.localeCompare(b.nodeName);
        });
      const nodes: Set<string> = new Set<string>([
        ...rosterNow.keys(),
        push.nodeName,
      ]);

      let liveCount: number = 0;
      for (const nodeName of nodes) {
        const entry: ProxmoxNodeLiveness | null = keyOf(nodeName);
        if (isAliveProxmoxNode(entry, nowMs)) {
          liveCount++;
        }
        if (rules.established(entry, nowMs)) {
          report.established = true;
        }
      }

      const silentBeforeMs: number = push.pushTimeMs - PROXMOX_NODE_SILENCE_MS;
      const silentNodes: Array<string> = Array.from(rosterNow.keys())
        .filter((nodeName: string) => {
          return (
            nodeName !== push.nodeName &&
            !isAliveProxmoxNode(keyOf(nodeName), nowMs) &&
            rosterNow.get(nodeName)!.lastSeenAtMs < silentBeforeMs
          );
        })
        .sort();

      /*
       * Without an established node: Offline, and marked within the window
       * of the roster's read (or, never the design, of the push).
       */
      const ageAtMs: number =
        rules.markAgeAt === "roster-read" ? rosterLoadedAtMs : nowMs;
      const continues: (nodeName: string) => boolean = (
        nodeName: string,
      ): boolean => {
        const row: ReplayedNodeRow = rosterNow.get(nodeName)!;
        if (row.isUp !== false) {
          return false;
        }
        if (rules.continuationWindowMs === null) {
          return true;
        }
        const markedAtMs: number | null = markOf(row);
        return (
          markedAtMs !== null &&
          ageAtMs - markedAtMs <= rules.continuationWindowMs
        );
      };
      const reported: Array<string> = report.established
        ? silentNodes
        : rules.continuesOffline
          ? silentNodes.filter(continues)
          : [];
      if (reported.length > 0) {
        report.silentNodes = reported;
        report.reporterCount =
          rules.reporterCount === "presumed-live"
            ? nodes.size - reported.length
            : liveCount;
      }
    }

    expected.set(push, report);
    processed++;

    // The flush, after the report. The fold: newest point time wins.
    const databaseNowMs: number = nowMs + run.databaseClockOffsetMs;
    const own: ReplayedNodeRow | undefined = inventory.get(push.nodeName);
    if (!own) {
      inventory.set(push.nodeName, {
        lastSeenAtMs: push.pushTimeMs,
        isUp: true,
        isNativePush: true,
        notReportingMarkedAtMs: null,
        updatedAtMs: databaseNowMs,
      });
    } else if (push.pushTimeMs >= own.lastSeenAtMs) {
      own.lastSeenAtMs = push.pushTimeMs;
      own.isUp = true;
      own.isNativePush = true;
      own.notReportingMarkedAtMs = null;
      own.updatedAtMs = databaseNowMs;
    }

    adoptAt(processed, true);

    /*
     * The Offline mark of what it reported, fenced per set of nodes, at
     * markedAt — the worker's now; a row already Offline and native is
     * marked again once its mark is missing or over a minute older than
     * that.
     */
    if (report.silentNodes.length > 0) {
      const markedAtMs: number = run.markOnDatabaseClock
        ? databaseNowMs
        : nowMs;
      const fence: string = report.silentNodes.join("\n");
      const heldUntilMs: number | undefined = markFences.get(fence);
      if (heldUntilMs === undefined || nowMs >= heldUntilMs) {
        markFences.set(fence, nowMs + MARK_FENCE_MS);
        for (const nodeName of report.silentNodes) {
          const row: ReplayedNodeRow | undefined = inventory.get(nodeName);
          if (
            !row ||
            row.lastSeenAtMs >= push.pushTimeMs - PROXMOX_NODE_SILENCE_MS
          ) {
            continue;
          }
          const lastMarkMs: number | null = markOf(row);
          if (
            row.isUp !== false ||
            row.isNativePush !== true ||
            lastMarkMs === null ||
            lastMarkMs < markedAtMs - SILENT_NODE_MARK_REFRESH_MS
          ) {
            row.isUp = false;
            row.isNativePush = true;
            if (run.markInUpdatedAt) {
              row.updatedAtMs = markedAtMs;
            } else {
              row.notReportingMarkedAtMs = markedAtMs;
              row.updatedAtMs = databaseNowMs;
            }
          }
        }
      }
    }

    adoptAt(processed, false);
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

/*
 * Every push reported exactly what the replayed rules say it should, and
 * read the Offline rows exactly as the replay has them — each one's last
 * mark included — from a roster read exactly when the replay's was.
 */
function expectReportsMatchReplay(
  run: ScenarioRun,
  replay: Map<NodeStatusPushRecord, ExpectedReport>,
): void {
  const rosterState: (
    rows: Array<RosterOfflineRow>,
    readAtMs: number | null,
  ) => string = (
    rows: Array<RosterOfflineRow>,
    readAtMs: number | null,
  ): string => {
    const readAt: string =
      readAtMs === null ? "no roster" : new Date(readAtMs).toISOString();
    if (rows.length === 0) {
      return `roster read ${readAt}: no Offline row`;
    }
    return `roster read ${readAt}: ${rows
      .map((row: RosterOfflineRow) => {
        const markedAt: string =
          row.markedAtMs === null
            ? "never"
            : new Date(row.markedAtMs).toISOString();
        return `${row.nodeName} Offline, marked ${markedAt}`;
      })
      .join(", ")}`;
  };
  // Collected, then asserted once: thousands of pushes on a big cluster.
  const problems: Array<string> = [];
  for (const push of run.simulator.nodeStatusPushes) {
    const expected: ExpectedReport = replayedReportOf(replay, push);
    const actual: string = `${push.silentNodes.join(",")} / L=${push.reporterCount} / ${rosterState(push.offlineRosterRows, push.rosterReadAtMs)}`;
    const wanted: string = `${expected.silentNodes.join(",")} / L=${expected.reporterCount} / ${rosterState(expected.offlineRosterRows, expected.rosterReadAtMs)}`;
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

// One evaluation's verdicts — the monitor's, or the oracle's under some rules.
interface Verdict {
  atMs: number;
  quorumFires: boolean;
  quorumHealthy: boolean;
  quorumPoints: Array<FormulaPoint>;
  // Node Offline: the node ids its offline criteria matched.
  offlineIds: Array<string>;
}

function verdictsOf(ticks: Array<Tick>): Array<Verdict> {
  return ticks.map((tick: Tick) => {
    return {
      atMs: tick.atMs,
      quorumFires: tick.quorum.fires,
      quorumHealthy: tick.quorum.healthy,
      quorumPoints: tick.quorum.formulaPoints,
      offlineIds: tick.nodeOffline.offlineIds,
    };
  });
}

/*
 * The verdicts the closed form gives over the same push log when the
 * reports follow `rules` — what the monitor WOULD have said.
 */
function oracleVerdicts(
  run: ScenarioRun,
  ticks: Array<Tick>,
  rules: ReplayRules,
): Array<Verdict> {
  const replay: Map<NodeStatusPushRecord, ExpectedReport> = replayReports(
    run,
    rules,
  );
  return ticks.map((tick: Tick) => {
    const quorum: ExpectedQuorum = expectedQuorum({
      run,
      replay,
      atMs: tick.atMs,
    });
    return {
      atMs: tick.atMs,
      quorumFires: quorum.fires,
      quorumHealthy: quorum.healthy,
      quorumPoints: quorum.points,
      offlineIds: expectedNodeOffline({ run, replay, atMs: tick.atMs })
        .offlineIds,
    };
  });
}

function describeQuorum(verdict: Verdict): string {
  const state: string = verdict.quorumFires
    ? "fires"
    : verdict.quorumHealthy
      ? "HEALTHY"
      : "NO CRITERIA MET";
  const points: string = verdict.quorumPoints
    .map((point: FormulaPoint) => {
      return `${new Date(point.timestampMs).toISOString().substring(11, 16)}=${point.value.toFixed(2)}%`;
    })
    .join(" ");
  return `Quorum ${state} [${points}]`;
}

/*
 * VERDICT CONTINUITY through an ongoing failure: on every evaluation
 * Quorum at Risk matches its offline criteria — never "no criteria met"
 * (MonitorResource then auto-resolves its alert and incident, to page
 * again minutes later) and never healthy — and Node Offline keeps every
 * dead node's series firing. Returns the evaluations that break it, each
 * with its minutes' availability; empty when it holds.
 */
function continuityBreaks(data: {
  verdicts: Array<Verdict>;
  deadIds: Array<string>;
}): Array<string> {
  const breaks: Array<string> = [];
  for (const verdict of data.verdicts) {
    const notFiring: Array<string> = data.deadIds.filter((id: string) => {
      return !verdict.offlineIds.includes(id);
    });
    if (verdict.quorumFires && notFiring.length === 0) {
      continue;
    }
    breaks.push(
      `${new Date(verdict.atMs).toISOString()}: ${describeQuorum(verdict)}` +
        (notFiring.length > 0
          ? `; Node Offline NOT firing for ${notFiring.join(", ")}`
          : ""),
    );
  }
  return breaks;
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
      /*
       * The continuation's gate is this same window, the mark's age taken
       * when the roster was read — which a worker reuses for 30 s.
       */
      expect(PROXMOX_MONITOR_WINDOW_MS).toBe(WINDOW_MS);
      expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBe(30_000);
    });

    /*
     * The continuation's gate, spelled out on the simplest run (the oracle
     * checks the rows every push read): the first report's flush marks
     * pve3 Offline — its notReportingMarkedAt written then. While the
     * survivors keep reporting it, the mark is fenced to once per 30 s for
     * the set, and the UPDATE writes the mark again only once it is over a
     * minute old: a refresh every 60 to 90 s, never more often. So every
     * roster read from then on has pve3 Offline and marked less than
     * 2 minutes before — refresh plus the roster cache's 30 s — well
     * within the monitor window.
     */
    test("the first report marks pve3 Offline, and while it is reported its mark is refreshed every 60 to 90 s — every roster after reads it marked within 2 minutes", () => {
      const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
      const writes: Array<SimulatedOfflineMark> =
        run.simulator.offlineMarks.filter((mark: SimulatedOfflineMark) => {
          return mark.markedNodes.includes("pve3");
        });
      expect(writes.length).toBeGreaterThan(15);
      expect(writes[0]!.atMs).toBe(reports[0]!.receiveMs);

      for (let index: number = 1; index < writes.length; index++) {
        const intervalMs: number =
          writes[index]!.atMs - writes[index - 1]!.atMs;
        expect(intervalMs).toBeGreaterThan(SILENT_NODE_MARK_REFRESH_MS);
        expect(intervalMs).toBeLessThan(
          SILENT_NODE_MARK_REFRESH_MS + MARK_FENCE_MS,
        );
      }
      // The fence let marks through in between: the refresh guard held them.
      expect(
        run.simulator.offlineMarks.filter((mark: SimulatedOfflineMark) => {
          return !mark.fenced && mark.markedNodes.length === 0;
        }).length,
      ).toBeGreaterThan(10);

      for (const push of run.simulator.nodeStatusPushes) {
        if (push.receiveMs <= writes[0]!.atMs) {
          expect(push.offlineRosterRows).toEqual([]);
        }
      }
      const reloaded: Array<NodeStatusPushRecord> =
        run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
          return push.receiveMs > writes[0]!.atMs + PROXMOX_ROSTER_CACHE_TTL_MS;
        });
      expect(reloaded.length).toBeGreaterThan(100);
      const freshWithinMs: number =
        SILENT_NODE_MARK_REFRESH_MS +
        MARK_FENCE_MS +
        PROXMOX_ROSTER_CACHE_TTL_MS;
      expect(freshWithinMs).toBeLessThan(PROXMOX_MONITOR_WINDOW_MS);
      for (const push of reloaded) {
        expect(push.offlineRosterRows.length).toBe(1);
        expect(push.offlineRosterRows[0]!.nodeName).toBe("pve3");
        const markedAtMs: number | null = push.offlineRosterRows[0]!.markedAtMs;
        expect(markedAtMs).not.toBeNull();
        expect(push.receiveMs - markedAtMs!).toBeLessThan(freshWithinMs);
      }
      // Each write of the mark is the worker's now; pve3's row holds the last.
      for (const write of writes) {
        expect(write.markedAtMs).toBe(write.atMs);
      }
      expect(run.simulator.nodeRow("pve3")?.notReportingMarkedAt).toEqual(
        new Date(writes[writes.length - 1]!.atMs),
      );
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
       * is not yet silent — presumed live until it is reported, so L = 2
       * throughout, its key gone or not.
       */
      const firstFullMs: number = full[0]!.receiveMs;
      const partial: Array<NodeStatusPushRecord> = reports.filter(
        (report: NodeStatusPushRecord) => {
          return !full.includes(report);
        },
      );
      expect(partial.length).toBeGreaterThan(0);
      for (const report of partial) {
        expect(report.silentNodes).toEqual(["pve2"]);
        expect(report.reporterCount).toBe(2);
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
       * to 10 s apart: for those seconds the later one is not yet silent
       * — presumed live until it is reported, its key gone or not, so
       * L = 3 — while the earlier one is reported alone.
       */
      const firstFullMs: number = fullReports[0]!.receiveMs;
      for (const report of reportingPushes(run)) {
        if (report.silentNodes.length === 1) {
          expect(report.reporterCount).toBe(3);
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
   * reports a sibling that is not yet Offline until a node has pushed for
   * 2 minutes after the outage, by when every live node has a key again.
   * pve5 IS Offline (reported and marked long before), so every live node
   * keeps reporting it from its first push back — the established gate
   * guards a node's first report only, and pve5's row was last marked
   * less than a monitor window before (at most 90 s before the outage),
   * the reports back then marking it again themselves. Each
   * report counts L = 4: every node it does not name is presumed live,
   * a live sibling whose first push back is not processed yet included,
   * so every push weighs pve5 at exactly a quarter of a node.
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
        { ...DESIGN_RULES, established: established },
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

    test("no live node is ever reported; pve5, already Offline, is reported by every push back from the outage — none established for 2 minutes", () => {
      const replay: Map<NodeStatusPushRecord, ExpectedReport> =
        replayReports(run);
      const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
      for (const report of reports) {
        expect(report.silentNodes).toEqual(["pve5"]);
      }
      for (const name of LIVE_NODES) {
        expect(run.simulator.reportsOf(name)).toEqual([]);
      }
      expect(run.simulator.nodeRow("pve5")?.isUp).toBe(false);

      // Reported up to the outage…
      expect(
        reports.some((report: NodeStatusPushRecord) => {
          return (
            report.receiveMs < OUTAGE_FROM_MS &&
            report.receiveMs >= OUTAGE_FROM_MS - 15_000
          );
        }),
      ).toBe(true);

      // …and by every push after it, from the very first one back…
      const after: Array<NodeStatusPushRecord> =
        run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
          return push.receiveMs >= OUTAGE_FROM_MS;
        });
      expect(after.length).toBeGreaterThan(50);
      expect(after[0]).toBe(firstBack);
      for (const push of after) {
        expect(push.silentNodes).toEqual(["pve5"]);
      }

      // …though no node was established for the first 2 minutes back…
      const warmUp: Array<NodeStatusPushRecord> = after.filter(
        (push: NodeStatusPushRecord) => {
          return !replayedReportOf(replay, push).established;
        },
      );
      expect(warmUp.length).toBeGreaterThan(20);
      expect(warmUp[0]).toBe(firstBack);
      for (const push of warmUp) {
        expect(push.receiveMs).toBeLessThan(
          firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS + 15_000,
        );
        /*
         * …while the roster had pve5 Offline, marked within the window of
         * its read (at most the cache's 30 s before the push).
         */
        expect(push.offlineRosterRows.length).toBe(1);
        expect(push.offlineRosterRows[0]!.nodeName).toBe("pve5");
        const markedAtMs: number = push.offlineRosterRows[0]!.markedAtMs!;
        const readAtMs: number = push.rosterReadAtMs!;
        expect(push.receiveMs - readAtMs).toBeLessThanOrEqual(
          PROXMOX_ROSTER_CACHE_TTL_MS,
        );
        expect(readAtMs - markedAtMs).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
      }
      // The first read after the outage: the last mark before it.
      expect(firstBack.rosterReadAtMs).toBe(firstBack.receiveMs);
      expect(firstBack.offlineRosterRows[0]!.markedAtMs!).toBeLessThan(
        OUTAGE_FROM_MS,
      );
      /*
       * The warm-up's own reports mark pve5 again — over a minute old by
       * then — so the mark the continuation reads stays fresh.
       */
      expect(
        run.simulator.offlineMarks.some((mark: SimulatedOfflineMark) => {
          return (
            mark.markedNodes.includes("pve5") &&
            mark.atMs >= firstBack.receiveMs &&
            mark.atMs <= warmUp[warmUp.length - 1]!.receiveMs
          );
        }),
      ).toBe(true);

      // L = 4 on every report, the warm-up included.
      for (const push of reports) {
        expect(push.reporterCount).toBe(4);
      }
    });

    /*
     * L counted from the nodes with a live key — the rule before — came up
     * short by one or two in the warm-up, while a live sibling's key had
     * run out before its first push back was processed: those pushes
     * weighed pve5 at a third or a half of a node, and their minutes read
     * below 4 ÷ 5. Whether a push lands in those seconds is the draw's
     * (this one does, as did 23 of 24 other draws); 4 ÷ 5 held in all.
     */
    test("availability reads exactly 4 ÷ 5 in every minute once pve5 is reported, the warm-up after the outage included — with L from live keys it would not", () => {
      const firstFull: Tick | undefined = steadyTicks(run, ["pve5"])[0];
      expect(firstFull).toBeDefined();
      const through: Array<Tick> = ticksFrom(run, firstFull!.atMs);
      expect(through.length).toBeGreaterThan(30);
      for (const tick of through) {
        expect(tick.quorum.formulaPoints.length).toBeGreaterThanOrEqual(3);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBeCloseTo(80, 10);
        }
      }

      const undercounted: Array<string> = [];
      for (const verdict of oracleVerdicts(run, through, L_FROM_LIVE_KEYS)) {
        for (const point of verdict.quorumPoints) {
          if (point.value < 80 - 1e-9) {
            undercounted.push(
              `${new Date(point.timestampMs).toISOString()}=${point.value}`,
            );
          }
        }
      }
      expect(undercounted.length).toBeGreaterThan(0);
    });

    /*
     * The trap is really set: replayed with the rule that took any alive
     * key with a 2-minute streak as established, pushes right after the
     * outage report live nodes — the ones whose keys had just expired.
     * Whether a push lands in those few seconds is the draw's (this one
     * does; the sweep below counts how many do). The real pushes there
     * reported only pve5, already Offline — never a live node.
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
        expect(push.silentNodes).toEqual(["pve5"]);
        expect(push.reporterCount).toBe(4);
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
        // pve5, already Offline, is reported on every push back.
        expect(sweep.simulator.reportsOf("pve5").length).toBeGreaterThan(100);
        for (const push of sweep.simulator.nodeStatusPushes) {
          if (push.receiveMs >= OUTAGE_FROM_MS) {
            expect({ seed, silentNodes: push.silentNodes }).toEqual({
              seed,
              silentNodes: ["pve5"],
            });
          }
        }

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
        /*
         * Never marked before the outage (nobody had reported it), so it
         * was still Online at the tick — only the first report after the
         * outage marks it Offline.
         */
        const firstMark: SimulatedOfflineMark | undefined =
          run.simulator.offlineMarks.find((mark: SimulatedOfflineMark) => {
            return mark.markedNodes.includes("pve3");
          });
        expect(firstMark).toBeDefined();
        expect(firstMark!.atMs).toBeGreaterThan(cleanup.atMs);
        expect(firstMark!.atMs).toBe(reportingPushes(run)[0]!.receiveMs);

        /*
         * Marked last by the latest mark (a refresh, while reported), which
         * also wrote the row last (the database's clock is the workers').
         */
        const marks: Array<SimulatedOfflineMark> =
          run.simulator.offlineMarks.filter((mark: SimulatedOfflineMark) => {
            return mark.markedNodes.includes("pve3");
          });
        expect(marks.length).toBeGreaterThan(1);
        const row: SimulatedNodeRow | null = run.simulator.nodeRow("pve3");
        expect(row).toEqual({
          lastSeenAt: new Date(lastOwnPush.pushTimeMs),
          isUp: false,
          isNativePush: true,
          notReportingMarkedAt: new Date(marks[marks.length - 1]!.atMs),
          updatedAt: new Date(marks[marks.length - 1]!.atMs),
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

  /*
   * ------------------------------------------------------------------
   * Report continuation: a node already Offline keeps being reported
   * while no node is established.
   * ------------------------------------------------------------------
   *
   * The established gate holds back a node's FIRST report until some
   * node has pushed unbroken for 2 minutes. It used to hold back every
   * report: after anything that restarts every live node's streak at
   * once — the lone survivor's own gap, a OneUptime outage (Redis keeping
   * its keys or not), OneUptime processing the survivor in bursts — the
   * live nodes' pushes of those 2 minutes were stored with no report,
   * their minutes read 100 %, and Quorum at Risk fell to "no criteria
   * met" with the cluster half down all along: MonitorResource
   * auto-resolved its alert and incident, to page again minutes later.
   *
   * Each scenario asserts VERDICT CONTINUITY from the first firing to the
   * end — on every evaluation Quorum at Risk matches its offline criteria
   * and Node Offline keeps the dead nodes' series firing — and, replayed
   * without the continuation, shows the break it closes.
   *
   * The continuation reports only nodes MARKED within the monitor window
   * of the moment the roster was read (see "the mark near the window's
   * edge" below): the row's notReportingMarkedAt, which the mark writes at
   * most once a minute while the node stays reported, on the worker's
   * clock. The continuing reports mark it themselves, so it stays fresh
   * however long no node is established — a lone survivor processed in
   * bursts for 10 minutes included — and it lives in Postgres, so an
   * outage that loses Redis loses none of it. A gap only has to be short
   * enough that the last mark before it is still within the window when
   * the first push after it reads the roster.
   */
  describe("2 nodes, pve2 dead, then the lone survivor pve1 is gone for 90 s", () => {
    const GONE_FROM_MS: number = DEATH_MS + 12 * MINUTE_MS;
    const GONE_TO_MS: number = GONE_FROM_MS + 90_000;
    const DEAD_IDS: Array<string> = ["node/pve2"];
    let run: ScenarioRun;
    let replay: Map<NodeStatusPushRecord, ExpectedReport>;
    // pve1's first push after its gap.
    let back: NodeStatusPushRecord;
    // From the first evaluation Quorum at Risk fired on, to the end.
    let through: Array<Tick>;

    beforeAll(async () => {
      run = await runScenario({
        seed: 211,
        nodeCount: 2,
        durationMinutes: 45,
        downRanges: {
          pve1: [{ fromMs: GONE_FROM_MS, toMs: GONE_TO_MS }],
          pve2: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
        },
      });
      replay = replayReports(run);
      const firstBack: NodeStatusPushRecord | undefined = run.simulator
        .ownPushes("pve1")
        .find((push: NodeStatusPushRecord) => {
          return push.pushTimeMs > GONE_FROM_MS;
        });
      if (!firstBack) {
        throw new Error("pve1 never came back");
      }
      back = firstBack;
      const first: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.quorum.fires;
      });
      if (!first) {
        throw new Error("Quorum at Risk never fired");
      }
      through = ticksFrom(run, first.atMs);
    });

    test("pve1 was gone 90 s: its streak restarted, and no node was established for the 2 minutes after", () => {
      const before: NodeStatusPushRecord = lastOwnPushBefore(
        run,
        "pve1",
        GONE_FROM_MS,
      );
      expect(back.receiveMs - before.receiveMs).toBeGreaterThan(
        PROXMOX_NODE_STREAK_GAP_MS,
      );
      expect(back.receiveMs - before.receiveMs).toBeLessThan(
        PROXMOX_NODE_SILENCE_MS,
      );
      expect(replayedReportOf(replay, back).reporterStreakMs).toBe(0);

      const warmUp: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return (
            push.receiveMs >= back.receiveMs &&
            !replayedReportOf(replay, push).established
          );
        });
      expect(warmUp.length).toBeGreaterThan(8);
      for (const push of warmUp) {
        expect(push.receiveMs).toBeLessThan(
          back.receiveMs + PROXMOX_NODE_SILENCE_MS + 1,
        );
      }
    });

    test("pve1 reports pve2 — Offline since its first report — on every push back, warming up or not, with L = 1", () => {
      const firstMark: SimulatedOfflineMark | undefined =
        run.simulator.offlineMarks.find((mark: SimulatedOfflineMark) => {
          return mark.markedNodes.includes("pve2");
        });
      expect(firstMark).toBeDefined();
      expect(firstMark!.atMs).toBeLessThan(GONE_FROM_MS);
      expect(run.simulator.nodeRow("pve2")?.isUp).toBe(false);

      const afterGap: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return push.receiveMs >= back.receiveMs;
        });
      expect(afterGap.length).toBeGreaterThan(50);
      for (const push of afterGap) {
        expect(push.silentNodes).toEqual(["pve2"]);
        expect(push.reporterCount).toBe(1);
      }
    });

    test("VERDICT CONTINUITY: Quorum at Risk matches and Node Offline fires for node/pve2 on every evaluation from the first firing to the end, the gap included", () => {
      expect(through[0]!.atMs).toBeLessThanOrEqual(DEATH_MS + 9 * MINUTE_MS);
      expect(through[0]!.atMs).toBeLessThan(GONE_FROM_MS);
      expect(through[through.length - 1]!.atMs).toBeGreaterThan(
        GONE_TO_MS + PROXMOX_NODE_SILENCE_MS + WINDOW_MS,
      );

      expect(
        continuityBreaks({ verdicts: verdictsOf(through), deadIds: DEAD_IDS }),
      ).toEqual([]);
      for (const tick of through) {
        expect(tick.nodeOffline.offlineIds).toEqual(DEAD_IDS);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
      }
    });

    test("without the continuation, pve1's first 2 minutes back would read 100 % and Quorum at Risk would stop matching", () => {
      const wouldBreak: Array<Verdict> = oracleVerdicts(
        run,
        through,
        EVERY_REPORT_WAITS_FOR_ESTABLISHED,
      ).filter((verdict: Verdict) => {
        return !verdict.quorumFires;
      });
      expect(wouldBreak.length).toBeGreaterThan(3);
      for (const verdict of wouldBreak) {
        expect(verdict.atMs).toBeGreaterThan(back.receiveMs);
        expect(verdict.atMs).toBeLessThan(
          back.receiveMs + PROXMOX_NODE_SILENCE_MS + WINDOW_MS + MINUTE_MS,
        );
      }
      expect(
        wouldBreak.some((verdict: Verdict) => {
          return verdict.quorumPoints.some((point: FormulaPoint) => {
            return point.value === 100;
          });
        }),
      ).toBe(true);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  /*
   * The same through a short OneUptime outage. Every survivor's streak
   * restarts — its key outlives a 90 s gap but its streak does not, or
   * Redis loses every key with the outage (a failover, a restart), however
   * short — so no node is established for the 2 minutes after. pve3's and
   * pve4's marks are in Postgres: they outlive both.
   */
  const SHORT_OUTAGE_CASES: Array<{
    seed: number;
    outageMs: number;
    keepsLiveness: boolean;
  }> = [
    { seed: 223, outageMs: 90_000, keepsLiveness: true },
    { seed: 251, outageMs: 30_000, keepsLiveness: false },
    { seed: 257, outageMs: 90_000, keepsLiveness: false },
  ];

  for (const outageCase of SHORT_OUTAGE_CASES) {
    const redisFate: string = outageCase.keepsLiveness
      ? "Redis rides out"
      : "loses Redis";
    const outageSeconds: number = outageCase.outageMs / 1000;

    describe(`4 nodes, pve3 and pve4 dead (L = D = 2), then a ${outageSeconds} s OneUptime outage that ${redisFate}`, () => {
      const OUTAGE: SimulatedIngestOutage = {
        fromMs: DEATH_MS + 12 * MINUTE_MS,
        toMs: DEATH_MS + 12 * MINUTE_MS + outageCase.outageMs,
        keepsLiveness: outageCase.keepsLiveness,
      };
      const SURVIVORS: Array<string> = ["pve1", "pve2"];
      const DEAD_IDS: Array<string> = ["node/pve3", "node/pve4"];
      let run: ScenarioRun;
      let replay: Map<NodeStatusPushRecord, ExpectedReport>;
      // The first node-status push OneUptime processed after the outage.
      let firstBack: NodeStatusPushRecord;
      let through: Array<Tick>;

      beforeAll(async () => {
        run = await runScenario({
          seed: outageCase.seed,
          nodeCount: 4,
          durationMinutes: 45,
          downRanges: {
            pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
            pve4: [{ fromMs: DEATH_MS, toMs: NEVER_MS }],
          },
          outage: OUTAGE,
        });
        replay = replayReports(run);
        const back: NodeStatusPushRecord | undefined =
          run.simulator.nodeStatusPushes.find((push: NodeStatusPushRecord) => {
            return push.receiveMs >= OUTAGE.toMs;
          });
        if (!back) {
          throw new Error("nothing was processed after the outage");
        }
        firstBack = back;
        const first: Tick | undefined = firstTick(run, (tick: Tick) => {
          return tick.quorum.fires;
        });
        if (!first) {
          throw new Error("Quorum at Risk never fired");
        }
        through = ticksFrom(run, first.atMs);
      });

      test(`nothing was processed for ${outageSeconds} s, ${outageCase.keepsLiveness ? "Redis kept its keys" : "Redis lost every key"}, and each survivor's streak restarted — no node established for 2 minutes after`, () => {
        expect(run.simulator.livenessLostAtMs).toEqual(
          outageCase.keepsLiveness ? [] : [OUTAGE.fromMs],
        );
        expect(
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return (
                push.receiveMs >= OUTAGE.fromMs && push.receiveMs < OUTAGE.toMs
              );
            },
          ),
        ).toEqual([]);

        for (const name of SURVIVORS) {
          const before: NodeStatusPushRecord = lastOwnPushBefore(
            run,
            name,
            OUTAGE.fromMs,
          );
          const resumed: NodeStatusPushRecord = run.simulator
            .ownPushes(name)
            .find((push: NodeStatusPushRecord) => {
              return push.receiveMs >= OUTAGE.toMs;
            })!;
          // Never silent to each other: back within the silence window.
          expect(resumed.receiveMs - before.receiveMs).toBeLessThan(
            PROXMOX_NODE_SILENCE_MS,
          );
          if (outageCase.keepsLiveness) {
            // Its key outlived the gap; its streak did not.
            expect(resumed.receiveMs - before.receiveMs).toBeGreaterThan(
              PROXMOX_NODE_STREAK_GAP_MS,
            );
          }
          expect(replayedReportOf(replay, resumed).reporterStreakMs).toBe(0);
        }

        const warmUp: Array<NodeStatusPushRecord> =
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return (
                push.receiveMs >= OUTAGE.toMs &&
                !replayedReportOf(replay, push).established
              );
            },
          );
        expect(warmUp.length).toBeGreaterThan(15);
        expect(warmUp[0]).toBe(firstBack);
      });

      /*
       * The continuation's gate through the warm-up: the roster has pve3
       * and pve4 Offline, marked in Postgres before the outage — Redis
       * kept or lost — and then again by the warm-up's own reports.
       */
      test("the warm-up reads pve3 and pve4 Offline and marked within the window: first the marks from before the outage, then its own", () => {
        const warmUp: Array<NodeStatusPushRecord> =
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return (
                push.receiveMs >= OUTAGE.toMs &&
                !replayedReportOf(replay, push).established
              );
            },
          );
        for (const push of warmUp) {
          expect(
            push.offlineRosterRows.map((row: RosterOfflineRow) => {
              return row.nodeName;
            }),
          ).toEqual(["pve3", "pve4"]);
          expect(push.receiveMs - push.rosterReadAtMs!).toBeLessThanOrEqual(
            PROXMOX_ROSTER_CACHE_TTL_MS,
          );
          for (const row of push.offlineRosterRows) {
            expect(push.rosterReadAtMs! - row.markedAtMs!).toBeLessThanOrEqual(
              PROXMOX_MONITOR_WINDOW_MS,
            );
          }
        }
        expect(firstBack.rosterReadAtMs).toBe(firstBack.receiveMs);
        for (const row of firstBack.offlineRosterRows) {
          expect(row.markedAtMs!).toBeLessThan(OUTAGE.fromMs);
        }
        expect(
          run.simulator.offlineMarks.some((mark: SimulatedOfflineMark) => {
            return (
              mark.markedNodes.length === 2 &&
              mark.atMs >= firstBack.receiveMs &&
              mark.atMs <= warmUp[warmUp.length - 1]!.receiveMs
            );
          }),
        ).toBe(true);
      });

      test("every survivor push back reports pve3 and pve4 with L = 2 — D ÷ L = 1 — through the 2 minutes without an established node", () => {
        const afterOutage: Array<NodeStatusPushRecord> =
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return push.receiveMs >= OUTAGE.toMs;
            },
          );
        expect(afterOutage.length).toBeGreaterThan(100);
        for (const push of afterOutage) {
          expect(SURVIVORS).toContain(push.nodeName);
          expect(push.silentNodes).toEqual(["pve3", "pve4"]);
          expect(push.reporterCount).toBe(2);
          expect(reportInfoWeight(push)).toBe(1);
        }
      });

      test("VERDICT CONTINUITY: Quorum at Risk matches and Node Offline fires for node/pve3 and node/pve4 on every evaluation from the first firing to the end, the outage included", () => {
        expect(through[0]!.atMs).toBeLessThanOrEqual(DEATH_MS + 9 * MINUTE_MS);
        expect(through[0]!.atMs).toBeLessThan(OUTAGE.fromMs);
        expect(through[through.length - 1]!.atMs).toBeGreaterThan(
          OUTAGE.toMs + PROXMOX_NODE_SILENCE_MS + WINDOW_MS,
        );

        expect(
          continuityBreaks({
            verdicts: verdictsOf(through),
            deadIds: DEAD_IDS,
          }),
        ).toEqual([]);
        for (const tick of through) {
          expect(tick.nodeOffline.offlineIds).toEqual(DEAD_IDS);
          expect(tick.nodeOffline.healthyIds).toEqual([
            "node/pve1",
            "node/pve2",
          ]);
          for (const point of tick.quorum.formulaPoints) {
            expect(point.value).toBe(50);
          }
        }
      });

      test("without the continuation, the survivors' first 2 minutes back would read 100 % and Quorum at Risk would stop matching", () => {
        const wouldBreak: Array<Verdict> = oracleVerdicts(
          run,
          through,
          EVERY_REPORT_WAITS_FOR_ESTABLISHED,
        ).filter((verdict: Verdict) => {
          return !verdict.quorumFires;
        });
        expect(wouldBreak.length).toBeGreaterThan(3);
        for (const verdict of wouldBreak) {
          expect(verdict.atMs).toBeGreaterThan(firstBack.receiveMs);
          expect(verdict.atMs).toBeLessThan(
            firstBack.receiveMs +
              PROXMOX_NODE_SILENCE_MS +
              WINDOW_MS +
              MINUTE_MS,
          );
        }
        expect(
          wouldBreak.some((verdict: Verdict) => {
            return verdict.quorumPoints.some((point: FormulaPoint) => {
              return point.value === 100;
            });
          }),
        ).toBe(true);
      });

      test("the verdicts equal the oracle on every evaluation", () => {
        expectMatchesOracle(run);
      });
    });
  }

  /*
   * OneUptime falls behind on the lone survivor: for 10 minutes pve1's
   * pushes are processed in bursts 50–70 s apart. A gap over a minute
   * restarts its streak, so it is seldom established — for minutes on end
   * no node is. Its reports carry on all the same: pve2 is Offline, and
   * the first report of a burst marks it again whenever the last mark is
   * over a minute old, so the mark the continuation reads is never more
   * than two bursts old. (Gated instead on whether the cluster had been
   * established within the window, the reports stopped mid-stall and
   * again after it — Quorum at Risk fell to "no criteria met" on 21
   * evaluations of this draw, with half the cluster down all along.)
   */
  describe("2 nodes, pve2 dead, the lone survivor pve1's pushes processed every 50–70 s for 10 minutes", () => {
    const STALL_FROM_MS: number = DEATH_MS + 10 * MINUTE_MS;
    const STALL_TO_MS: number = STALL_FROM_MS + 10 * MINUTE_MS;
    const MAX_BURST_INTERVAL_MS: number = 70_000;
    const DEAD_IDS: Array<string> = ["node/pve2"];
    let run: ScenarioRun;
    let replay: Map<NodeStatusPushRecord, ExpectedReport>;
    // pve1's burst times, oldest first.
    let bursts: Array<number>;
    let through: Array<Tick>;

    beforeAll(async () => {
      run = await runScenario({
        seed: 227,
        nodeCount: 2,
        durationMinutes: 50,
        downRanges: { pve2: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
        processingBursts: {
          pve1: {
            fromMs: STALL_FROM_MS,
            toMs: STALL_TO_MS,
            minIntervalMs: 50_000,
            maxIntervalMs: MAX_BURST_INTERVAL_MS,
          },
        },
      });
      replay = replayReports(run);

      // A burst processes several of pve1's pushes at one instant.
      const pushesAt: Map<number, number> = new Map();
      for (const push of run.simulator.ownPushes("pve1")) {
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

      const first: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.quorum.fires;
      });
      if (!first) {
        throw new Error("Quorum at Risk never fired");
      }
      through = ticksFrom(run, first.atMs);
    });

    test("pve1's pushes really were processed in bursts 50–70 s apart, some too far apart to keep its streak", () => {
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
      expect(
        gaps.filter((gapMs: number) => {
          return gapMs > PROXMOX_NODE_STREAK_GAP_MS;
        }).length,
      ).toBeGreaterThanOrEqual(2);

      for (const push of run.simulator.ownPushes("pve1")) {
        if (
          push.receiveMs >= STALL_FROM_MS &&
          push.receiveMs <= bursts[bursts.length - 1]!
        ) {
          expect(bursts).toContain(push.receiveMs);
        }
      }
    });

    test("every pve1 push in the bursts reports pve2 with L = 1 — the many made while no node was established included", () => {
      const stalled: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return bursts.includes(push.receiveMs);
        });
      expect(stalled.length).toBeGreaterThan(50);

      const unestablished: Array<NodeStatusPushRecord> = stalled.filter(
        (push: NodeStatusPushRecord) => {
          return !replayedReportOf(replay, push).established;
        },
      );
      expect(unestablished.length).toBeGreaterThan(20);

      for (const push of stalled) {
        expect(push.silentNodes).toEqual(["pve2"]);
        expect(push.reporterCount).toBe(1);
      }
    });

    /*
     * What keeps them going: a burst's first report marks pve2 again once
     * the last mark is over a minute old — every burst or every other one
     * — and each burst reloads the roster (the last load is 50 s or more
     * old), so every push in the bursts reads pve2 marked at most two
     * bursts before, well within the monitor window.
     */
    test("through the bursts pve2's mark is written by a burst's own report whenever it is over a minute old, and every push reads it at most two bursts old", () => {
      const stalled: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return bursts.includes(push.receiveMs);
        });
      for (const push of stalled) {
        expect(push.offlineRosterRows.length).toBe(1);
        expect(push.offlineRosterRows[0]!.nodeName).toBe("pve2");
        const markedAtMs: number = push.offlineRosterRows[0]!.markedAtMs!;
        expect(push.receiveMs - markedAtMs).toBeLessThanOrEqual(
          2 * MAX_BURST_INTERVAL_MS,
        );
      }
      expect(2 * MAX_BURST_INTERVAL_MS).toBeLessThan(PROXMOX_MONITOR_WINDOW_MS);

      const writes: Array<SimulatedOfflineMark> =
        run.simulator.offlineMarks.filter((mark: SimulatedOfflineMark) => {
          return (
            mark.markedNodes.includes("pve2") &&
            mark.atMs >= bursts[0]! &&
            mark.atMs <= bursts[bursts.length - 1]!
          );
        });
      expect(writes.length).toBeGreaterThanOrEqual(4);
      for (const write of writes) {
        expect(bursts).toContain(write.atMs);
      }
    });

    test("VERDICT CONTINUITY: Quorum at Risk matches and Node Offline fires for node/pve2 on every evaluation from the first firing to the end, the bursts included", () => {
      expect(through[0]!.atMs).toBeLessThanOrEqual(DEATH_MS + 9 * MINUTE_MS);
      expect(through[0]!.atMs).toBeLessThan(STALL_FROM_MS);
      expect(through[through.length - 1]!.atMs).toBeGreaterThan(
        bursts[bursts.length - 1]! + WINDOW_MS,
      );

      expect(
        continuityBreaks({ verdicts: verdictsOf(through), deadIds: DEAD_IDS }),
      ).toEqual([]);
      for (const tick of through) {
        expect(tick.nodeOffline.offlineIds).toEqual(DEAD_IDS);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
      }
    });

    test("without the continuation, the pushes of every burst after a streak break would read 100 % and Quorum at Risk would stop matching", () => {
      const wouldBreak: Array<Verdict> = oracleVerdicts(
        run,
        through,
        EVERY_REPORT_WAITS_FOR_ESTABLISHED,
      ).filter((verdict: Verdict) => {
        return !verdict.quorumFires;
      });
      expect(wouldBreak.length).toBeGreaterThan(3);
      // Up to a window after the streak that follows the last burst.
      for (const verdict of wouldBreak) {
        expect(verdict.atMs).toBeGreaterThan(STALL_FROM_MS);
        expect(verdict.atMs).toBeLessThan(
          bursts[bursts.length - 1]! +
            PROXMOX_NODE_SILENCE_MS +
            WINDOW_MS +
            MINUTE_MS,
        );
      }
      expect(
        wouldBreak.some((verdict: Verdict) => {
          return verdict.quorumPoints.some((point: FormulaPoint) => {
            return point.value === 100;
          });
        }),
      ).toBe(true);
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  /*
   * The mark near the window's edge. A worker decides on a roster it may
   * have read up to 30 s before (the roster cache). After a gap in which
   * nobody reported, the first push back reads the Offline node's mark a
   * little under 5 minutes old — within the window — so it continues the
   * report, and its flush rewrites the mark. The pushes of the next 30 s
   * still read the roster from before that rewrite: the old mark, by their
   * own time a little OVER 5 minutes old. Were its age taken at each push,
   * they would drop the report — minutes of Quorum at Risk "no criteria
   * met" with half the cluster down all along. It is taken when the roster
   * was read, so every push one cached roster serves decides as the push
   * that read it did: all of them continue.
   *
   * The lone survivor pve1 goes away 35 s after a mark (reporting, but not
   * marking, until then) and is back when that mark is 285 s old or a
   * little more — timed from a run of the same draw without the gap, whose
   * pushes and marks up to the gap are the same. Every assertion held on
   * 24 other draws.
   */
  describe("2 nodes, pve2 dead, then the lone survivor pve1 is gone until pve2's mark is almost 5 minutes old", () => {
    const AFTER_MS: number = DEATH_MS + 12 * MINUTE_MS;
    const DEAD_IDS: Array<string> = ["node/pve2"];
    const BASE: ScenarioInput = {
      seed: 269,
      nodeCount: 2,
      durationMinutes: 50,
      downRanges: { pve2: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
    };
    let run: ScenarioRun;
    let replay: Map<NodeStatusPushRecord, ExpectedReport>;
    // The last mark of pve2 before the gap.
    let lastMark: SimulatedOfflineMark;
    // pve1's first push back, and those that read the roster it loaded.
    let back: NodeStatusPushRecord;
    let cached: Array<NodeStatusPushRecord>;
    let through: Array<Tick>;

    beforeAll(async () => {
      const probe: ScenarioRun = await runScenario({
        ...BASE,
        evaluateFromMs: SIM_START_MS + BASE.durationMinutes * MINUTE_MS,
      });
      const mark: SimulatedOfflineMark | undefined =
        probe.simulator.offlineMarks.find((entry: SimulatedOfflineMark) => {
          return entry.atMs >= AFTER_MS && entry.markedNodes.includes("pve2");
        });
      const firstBack: NodeStatusPushRecord | undefined = mark
        ? probe.simulator
            .ownPushes("pve1")
            .find((push: NodeStatusPushRecord) => {
              return push.receiveMs - mark.atMs >= 285_000;
            })
        : undefined;
      if (!mark || !firstBack) {
        throw new Error("the probe run never marked pve2 after 12:32");
      }

      /*
       * Gone from 35 s after the mark (its pass received within 1.5 s, so
       * before the next refresh) until just before the pass that is
       * received 285 s or more after it.
       */
      run = await runScenario({
        ...BASE,
        downRanges: {
          ...BASE.downRanges,
          pve1: [
            { fromMs: mark.atMs + 35_000, toMs: firstBack.receiveMs - 1_500 },
          ],
        },
      });
      replay = replayReports(run);

      const marks: Array<SimulatedOfflineMark> =
        run.simulator.offlineMarks.filter((entry: SimulatedOfflineMark) => {
          return (
            entry.markedNodes.includes("pve2") &&
            entry.atMs < mark.atMs + 35_000
          );
        });
      lastMark = marks[marks.length - 1]!;
      const pushedBack: NodeStatusPushRecord | undefined = run.simulator
        .ownPushes("pve1")
        .find((push: NodeStatusPushRecord) => {
          return push.receiveMs > mark.atMs + 60_000;
        });
      if (!pushedBack) {
        throw new Error("pve1 never came back");
      }
      back = pushedBack;
      cached = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return (
            push.receiveMs > back.receiveMs &&
            push.receiveMs <= back.receiveMs + PROXMOX_ROSTER_CACHE_TTL_MS
          );
        });
      const first: Tick | undefined = firstTick(run, (tick: Tick) => {
        return tick.quorum.fires;
      });
      if (!first) {
        throw new Error("Quorum at Risk never fired");
      }
      through = ticksFrom(run, first.atMs);
    });

    test("the setup: pve1 left 35 s after a mark of pve2, and its first push back — its streak restarted — read that mark 270 to 300 s old", () => {
      expect(lastMark.atMs).toBeGreaterThanOrEqual(AFTER_MS);
      const before: NodeStatusPushRecord = lastOwnPushBefore(
        run,
        "pve1",
        back.pushTimeMs,
      );
      expect(before.receiveMs - lastMark.atMs).toBeLessThan(
        SILENT_NODE_MARK_REFRESH_MS,
      );
      expect(back.receiveMs - before.receiveMs).toBeGreaterThan(
        PROXMOX_NODE_SILENCE_MS,
      );
      expect(replayedReportOf(replay, back).reporterStreakMs).toBe(0);
      expect(replayedReportOf(replay, back).established).toBe(false);

      // Its own read: the cache had run out in the gap.
      expect(back.rosterReadAtMs).toBe(back.receiveMs);
      expect(back.offlineRosterRows).toEqual([
        { nodeName: "pve2", markedAtMs: lastMark.atMs },
      ]);
      const ageMs: number = back.rosterReadAtMs! - lastMark.atMs;
      expect(ageMs).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS - PROXMOX_ROSTER_CACHE_TTL_MS,
      );
      expect(ageMs).toBeLessThanOrEqual(PROXMOX_MONITOR_WINDOW_MS);
    });

    test("the first push back continues the report and its flush rewrites the mark; the pushes of the next 30 s read the roster it read — the old mark, over 5 minutes old by their own time — and continue too", () => {
      expect(back.silentNodes).toEqual(["pve2"]);
      expect(back.reporterCount).toBe(1);
      expect(
        run.simulator.offlineMarks.find((entry: SimulatedOfflineMark) => {
          return entry.atMs === back.receiveMs;
        })?.markedNodes,
      ).toEqual(["pve2"]);

      expect(cached.length).toBeGreaterThanOrEqual(2);
      const overTheWindow: Array<NodeStatusPushRecord> = cached.filter(
        (push: NodeStatusPushRecord) => {
          return push.receiveMs - lastMark.atMs > PROXMOX_MONITOR_WINDOW_MS;
        },
      );
      expect(overTheWindow.length).toBeGreaterThan(0);
      for (const push of cached) {
        expect(replayedReportOf(replay, push).established).toBe(false);
        // The roster `back` read, the mark's age taken then.
        expect(push.rosterReadAtMs).toBe(back.receiveMs);
        expect(push.offlineRosterRows).toEqual([
          { nodeName: "pve2", markedAtMs: lastMark.atMs },
        ]);
        expect(push.rosterReadAtMs! - lastMark.atMs).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
        expect(push.silentNodes).toEqual(["pve2"]);
        expect(push.reporterCount).toBe(1);
      }

      // Every push back reports pve2, from the first one on.
      const afterGap: Array<NodeStatusPushRecord> = run.simulator
        .ownPushes("pve1")
        .filter((push: NodeStatusPushRecord) => {
          return push.receiveMs >= back.receiveMs;
        });
      expect(afterGap.length).toBeGreaterThan(50);
      for (const push of afterGap) {
        expect(push.silentNodes).toEqual(["pve2"]);
        expect(push.reporterCount).toBe(1);
      }
    });

    test("VERDICT CONTINUITY: Quorum at Risk matches and Node Offline fires for node/pve2 on every evaluation from the first firing to the end, the gap included", () => {
      expect(through[0]!.atMs).toBeLessThan(lastMark.atMs);
      expect(through[through.length - 1]!.atMs).toBeGreaterThan(
        back.receiveMs + PROXMOX_NODE_SILENCE_MS + WINDOW_MS,
      );
      expect(
        continuityBreaks({ verdicts: verdictsOf(through), deadIds: DEAD_IDS }),
      ).toEqual([]);
      for (const tick of through) {
        expect(tick.nodeOffline.offlineIds).toEqual(DEAD_IDS);
        for (const point of tick.quorum.formulaPoints) {
          expect(point.value).toBe(50);
        }
      }
    });

    test("with the mark's age taken at each push, the pushes reading the cached roster would have dropped the report and Quorum at Risk would have stopped matching", () => {
      const bare: Map<NodeStatusPushRecord, ExpectedReport> = replayReports(
        run,
        MARK_AGE_AT_PUSH,
      );
      expect(replayedReportOf(bare, back).silentNodes).toEqual(["pve2"]);
      const dropped: Array<NodeStatusPushRecord> = cached.filter(
        (push: NodeStatusPushRecord) => {
          return replayedReportOf(bare, push).silentNodes.length === 0;
        },
      );
      expect(dropped.length).toBeGreaterThan(0);
      for (const push of dropped) {
        expect(push.receiveMs - lastMark.atMs).toBeGreaterThan(
          PROXMOX_MONITOR_WINDOW_MS,
        );
      }

      const wouldBreak: Array<Verdict> = oracleVerdicts(
        run,
        through,
        MARK_AGE_AT_PUSH,
      ).filter((verdict: Verdict) => {
        return !verdict.quorumFires;
      });
      expect(wouldBreak.length).toBeGreaterThan(3);
      for (const verdict of wouldBreak) {
        expect(verdict.atMs).toBeGreaterThan(back.receiveMs);
        expect(verdict.atMs).toBeLessThan(
          back.receiveMs + WINDOW_MS + 2 * MINUTE_MS,
        );
        expect(
          verdict.quorumPoints.some((point: FormulaPoint) => {
            return point.value > 50;
          }),
        ).toBe(true);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  /*
   * The other side of the edge, after a gap of the whole cluster: a
   * OneUptime outage that begins 5 s after pve3's last mark and lasts
   * 310 s, so the first push back reads that mark 300 to 330 s old — past
   * the window by less than the roster cache's 30 s. pve3 came back in the
   * outage's middle; its first push back is processed a minute after its
   * siblings'.
   *
   * The first push back reads the roster with the mark past the window,
   * so nothing continues, and every push that cached roster serves decides
   * the same: the mark's age is the read's. Nobody reports pve3 — up since
   * the outage's middle — and Node Offline never names it after the outage.
   *
   * Taking the age at each push instead, against the window plus the
   * cache's 30 s (tried before the age was the read's), only moves the
   * edge: the first push back reads the mark within 330 s and continues —
   * reporting pve3, a node that is up — and its flush marks pve3 afresh;
   * the pushes its cached roster serves drop the report once the old mark
   * passes 330 s at their own time; the next roster read has the fresh
   * mark, and the report carries on until pve3's own push is in —
   * reported, unreported, reported again — and Node Offline fires for
   * node/pve3.
   *
   * The outage is timed from a run of the same draw without it, whose
   * pushes and marks up to the outage are the same. Every assertion held on
   * 24 other draws.
   */
  describe("3 nodes, pve3 Offline comes back during a 310 s OneUptime outage that begins 5 s after its last mark: the first push back reads the mark 300 to 330 s old", () => {
    const AFTER_MS: number = DEATH_MS + 10 * MINUTE_MS;
    const OUTAGE_MS: number = 310_000;
    const BASE: ScenarioInput = {
      seed: 277,
      nodeCount: 3,
      durationMinutes: 45,
      downRanges: { pve3: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
    };
    let run: ScenarioRun;
    let replay: Map<NodeStatusPushRecord, ExpectedReport>;
    let outage: SimulatedIngestOutage;
    // pve3's last mark before the outage.
    let lastMark: SimulatedOfflineMark;
    /*
     * The first node-status push processed after the outage, the pushes
     * that read the roster it loaded, and pve3's own first push back.
     */
    let firstBack: NodeStatusPushRecord;
    let cached: Array<NodeStatusPushRecord>;
    let pve3Back: NodeStatusPushRecord;

    beforeAll(async () => {
      const probe: ScenarioRun = await runScenario({
        ...BASE,
        evaluateFromMs: SIM_START_MS + BASE.durationMinutes * MINUTE_MS,
      });
      const mark: SimulatedOfflineMark | undefined =
        probe.simulator.offlineMarks.find((entry: SimulatedOfflineMark) => {
          return entry.atMs >= AFTER_MS && entry.markedNodes.includes("pve3");
        });
      if (!mark) {
        throw new Error("the probe run never marked pve3 after 12:30");
      }

      const fromMs: number = mark.atMs + 5_000;
      outage = {
        fromMs: fromMs,
        toMs: fromMs + OUTAGE_MS,
        resumeDelayMsByNode: { pve3: MINUTE_MS },
      };
      run = await runScenario({
        ...BASE,
        // Up again (true time) from the outage's middle.
        downRanges: {
          pve3: [{ fromMs: DEATH_MS, toMs: fromMs + OUTAGE_MS / 2 }],
        },
        outage: outage,
      });
      replay = replayReports(run);

      const marks: Array<SimulatedOfflineMark> =
        run.simulator.offlineMarks.filter((entry: SimulatedOfflineMark) => {
          return (
            entry.markedNodes.includes("pve3") && entry.atMs < outage.fromMs
          );
        });
      lastMark = marks[marks.length - 1]!;
      const back: NodeStatusPushRecord | undefined =
        run.simulator.nodeStatusPushes.find((push: NodeStatusPushRecord) => {
          return push.receiveMs >= outage.toMs;
        });
      const ownBack: NodeStatusPushRecord | undefined = run.simulator
        .ownPushes("pve3")
        .find((push: NodeStatusPushRecord) => {
          return push.receiveMs >= outage.toMs;
        });
      if (!back || !ownBack) {
        throw new Error("nothing was processed after the outage");
      }
      firstBack = back;
      pve3Back = ownBack;
      cached = run.simulator.nodeStatusPushes.filter(
        (push: NodeStatusPushRecord) => {
          return (
            push.receiveMs > firstBack.receiveMs &&
            push.receiveMs <= firstBack.receiveMs + PROXMOX_ROSTER_CACHE_TTL_MS
          );
        },
      );
    });

    test("the setup: the outage began 5 s after pve3's last mark and nothing was processed in it; pve3, up from its middle, is back a minute after its siblings; the first push back — no node established — read pve3's mark 300 to 330 s old", () => {
      expect(run.simulator.livenessLostAtMs).toEqual([outage.fromMs]);
      expect(lastMark.atMs).toBe(outage.fromMs - 5_000);
      expect(
        run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
          return (
            push.receiveMs >= outage.fromMs && push.receiveMs < outage.toMs
          );
        }),
      ).toEqual([]);
      // Up (true time) from the outage's middle; nothing of it received.
      expect(
        run.simulator.ownPushes("pve3").filter((push: NodeStatusPushRecord) => {
          return (
            push.pushTimeMs > DEATH_MS + 1_000 && push.receiveMs < outage.toMs
          );
        }),
      ).toEqual([]);
      expect(["pve1", "pve2"]).toContain(firstBack.nodeName);
      expect(pve3Back.receiveMs - firstBack.receiveMs).toBeGreaterThan(
        PROXMOX_ROSTER_CACHE_TTL_MS + 10_000,
      );
      expect(run.simulator.nodeRow("pve3")?.isUp).toBe(true);

      expect(replayedReportOf(replay, firstBack).established).toBe(false);
      // Its own read: the cache had run out in the outage.
      expect(firstBack.rosterReadAtMs).toBe(firstBack.receiveMs);
      expect(firstBack.offlineRosterRows).toEqual([
        { nodeName: "pve3", markedAtMs: lastMark.atMs },
      ]);
      const ageMs: number = firstBack.rosterReadAtMs! - lastMark.atMs;
      expect(ageMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
      expect(ageMs).toBeLessThanOrEqual(
        PROXMOX_MONITOR_WINDOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS,
      );
    });

    test("nothing continues: the first push back and every push its cached roster serves report nothing, and nobody reports pve3 after the outage — its own push clears its row", () => {
      expect(firstBack.silentNodes).toEqual([]);
      expect(cached.length).toBeGreaterThanOrEqual(2);
      for (const push of cached) {
        expect(replayedReportOf(replay, push).established).toBe(false);
        // The roster firstBack read, the mark's age taken then.
        expect(push.rosterReadAtMs).toBe(firstBack.receiveMs);
        expect(push.offlineRosterRows).toEqual([
          { nodeName: "pve3", markedAtMs: lastMark.atMs },
        ]);
        expect(push.silentNodes).toEqual([]);
      }

      for (const report of run.simulator.reportsOf("pve3")) {
        expect(report.receiveMs).toBeLessThan(outage.fromMs);
      }
      expect(
        run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
          return push.receiveMs >= outage.toMs && push.silentNodes.length > 0;
        }),
      ).toEqual([]);
      // Nothing marked pve3 again: the row's mark is gone with its own push.
      for (const entry of run.simulator.offlineMarks) {
        expect(entry.atMs).toBeLessThan(outage.fromMs);
      }
      expect(run.simulator.nodeRow("pve3")?.notReportingMarkedAt).toBeNull();
    });

    test("after the outage Node Offline never names node/pve3, and Quorum at Risk never fires", () => {
      expect(
        ticksFrom(run, outage.toMs)
          .filter((tick: Tick) => {
            return tick.nodeOffline.offlineIds.length > 0;
          })
          .map((tick: Tick) => {
            return `${new Date(tick.atMs).toISOString()}: ${tick.nodeOffline.offlineIds.join(",")}`;
          }),
      ).toEqual([]);
      for (const tick of run.ticks) {
        expect(tick.quorum.fires).toBe(false);
      }
    });

    test("with the mark's age taken at each push against the window plus the cache's 30 s, the first push back would have reported pve3 — up — the pushes its cached roster served dropped it, the next roster read carried it on until pve3's own push, and Node Offline would have fired for node/pve3", () => {
      const slack: Map<NodeStatusPushRecord, ExpectedReport> = replayReports(
        run,
        MARK_AGE_AT_PUSH_WITH_CACHE_SLACK,
      );
      // Reported…
      expect(replayedReportOf(slack, firstBack).silentNodes).toEqual(["pve3"]);

      // …unreported, by pushes reading the same cached roster…
      const dropped: Array<NodeStatusPushRecord> = cached.filter(
        (push: NodeStatusPushRecord) => {
          return replayedReportOf(slack, push).silentNodes.length === 0;
        },
      );
      expect(dropped.length).toBeGreaterThan(0);
      for (const push of dropped) {
        expect(push.receiveMs - lastMark.atMs).toBeGreaterThan(
          PROXMOX_MONITOR_WINDOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS,
        );
      }

      // …and reported again from the next read on, until pve3's own push.
      const reportedAgain: Array<NodeStatusPushRecord> =
        run.simulator.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
          return (
            push.receiveMs > dropped[dropped.length - 1]!.receiveMs &&
            push.receiveMs < pve3Back.receiveMs
          );
        });
      expect(reportedAgain.length).toBeGreaterThan(0);
      for (const push of reportedAgain) {
        expect(replayedReportOf(slack, push).silentNodes).toEqual(["pve3"]);
      }
      expect(replayedReportOf(slack, pve3Back).silentNodes).toEqual([]);

      const falseOffline: Array<Verdict> = oracleVerdicts(
        run,
        ticksFrom(run, outage.toMs),
        MARK_AGE_AT_PUSH_WITH_CACHE_SLACK,
      ).filter((verdict: Verdict) => {
        return verdict.offlineIds.includes("node/pve3");
      });
      expect(falseOffline.length).toBeGreaterThan(0);
      for (const verdict of falseOffline) {
        expect(verdict.atMs).toBeGreaterThan(firstBack.receiveMs);
        expect(verdict.atMs).toBeLessThan(pve3Back.receiveMs + 2 * MINUTE_MS);
      }
    });

    test("the verdicts equal the oracle on every evaluation", () => {
      expectMatchesOracle(run);
    });
  });

  /*
   * A cluster moved to the native push. The inventory still holds the
   * rows an earlier collector left: the Proxmox Agent's (isNativePush
   * false) and one from before the column existed (null), all last seen
   * Online 30 minutes ago. pve3 and pve4 died in the meantime; the native
   * push starts at 12:03:30 with pve1 and pve2.
   *
   * Nobody may report pve3 or pve4 for 2 minutes — never marked Offline,
   * they wait for an established node — and the 12:05 cleanup tick falls
   * in those 2 minutes, its cutoff anchored 15 minutes back, well past
   * their last sighting. Only a native Node row is kept there: the first
   * native flush adopts every Node row of the cluster
   * (adoptNodesAsNativePush), so both survive the tick and are reported
   * once a node is established. The counterfactual prunes them instead,
   * and they are never reported at all.
   */
  describe("4 nodes moved from an earlier collector; pve3 (agent row) and pve4 (row from before isNativePush) died before the native push began", () => {
    const NATIVE_FROM_MS: number = SIM_START_MS + 3 * MINUTE_MS + 30_000;
    // The first cleanup tick with the cluster connected.
    const WARM_UP_CLEANUP_MS: number = SIM_START_MS + 5 * MINUTE_MS;
    const EARLIER_SEEN_AT: Date = new Date(SIM_START_MS - 30 * MINUTE_MS);

    function scenario(withoutNativeAdoption: boolean): ScenarioInput {
      return {
        seed: 241,
        nodeCount: 4,
        durationMinutes: 25,
        downRanges: {
          pve1: [{ fromMs: BEFORE_START_MS, toMs: NATIVE_FROM_MS }],
          pve2: [{ fromMs: BEFORE_START_MS, toMs: NATIVE_FROM_MS }],
          pve3: [{ fromMs: BEFORE_START_MS, toMs: NEVER_MS }],
          pve4: [{ fromMs: BEFORE_START_MS, toMs: NEVER_MS }],
        },
        /*
         * Last written by the collector's own last sighting; never reported
         * as not reporting, so never marked.
         */
        initialNodeRows: {
          pve1: {
            lastSeenAt: EARLIER_SEEN_AT,
            isUp: true,
            isNativePush: false,
            notReportingMarkedAt: null,
            updatedAt: EARLIER_SEEN_AT,
          },
          pve2: {
            lastSeenAt: EARLIER_SEEN_AT,
            isUp: true,
            isNativePush: false,
            notReportingMarkedAt: null,
            updatedAt: EARLIER_SEEN_AT,
          },
          pve3: {
            lastSeenAt: EARLIER_SEEN_AT,
            isUp: true,
            isNativePush: false,
            notReportingMarkedAt: null,
            updatedAt: EARLIER_SEEN_AT,
          },
          pve4: {
            lastSeenAt: EARLIER_SEEN_AT,
            isUp: true,
            isNativePush: null,
            notReportingMarkedAt: null,
            updatedAt: EARLIER_SEEN_AT,
          },
        },
        withoutNativeAdoption: withoutNativeAdoption,
      };
    }

    function warmUpCleanup(run: ScenarioRun): SimulatedCleanupRun {
      const cleanup: SimulatedCleanupRun | undefined =
        run.simulator.cleanupRuns.find((entry: SimulatedCleanupRun) => {
          return entry.atMs === WARM_UP_CLEANUP_MS;
        });
      if (!cleanup) {
        throw new Error("the cleanup cron never ran at 12:05");
      }
      return cleanup;
    }

    describe("the first native flush adopts every Node row", () => {
      let run: ScenarioRun;

      beforeAll(async () => {
        run = await runScenario(scenario(false));
      });

      test("the first request processed adopts the rows no native push wrote — once, the fence holding the rest off", () => {
        const firstMs: number = run.simulator.nodeStatusPushes[0]!.receiveMs;
        expect(firstMs).toBeGreaterThanOrEqual(NATIVE_FROM_MS);

        expect(run.simulator.adoptions.length).toBeGreaterThan(0);
        const first: SimulatedAdoption = run.simulator.adoptions[0]!;
        expect(first.atMs).toBeLessThanOrEqual(firstMs);
        expect(first.atMs).toBeGreaterThanOrEqual(NATIVE_FROM_MS);
        expect(first.adoptedNodes).toEqual(
          expect.arrayContaining(["pve3", "pve4"]),
        );
        // Once per 10 minutes, and nothing left to adopt after.
        for (const later of run.simulator.adoptions.slice(1)) {
          expect(later.atMs - first.atMs).toBeGreaterThanOrEqual(
            10 * MINUTE_MS,
          );
          expect(later.adoptedNodes).toEqual([]);
        }
      });

      test("the 12:05 tick, in the warm-up, finds pve3's and pve4's rows stale and keeps them", () => {
        const cleanup: SimulatedCleanupRun = warmUpCleanup(run);
        expect(cleanup.connected).toBe(true);
        expect(cleanup.cutoffMs!).toBeGreaterThan(EARLIER_SEEN_AT.getTime());
        expect(cleanup.keptNodes).toEqual(["pve3", "pve4"]);
        expect(cleanup.prunedNodes).toEqual([]);
        // Nobody could report them yet: never Offline, nobody established.
        expect(
          reportingPushes(run).filter((push: NodeStatusPushRecord) => {
            return push.receiveMs <= cleanup.atMs;
          }),
        ).toEqual([]);
        for (const entry of run.simulator.cleanupRuns) {
          expect(entry.prunedNodes).toEqual([]);
        }
      });

      test("once a node is established, both survivors report pve3 and pve4 (L = D = 2); pve1 and pve2 — silent in the inventory until their first push, but never Offline — are never reported", () => {
        const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
        expect(reports.length).toBeGreaterThan(100);
        expect(reports[0]!.receiveMs).toBeGreaterThanOrEqual(
          run.simulator.nodeStatusPushes[0]!.receiveMs +
            PROXMOX_NODE_SILENCE_MS,
        );
        for (const report of reports) {
          expect(report.silentNodes).toEqual(["pve3", "pve4"]);
          expect(report.reporterCount).toBe(2);
        }
        expect(run.simulator.reportsOf("pve1")).toEqual([]);
        expect(run.simulator.reportsOf("pve2")).toEqual([]);

        // Both reported together: every mark writes both rows at once.
        const marks: Array<SimulatedOfflineMark> =
          run.simulator.offlineMarks.filter((mark: SimulatedOfflineMark) => {
            return mark.markedNodes.length > 0;
          });
        expect(marks.length).toBeGreaterThan(1);
        for (const mark of marks) {
          expect(mark.markedNodes).toEqual(["pve3", "pve4"]);
        }
        /*
         * Marked last by the latest mark, on the worker's clock; that write
         * is also the row's last (the database's clock is the workers').
         */
        for (const name of ["pve3", "pve4"]) {
          expect(run.simulator.nodeRow(name)).toEqual({
            lastSeenAt: EARLIER_SEEN_AT,
            isUp: false,
            isNativePush: true,
            notReportingMarkedAt: new Date(marks[marks.length - 1]!.atMs),
            updatedAt: new Date(marks[marks.length - 1]!.atMs),
          });
        }
      });

      test("Node Offline fires for node/pve3 and node/pve4 from a window after the first report on", () => {
        const firstReport: NodeStatusPushRecord = reportingPushes(run)[0]!;
        const last: Tick = run.ticks[run.ticks.length - 1]!;
        expect(last.atMs).toBeGreaterThan(firstReport.receiveMs + WINDOW_MS);
        for (const tick of ticksFrom(
          run,
          firstReport.receiveMs + WINDOW_MS + MINUTE_MS,
        )) {
          expect(tick.nodeOffline.offlineIds).toEqual([
            "node/pve3",
            "node/pve4",
          ]);
        }
      });

      test("the verdicts equal the oracle on every evaluation", () => {
        expectMatchesOracle(run);
      });
    });

    describe("counterfactual: without the adoption", () => {
      let run: ScenarioRun;

      beforeAll(async () => {
        run = await runScenario(scenario(true));
      });

      test("the 12:05 tick prunes pve3's and pve4's rows before anyone could report them", () => {
        expect(run.simulator.adoptions).toEqual([]);
        const cleanup: SimulatedCleanupRun = warmUpCleanup(run);
        expect(cleanup.prunedNodes).toEqual(["pve3", "pve4"]);
        expect(run.simulator.nodeRow("pve3")).toBeNull();
        expect(run.simulator.nodeRow("pve4")).toBeNull();
      });

      test("pve3 and pve4 are never reported and Node Offline never fires", () => {
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
   * Nothing but a report is a mark. A cluster moved from the Proxmox Agent
   * to the native push; the agent's last scrape, 10 minutes before the
   * native push began, saw pve3 offline, so its row is Offline, written
   * then — its updatedAt that write's, on the database's clock — and never
   * marked: only markNodesNotReporting writes notReportingMarkedAt. pve3 is
   * back by the time the native push begins, but its first native push is
   * processed a minute after its siblings'.
   *
   * The first native flush adopts all three rows into the native keep —
   * isNativePush only. Until pve3's own push is in, every push reads pve3
   * Offline and never marked, so nothing continues; no node is established
   * yet, so nobody reports pve3; and its own first push turns it Online.
   * The row's updatedAt passes for nothing, however it reads:
   *   - with the database's clock 10 minutes ahead of the workers', the
   *     agent's write of pve3's row reads as made just as the native push
   *     begins — and still nobody reports pve3;
   *   - with the mark kept in updatedAt instead (the design before
   *     notReportingMarkedAt), that same skewed write reads as a mark made
   *     just now: pve1 and pve2 report pve3 until its own push is in, and
   *     Node Offline fires for a node that is up;
   *   - as it did, with no skew at all, with the mark in updatedAt and the
   *     adoption stamping updatedAt, as they first shipped.
   * All of it held on 24 other draws.
   */
  describe("3 nodes moved from the Proxmox Agent, whose last scrape 10 minutes before saw pve3 offline; pve3 is back, its first native push a minute behind its siblings'", () => {
    const NATIVE_FROM_MS: number = SIM_START_MS + 3 * MINUTE_MS + 30_000;
    const PVE3_FROM_MS: number = NATIVE_FROM_MS + MINUTE_MS;
    const AGENT_LAST_AT: Date = new Date(NATIVE_FROM_MS - 10 * MINUTE_MS);
    const CLOCK_AHEAD_MS: number = 10 * MINUTE_MS;

    interface AgentMoveVariant {
      // The database's clock minus the workers'.
      databaseClockOffsetMs: number;
      // Counterfactuals, never production (see the simulator).
      markInUpdatedAt: boolean;
      adoptionStampsUpdatedAt: boolean;
    }

    /*
     * The agent's row, as its last scrape's bulkUpsert wrote it: updatedAt
     * the database's now(), notReportingMarkedAt never written.
     */
    function agentRow(
      isUp: boolean,
      databaseClockOffsetMs: number,
    ): SimulatedNodeRow {
      return {
        lastSeenAt: AGENT_LAST_AT,
        isUp: isUp,
        isNativePush: false,
        notReportingMarkedAt: null,
        updatedAt: new Date(AGENT_LAST_AT.getTime() + databaseClockOffsetMs),
      };
    }

    function scenario(variant: AgentMoveVariant): ScenarioInput {
      return {
        seed: 263,
        nodeCount: 3,
        durationMinutes: 20,
        downRanges: {
          pve1: [{ fromMs: BEFORE_START_MS, toMs: NATIVE_FROM_MS }],
          pve2: [{ fromMs: BEFORE_START_MS, toMs: NATIVE_FROM_MS }],
          pve3: [{ fromMs: BEFORE_START_MS, toMs: PVE3_FROM_MS }],
        },
        initialNodeRows: {
          pve1: agentRow(true, variant.databaseClockOffsetMs),
          pve2: agentRow(true, variant.databaseClockOffsetMs),
          pve3: agentRow(false, variant.databaseClockOffsetMs),
        },
        databaseClockOffsetMs: variant.databaseClockOffsetMs,
        markInUpdatedAt: variant.markInUpdatedAt,
        adoptionStampsUpdatedAt: variant.adoptionStampsUpdatedAt,
        // From the first native push on (7 s past the half minute).
        evaluateFromMs: NATIVE_FROM_MS + 7_000,
      };
    }

    function firstOwnPush(
      run: ScenarioRun,
      name: string,
    ): NodeStatusPushRecord {
      const first: NodeStatusPushRecord | undefined =
        run.simulator.ownPushes(name)[0];
      if (!first) {
        throw new Error(`${name} never pushed`);
      }
      return first;
    }

    // Node-status pushes processed before pve3's first own push.
    function beforePve3(run: ScenarioRun): Array<NodeStatusPushRecord> {
      const pve3Back: NodeStatusPushRecord = firstOwnPush(run, "pve3");
      return run.simulator.nodeStatusPushes.filter(
        (push: NodeStatusPushRecord) => {
          return push.receiveMs < pve3Back.receiveMs;
        },
      );
    }

    const DESIGN_VARIANTS: Array<{ name: string; variant: AgentMoveVariant }> =
      [
        {
          name: "the database's clock the workers'",
          variant: {
            databaseClockOffsetMs: 0,
            markInUpdatedAt: false,
            adoptionStampsUpdatedAt: false,
          },
        },
        {
          name: "the database's clock 10 minutes ahead of the workers'",
          variant: {
            databaseClockOffsetMs: CLOCK_AHEAD_MS,
            markInUpdatedAt: false,
            adoptionStampsUpdatedAt: false,
          },
        },
      ];

    for (const design of DESIGN_VARIANTS) {
      describe(`the mark is notReportingMarkedAt, which the agent never wrote — ${design.name}`, () => {
        const offsetMs: number = design.variant.databaseClockOffsetMs;
        // The agent's write of pve3's row, as the database's clock stamped it.
        const agentWriteMs: number = AGENT_LAST_AT.getTime() + offsetMs;
        let run: ScenarioRun;

        beforeAll(async () => {
          run = await runScenario(scenario(design.variant));
        });

        test("the setup: the agent's rows, pve3's Offline, written 10 minutes before on the database's clock and never marked; pve3's first native push processed about a minute after its siblings', and Online from then on", () => {
          expect(run.simulator.initialNodeRows().get("pve3")).toEqual({
            lastSeenAt: AGENT_LAST_AT,
            isUp: false,
            isNativePush: false,
            notReportingMarkedAt: null,
            updatedAt: new Date(agentWriteMs),
          });
          const siblingsFirstMs: number = Math.max(
            firstOwnPush(run, "pve1").receiveMs,
            firstOwnPush(run, "pve2").receiveMs,
          );
          expect(siblingsFirstMs).toBeGreaterThanOrEqual(NATIVE_FROM_MS);
          const behindMs: number =
            firstOwnPush(run, "pve3").receiveMs - siblingsFirstMs;
          expect(behindMs).toBeGreaterThan(EVALUATION_STEP_MS);
          expect(behindMs).toBeLessThan(MINUTE_MS + 15_000);

          // Its own push cleared the (absent) mark and wrote the row now.
          const pve3Last: NodeStatusPushRecord =
            run.simulator.ownPushes("pve3")[
              run.simulator.ownPushes("pve3").length - 1
            ]!;
          const row: SimulatedNodeRow | null = run.simulator.nodeRow("pve3");
          expect(row?.isUp).toBe(true);
          expect(row?.notReportingMarkedAt).toBeNull();
          expect(row!.updatedAt.getTime() - pve3Last.receiveMs).toBe(offsetMs);
        });

        test("the first native flush adopts pve3's row before its first push, and every push before it reads pve3 Offline and never marked — the agent's write passing for no mark, however recent it reads", () => {
          const adoption: SimulatedAdoption | undefined =
            run.simulator.adoptions[0];
          expect(adoption).toBeDefined();
          expect(adoption!.atMs).toBeLessThanOrEqual(
            run.simulator.nodeStatusPushes[0]!.receiveMs,
          );
          expect(adoption!.adoptedNodes).toContain("pve3");

          const pushes: Array<NodeStatusPushRecord> = beforePve3(run);
          expect(pushes.length).toBeGreaterThan(8);
          for (const push of pushes) {
            expect(push.offlineRosterRows).toEqual([
              { nodeName: "pve3", markedAtMs: null },
            ]);
            /*
             * The agent's write, by the workers' clock: 10 minutes old — or,
             * the database's clock 10 minutes ahead, within the window.
             */
            const writeAgeMs: number = push.rosterReadAtMs! - agentWriteMs;
            if (offsetMs === 0) {
              expect(writeAgeMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
            } else {
              expect(writeAgeMs).toBeLessThanOrEqual(PROXMOX_MONITOR_WINDOW_MS);
            }
          }
        });

        test("nobody reports pve3 — no node is established before its own push is in — and Node Offline never fires for node/pve3", () => {
          const replay: Map<NodeStatusPushRecord, ExpectedReport> =
            replayReports(run);
          for (const push of beforePve3(run)) {
            expect(replayedReportOf(replay, push).established).toBe(false);
          }
          expect(reportingPushes(run)).toEqual([]);
          expect(run.simulator.offlineMarks).toEqual([]);
          for (const tick of run.ticks) {
            expect(tick.nodeOffline.offlineIds).toEqual([]);
            expect(tick.quorum.fires).toBe(false);
          }
        });

        test("the verdicts equal the oracle on every evaluation", () => {
          expectMatchesOracle(run);
        });
      });
    }

    /*
     * Not the design — the gap it closes. The roster's mark as the row's
     * updatedAt: every write of the row passes for one.
     */
    const COUNTERFACTUALS: Array<{
      name: string;
      variant: AgentMoveVariant;
      // What pve3's row reads as marked at, before any report marks it.
      readsAsMarkedAt: (run: ScenarioRun) => number;
    }> = [
      {
        name: "the mark kept in updatedAt, the database's clock 10 minutes ahead of the workers'",
        variant: {
          databaseClockOffsetMs: CLOCK_AHEAD_MS,
          markInUpdatedAt: true,
          adoptionStampsUpdatedAt: false,
        },
        // The agent's own write, on the skewed clock.
        readsAsMarkedAt: (): number => {
          return AGENT_LAST_AT.getTime() + CLOCK_AHEAD_MS;
        },
      },
      {
        name: "the mark kept in updatedAt and the adoption stamping it, as they first shipped",
        variant: {
          databaseClockOffsetMs: 0,
          markInUpdatedAt: true,
          adoptionStampsUpdatedAt: true,
        },
        // The adoption's stamp.
        readsAsMarkedAt: (run: ScenarioRun): number => {
          return run.simulator.adoptions[0]!.atMs;
        },
      },
    ];

    for (const counterfactual of COUNTERFACTUALS) {
      describe(`counterfactual: ${counterfactual.name}`, () => {
        let run: ScenarioRun;

        beforeAll(async () => {
          run = await runScenario(scenario(counterfactual.variant));
        });

        test("pve3's Offline row reads as marked just now: pve1 and pve2 report it, no node established, until its own push is in", () => {
          const replay: Map<NodeStatusPushRecord, ExpectedReport> =
            replayReports(run);
          const pve3Back: NodeStatusPushRecord = firstOwnPush(run, "pve3");
          const reports: Array<NodeStatusPushRecord> = reportingPushes(run);
          expect(reports.length).toBeGreaterThan(2);
          expect(reports[0]!.offlineRosterRows).toEqual([
            {
              nodeName: "pve3",
              markedAtMs: counterfactual.readsAsMarkedAt(run),
            },
          ]);
          for (const report of reports) {
            expect(["pve1", "pve2"]).toContain(report.nodeName);
            expect(report.silentNodes).toEqual(["pve3"]);
            expect(report.reporterCount).toBe(2);
            expect(report.receiveMs).toBeLessThan(pve3Back.receiveMs);
            expect(replayedReportOf(replay, report).established).toBe(false);
            expect(report.offlineRosterRows.length).toBe(1);
            expect(
              report.rosterReadAtMs! - report.offlineRosterRows[0]!.markedAtMs!,
            ).toBeLessThanOrEqual(PROXMOX_MONITOR_WINDOW_MS);
          }
        });

        test("Node Offline fires for node/pve3 — a node that is up", () => {
          const pve3Back: NodeStatusPushRecord = firstOwnPush(run, "pve3");
          const firing: Array<Tick> = run.ticks.filter((tick: Tick) => {
            return tick.nodeOffline.offlineIds.includes("node/pve3");
          });
          expect(firing.length).toBeGreaterThan(0);
          for (const tick of firing) {
            expect(tick.atMs).toBeLessThan(pve3Back.receiveMs + 2 * MINUTE_MS);
          }
        });

        test("the verdicts equal the oracle (which replays the mark in updatedAt) on every evaluation", () => {
          expectMatchesOracle(run);
        });
      });
    }
  });

  /*
   * ------------------------------------------------------------------
   * After an outage longer than the monitor window, nothing continues.
   * ------------------------------------------------------------------
   *
   * The continuation keeps reporting a node already Offline through a gap
   * only while it was marked within the monitor window of the roster's
   * read — its row's notReportingMarkedAt, which the reports refresh while
   * they go on. Through a longer OneUptime outage nothing reports, so
   * every mark ages past the window (Redis lost or not: the mark is in
   * Postgres); the window holds
   * nothing from before and the incidents have resolved, and every report
   * waits for an established node again, by when every live node has
   * pushed.
   *
   * Two things went wrong here while the continuation ran through such an
   * outage, with L = the nodes with a live key:
   *   - the first node back reported the Offline node with L = 1 — a whole
   *     node's weight — before its siblings' first pushes were processed,
   *     and with one Offline node of four the window read 50 %: Quorum at
   *     Risk fired with 3 of 4 nodes up. L now counts every node a report
   *     does not name (presumed live until reported), and the gate holds
   *     the report back — either fix alone prevents it;
   *   - a node Offline before the outage that came back during it was
   *     reported by the first nodes back until its own first push was
   *     processed, and the window held nothing but those reports: Node
   *     Offline fired for a node that had been up for minutes. Only the
   *     gate prevents it.
   * Each scenario runs with Redis lost in the outage and with Redis riding
   * it out. Their verdicts held on 24 other draws; what the draw decides
   * is pinned in the setup tests (pve1 back alone for over 30 s: 20 of
   * those 24) and whether the rule as first shipped would have fired
   * (an evaluation landing while pve1's pushes are all the window holds:
   * 22 of 24).
   */
  for (const keepsLiveness of [false, true]) {
    const redisFate: string = keepsLiveness ? "Redis rides out" : "loses Redis";

    describe(`4 nodes, pve4 Offline, then a 10-minute OneUptime outage that ${redisFate}; the survivors back 0, 33 and 66 s apart`, () => {
      const OUTAGE: SimulatedIngestOutage = {
        fromMs: DEATH_MS + 10 * MINUTE_MS,
        toMs: DEATH_MS + 20 * MINUTE_MS,
        resumeDelayMsByNode: { pve1: 0, pve2: 33_000, pve3: 66_000 },
        keepsLiveness: keepsLiveness,
      };
      let run: ScenarioRun;
      let replay: Map<NodeStatusPushRecord, ExpectedReport>;
      let firstBack: NodeStatusPushRecord;

      beforeAll(async () => {
        run = await runScenario({
          seed: 233,
          nodeCount: 4,
          durationMinutes: 50,
          downRanges: { pve4: [{ fromMs: DEATH_MS, toMs: NEVER_MS }] },
          outage: OUTAGE,
        });
        replay = replayReports(run);
        const back: NodeStatusPushRecord | undefined =
          run.simulator.nodeStatusPushes.find((push: NodeStatusPushRecord) => {
            return push.receiveMs >= OUTAGE.toMs;
          });
        if (!back) {
          throw new Error("nothing was processed after the outage");
        }
        firstBack = back;
      });

      function firstPushBackOf(name: string): NodeStatusPushRecord {
        const back: NodeStatusPushRecord | undefined = run.simulator
          .ownPushes(name)
          .find((push: NodeStatusPushRecord) => {
            return push.receiveMs >= OUTAGE.toMs;
          });
        if (!back) {
          throw new Error(`${name} never came back after the outage`);
        }
        return back;
      }

      test("the setup: pve4 Offline before the outage, pve1 back alone for over 30 s", () => {
        expect(run.simulator.livenessLostAtMs).toEqual(
          keepsLiveness ? [] : [OUTAGE.fromMs],
        );
        const mark: SimulatedOfflineMark | undefined =
          run.simulator.offlineMarks.find((entry: SimulatedOfflineMark) => {
            return entry.markedNodes.includes("pve4");
          });
        expect(mark).toBeDefined();
        expect(mark!.atMs).toBeLessThan(OUTAGE.fromMs);

        expect(firstBack.nodeName).toBe("pve1");
        for (const name of ["pve2", "pve3"]) {
          expect(
            firstPushBackOf(name).receiveMs - firstBack.receiveMs,
          ).toBeGreaterThan(EVALUATION_STEP_MS);
        }
        // No live node is ever reported.
        for (const name of ["pve1", "pve2", "pve3"]) {
          expect(run.simulator.reportsOf(name)).toEqual([]);
        }
      });

      test("pve4's mark had aged past the window when the outage ended: nobody reports pve4 until a node is established after it, and then every report counts L = 3", () => {
        const after: Array<NodeStatusPushRecord> =
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return push.receiveMs >= OUTAGE.toMs;
            },
          );
        const firstReport: NodeStatusPushRecord | undefined = after.find(
          (push: NodeStatusPushRecord) => {
            return push.silentNodes.length > 0;
          },
        );
        expect(firstReport).toBeDefined();
        expect(replayedReportOf(replay, firstReport!).established).toBe(true);
        expect(firstReport!.receiveMs).toBeGreaterThanOrEqual(
          firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS,
        );

        const warmUp: Array<NodeStatusPushRecord> = after.filter(
          (push: NodeStatusPushRecord) => {
            return !replayedReportOf(replay, push).established;
          },
        );
        expect(warmUp.length).toBeGreaterThan(20);
        for (const push of warmUp) {
          /*
           * Offline all along, last marked before the outage — too long
           * before the roster's read.
           */
          expect(push.offlineRosterRows.length).toBe(1);
          expect(push.offlineRosterRows[0]!.nodeName).toBe("pve4");
          const markedAtMs: number = push.offlineRosterRows[0]!.markedAtMs!;
          expect(markedAtMs).toBeLessThan(OUTAGE.fromMs);
          expect(push.rosterReadAtMs! - markedAtMs).toBeGreaterThan(
            PROXMOX_MONITOR_WINDOW_MS,
          );
          expect(push.silentNodes).toEqual([]);
        }

        // By the first report, every survivor had pushed.
        for (const name of ["pve2", "pve3"]) {
          expect(firstPushBackOf(name).receiveMs).toBeLessThan(
            firstReport!.receiveMs,
          );
        }
        for (const push of after) {
          if (push.silentNodes.length > 0) {
            expect(push.silentNodes).toEqual(["pve4"]);
            expect(push.reporterCount).toBe(3);
          }
        }
      });

      test("Node Offline fires for node/pve4 only", () => {
        for (const tick of run.ticks) {
          for (const id of tick.nodeOffline.offlineIds) {
            expect(id).toBe("node/pve4");
          }
        }
      });

      test("the verdicts equal the oracle on every evaluation", () => {
        expectMatchesOracle(run);
      });

      test("Quorum at Risk never fires — 3 of 4 nodes are up all along", () => {
        expect(
          verdictsOf(run.ticks)
            .filter((verdict: Verdict) => {
              return verdict.quorumFires;
            })
            .map((verdict: Verdict) => {
              return `${new Date(verdict.atMs).toISOString()}: ${describeQuorum(verdict)}`;
            }),
        ).toEqual([]);
      });

      test("as the continuation first shipped — ungated, L from live keys — pve1 back alone would have weighed pve4 as a whole node and Quorum at Risk would have fired; either fix alone prevents it", () => {
        const firedAt: (rules: ReplayRules) => Array<number> = (
          rules: ReplayRules,
        ): Array<number> => {
          return oracleVerdicts(run, run.ticks, rules)
            .filter((verdict: Verdict) => {
              return verdict.quorumFires;
            })
            .map((verdict: Verdict) => {
              return verdict.atMs;
            });
        };

        const asShipped: Array<number> = firedAt(CONTINUATION_AS_FIRST_SHIPPED);
        expect(asShipped.length).toBeGreaterThan(0);
        for (const atMs of asShipped) {
          // Only while pve1's L = 1 pushes are all the window holds.
          expect(atMs).toBeGreaterThan(firstBack.receiveMs);
          expect(atMs).toBeLessThan(
            firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS,
          );
        }
        const asShippedReplay: Map<NodeStatusPushRecord, ExpectedReport> =
          replayReports(run, CONTINUATION_AS_FIRST_SHIPPED);
        expect(replayedReportOf(asShippedReplay, firstBack)).toMatchObject({
          silentNodes: ["pve4"],
          reporterCount: 1,
        });

        expect(firedAt(WITHOUT_WINDOW_GATE)).toEqual([]);
        expect(firedAt(L_FROM_LIVE_KEYS)).toEqual([]);
      });
    });

    describe(`3 nodes, pve3 Offline comes back during a 10-minute OneUptime outage that ${redisFate}; pve3 back 40 s after the others`, () => {
      const OUTAGE: SimulatedIngestOutage = {
        fromMs: DEATH_MS + 10 * MINUTE_MS,
        toMs: DEATH_MS + 20 * MINUTE_MS,
        resumeDelayMsByNode: { pve1: 0, pve2: 0, pve3: 40_000 },
        keepsLiveness: keepsLiveness,
      };
      let run: ScenarioRun;
      // The first node-status push processed after the outage, and pve3's.
      let firstBack: NodeStatusPushRecord;
      let pve3Back: NodeStatusPushRecord;

      beforeAll(async () => {
        run = await runScenario({
          seed: 239,
          nodeCount: 3,
          durationMinutes: 50,
          downRanges: {
            pve3: [{ fromMs: DEATH_MS, toMs: OUTAGE.fromMs + 3 * MINUTE_MS }],
          },
          outage: OUTAGE,
        });
        const back: NodeStatusPushRecord | undefined =
          run.simulator.nodeStatusPushes.find((push: NodeStatusPushRecord) => {
            return push.receiveMs >= OUTAGE.toMs;
          });
        const ownBack: NodeStatusPushRecord | undefined = run.simulator
          .ownPushes("pve3")
          .find((push: NodeStatusPushRecord) => {
            return push.receiveMs >= OUTAGE.toMs;
          });
        if (!back || !ownBack) {
          throw new Error("nothing was processed after the outage");
        }
        firstBack = back;
        pve3Back = ownBack;
      });

      test("the setup: pve3 Offline before the outage, up from its middle, its first push back processed 40 s after the others'", () => {
        expect(run.simulator.livenessLostAtMs).toEqual(
          keepsLiveness ? [] : [OUTAGE.fromMs],
        );
        const mark: SimulatedOfflineMark | undefined =
          run.simulator.offlineMarks.find((entry: SimulatedOfflineMark) => {
            return entry.markedNodes.includes("pve3");
          });
        expect(mark).toBeDefined();
        expect(mark!.atMs).toBeLessThan(OUTAGE.fromMs);

        // Up (true time) from 3 minutes into the outage; nothing received.
        expect(
          run.simulator
            .ownPushes("pve3")
            .filter((push: NodeStatusPushRecord) => {
              return (
                push.pushTimeMs > DEATH_MS + 1_000 &&
                push.receiveMs < OUTAGE.toMs
              );
            }),
        ).toEqual([]);
        expect(pve3Back.receiveMs - firstBack.receiveMs).toBeGreaterThan(
          EVALUATION_STEP_MS,
        );
        // Back for good: Online again at the end.
        expect(run.simulator.nodeRow("pve3")?.isUp).toBe(true);
      });

      test("nobody reports pve3 after the outage: its mark had aged past the window, and pve3's own push is in before any node is established", () => {
        for (const report of run.simulator.reportsOf("pve3")) {
          expect(report.receiveMs).toBeLessThan(OUTAGE.fromMs);
        }
        expect(pve3Back.receiveMs).toBeLessThan(
          firstBack.receiveMs + PROXMOX_NODE_SILENCE_MS,
        );

        /*
         * The first nodes back, before pve3's push: its row still Offline,
         * last marked before the outage — too long ago — so no report.
         */
        const beforePve3: Array<NodeStatusPushRecord> =
          run.simulator.nodeStatusPushes.filter(
            (push: NodeStatusPushRecord) => {
              return (
                push.receiveMs >= OUTAGE.toMs &&
                push.receiveMs < pve3Back.receiveMs
              );
            },
          );
        expect(beforePve3.length).toBeGreaterThan(4);
        for (const push of beforePve3) {
          expect(push.offlineRosterRows.length).toBe(1);
          expect(push.offlineRosterRows[0]!.nodeName).toBe("pve3");
          const markedAtMs: number = push.offlineRosterRows[0]!.markedAtMs!;
          expect(markedAtMs).toBeLessThan(OUTAGE.fromMs);
          expect(push.rosterReadAtMs! - markedAtMs).toBeGreaterThan(
            PROXMOX_MONITOR_WINDOW_MS,
          );
          expect(push.silentNodes).toEqual([]);
        }
      });

      test("the verdicts equal the oracle on every evaluation", () => {
        expectMatchesOracle(run);
      });

      test("after the outage, Node Offline never fires for node/pve3 — it has been up since the outage's middle", () => {
        expect(
          ticksFrom(run, OUTAGE.toMs)
            .filter((tick: Tick) => {
              return tick.nodeOffline.offlineIds.includes("node/pve3");
            })
            .map((tick: Tick) => {
              return new Date(tick.atMs).toISOString();
            }),
        ).toEqual([]);
      });

      test("without the window gate, the first nodes back would have reported pve3 until its own push was in, and Node Offline would have fired for it", () => {
        const after: Array<Tick> = ticksFrom(run, OUTAGE.toMs);
        const firingFor: (rules: ReplayRules) => Array<number> = (
          rules: ReplayRules,
        ): Array<number> => {
          return oracleVerdicts(run, after, rules)
            .filter((verdict: Verdict) => {
              return verdict.offlineIds.includes("node/pve3");
            })
            .map((verdict: Verdict) => {
              return verdict.atMs;
            });
        };

        const ungated: Array<number> = firingFor(WITHOUT_WINDOW_GATE);
        expect(ungated.length).toBeGreaterThan(0);
        for (const atMs of ungated) {
          expect(atMs).toBeGreaterThan(firstBack.receiveMs);
          expect(atMs).toBeLessThan(pve3Back.receiveMs + 2 * MINUTE_MS);
        }
        expect(firingFor(CONTINUATION_AS_FIRST_SHIPPED)).toEqual(ungated);
        // L plays no part here: the gate alone prevents it.
        expect(firingFor(L_FROM_LIVE_KEYS)).toEqual([]);
      });
    });
  }

  /*
   * The mark is judged on the ingest worker's clock, so it is written on
   * it too (markNodesNotReporting's markedAt, into notReportingMarkedAt).
   * The database's clock here runs 10 minutes ahead of the workers'.
   * Written with the database's now(), as it first was, a mark would read
   * 10 minutes younger than it is: pve3's last mark before a 10-minute
   * outage would still be within the monitor window after it, and — as in
   * the scenario above without the gate — the first nodes back would
   * report pve3, up since the outage's middle, until its own push was in,
   * and Node Offline would fire for it. Both held on 24 other draws.
   */
  describe("3 nodes, pve3 Offline comes back during a 10-minute OneUptime outage, the database's clock 10 minutes ahead of the workers'", () => {
    const CLOCK_AHEAD_MS: number = 10 * MINUTE_MS;
    const OUTAGE: SimulatedIngestOutage = {
      fromMs: DEATH_MS + 10 * MINUTE_MS,
      toMs: DEATH_MS + 20 * MINUTE_MS,
      resumeDelayMsByNode: { pve1: 0, pve2: 0, pve3: 40_000 },
    };

    function scenario(markOnDatabaseClock: boolean): ScenarioInput {
      return {
        seed: 271,
        nodeCount: 3,
        durationMinutes: 50,
        downRanges: {
          pve3: [{ fromMs: DEATH_MS, toMs: OUTAGE.fromMs + 3 * MINUTE_MS }],
        },
        outage: OUTAGE,
        databaseClockOffsetMs: CLOCK_AHEAD_MS,
        markOnDatabaseClock: markOnDatabaseClock,
      };
    }

    function firstPushBack(
      run: ScenarioRun,
      name: string | null,
    ): NodeStatusPushRecord {
      const back: NodeStatusPushRecord | undefined = (
        name ? run.simulator.ownPushes(name) : run.simulator.nodeStatusPushes
      ).find((push: NodeStatusPushRecord) => {
        return push.receiveMs >= OUTAGE.toMs;
      });
      if (!back) {
        throw new Error("nothing was processed after the outage");
      }
      return back;
    }

    // The node-status pushes after the outage, before pve3's own.
    function beforePve3(run: ScenarioRun): Array<NodeStatusPushRecord> {
      const pve3Back: NodeStatusPushRecord = firstPushBack(run, "pve3");
      return run.simulator.nodeStatusPushes.filter(
        (push: NodeStatusPushRecord) => {
          return (
            push.receiveMs >= OUTAGE.toMs && push.receiveMs < pve3Back.receiveMs
          );
        },
      );
    }

    function nodeOfflineForPve3After(run: ScenarioRun): Array<number> {
      return ticksFrom(run, OUTAGE.toMs)
        .filter((tick: Tick) => {
          return tick.nodeOffline.offlineIds.includes("node/pve3");
        })
        .map((tick: Tick) => {
          return tick.atMs;
        });
    }

    describe("the mark written on the worker's clock (markedAt)", () => {
      let run: ScenarioRun;

      beforeAll(async () => {
        run = await runScenario(scenario(false));
      });

      test("the setup: the database's own writes run 10 minutes ahead; every mark is written at the worker's now", () => {
        // The fold's own write of a live node's row: the database's now().
        const pve1Last: NodeStatusPushRecord =
          run.simulator.ownPushes("pve1")[
            run.simulator.ownPushes("pve1").length - 1
          ]!;
        expect(
          run.simulator.nodeRow("pve1")!.updatedAt.getTime() -
            pve1Last.receiveMs,
        ).toBeGreaterThanOrEqual(CLOCK_AHEAD_MS);

        const writes: Array<SimulatedOfflineMark> =
          run.simulator.offlineMarks.filter((mark: SimulatedOfflineMark) => {
            return mark.markedNodes.includes("pve3");
          });
        expect(writes.length).toBeGreaterThan(3);
        for (const mark of run.simulator.offlineMarks) {
          expect(mark.markedAtMs).toBe(mark.atMs);
        }
        // Refreshed every 60 to 90 s on the worker's clock, as without skew.
        for (let index: number = 1; index < writes.length; index++) {
          const intervalMs: number =
            writes[index]!.atMs - writes[index - 1]!.atMs;
          expect(intervalMs).toBeGreaterThan(SILENT_NODE_MARK_REFRESH_MS);
          expect(intervalMs).toBeLessThan(
            SILENT_NODE_MARK_REFRESH_MS + MARK_FENCE_MS,
          );
        }
        expect(writes[writes.length - 1]!.atMs).toBeLessThan(OUTAGE.fromMs);
        expect(run.simulator.nodeRow("pve3")?.isUp).toBe(true);
      });

      test("after the outage the first nodes back read pve3's mark past the monitor window, and nobody reports pve3", () => {
        const pushes: Array<NodeStatusPushRecord> = beforePve3(run);
        expect(pushes.length).toBeGreaterThan(4);
        for (const push of pushes) {
          expect(push.offlineRosterRows.length).toBe(1);
          expect(push.offlineRosterRows[0]!.nodeName).toBe("pve3");
          expect(
            push.rosterReadAtMs! - push.offlineRosterRows[0]!.markedAtMs!,
          ).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
          expect(push.silentNodes).toEqual([]);
        }
        for (const report of run.simulator.reportsOf("pve3")) {
          expect(report.receiveMs).toBeLessThan(OUTAGE.fromMs);
        }
      });

      test("after the outage, Node Offline never fires for node/pve3", () => {
        expect(
          nodeOfflineForPve3After(run).map((atMs: number) => {
            return new Date(atMs).toISOString();
          }),
        ).toEqual([]);
      });

      test("the verdicts equal the oracle on every evaluation", () => {
        expectMatchesOracle(run);
      });
    });

    describe("counterfactual: the mark written with the database's now(), as it first was", () => {
      let run: ScenarioRun;

      beforeAll(async () => {
        run = await runScenario(scenario(true));
      });

      test("every mark reads 10 minutes younger than it is: after the outage the first nodes back read pve3 as marked within the window and report it until its own push is in", () => {
        for (const mark of run.simulator.offlineMarks) {
          expect(mark.markedAtMs).toBe(mark.atMs + CLOCK_AHEAD_MS);
        }
        const pushes: Array<NodeStatusPushRecord> = beforePve3(run);
        expect(pushes.length).toBeGreaterThan(4);
        for (const push of pushes) {
          expect(
            push.rosterReadAtMs! - push.offlineRosterRows[0]!.markedAtMs!,
          ).toBeLessThanOrEqual(PROXMOX_MONITOR_WINDOW_MS);
          expect(push.silentNodes).toEqual(["pve3"]);
        }
      });

      test("Node Offline fires for node/pve3 after the outage — up since its middle", () => {
        const firing: Array<number> = nodeOfflineForPve3After(run);
        expect(firing.length).toBeGreaterThan(0);
        const pve3Back: NodeStatusPushRecord = firstPushBack(run, "pve3");
        for (const atMs of firing) {
          expect(atMs).toBeGreaterThan(firstPushBack(run, null).receiveMs);
          expect(atMs).toBeLessThan(pve3Back.receiveMs + 2 * MINUTE_MS);
        }
      });

      test("the verdicts equal the oracle (which replays the database's clock) on every evaluation", () => {
        expectMatchesOracle(run);
      });
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
