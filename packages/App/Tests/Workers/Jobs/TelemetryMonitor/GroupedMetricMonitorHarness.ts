import { createHash } from "crypto";
import {
  IntervalHistogram,
  PerformanceEntry,
  PerformanceObserver,
  PerformanceObserverEntryList,
  monitorEventLoopDelay,
  performance,
} from "perf_hooks";
import { Readable } from "stream";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Redis from "Common/Server/Infrastructure/Redis";
import AlertStateService from "Common/Server/Services/AlertStateService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import MetricService from "Common/Server/Services/MetricService";
import MonitorAlert from "Common/Server/Utils/Monitor/MonitorAlert";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorStatusTimelineUtil from "Common/Server/Utils/Monitor/MonitorStatusTimeline";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "Common/Types/Probe/ProbeApiIngestResponse";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import {
  ALERT_ACKNOWLEDGED_STATE_ID,
  ALERT_IDENTIFIED_STATE_ID,
  ALERT_RESOLVED_STATE_ID,
  DEGRADED_STATUS_ID,
  FLEET_MONITOR_ID,
  FLEET_PROJECT_ID,
  GroupedMetricFleet,
  INCIDENT_RESOLVED_STATE_ID,
  OPERATIONAL_STATUS_ID,
  OpenFleetAlert,
  QUERIES,
  readKey,
} from "./GroupedMetricMonitorFleet";

/*
 * ONE EVALUATION OF THE #10108 FLEET, ON THE REAL PATH, MEASURED.
 *
 * Runs processTelemetryMonitorEvaluationFromQueue - the job a telemetry
 * monitor's check is - for the fleet of GroupedMetricMonitorFleet, end to
 * end: the worker's four reads and their arrival reads, the series
 * breakdown, the formula, MonitorResourceUtil.monitorResource under the
 * monitor's real lock (redis-semaphore, refreshing on its own timer), the
 * criteria evaluator, the status timeline, the alert resolve and create
 * passes, and the monitor log, flushed.
 *
 * Only the stores are stood in for, at their lowest level:
 *   - ClickHouse: the client the services read with answers each read with
 *     the JSON text the fleet holds for it, in 64 KiB chunks, which
 *     executeQuery decodes and parses as it does a real answer; inserts are
 *     encoded as they are for the real client and their bytes counted.
 *   - Postgres: every service's reads and writes (DatabaseService) answer
 *     from the fleet - the monitor, its open alerts, the catalog - and
 *     record what was written; any other read finds nothing.
 *   - Valkey: an in-memory client with the commands this path sends, lock
 *     keys expiring on the clock, so a lock whose refresh comes too late is
 *     lost exactly as it is in production.
 *
 * What it measures: how long the evaluation takes, the longest time the
 * event loop could not run anything else (monitorEventLoopDelay, and a
 * 5 ms timer that says when and in which phase each stall happened), CPU
 * time, the heap and garbage collection, every database call, and the
 * lock. What it records is the outcome - the alerts created and resolved,
 * the status changes, the evaluation summary - which the equivalence test
 * holds to what the code before #10108 did.
 */

export const LOCK_NAMESPACE: string = "MonitorResourceUtil.monitorResource";

// A stall worth naming: the event loop held this long by one piece of work.
const STALL_REPORT_MS: number = 20;
const STALL_TIMER_MS: number = 5;

/*
 * How long a store takes to answer. Each answer arrives on a later turn of
 * the event loop, as a network answer does, so what the evaluation does
 * between two reads is one synchronous stretch, as it is in production -
 * the stretches are what the event loop delay measures. ClickHouse's reads
 * are kept short of the 0.2 s the issue measured so a run stays quick; how
 * long they wait does not change how long the work between them holds the
 * loop.
 */
const CLICKHOUSE_READ_LATENCY_MS: number = 20;

