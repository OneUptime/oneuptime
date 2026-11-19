import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import GracefulShutdown, {
  ShutdownPriority,
} from "Common/Server/Utils/GracefulShutdown";
import logger from "Common/Server/Utils/Logger";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricService from "Common/Server/Services/MetricService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SessionReplayCustomSignalCount } from "Common/Types/Rum/SessionReplayFrustrationSignals";
import {
  SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS,
  SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION,
  getSessionReplaySignalId,
} from "Common/Types/Rum/SessionReplaySignalMetric";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";

/*
 * How many recorded sessions hit each of a RUM application's own signals,
 * minute by minute (issue #6518): the series the application's "Sessions
 * hit <signal>" alerts read (SESSION_REPLAY_SIGNAL_SESSIONS_METRIC).
 *
 * A session counts once for a signal. Each chunk a recorder uploads names
 * the signals that fired while it was open; the first chunk of a session to
 * name one counts it, in the minute that chunk arrived. Which signals a
 * session has already counted is a Redis set per session, so a chunk sent
 * again, a second tab of the same session, or a second worker never counts
 * one twice. With Redis unreachable nothing is counted: a series that
 * counts a session again for every chunk would open alerts nobody can
 * trust, and a gap in it only resolves them.
 *
 * Counts are held in memory per minute, per worker, and written once the
 * minute and a few seconds of grace are over, as Delta Sum points under the
 * RUM application - one point per signal per minute per worker, summed by
 * any monitor or chart that reads the series - the way
 * ProductAnalyticsDerivedMetrics writes the event counts. A crash loses at
 * most the minute in hand; a graceful shutdown writes everything first.
 */

export interface SessionReplaySignalBucket {
  projectId: string;
  rumApplicationId: string;
  // The signal's id on the Frustration Signals page, or "" when unknown.
  signalId: string;
  signalName: string;
  minuteStartMs: number;
  count: number;
}

/* How long a session's set of counted signals is kept after its last chunk. */
export const SESSION_REPLAY_SIGNAL_SET_TTL_SECONDS: number = 24 * 60 * 60;

export const SESSION_REPLAY_SIGNAL_SET_KEY_PREFIX: string = "replay:signals:";

/* How long after its minute ends a bucket waits for late chunks. */
export const SESSION_REPLAY_SIGNAL_GRACE_MS: number = 5000;

/* How often the buckets are looked at. */
const FLUSH_INTERVAL_MS: number = 15000;

/*
 * Buckets held at once before they are written early. An application has
 * at most twenty signals, so this is many applications' worth.
 */
export const SESSION_REPLAY_SIGNAL_MAX_BUCKETS: number = 20000;

/* The most names one chunk can carry (SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK). */
const MAX_NAMES_PER_CHUNK: number = 50;

export default class SessionReplaySignalMetrics {
  private static buckets: Map<string, SessionReplaySignalBucket> = new Map<
    string,
    SessionReplaySignalBucket
  >();

  private static timer: ReturnType<typeof setInterval> | null = null;
  private static shutdownRegistered: boolean = false;
  private static flushing: Promise<void> | null = null;

  /* Projects this process has put the series in the metric catalog of. */
  private static registered: Set<string> = new Set<string>();

  public static sessionSetKey(projectId: string, sessionId: string): string {
    return `${SESSION_REPLAY_SIGNAL_SET_KEY_PREFIX}${projectId}:${sessionId}`;
  }

  /*
   * The names a chunk's envelope counts (its signals.customSignals), each
   * once ignoring case, as the session row merges them.
   */
  public static namesOf(
    customSignals: ReadonlyArray<SessionReplayCustomSignalCount> | undefined,
  ): Array<string> {
    const names: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const signal of customSignals || []) {
      const name: string =
        typeof signal?.name === "string" ? signal.name.trim() : "";

      if (!name || seen.has(name.toLowerCase())) {
        continue;
      }

      seen.add(name.toLowerCase());
      names.push(name);

      if (names.length >= MAX_NAMES_PER_CHUNK) {
        break;
      }
    }

