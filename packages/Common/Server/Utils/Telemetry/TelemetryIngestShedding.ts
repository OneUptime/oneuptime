import Redis, { ClientType } from "../../Infrastructure/Redis";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import logger from "../Logger";
import { parseRedisInfo } from "../InstanceHealth/RedisHealth";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import {
  getTelemetryIngestionBudgetSignalSlug,
  getTelemetryIngestionBudgetSignalWords,
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionQueueRefusalKind,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * SHEDDING ONE PROJECT'S FLOOD, NOT EVERYONE'S TELEMETRY (2026-11-27).
 *
 * Everything sent to OneUptime waits on the one Telemetry queue in Valkey
 * until a worker stores it: the job in BullMQ, its body beside it
 * (TelemetryBodyStore). On 2026-11-27 one project's metrics flood was about
 * 93% of that queue. The queue grew to 700,000 jobs and Valkey to 35 GB,
 * Valkey's one thread saturated, the probes' API timed out on its cache
 * reads, and a restart of Valkey lost every job in it: every other
 * project's telemetry and the probes' check results too. The only lever was
 * DISABLE_TELEMETRY_INGESTION, which drops everyone's data.
 *
 * So the ingest refuses, with an answer the sender retries, telemetry that
 * the queue cannot take without harm:
 *
 *   - One project and signal far ahead of the workers. Once about
 *     `projectQueueLimit` (10,000) of a project's batches of one signal wait
 *     in the queue, its next batches of that signal are refused - 429 with a
 *     Retry-After over HTTP, RESOURCE_EXHAUSTED with a RetryInfo over gRPC -
 *     and its exporters send them again later, while every other project,
 *     and the project's other signals, carry on. A healthy queue holds
 *     almost nothing of any project, so only a flood, or ingest stopped for
 *     long, gets there; the project is taken again once it is back under
 *     four fifths of the limit.
 *   - Everyone, as a last resort. Once Valkey uses more than
 *     `valkeyMemoryLimitPercent` (85%) of its maxmemory, every project's
 *     bulk telemetry is refused the same way, so the rest of Valkey is kept
 *     for what must not stop: the probes' check results, incoming requests,
 *     the Worker and Workflow queues, the caches. Monitoring work is never
 *     refused here, and without a maxmemory there is no share to measure.
 *
 * How it knows. Bulk telemetry waits in the queue's prioritized set
 * (TELEMETRY_BULK_JOB_PRIORITY in TelemetryQueueService), and every job id
 * there starts with its type and its project: "metrics-<projectId>-...". A
 * process that takes telemetry counts that set (ZCARD) every
 * REFRESH_INTERVAL_MS, and, when it holds more than one project may, reads
 * a random sample of its ids (ZRANDMEMBER): a project's share of the
 * sample, times the size of the set, is about how many of its batches wait.
 * With INFO memory, that is at most three commands per process every ten
 * seconds, never one per request: a request is decided in memory, from the
 * last read. Nothing is counted on enqueue and taken back on completion, so
 * nothing can drift: a job that was lost, purged or is being retried is
 * simply not in the next sample.
 *
 * It fails open. While Valkey cannot be read, nothing is refused here - a
 * Valkey that is down refuses the enqueue on its own - and a read older
 * than STALE_AFTER_MS is not used.
 */

export interface TelemetryIngestSheddingSettings {
  // A project's batches of one signal waiting, at which it is refused. 0: never.
  projectQueueLimit: number;
  // Valkey's memory use, in percent of maxmemory, at which all bulk telemetry is refused. 0: never.
  valkeyMemoryLimitPercent: number;
  // Job ids read per sample.
  sampleSize: number;
  // How often a process reads the queue again.
  refreshIntervalMs: number;
  // What a refused sender is told to wait.
  retryAfterSeconds: number;
}

export const DEFAULT_PROJECT_QUEUE_LIMIT: number = 10_000;
export const DEFAULT_VALKEY_MEMORY_LIMIT_PERCENT: number = 85;

const DEFAULT_SAMPLE_SIZE: number = 1000;
const DEFAULT_REFRESH_INTERVAL_MS: number = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS: number = 30;

/*
 * A project refused once stays refused until it is back under this share of
 * the limit, so a sample's noise around the limit does not take it and
 * refuse it by turns.
 */
export const RELEASE_SHARE_OF_LIMIT: number = 0.8;

/*
 * A project is refused only on this many of its ids in the sample. With a
 * very deep queue one id stands for many batches, and a single chance hit
 * would otherwise refuse a project that has few.
 */
export const MIN_SAMPLE_HITS: number = 5;

// A read this old is not used: nothing is refused on it.
export const STALE_AFTER_MS: number = 60_000;

const readWholeNumber: (
  envKey: string,
  defaultValue: number,
  max?: number,
) => number = (envKey: string, defaultValue: number, max?: number): number => {
  const raw: string | undefined = process.env[envKey];

  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const parsed: number = Number(raw.trim());

  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    (max !== undefined && parsed > max)
  ) {
    logger.warn(
      `TelemetryIngestShedding: ${envKey}=${raw} is not a whole number${
        max !== undefined ? ` from 0 to ${max}` : ""
      }; using ${defaultValue}.`,
    );
    return defaultValue;
  }

  return parsed;
};