// One turn of the event loop: what an answer from a socket costs at least.
function nextTurn(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

export interface StallRecord {
  // When it ended, from the evaluation's start.
  atMs: number;
  durationMs: number;
  phase: string;
}

export interface PhaseRecord {
  name: string;
  startMs: number;
  endMs: number;
}

export interface EvaluationMeasurement {
  totalMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  // The longest the event loop was blocked, from monitorEventLoopDelay.
  longestBlockMs: number;
  eventLoopDelayP99Ms: number;
  eventLoopDelayMeanMs: number;
  eventLoopUtilization: number;
  // The longest gap the 5 ms timer saw, and the stalls over 20 ms.
  longestStallMs: number;
  stallsOver100Ms: number;
  stalls: Array<StallRecord>;
  phases: Array<PhaseRecord>;
  heapUsedBeforeMb: number;
  heapUsedPeakMb: number;
  heapUsedAfterMb: number;
  rssPeakMb: number;
  gcCount: number;
  gcTotalMs: number;
  gcLongestMs: number;
  postgresCalls: Record<string, number>;
  postgresCallCount: number;
  clickhouseReads: number;
  clickhouseReadBytes: number;
  clickhouseInserts: number;
  clickhouseInsertBytes: number;
  lockRefreshes: number;
  lockLost: boolean;
  unhandledRejections: Array<string>;
  // The evaluation as the monitor log keeps it, in bytes of JSON.
  monitorLogBytes: number;
}

export interface CreatedAlertRecord {
  createdCriteriaId: string | null;
  seriesFingerprint: string | null;
  seriesLabels: JSONValue;
  title: string | null;
  description: string | null;
  rootCause: string | null;
  alertSeverityId: string | null;
  currentAlertStateId: string | null;
  remediationNotes: string | null;
  createdStateLogHash: string;
  monitorSummaryHash: string;
  evaluationDetailsHash: string;
  telemetryQueryHash: string;
}

export interface ResolvedAlertRecord {
  alertId: string;
  alertStateId: string | null;
  rootCause: string | null;
  stateChangeLogHash: string;
}

export interface StatusChangeRecord {
  monitorStatusId: string | null;
  rootCause: string | null;
  statusChangeLogHash: string;
}

// What the evaluation decided of one criteria: the series it matched.
export interface MatchedCriteriaRecord {
  criteriaId: string;
  rootCause: string;
  series: Array<{
    fingerprint: string;
    labels: JSONValue;
    rootCause: string | null;
    metricContextHash: string;
  }>;
}

export interface EvaluationOutcome {
  // The verdict monitorResource reached: what the criteria evaluator matched.
  criteriaMetId: string | null;
  rootCause: string | null;
  evaluatedCriteriaIds: Array<string>;
  matchedCriteria: Array<MatchedCriteriaRecord>;
  createdAlerts: Array<CreatedAlertRecord>;
  resolvedAlerts: Array<ResolvedAlertRecord>;
  statusChanges: Array<StatusChangeRecord>;
  // What the evaluation said of each criteria and why, as the log keeps it.
  criteriaResults: JSONValue;
  events: JSONValue;
}

export interface EvaluationRun {
  measurement: EvaluationMeasurement;
  outcome: EvaluationOutcome;
  error: string | null;
}

export interface RunEvaluationOptions {
  fleet: GroupedMetricFleet;
  /*
   * Called once the monitor's lock is held, for a test that takes it away
   * part way through (as a Valkey restart would).
   */
  onLockAcquired?: ((lockKey: string, store: FakeValkey) => void) | undefined;
  // Wraps the work after the reads, for a test that makes it slow.
  slowDownEvaluationMs?: number | undefined;
}

function hashOf(value: unknown): string {
  if (value === undefined || value === null) {
    return "none";
  }

  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function idOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return String((value as { toString: () => string }).toString());
}

function textOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

// The parts of an evaluation event that do not change from run to run.
function stableEvent(event: JSONObject): JSONObject {
  const copy: JSONObject = { ...event };
  delete copy["at"];
  delete copy["relatedAlertCreatedAt"];
  return copy;
}

/*
 * VALKEY, IN MEMORY: the commands this path sends, with keys that expire on
 * the clock. redis-semaphore's mutex sets its key with NX and PX, refreshes
 * it with a script that extends it only while it still holds the holder's
 * identifier, and deletes it the same way: both scripts are recognised by
 * what they do.
 */
export class FakeValkey {
  public status: string = "ready";
  public refreshes: number = 0;
  public unknownCommands: Set<string> = new Set<string>();
  private values: Map<string, { value: string; expiresAtMs: number | null }> =
    new Map();

  public deleteKey(key: string): void {
    this.values.delete(key);
  }

  public hasKey(key: string): boolean {
    return this.read(key) !== null;
  }

  public read(key: string): string | null {
    const entry: { value: string; expiresAtMs: number | null } | undefined =
      this.values.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    return entry.value;
  }

  private write(key: string, value: string, ttlMs: number | null): void {
    this.values.set(key, {
      value: value,
      expiresAtMs: ttlMs === null ? null : Date.now() + ttlMs,
    });
  }

  public async get(key: string): Promise<string | null> {
    await nextTurn();
    return this.read(key);
  }

  public async mget(
    ...keys: Array<string | Array<string>>
  ): Promise<Array<string | null>> {
    await nextTurn();
    return keys.flat().map((key: string): string | null => {
      return this.read(key);
    });
  }

  public async set(
    key: string,
    value: string,
    ...args: Array<unknown>
  ): Promise<string | null> {
    await nextTurn();
    let ttlMs: number | null = null;
    let onlyIfAbsent: boolean = false;
    let onlyIfPresent: boolean = false;

    for (let index: number = 0; index < args.length; index++) {
      const flag: string = String(args[index]).toUpperCase();

      if (flag === "PX") {
        ttlMs = Number(args[++index]);
      } else if (flag === "EX") {
        ttlMs = Number(args[++index]) * 1000;
      } else if (flag === "NX") {
        onlyIfAbsent = true;
      } else if (flag === "XX") {
        onlyIfPresent = true;
      }
    }

    const exists: boolean = this.read(key) !== null;

    if ((onlyIfAbsent && exists) || (onlyIfPresent && !exists)) {
      return null;
    }

    this.write(key, String(value), ttlMs);
    return "OK";
  }

  public async del(...keys: Array<string | Array<string>>): Promise<number> {
    await nextTurn();
    let deleted: number = 0;

    for (const key of keys.flat()) {
      if (this.read(key) !== null) {
        deleted++;
      }
      this.values.delete(key);
    }

    return deleted;
  }

  public async exists(...keys: Array<string>): Promise<number> {
    await nextTurn();
    return keys.filter((key: string): boolean => {
      return this.read(key) !== null;
    }).length;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    await nextTurn();
    const value: string | null = this.read(key);

    if (value === null) {
      return 0;
    }

    this.write(key, value, Number(seconds) * 1000);
    return 1;
  }

  public async pexpire(key: string, ms: number): Promise<number> {
    await nextTurn();
    const value: string | null = this.read(key);

    if (value === null) {
      return 0;
    }

    this.write(key, value, Number(ms));
    return 1;
  }

  public async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  public async incrby(key: string, by: number): Promise<number> {
    await nextTurn();
    const next: number = Number(this.read(key) || 0) + Number(by);
    this.write(key, String(next), null);
    return next;
  }

  public async decrby(key: string, by: number): Promise<number> {
    return this.incrby(key, -Number(by));
  }

  public async evalsha(): Promise<unknown> {
    throw new Error("NOSCRIPT No matching script. Please use EVAL.");
  }

  public async eval(
    script: string,
    keyCount: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    await nextTurn();
    const keys: Array<string> = args.slice(0, Number(keyCount)).map(String);
    const argv: Array<string> = args.slice(Number(keyCount)).map(String);

    // redis-semaphore's mutex refresh: extend while it is still ours.
    if (script.includes("pexpire") && script.includes("identifier")) {
      this.refreshes++;

      if (this.read(keys[0]!) === argv[0]) {
        this.write(keys[0]!, argv[0]!, Number(argv[1]));
        return 1;
      }

      return 0;
    }

    // redis-semaphore's mutex release: delete while it is still ours.
    if (script.includes("del") && script.includes("identifier")) {
      if (this.read(keys[0]!) === argv[0]) {
        this.values.delete(keys[0]!);
        return 1;
      }

      return 0;
    }

    this.unknownCommands.add(`eval:${script.trim().split("\n")[0]}`);
    return null;
  }

  public pipeline(): unknown {
    const commands: Array<() => Promise<unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const store: FakeValkey = this;

    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (
          _target: Record<string, unknown>,
          name: string | symbol,
        ): unknown => {
          if (name === "exec") {
            return async (): Promise<Array<[Error | null, unknown]>> => {
              const results: Array<[Error | null, unknown]> = [];

              for (const command of commands) {
                try {
                  results.push([null, await command()]);
                } catch (error) {
                  results.push([error as Error, null]);
                }
              }

              return results;
            };
          }

          return (...args: Array<unknown>): unknown => {
            commands.push((): Promise<unknown> => {
              return (
                store as unknown as Record<
                  string,
                  (...a: Array<unknown>) => Promise<unknown>
                >
              )[String(name)]!(...args);
            });
            return chain;
          };
        },
      },
    ) as Record<string, unknown>;

    return chain;
  }

  public multi(): unknown {
    return this.pipeline();
  }

  public on(): FakeValkey {
    return this;
  }

  public once(): FakeValkey {
    return this;
  }

  public duplicate(): FakeValkey {
    return this;
  }

  public async publish(): Promise<number> {
    return 0;
  }

  public async ping(): Promise<string> {
    return "PONG";
  }
}