    return names;
  }

  /*
   * Counts the signals this chunk names that its session had not counted
   * yet. Never throws: the recording is already stored, and a count that
   * could not be made is a count missing from a chart, not a lost chunk.
   */
  public static async countChunk(data: {
    projectId: string;
    rumApplicationId: string;
    sessionId: string;
    customSignals: ReadonlyArray<SessionReplayCustomSignalCount> | undefined;
    customSignalIds: Readonly<Record<string, string>> | undefined;
    receivedAtUnixMs: number;
  }): Promise<void> {
    const names: Array<string> = this.namesOf(data.customSignals);

    if (names.length === 0) {
      return;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    let firstTimes: Array<string> = [];

    try {
      const key: string = this.sessionSetKey(data.projectId, data.sessionId);
      let transaction: ReturnType<ClientType["multi"]> = client.multi();

      for (const name of names) {
        transaction = transaction.sadd(key, name.toLowerCase());
      }

      transaction = transaction.expire(
        key,
        SESSION_REPLAY_SIGNAL_SET_TTL_SECONDS,
      );

      const results: Array<[Error | null, unknown]> | null =
        await transaction.exec();

      firstTimes = names.filter((_name: string, index: number): boolean => {
        const result: [Error | null, unknown] | undefined = results?.[index];

        return Boolean(result) && !result?.[0] && Number(result?.[1]) === 1;
      });
    } catch (err) {
      logger.warn(
        `SessionReplaySignalMetrics: could not read which signals session ${data.sessionId} has counted`,
      );
      logger.warn(err);
      return;
    }

    this.count({
      projectId: data.projectId,
      rumApplicationId: data.rumApplicationId,
      names: firstTimes,
      customSignalIds: data.customSignalIds,
      atUnixMs: data.receivedAtUnixMs,
    });
  }

  /* One session more for each name, in the minute of atUnixMs. */
  public static count(data: {
    projectId: string;
    rumApplicationId: string;
    names: ReadonlyArray<string>;
    customSignalIds: Readonly<Record<string, string>> | undefined;
    atUnixMs: number;
  }): void {
    if (data.names.length === 0) {
      return;
    }

    const minuteStartMs: number =
      Math.floor(data.atUnixMs / SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS) *
      SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS;

    for (const name of data.names) {
      const signalId: string = getSessionReplaySignalId(
        data.customSignalIds,
        name,
      );
      const key: string = JSON.stringify([
        data.projectId,
        data.rumApplicationId,
        minuteStartMs,
        signalId,
        name,
      ]);
      const existing: SessionReplaySignalBucket | undefined =
        this.buckets.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        this.buckets.set(key, {
          projectId: data.projectId,
          rumApplicationId: data.rumApplicationId,
          signalId: signalId,
          signalName: name,
          minuteStartMs: minuteStartMs,
          count: 1,
        });
      }
    }

    this.ensureTimer();

    if (this.buckets.size >= SESSION_REPLAY_SIGNAL_MAX_BUCKETS) {
      void this.flush({ everything: true });
    }
  }

  /* The buckets whose minute (and grace) is over - or every bucket - out of memory. */
  public static takeDue(data: {
    nowMs: number;
    everything: boolean;
  }): Array<SessionReplaySignalBucket> {
    const due: Array<SessionReplaySignalBucket> = [];

    for (const [key, bucket] of this.buckets) {
      const endsAt: number =
        bucket.minuteStartMs +
        SESSION_REPLAY_SIGNAL_METRIC_INTERVAL_MS +
        SESSION_REPLAY_SIGNAL_GRACE_MS;

      if (data.everything || endsAt <= data.nowMs) {
        due.push(bucket);
        this.buckets.delete(key);
      }
    }

    return due;
  }

  /*
   * One Delta Sum point per bucket, at its minute. The id is left out when
   * it is not known, so a filter on it never matches a point it does not
   * belong to.
   */
  public static buildRows(data: {
    buckets: Array<SessionReplaySignalBucket>;
    retentionInDaysByApplication: Map<string, number>;
    writtenAt: Date;
  }): Array<JSONObject> {
    return data.buckets.map((bucket: SessionReplaySignalBucket): JSONObject => {
      const start: Date = new Date(bucket.minuteStartMs);
      const timestamp: string = OneUptimeDate.toClickhouseDateTime(start);
      const attributes: JSONObject = {
        [SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE]: bucket.signalName,
      };

      if (bucket.signalId) {
        attributes[SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE] = bucket.signalId;
      }

      const retentionInDays: number =
        data.retentionInDaysByApplication.get(bucket.rumApplicationId) || 30;

      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(data.writtenAt),
        projectId: bucket.projectId,
        primaryEntityId: bucket.rumApplicationId,
        primaryEntityType: ServiceType.RealUserMonitor,
        name: SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
        aggregationTemporality: AggregationTemporality.Delta,
        metricPointType: MetricPointType.Sum,
        time: timestamp,
        startTime: timestamp,
        timeUnixNano: OneUptimeDate.toUnixNano(start).toString(),
        startTimeUnixNano: OneUptimeDate.toUnixNano(start).toString(),
        attributes: attributes,
        attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
        isMonotonic: true,
        count: null,
        sum: null,
        min: null,
        max: null,
        bucketCounts: [],
        explicitBounds: [],
        value: bucket.count,
        retentionDate: OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDurationInDays(start, retentionInDays),
        ),
      } as JSONObject;
    });
  }

  public static async flush(data: { everything: boolean }): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }

    const due: Array<SessionReplaySignalBucket> = this.takeDue({
      nowMs: Date.now(),
      everything: data.everything,
    });

    if (due.length === 0) {
      return;
    }

    this.flushing = this.write(due).finally((): void => {
      this.flushing = null;
    });

    await this.flushing;
  }

  private static async write(
    buckets: Array<SessionReplaySignalBucket>,
  ): Promise<void> {
    try {
      const retentionInDaysByApplication: Map<string, number> = new Map<
        string,
        number
      >();

      for (const bucket of buckets) {
        if (retentionInDaysByApplication.has(bucket.rumApplicationId)) {
          continue;
        }

        const metadata: TelemetryServiceMetadata =
          await OTelIngestService.buildResourceMetadataForNonService({
            serviceName: "RUM Application",
            resourceId: new ObjectID(bucket.rumApplicationId),
            primaryEntityType: ServiceType.RealUserMonitor,
            projectId: new ObjectID(bucket.projectId),
          });

        retentionInDaysByApplication.set(
          bucket.rumApplicationId,
          resolveTelemetryRetentionInDays({
            pillar: "metrics",
            serviceConfig: metadata.serviceRetentionConfig,
            serviceRetentionInDays: metadata.serviceRetentionInDays,
            projectConfig: metadata.projectRetentionConfig,
            projectRetentionInDays: metadata.projectRetentionInDays,
          }),
        );
      }

      await MetricService.insertJsonRows(
        this.buildRows({
          buckets: buckets,
          retentionInDaysByApplication: retentionInDaysByApplication,
          writtenAt: new Date(),
        }),
      );

      await this.register(buckets);
    } catch (err) {
      logger.error(
        `SessionReplaySignalMetrics: could not write ${buckets.length} per-minute signal session counts.`,
      );
      logger.error(err);
    }
  }

  /* Put the series in each project's metric catalog, once a process. */
  private static async register(
    buckets: Array<SessionReplaySignalBucket>,
  ): Promise<void> {
    const projectIds: Set<string> = new Set<string>(
      buckets.map((bucket: SessionReplaySignalBucket): string => {
        return bucket.projectId;
      }),
    );

    for (const projectId of projectIds) {
      if (this.registered.has(projectId)) {
        continue;
      }

      const metricType: MetricType = new MetricType();
      metricType.name = SESSION_REPLAY_SIGNAL_SESSIONS_METRIC;
      metricType.description =
        SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION;
      metricType.unit = "";

      const map: Dictionary<MetricType> = {
        [SESSION_REPLAY_SIGNAL_SESSIONS_METRIC]: metricType,
      };

      try {
        await TelemetryUtil.indexMetricNameServiceNameMap({
          projectId: new ObjectID(projectId),
          metricNameServiceNameMap: map,
        });

        this.registered.add(projectId);
      } catch (err) {
        logger.error(
          `SessionReplaySignalMetrics: could not register the signal session count metric for project ${projectId}.`,
        );
        logger.error(err);
      }
    }
  }

  private static ensureTimer(): void {
    if (!this.timer) {
      this.timer = setInterval((): void => {
        void this.flush({ everything: false });
      }, FLUSH_INTERVAL_MS);

      /* Never the reason a process stays up. */
      if (typeof this.timer.unref === "function") {
        this.timer.unref();
      }
    }

    if (!this.shutdownRegistered) {
      this.shutdownRegistered = true;

      GracefulShutdown.registerHandler(
        "SessionReplaySignalMetrics",
        ShutdownPriority.Workers,
        async (): Promise<void> => {
          await this.flush({ everything: true });
        },
      );
    }
  }

  /* Tests: forget every bucket, timer and registration. */
  public static resetForTests(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.buckets.clear();
    this.registered.clear();
    this.flushing = null;
  }

  public static getBucketCountForTests(): number {
    return this.buckets.size;
  }
}