export function readTelemetryIngestSheddingSettingsFromEnv(): TelemetryIngestSheddingSettings {
  return {
    projectQueueLimit: readWholeNumber(
      "TELEMETRY_INGEST_PROJECT_QUEUE_LIMIT",
      DEFAULT_PROJECT_QUEUE_LIMIT,
    ),
    valkeyMemoryLimitPercent: readWholeNumber(
      "TELEMETRY_INGEST_VALKEY_MEMORY_LIMIT_PERCENT",
      DEFAULT_VALKEY_MEMORY_LIMIT_PERCENT,
      100,
    ),
    sampleSize: DEFAULT_SAMPLE_SIZE,
    refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
    retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
  };
}

/*
 * The signal of each type of job that has one, by the type the job id
 * starts with (TelemetryQueueService's TelemetryType values; the App's
 * TelemetryIngestShedding parity test holds the two together). Session
 * replay, product analytics and Kubernetes cost wait in the same set and
 * count towards its size, but have budgets and limits of their own.
 */
const SIGNAL_BY_JOB_TYPE: Dictionary<TelemetryIngestionBudgetSignal> = {
  logs: ProductType.Logs,
  syslog: ProductType.Logs,
  fluentlogs: ProductType.Logs,
  traces: ProductType.Traces,
  metrics: ProductType.Metrics,
  profiles: ProductType.Profiles,
  "security-events": ProductType.SecurityEvents,
};

export function getTelemetryIngestSheddingSignalForJobType(
  jobType: string,
): TelemetryIngestionBudgetSignal | null {
  return Object.prototype.hasOwnProperty.call(SIGNAL_BY_JOB_TYPE, jobType)
    ? SIGNAL_BY_JOB_TYPE[jobType]!
    : null;
}

// "<type>-<projectId>-<the rest>", the type in lower case with dashes.
const QUEUED_JOB_ID_PATTERN: RegExp =
  /^([a-z]+(?:-[a-z]+)*?)-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-/;

export interface QueuedTelemetryJob {
  projectId: string;
  signal: TelemetryIngestionBudgetSignal;
}

// The project and signal of a queued job, or null for a job without both.
export function parseQueuedTelemetryJobId(
  jobId: string,
): QueuedTelemetryJob | null {
  const match: RegExpExecArray | null = QUEUED_JOB_ID_PATTERN.exec(jobId);

  if (!match) {
    return null;
  }

  const signal: TelemetryIngestionBudgetSignal | null =
    getTelemetryIngestSheddingSignalForJobType(match[1]!);

  if (!signal) {
    return null;
  }

  return { projectId: match[2]!.toLowerCase(), signal: signal };
}

export const getTelemetryIngestSheddingKey: (
  projectId: string,
  signal: TelemetryIngestionBudgetSignal,
) => string = (
  projectId: string,
  signal: TelemetryIngestionBudgetSignal,
): string => {
  return `${projectId.toLowerCase()}:${getTelemetryIngestionBudgetSignalSlug(signal)}`;
};

export interface QueuedBatchesEstimate extends QueuedTelemetryJob {
  sampleHits: number;
  estimatedQueuedBatches: number;
}