// What a store call answers, or undefined for its default.
type StoreHandler = (args: Array<unknown>) => unknown;

/*
 * A fake ClickHouse answer: what executeQuery reads of a result set - its
 * text, decoded chunk by chunk as the client decodes a response body.
 */
function toResultSet(body: Buffer, queryId: string): Record<string, unknown> {
  const chunkSize: number = 64 * 1024;
  let consumed: boolean = false;

  const chunks: () => Array<Buffer> = (): Array<Buffer> => {
    const parts: Array<Buffer> = [];

    for (let offset: number = 0; offset < body.length; offset += chunkSize) {
      parts.push(body.subarray(offset, offset + chunkSize));
    }

    return parts;
  };

  const text: () => Promise<string> = async (): Promise<string> => {
    if (consumed) {
      throw new Error("Stream has been already consumed");
    }

    consumed = true;
    let decoded: string = "";
    const decoder: TextDecoder = new TextDecoder();

    for (const chunk of chunks()) {
      await nextTurn();
      decoded += decoder.decode(chunk, { stream: true });
    }

    return decoded + decoder.decode();
  };

  return {
    query_id: queryId,
    response_headers: {},
    text: text,
    json: async (): Promise<unknown> => {
      return JSON.parse(await text());
    },
    stream: (): Readable => {
      return Readable.from(chunks());
    },
    close: (): void => {},
  };
}

// A read's aggregation, as its statement opens: "SELECT max(".
const AGGREGATION_PATTERN: RegExp = /^SELECT\s+([a-zA-Z]+)\(/;

const EMPTY_ANSWER: Buffer = Buffer.from(
  JSON.stringify({ meta: [], data: [], rows: 0 }),
  "utf8",
);

interface InstalledStubs {
  restore: () => void;
  store: FakeValkey;
  postgresCalls: Map<string, number>;
  createdAlerts: Array<Alert>;
  resolvedTimelines: Array<AlertStateTimeline>;
  statusTimelines: Array<MonitorStatusTimeline>;
  monitorLogRows: Array<JSONObject>;
  clickhouse: {
    reads: number;
    readBytes: number;
    inserts: number;
    insertBytes: number;
    unexpectedReads: Array<string>;
  };
}

function patch<T>(
  target: T,
  name: string,
  replacement: unknown,
  restorers: Array<() => void>,
): void {
  const holder: Record<string, unknown> = target as unknown as Record<
    string,
    unknown
  >;
  const hadOwn: boolean = Object.prototype.hasOwnProperty.call(holder, name);
  const original: unknown = holder[name];

  holder[name] = replacement;

  restorers.push((): void => {
    if (hadOwn) {
      holder[name] = original;
    } else {
      delete holder[name];
    }
  });
}

function modelNameOf(service: unknown): string {
  const modelType: { name?: string } | undefined = (
    service as { modelType?: { name?: string } }
  ).modelType;

  return modelType?.name || "Unknown";
}

export function installFleetStubs(fleet: GroupedMetricFleet): InstalledStubs {
  const restorers: Array<() => void> = [];
  const store: FakeValkey = new FakeValkey();
  const postgresCalls: Map<string, number> = new Map();
  const createdAlerts: Array<Alert> = [];
  const resolvedTimelines: Array<AlertStateTimeline> = [];
  const statusTimelines: Array<MonitorStatusTimeline> = [];
  const monitorLogRows: Array<JSONObject> = [];
  const clickhouse: InstalledStubs["clickhouse"] = {
    reads: 0,
    readBytes: 0,
    inserts: 0,
    insertBytes: 0,
    unexpectedReads: [],
  };

  // The alerts open now: the fleet's, then what this check opens and resolves.
  const openAlerts: Map<string, Alert> = new Map();

  for (const entry of fleet.openAlerts) {
    openAlerts.set(entry.alert._id!.toString(), entry.alert);
  }

  let lastStatusId: ObjectID =
    fleet.monitor.currentMonitorStatusId || OPERATIONAL_STATUS_ID;
  let createdAlertNumber: number = 1000;

  const copyOfAlert: (alert: Alert) => Alert = (alert: Alert): Alert => {
    const copy: Alert = new Alert();
    copy._id = alert._id!;
    copy.projectId = alert.projectId!;
    copy.title = alert.title!;
    copy.createdAt = alert.createdAt!;
    copy.createdCriteriaId = alert.createdCriteriaId!;
    copy.alertNumber = alert.alertNumber!;
    copy.alertNumberWithPrefix = alert.alertNumberWithPrefix!;
    copy.currentAlertStateId = alert.currentAlertStateId!;
    if (alert.seriesFingerprint) {
      copy.seriesFingerprint = alert.seriesFingerprint;
    }
    if (alert.seriesLabels) {
      copy.seriesLabels = alert.seriesLabels;
    }
    return copy;
  };

  const handlers: Map<string, StoreHandler> = new Map<string, StoreHandler>([
    [
      "Monitor.findOneById",
      (): unknown => {
        return fleet.monitor;
      },
    ],
    [
      "Monitor.findOneBy",
      (): unknown => {
        return fleet.monitor;
      },
    ],
    [
      "MetricType.findBy",
      (): unknown => {
        return fleet.metricTypes;
      },
    ],
    [
      "Alert.findBy",
      (): unknown => {
        return Array.from(openAlerts.values()).map(copyOfAlert);
      },
    ],
    [
      "Alert.create",
      (args: Array<unknown>): unknown => {
        const alert: Alert = (args[0] as { data: Alert }).data;
        createdAlertNumber++;
        alert._id = `10108000-0000-4000-a000-${String(createdAlertNumber).padStart(12, "0")}`;
        alert.alertNumber = createdAlertNumber;
        alert.alertNumberWithPrefix = `A-${createdAlertNumber}`;
        alert.createdAt = new Date(fleet.windowEndMs);
        if (!alert.currentAlertStateId) {
          alert.currentAlertStateId = ALERT_IDENTIFIED_STATE_ID;
        }
        createdAlerts.push(alert);
        openAlerts.set(alert._id.toString(), alert);
        return alert;
      },
    ],
    [
      "AlertStateTimeline.create",
      (args: Array<unknown>): unknown => {
        const timeline: AlertStateTimeline = (
          args[0] as { data: AlertStateTimeline }
        ).data;
        resolvedTimelines.push(timeline);

        if (
          timeline.alertStateId?.toString() ===
          ALERT_RESOLVED_STATE_ID.toString()
        ) {
          openAlerts.delete(timeline.alertId!.toString());
        }

        timeline._id = ObjectID.generate().toString();
        return timeline;
      },
    ],
    [
      "MonitorStatusTimeline.findOneBy",
      (): unknown => {
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline._id = ObjectID.generate().toString();
        timeline.monitorStatusId = lastStatusId;
        return timeline;
      },
    ],
    [
      "MonitorStatusTimeline.create",
      (args: Array<unknown>): unknown => {
        const timeline: MonitorStatusTimeline = (
          args[0] as { data: MonitorStatusTimeline }
        ).data;
        statusTimelines.push(timeline);
        lastStatusId = timeline.monitorStatusId!;
        fleet.monitor.currentMonitorStatusId = timeline.monitorStatusId!;
        timeline._id = ObjectID.generate().toString();
        return timeline;
      },
    ],
    [
      "MonitorStatus.findOneBy",
      (args: Array<unknown>): unknown => {
        const query: JSONObject =
          ((args[0] as { query?: JSONObject }).query as JSONObject) || {};
        const status: MonitorStatus = new MonitorStatus();
        const id: string = String(query["_id"] || "");
        status._id = id || DEGRADED_STATUS_ID.toString();
        status.name =
          id === OPERATIONAL_STATUS_ID.toString() ? "Operational" : "Degraded";
        return status;
      },
    ],
  ]);

  const defaults: Record<string, unknown> = {
    findBy: [],
    findAllBy: [],
    findOneBy: null,
    findOneById: null,
    countBy: new PositiveNumber(0),
    updateOneById: undefined,
    updateOneBy: undefined,
    updateBy: 0,
    deleteBy: 0,
    deleteOneBy: 0,
    deleteOneById: 0,
  };

  const databasePrototype: Record<string, unknown> =
    DatabaseService.prototype as unknown as Record<string, unknown>;

  for (const method of [...Object.keys(defaults), "create"]) {
    patch(
      databasePrototype,
      method,
      async function (
        this: unknown,
        ...args: Array<unknown>
      ): Promise<unknown> {
        const key: string = `${modelNameOf(this)}.${method}`;
        postgresCalls.set(key, (postgresCalls.get(key) || 0) + 1);
        await nextTurn();

        const handler: StoreHandler | undefined = handlers.get(key);

        if (handler) {
          return handler(args);
        }

        if (method === "create") {
          const data: { _id?: string } = (args[0] as { data: { _id?: string } })
            .data;
          data._id = data._id || ObjectID.generate().toString();
          return data;
        }

        return defaults[method];
      },
      restorers,
    );
  }

  // A raw statement nobody stood in for is a gap in the harness: say so.
  patch(
    databasePrototype,
    "getRepository",
    function (this: unknown): never {
      throw new Error(
        `The #10108 harness has no stand-in for a raw Postgres statement on ${modelNameOf(this)}.`,
      );
    },
    restorers,
  );

  // The project's states, as their services read them.
  patch(
    AlertStateService,
    "getUnresolvedAlertStateIds",
    async (): Promise<Array<ObjectID>> => {
      return [ALERT_IDENTIFIED_STATE_ID, ALERT_ACKNOWLEDGED_STATE_ID];
    },
    restorers,
  );
  patch(
    IncidentStateService,
    "getUnresolvedIncidentStateIds",
    async (): Promise<Array<ObjectID>> => {
      return [];
    },
    restorers,
  );
  patch(
    AlertStateTimelineService,
    "getResolvedStateIdForProject",
    async (): Promise<ObjectID> => {
      return ALERT_RESOLVED_STATE_ID;
    },
    restorers,
  );
  patch(
    IncidentStateTimelineService,
    "getResolvedStateIdForProject",
    async (): Promise<ObjectID> => {
      return INCIDENT_RESOLVED_STATE_ID;
    },
    restorers,
  );
  patch(
    ProjectService,
    "isProjectBlocked",
    async (): Promise<boolean> => {
      return false;
    },
    restorers,
  );
  patch(
    ProjectScopedReferenceValidator,
    "isUsableInProject",
    async (): Promise<boolean> => {
      return true;
    },
    restorers,
  );

  // The window this check judges ends where the fleet's does.
  patch(
    ReceivingCoverage,
    "planTelemetryEvaluation",
    async (): Promise<unknown> => {
      return {
        evaluate: true,
        evaluateUntil: new Date(fleet.windowEndMs),
        isIngestBehind: true,
      };
    },
    restorers,
  );

  const metricNames: Set<string> = new Set<string>(
    QUERIES.map((query: { metricName: string }): string => {
      return query.metricName;
    }),
  );

  const nameOf: (
    params: Record<string, unknown> | undefined,
  ) => string | null = (
    params: Record<string, unknown> | undefined,
  ): string | null => {
    for (const value of Object.values(params || {})) {
      if (typeof value === "string" && metricNames.has(value)) {
        return value;
      }
    }

    return null;
  };

  const readClient: Record<string, unknown> = {
    query: async (params: {
      query: string;
      query_params?: Record<string, unknown>;
    }): Promise<Record<string, unknown>> => {
      clickhouse.reads++;
      const metricName: string | null = nameOf(params.query_params);
      let body: Buffer | undefined = undefined;

      if (metricName && params.query.includes("__arrival_newest")) {
        body = fleet.arrivalAnswers.get(metricName);
      } else if (metricName) {
        const aggregation: string | undefined = AGGREGATION_PATTERN.exec(
          params.query,
        )?.[1];
        body = aggregation
          ? fleet.valueAnswers.get(readKey(metricName, aggregation))
          : undefined;
      }

      if (!body) {
        clickhouse.unexpectedReads.push(params.query.substring(0, 160));
        body = EMPTY_ANSWER;
      }

      clickhouse.readBytes += body.length;
      await sleep(CLICKHOUSE_READ_LATENCY_MS);
      return toResultSet(body, `fleet-${clickhouse.reads}`);
    },
  };

  const ingestClient: Record<string, unknown> = {
    exec: async (params: {
      query: string;
      values?: Readable;
    }): Promise<Record<string, unknown>> => {
      clickhouse.inserts++;

      if (params.values) {
        for await (const chunk of params.values) {
          clickhouse.insertBytes += (chunk as Buffer).length;
          await nextTurn();
        }
      }

      return { stream: Readable.from([]), query_id: "insert" };
    },
    insert: async (): Promise<Record<string, unknown>> => {
      clickhouse.inserts++;
      return { query_id: "insert" };
    },
  };

  const analyticsPrototype: Record<string, unknown> =
    AnalyticsDatabaseService.prototype as unknown as Record<string, unknown>;

  patch(
    analyticsPrototype,
    "getDatabaseClient",
    (): unknown => {
      return readClient;
    },
    restorers,
  );
  patch(
    analyticsPrototype,
    "getIngestClient",
    (): unknown => {
      return ingestClient;
    },
    restorers,
  );

  // What the monitor log keeps of the check.
  const originalInsertJsonRows: unknown = analyticsPrototype["insertJsonRows"];
  patch(
    analyticsPrototype,
    "insertJsonRows",
    async function (
      this: unknown,
      rows: Array<JSONObject>,
      ...rest: Array<unknown>
    ): Promise<void> {
      if (modelNameOf(this) === "MonitorLog") {
        monitorLogRows.push(...rows);
      }

      return (
        originalInsertJsonRows as (
          this: unknown,
          ...args: Array<unknown>
        ) => Promise<void>
      ).call(this, rows, ...rest);
    },
    restorers,
  );

  const redisHolder: Record<string, unknown> = Redis as unknown as Record<
    string,
    unknown
  >;
  const originalClient: unknown = redisHolder["client"];
  redisHolder["client"] = store;
  restorers.push((): void => {
    redisHolder["client"] = originalClient;
  });

  return {
    restore: (): void => {
      for (const restore of restorers.reverse()) {
        restore();
      }
    },
    store: store,
    postgresCalls: postgresCalls,
    createdAlerts: createdAlerts,
    resolvedTimelines: resolvedTimelines,
    statusTimelines: statusTimelines,
    monitorLogRows: monitorLogRows,
    clickhouse: clickhouse,
  };
}

// The 5 ms timer: when the event loop was held, in which phase, and the heap.
export class StallTracker {
  public stalls: Array<StallRecord> = [];
  public longestStallMs: number = 0;
  public heapPeak: number = 0;
  public rssPeak: number = 0;
  private marks: Array<{ name: string; at: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private last: number = 0;
  private startedAt: number = 0;

  // Where the evaluation is now: what a stall from here on is charged to.
  public mark(name: string): void {
    this.marks.push({ name: name, at: performance.now() });
  }

  // The phase active when a stall began, and every phase it ran into.
  private phasesDuring(from: number, to: number): string {
    let active: string = "start";
    const entered: Array<string> = [];

    for (const mark of this.marks) {
      if (mark.at <= from) {
        active = mark.name;
        continue;
      }

      if (mark.at <= to && entered[entered.length - 1] !== mark.name) {
        entered.push(mark.name);
      }
    }

    const names: Array<string> = [active, ...entered];
    const shown: Array<string> =
      names.length > 6
        ? [
            ...names.slice(0, 3),
            `... ${names.length - 5} more ...`,
            ...names.slice(-2),
          ]
        : names;

    return shown.join(" > ");
  }

  public start(): void {
    this.startedAt = performance.now();
    this.last = this.startedAt;

    this.timer = setInterval((): void => {
      const now: number = performance.now();
      const stall: number = now - this.last - STALL_TIMER_MS;

      if (stall > this.longestStallMs) {
        this.longestStallMs = stall;
      }

      if (stall >= STALL_REPORT_MS) {
        this.stalls.push({
          atMs: Math.round(now - this.startedAt),
          durationMs: Math.round(stall),
          phase: this.phasesDuring(this.last, now),
        });
      }

      const memory: NodeJS.MemoryUsage = process.memoryUsage();
      this.heapPeak = Math.max(this.heapPeak, memory.heapUsed);
      this.rssPeak = Math.max(this.rssPeak, memory.rss);
      this.last = now;
    }, STALL_TIMER_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}

/*
 * Marks where the evaluation is, at the entry and the end of the steps a
 * stall is charged to, so a stall says which step held the loop.
 */
function markPhases(input: {
  tracker: StallTracker;
  restorers: Array<() => void>;
}): void {
  const wrap: (
    target: unknown,
    method: string,
    nameOf: (args: Array<unknown>) => string,
  ) => void = (
    target: unknown,
    method: string,
    nameOf: (args: Array<unknown>) => string,
  ): void => {
    const holder: Record<string, unknown> = target as unknown as Record<
      string,
      unknown
    >;
    const original: (...args: Array<unknown>) => unknown = holder[method] as (
      ...args: Array<unknown>
    ) => unknown;

    patch(
      target,
      method,
      function (this: unknown, ...args: Array<unknown>): unknown {
        const name: string = nameOf(args);
        input.tracker.mark(name);
        const result: unknown = original.apply(this, args);

        if (result && typeof (result as Promise<unknown>).then === "function") {
          return (result as Promise<unknown>).then(
            (value: unknown): unknown => {
              input.tracker.mark(`after ${name}`);
              return value;
            },
            (error: unknown): never => {
              input.tracker.mark(`after ${name}`);
              throw error;
            },
          );
        }

        input.tracker.mark(`after ${name}`);
        return result;
      },
      input.restorers,
    );
  };

  const queryName: (args: Array<unknown>) => string = (
    args: Array<unknown>,
  ): string => {
    const first: { query?: { name?: unknown }; aggregationType?: unknown } =
      (args[0] as { query?: { name?: unknown }; aggregationType?: unknown }) ||
      {};
    return `${String(first.query?.name)} ${String(first.aggregationType || "")}`.trim();
  };

  wrap(MetricService, "aggregateBy", (args: Array<unknown>): string => {
    return `read ${queryName(args)}`;
  });
  wrap(MetricService, "readSeriesArrivals", (args: Array<unknown>): string => {
    return `arrival read ${queryName(args)}`;
  });
  wrap(MonitorResourceUtil, "monitorResource", (): string => {
    return "monitorResource";
  });
  wrap(MonitorCriteriaEvaluator, "processMonitorStep", (): string => {
    return "criteria";
  });
  wrap(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline", (): string => {
    return "status timeline";
  });
  wrap(MonitorAlert, "checkOpenAlertsAndCloseIfResolved", (): string => {
    return "alert resolve pass";
  });
  wrap(
    MonitorAlert,
    "criteriaMetCreateAlertsAndUpdateMonitorStatus",
    (): string => {
      return "alert create pass";
    },
  );
  wrap(MonitorLogUtil, "saveMonitorLog", (): string => {
    return "monitor log";
  });
}

function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function toOutcome(input: {
  stubs: InstalledStubs;
  response: ProbeApiIngestResponse | null;
}): EvaluationOutcome {
  const logRow: JSONObject | undefined = input.stubs.monitorLogRows[0];
  const logBody: JSONObject | undefined = logRow?.["logBody"] as
    | JSONObject
    | undefined;
  const summary: JSONObject | undefined = logBody?.["evaluationSummary"] as
    | JSONObject
    | undefined;
  const response: ProbeApiIngestResponse | null = input.response;

  return {
    criteriaMetId: textOf(response?.criteriaMetId),
    rootCause: textOf(response?.rootCause),
    evaluatedCriteriaIds: (response?.evaluatedCriteriaIds || []).map(String),
    matchedCriteria: (response?.matchedCriteria || []).map(
      (matched: MatchedCriteriaResult): MatchedCriteriaRecord => {
        return {
          criteriaId: matched.criteriaId,
          rootCause: matched.rootCause,
          series: matched.perSeriesMatches.map(
            (
              match: PerSeriesCriteriaMatch,
            ): MatchedCriteriaRecord["series"][number] => {
              return {
                fingerprint: match.fingerprint,
                labels: (match.labels as JSONValue) || null,
                rootCause: textOf(match.rootCause),
                metricContextHash: hashOf(
                  match.metricContexts || match.metricContext,
                ),
              };
            },
          ),
        };
      },
    ),
    createdAlerts: input.stubs.createdAlerts.map(
      (alert: Alert): CreatedAlertRecord => {
        return {
          createdCriteriaId: textOf(alert.createdCriteriaId),
          seriesFingerprint: textOf(alert.seriesFingerprint),
          seriesLabels: (alert.seriesLabels as JSONValue) || null,
          title: textOf(alert.title),
          description: textOf(alert.description),
          rootCause: textOf(alert.rootCause),
          alertSeverityId: idOf(alert.alertSeverityId),
          currentAlertStateId: idOf(alert.currentAlertStateId),
          remediationNotes: textOf(alert.remediationNotes),
          createdStateLogHash: hashOf(alert.createdStateLog),
          monitorSummaryHash: hashOf(alert.monitorSummary),
          evaluationDetailsHash: hashOf(alert.evaluationDetails),
          telemetryQueryHash: hashOf(alert.telemetryQuery),
        };
      },
    ),
    resolvedAlerts: input.stubs.resolvedTimelines.map(
      (timeline: AlertStateTimeline): ResolvedAlertRecord => {
        return {
          alertId: String(timeline.alertId?.toString()),
          alertStateId: idOf(timeline.alertStateId),
          rootCause: textOf(timeline.rootCause),
          stateChangeLogHash: hashOf(timeline.stateChangeLog),
        };
      },
    ),
    statusChanges: input.stubs.statusTimelines.map(
      (timeline: MonitorStatusTimeline): StatusChangeRecord => {
        return {
          monitorStatusId: idOf(timeline.monitorStatusId),
          rootCause: textOf(timeline.rootCause),
          statusChangeLogHash: hashOf(timeline.statusChangeLog),
        };
      },
    ),
    criteriaResults: JSON.parse(
      JSON.stringify(summary?.["criteriaResults"] || null),
    ) as JSONValue,
    events: (
      (JSON.parse(
        JSON.stringify(summary?.["events"] || []),
      ) as Array<JSONObject>) || []
    ).map(stableEvent),
  };
}

function monitorLogBytesOf(stubs: InstalledStubs): number {
  const logBody: unknown = stubs.monitorLogRows[0]?.["logBody"];
  return logBody ? Buffer.byteLength(JSON.stringify(logBody)) : 0;
}

async function settle(tracker: StallTracker): Promise<void> {
  // Until the work an evaluation leaves behind (its monitor log) is done.
  for (let round: number = 0; round < 50; round++) {
    const before: number = tracker.stalls.length;
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });

    if (tracker.stalls.length === before && round > 2) {
      return;
    }
  }
}

/*
 * One evaluation of the fleet, on the real path, measured. The monitor's
 * open alerts are the fleet's as it starts; the stubs are taken away when
 * it ends, whatever happened.
 */
export async function runFleetEvaluation(
  options: RunEvaluationOptions,
): Promise<EvaluationRun> {
  const fleet: GroupedMetricFleet = options.fleet;
  const stubs: InstalledStubs = installFleetStubs(fleet);
  const tracker: StallTracker = new StallTracker();
  const phaseRestorers: Array<() => void> = [];
  markPhases({ tracker: tracker, restorers: phaseRestorers });

  // What monitorResource decided, as it hands it back.
  let response: ProbeApiIngestResponse | null = null;
  const monitorResource: (
    ...args: Array<unknown>
  ) => Promise<ProbeApiIngestResponse> = (
    MonitorResourceUtil as unknown as Record<
      string,
      (...args: Array<unknown>) => Promise<ProbeApiIngestResponse>
    >
  )["monitorResource"]!;
  patch(
    MonitorResourceUtil,
    "monitorResource",
    async (...args: Array<unknown>): Promise<ProbeApiIngestResponse> => {
      response = await monitorResource(...args);
      return response;
    },
    phaseRestorers,
  );
  const histogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 1 });
  const unhandledRejections: Array<string> = [];
  const gcDurations: Array<number> = [];
  const phases: Array<PhaseRecord> = [];
  let lockLost: boolean = false;

  const onUnhandled: (reason: unknown) => void = (reason: unknown): void => {
    const text: string =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String(reason);
    unhandledRejections.push(text);

    if (text.includes("LostLockError") || text.includes("Lost mutex")) {
      lockLost = true;
    }
  };

  process.on("unhandledRejection", onUnhandled);

  const gcObserver: PerformanceObserver = new PerformanceObserver(
    (list: PerformanceObserverEntryList): void => {
      for (const entry of list.getEntries() as Array<PerformanceEntry>) {
        gcDurations.push(entry.duration);
      }
    },
  );
  gcObserver.observe({ entryTypes: ["gc"] });

  // When the lock is held, a test may take it away.
  const lockKey: string = `${LOCK_NAMESPACE}-${FLEET_MONITOR_ID.toString()}`;
  let lockWatch: NodeJS.Timeout | null = null;

  if (options.onLockAcquired) {
    const callback: (lockKey: string, store: FakeValkey) => void =
      options.onLockAcquired;
    let called: boolean = false;
    lockWatch = setInterval((): void => {
      if (!called && stubs.store.hasKey(lockKey)) {
        called = true;
        callback(lockKey, stubs.store);
      }
    }, 1);
  }

  // What is left of the run before, collected when the process lets us.
  const collect: (() => void) | undefined = (
    global as unknown as { gc?: () => void }
  ).gc;

  if (collect) {
    collect();
  }

  /*
   * Both timers tick a few times first: a delay is measured between two
   * ticks, so work that started before the first would go unseen.
   */
  tracker.start();
  histogram.enable();
  await sleep(25);

  const heapBefore: number = process.memoryUsage().heapUsed;
  const cpuBefore: NodeJS.CpuUsage = process.cpuUsage();
  const eluBefore: ReturnType<typeof performance.eventLoopUtilization> =
    performance.eventLoopUtilization();
  let error: string | null = null;
  const startedAt: number = performance.now();

  try {
    tracker.mark("evaluation");
    phases.push({ name: "evaluation", startMs: 0, endMs: 0 });

    await processTelemetryMonitorEvaluationFromQueue({
      monitorId: FLEET_MONITOR_ID.toString(),
      projectId: FLEET_PROJECT_ID.toString(),
      queuedAt: new Date(fleet.windowEndMs),
    } as unknown as Parameters<
      typeof processTelemetryMonitorEvaluationFromQueue
    >[0]);

    phases[phases.length - 1]!.endMs = Math.round(
      performance.now() - startedAt,
    );
  } catch (caught) {
    error =
      caught instanceof Error
        ? `${caught.name}: ${caught.message}`
        : String(caught);
    phases[phases.length - 1]!.endMs = Math.round(
      performance.now() - startedAt,
    );
  }

  // The monitor log the check left, written as its buffer writes it.
  tracker.mark("after evaluation");
  const logStartedAt: number = performance.now();
  await settle(tracker);
  tracker.mark("monitor log flush");
  (MonitorLogUtil as unknown as { triggerFlush: () => void }).triggerFlush();
  await settle(tracker);
  phases.push({
    name: "monitor-log",
    startMs: Math.round(logStartedAt - startedAt),
    endMs: Math.round(performance.now() - startedAt),
  });

  const totalMs: number = performance.now() - startedAt;
  histogram.disable();
  tracker.stop();
  gcObserver.disconnect();

  if (lockWatch) {
    clearInterval(lockWatch);
  }

  const cpu: NodeJS.CpuUsage = process.cpuUsage(cpuBefore);
  const elu: ReturnType<typeof performance.eventLoopUtilization> =
    performance.eventLoopUtilization(eluBefore);

  // Give a late refresh timer the chance to say the lock was lost.
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 20);
  });

  process.removeListener("unhandledRejection", onUnhandled);

  const outcome: EvaluationOutcome = toOutcome({
    stubs: stubs,
    response: response,
  });

  const postgresCalls: Record<string, number> = {};
  let postgresCallCount: number = 0;

  for (const [key, count] of Array.from(stubs.postgresCalls.entries()).sort()) {
    postgresCalls[key] = count;
    postgresCallCount += count;
  }

  const measurement: EvaluationMeasurement = {
    totalMs: Math.round(totalMs),
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    longestBlockMs: Math.round(histogram.max / 1e6),
    eventLoopDelayP99Ms: Math.round(histogram.percentile(99) / 1e6),
    eventLoopDelayMeanMs: Math.round((histogram.mean / 1e6) * 10) / 10,
    eventLoopUtilization: Math.round(elu.utilization * 1000) / 1000,
    longestStallMs: Math.round(tracker.longestStallMs),
    stallsOver100Ms: tracker.stalls.filter((stall: StallRecord): boolean => {
      return stall.durationMs > 100;
    }).length,
    stalls: tracker.stalls,
    phases: phases,
    heapUsedBeforeMb: megabytes(heapBefore),
    heapUsedPeakMb: megabytes(tracker.heapPeak),
    heapUsedAfterMb: megabytes(process.memoryUsage().heapUsed),
    rssPeakMb: megabytes(tracker.rssPeak),
    gcCount: gcDurations.length,
    gcTotalMs: Math.round(
      gcDurations.reduce((sum: number, duration: number): number => {
        return sum + duration;
      }, 0),
    ),
    gcLongestMs: Math.round(Math.max(0, ...gcDurations)),
    postgresCalls: postgresCalls,
    postgresCallCount: postgresCallCount,
    clickhouseReads: stubs.clickhouse.reads,
    clickhouseReadBytes: stubs.clickhouse.readBytes,
    clickhouseInserts: stubs.clickhouse.inserts,
    clickhouseInsertBytes: stubs.clickhouse.insertBytes,
    lockRefreshes: stubs.store.refreshes,
    lockLost: lockLost,
    unhandledRejections: unhandledRejections,
    monitorLogBytes: monitorLogBytesOf(stubs),
  };

  for (const restore of phaseRestorers.reverse()) {
    restore();
  }

  stubs.restore();

  if (stubs.clickhouse.unexpectedReads.length > 0) {
    error =
      (error ? `${error}; ` : "") +
      `unexpected ClickHouse reads: ${stubs.clickhouse.unexpectedReads.join(" | ")}`;
  }

  return { measurement: measurement, outcome: outcome, error: error };
}

// The open alerts a fleet starts with, for a test to name them.
export function describeOpenAlerts(fleet: GroupedMetricFleet): Array<string> {
  return fleet.openAlerts.map((entry: OpenFleetAlert): string => {
    return `${entry.alert._id?.toString()} ${entry.alert.createdCriteriaId} ${entry.reason}`;
  });
}