/*
 * About how many batches of each project and signal wait, from a random
 * sample of the set's ids and the set's size. A sample as large as the set
 * (ZRANDMEMBER returns the whole set then) counts exactly.
 */
export function estimateQueuedBatches(data: {
  sampledJobIds: Array<string>;
  queuedBatches: number;
}): Array<QueuedBatchesEstimate> {
  const sampleSize: number = data.sampledJobIds.length;

  if (sampleSize === 0 || data.queuedBatches <= 0) {
    return [];
  }

  const hits: Map<string, { job: QueuedTelemetryJob; hits: number }> =
    new Map();

  for (const jobId of data.sampledJobIds) {
    const job: QueuedTelemetryJob | null = parseQueuedTelemetryJobId(jobId);

    if (!job) {
      continue;
    }

    const key: string = getTelemetryIngestSheddingKey(
      job.projectId,
      job.signal,
    );
    const entry: { job: QueuedTelemetryJob; hits: number } | undefined =
      hits.get(key);

    if (entry) {
      entry.hits++;
    } else {
      hits.set(key, { job: job, hits: 1 });
    }
  }

  const scale: number = Math.max(1, data.queuedBatches / sampleSize);

  return Array.from(hits.values()).map(
    (entry: {
      job: QueuedTelemetryJob;
      hits: number;
    }): QueuedBatchesEstimate => {
      return {
        projectId: entry.job.projectId,
        signal: entry.job.signal,
        sampleHits: entry.hits,
        estimatedQueuedBatches: Math.round(entry.hits * scale),
      };
    },
  );
}

/*
 * The projects and signals to refuse, keyed as getTelemetryIngestSheddingKey
 * keys them, each with its estimate: over the limit, or still over four
 * fifths of it when it was refused already - on at least MIN_SAMPLE_HITS
 * ids of the sample either way.
 */
export function decideRefusedProjects(data: {
  estimates: Array<QueuedBatchesEstimate>;
  limit: number;
  // Who the last read refused, by key; only whether a key is in it counts.
  refusedBefore: ReadonlyMap<string, unknown>;
}): Map<string, QueuedBatchesEstimate> {
  const refused: Map<string, QueuedBatchesEstimate> = new Map();

  if (data.limit <= 0) {
    return refused;
  }

  for (const estimate of data.estimates) {
    if (estimate.sampleHits < MIN_SAMPLE_HITS) {
      continue;
    }

    const key: string = getTelemetryIngestSheddingKey(
      estimate.projectId,
      estimate.signal,
    );
    const threshold: number = data.refusedBefore.has(key)
      ? data.limit * RELEASE_SHARE_OF_LIMIT
      : data.limit;

    if (estimate.estimatedQueuedBatches >= threshold) {
      refused.set(key, estimate);
    }
  }

  return refused;
}

// Whether Valkey uses at least `limitPercent` of its maxmemory.
export function isValkeyOverMemoryLimit(data: {
  info: Dictionary<string>;
  limitPercent: number;
}): boolean {
  const maxMemory: number = Number(data.info["maxmemory"]);
  const usedMemory: number = Number(data.info["used_memory"]);

  if (
    data.limitPercent <= 0 ||
    !Number.isFinite(maxMemory) ||
    maxMemory <= 0 ||
    !Number.isFinite(usedMemory)
  ) {
    return false;
  }

  return usedMemory >= (maxMemory * data.limitPercent) / 100;
}

/*
 * Thrown by the enqueue for a batch refused here: a TooManyRequests, so a
 * route that lets it through answers 429. The ingest routes that catch an
 * enqueue failure answer their retryable 503, which an exporter retries the
 * same way.
 */
export class TelemetryIngestShedError extends TooManyRequestsException {
  public readonly refusal: TelemetryIngestionBudgetRefusal;

  public constructor(refusal: TelemetryIngestionBudgetRefusal) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

interface SheddingState {
  refusedProjects: Map<string, QueuedBatchesEstimate>;
  isValkeyOverMemoryLimit: boolean;
  // When Valkey was last read, or null before the first read.
  readAtMs: number | null;
}

const formatCount: (count: number) => string = (count: number): string => {
  return Math.round(count).toLocaleString("en-US");
};

export default class TelemetryIngestShedding {
  private static settings: TelemetryIngestSheddingSettings =
    readTelemetryIngestSheddingSettingsFromEnv();

  private static state: SheddingState = {
    refusedProjects: new Map(),
    isValkeyOverMemoryLimit: false,
    readAtMs: null,
  };

  private static refreshing: Promise<void> | null = null;
  private static lastRefreshStartedAtMs: number = 0;

  /*
   * Why this project's batch of this signal is refused, or null to take
   * it. In memory: it reads Valkey again in the background when the last
   * read is due for it, and decides this request from the last read.
   */
  public static getRefusal(data: {
    projectId: ObjectID | string;
    signal: TelemetryIngestionBudgetSignal;
    nowMs?: number | undefined;
  }): TelemetryIngestionBudgetRefusal | null {
    const nowMs: number = data.nowMs ?? Date.now();

    this.refreshIfDue(nowMs);

    const state: SheddingState = this.state;

    if (state.readAtMs === null || nowMs - state.readAtMs > STALE_AFTER_MS) {
      return null;
    }

    const words: string = getTelemetryIngestionBudgetSignalWords(data.signal);
    const retryAfterSeconds: number = this.settings.retryAfterSeconds;

    if (state.isValkeyOverMemoryLimit) {
      return this.toRefusal({
        kind: TelemetryIngestionBudgetRefusalKind.QueueFull,
        signal: data.signal,
        nowMs: nowMs,
        message: `OneUptime's telemetry queue is nearly full, so it is not taking ${words} for now. Retry in ${retryAfterSeconds} seconds.`,
      });
    }

    const refused: QueuedBatchesEstimate | undefined =
      state.refusedProjects.get(
        getTelemetryIngestSheddingKey(data.projectId.toString(), data.signal),
      );

    if (!refused) {
      return null;
    }

    return this.toRefusal({
      kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
      signal: data.signal,
      nowMs: nowMs,
      message: `OneUptime has not yet stored the ${words} this project already sent: about ${formatCount(
        refused.estimatedQueuedBatches,
      )} batches are waiting, and a project may have ${formatCount(
        this.settings.projectQueueLimit,
      )} waiting. Retry in ${retryAfterSeconds} seconds.`,
    });
  }

  /*
   * Read Valkey and decide again: what getRefusal starts in the background.
   * Never throws; a failed read keeps the last one until it goes stale.
   */
  public static async refresh(nowMs?: number | undefined): Promise<void> {
    const readAtMs: number = nowMs ?? Date.now();
    const settings: TelemetryIngestSheddingSettings = this.settings;

    try {
      const client: ClientType | null = Redis.getClient();

      if (!client || !Redis.isConnected()) {
        return;
      }

      const prioritizedKey: string = Queue.getQueue(QueueName.Telemetry).toKey(
        "prioritized",
      );

      const [memoryInfo, queuedBatches]: [string, number] = await Promise.all([
        settings.valkeyMemoryLimitPercent > 0
          ? client.info("memory")
          : Promise.resolve(""),
        settings.projectQueueLimit > 0
          ? client.zcard(prioritizedKey)
          : Promise.resolve(0),
      ]);

      let estimates: Array<QueuedBatchesEstimate> = [];

      // No project can have more waiting than the whole set.
      if (
        settings.projectQueueLimit > 0 &&
        queuedBatches >= settings.projectQueueLimit * RELEASE_SHARE_OF_LIMIT
      ) {
        const sampledJobIds: Array<string> = await client.zrandmember(
          prioritizedKey,
          settings.sampleSize,
        );

        estimates = estimateQueuedBatches({
          sampledJobIds: sampledJobIds,
          queuedBatches: queuedBatches,
        });
      }

      const next: SheddingState = {
        refusedProjects: decideRefusedProjects({
          estimates: estimates,
          limit: settings.projectQueueLimit,
          refusedBefore: this.state.refusedProjects,
        }),
        isValkeyOverMemoryLimit: isValkeyOverMemoryLimit({
          info: parseRedisInfo(memoryInfo),
          limitPercent: settings.valkeyMemoryLimitPercent,
        }),
        readAtMs: readAtMs,
      };

      this.logChanges(this.state, next);
      this.state = next;
    } catch (err) {
      logger.warn(
        "TelemetryIngestShedding: could not read the telemetry queue; deciding on the last read until it is a minute old",
      );
      logger.warn(err);
    }
  }

  // For tests: the settings to decide with, and nothing read yet.
  public static reset(
    settings?: Partial<TelemetryIngestSheddingSettings> | undefined,
  ): void {
    this.settings = {
      ...readTelemetryIngestSheddingSettingsFromEnv(),
      ...(settings || {}),
    };
    this.state = {
      refusedProjects: new Map(),
      isValkeyOverMemoryLimit: false,
      readAtMs: null,
    };
    this.refreshing = null;
    this.lastRefreshStartedAtMs = 0;
  }

  // For tests: the refresh getRefusal started, if one is running.
  public static getRunningRefresh(): Promise<void> | null {
    return this.refreshing;
  }

  private static refreshIfDue(nowMs: number): void {
    const settings: TelemetryIngestSheddingSettings = this.settings;

    if (
      this.refreshing ||
      (settings.projectQueueLimit <= 0 &&
        settings.valkeyMemoryLimitPercent <= 0) ||
      nowMs - this.lastRefreshStartedAtMs < settings.refreshIntervalMs
    ) {
      return;
    }

    this.lastRefreshStartedAtMs = nowMs;
    this.refreshing = this.refresh(nowMs).finally((): void => {
      this.refreshing = null;
    });
  }

  private static toRefusal(data: {
    kind: TelemetryIngestionQueueRefusalKind;
    signal: TelemetryIngestionBudgetSignal;
    nowMs: number;
    message: string;
  }): TelemetryIngestionBudgetRefusal {
    const retryAfterSeconds: number = this.settings.retryAfterSeconds;

    return {
      kind: data.kind,
      scope: TelemetryIngestionBudgetScope.Project,
      signal: data.signal,
      message: data.message,
      retryAfterSeconds: retryAfterSeconds,
      resetsAt: new Date(data.nowMs + retryAfterSeconds * 1000),
    };
  }

  /*
   * One line when a project starts and stops being refused, and when the
   * queue starts and stops being too full for anyone: an operator needs to
   * know which project floods, and a line per refused request would be a
   * flood of its own. At error level, the line an operator is paged on
   * (Logger.warn is silent at LOG_LEVEL=ERROR); each process that takes
   * telemetry writes its own.
   */
  private static logChanges(
    previous: SheddingState,
    next: SheddingState,
  ): void {
    const settings: TelemetryIngestSheddingSettings = this.settings;

    for (const [key, estimate] of next.refusedProjects) {
      if (!previous.refusedProjects.has(key)) {
        logger.error(
          `TelemetryIngestShedding: refusing ${getTelemetryIngestionBudgetSignalWords(
            estimate.signal,
          )} of project ${estimate.projectId}: about ${formatCount(
            estimate.estimatedQueuedBatches,
          )} of its batches wait in the telemetry queue, over the limit of ${formatCount(
            settings.projectQueueLimit,
          )} (TELEMETRY_INGEST_PROJECT_QUEUE_LIMIT). Its senders are told to retry; every other project is taken as before.`,
        );
      }
    }

    for (const [key, estimate] of previous.refusedProjects) {
      if (!next.refusedProjects.has(key)) {
        logger.info(
          `TelemetryIngestShedding: taking ${getTelemetryIngestionBudgetSignalWords(
            estimate.signal,
          )} of project ${estimate.projectId} again: the workers caught up with it.`,
        );
      }
    }

    if (next.isValkeyOverMemoryLimit && !previous.isValkeyOverMemoryLimit) {
      logger.error(
        `TelemetryIngestShedding: Valkey uses more than ${settings.valkeyMemoryLimitPercent}% of its maxmemory (TELEMETRY_INGEST_VALKEY_MEMORY_LIMIT_PERCENT), so every project's logs, traces, metrics, profiles and security events are refused for now and their senders told to retry. Monitoring work, the Worker and Workflow queues and the caches keep the rest.`,
      );
    }

    if (!next.isValkeyOverMemoryLimit && previous.isValkeyOverMemoryLimit) {
      logger.info(
        "TelemetryIngestShedding: Valkey is back under its memory limit for telemetry; taking every project's telemetry again.",
      );
    }
  }
}
