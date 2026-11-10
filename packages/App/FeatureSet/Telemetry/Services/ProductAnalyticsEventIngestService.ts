import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
  SessionReplayPolicyResolution,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import SessionReplayIdentity from "Common/Server/Utils/SessionReplay/SessionReplayIdentity";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import MetricService from "Common/Server/Services/MetricService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import {
  PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE,
  ProductAnalyticsParsedBatch,
  ProductAnalyticsParsedEvent,
  ProductAnalyticsParsedMetric,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { ProductAnalyticsEventsJobData } from "./Queue/TelemetryQueueService";
import ProductAnalyticsDerivedMetrics from "../Utils/ProductAnalyticsDerivedMetrics";
import {
  SESSION_REPLAY_ENABLED_BY_DEFAULT,
  SESSION_REPLAY_INGEST_ENABLED,
} from "../Config";

/*
 * Product analytics events (issue #6444, part two): the gate a batch passes
 * at the route, and the worker that files what passed.
 *
 * The gate is Session Replay's policy plus one switch. A batch is accepted
 * only for an application whose project allows replay, whose replay is on,
 * and whose product analytics events are on; from an origin the
 * application allows; with consent when the application asks for it; and
 * within the project's per-minute allowance. A batch id seen in the last
 * day is answered as accepted and not filed again, so a recorder that
 * resends a batch whose answer it lost files it once.
 *
 * The worker writes the events to RumProductAnalyticsEventV1 and the
 * metric() points to the metric store under the RUM application, where
 * charts, dashboards and Metrics monitors read them, and counts the events
 * into the per-minute series ProductAnalyticsDerivedMetrics writes.
 */

export enum ProductAnalyticsGateOutcome {
  Accepted = "accepted",
  /* This batch id was filed already. Answered 202; nothing is filed again. */
  Duplicate = "duplicate",
  /* Off for this application: the recorder stops sending. */
  Stop = "stop",
  /* Consent not given yet: this batch is not filed; later ones may be. */
  Refused = "refused",
  OriginRefused = "origin-refused",
  RateLimited = "rate-limited",
  /* A policy, counter or claim could not be read. Retryable. */
  Unavailable = "unavailable",
}

export interface ProductAnalyticsGateDecision {
  outcome: ProductAnalyticsGateOutcome;
  /* A short closed vocabulary; the recorder logs it. */
  reason: string;
  retryAfterSeconds?: number | undefined;
  policy?: SessionReplayGatePolicy | undefined;
}

/* How long a batch id is remembered: a recorder resends within seconds. */
export const PRODUCT_ANALYTICS_BATCH_CLAIM_TTL_SECONDS: number = 24 * 60 * 60;

const BATCH_CLAIM_KEY_PREFIX: string = "product-analytics:batch:";
const BATCH_WRITTEN_KEY_PREFIX: string = "product-analytics:written:";
const ITEM_RATE_KEY_PREFIX: string = "product-analytics:rate:";
const ITEM_RATE_TTL_SECONDS: number = 120;

/* The consent the recorder reports under an explicit-consent policy. */
const CONSENT_GRANTED: string = "Granted";

export default class ProductAnalyticsEventIngestService {
  public static async gateBatch(data: {
    projectId: ObjectID;
    appIdentifier: string;
    origin: string | undefined;
    consentState: string;
    itemCount: number;
  }): Promise<ProductAnalyticsGateDecision> {
    if (!SESSION_REPLAY_INGEST_ENABLED || !SESSION_REPLAY_ENABLED_BY_DEFAULT) {
      return {
        outcome: ProductAnalyticsGateOutcome.Stop,
        reason: "ingest-disabled",
      };
    }

    let resolution: SessionReplayPolicyResolution;

    try {
      resolution = await SessionReplayGateCache.resolvePolicy({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
      });
    } catch (err) {
      logger.error("ProductAnalyticsEventIngestService: policy lookup failed");
      logger.error(err);

      return {
        outcome: ProductAnalyticsGateOutcome.Unavailable,
        reason: "policy-unavailable",
        retryAfterSeconds: 30,
      };
    }

    const policy: SessionReplayGatePolicy | null = resolution.policy;

    if (!policy) {
      return {
        outcome: ProductAnalyticsGateOutcome.Stop,
        reason: resolution.refusal || "not-enabled",
      };
    }

    if (!policy.isProductAnalyticsEnabled) {
      return {
        outcome: ProductAnalyticsGateOutcome.Stop,
        reason: "product-analytics-not-enabled",
        policy: policy,
      };
    }

    if (!SessionReplayGateCache.isOriginAllowed(policy, data.origin)) {
      return {
        outcome: ProductAnalyticsGateOutcome.OriginRefused,
        reason: "origin-not-allowed",
        policy: policy,
      };
    }

    if (
      policy.consentMode === SessionReplayConsentMode.RequireExplicit &&
      data.consentState !== CONSENT_GRANTED
    ) {
      return {
        outcome: ProductAnalyticsGateOutcome.Refused,
        reason: "consent-required",
        policy: policy,
      };
    }

    const rate: ProductAnalyticsGateDecision | null =
      await this.consumeItemAllowance({
        projectId: data.projectId,
        itemCount: Math.max(1, data.itemCount),
      });

    if (rate) {
      return { ...rate, policy: policy };
    }

    return {
      outcome: ProductAnalyticsGateOutcome.Accepted,
      reason: "accepted",
      policy: policy,
    };
  }

  /*
   * The project's per-minute allowance of events and metric points: a
   * fixed window counted in Redis, like replay's chunk rate. null when the
   * batch fits; a refusal otherwise. Fails closed (503) without Redis.
   */
  private static async consumeItemAllowance(data: {
    projectId: ObjectID;
    itemCount: number;
  }): Promise<ProductAnalyticsGateDecision | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return {
        outcome: ProductAnalyticsGateOutcome.Unavailable,
        reason: "rate-counter-unavailable",
        retryAfterSeconds: 30,
      };
    }

    const nowMs: number = Date.now();
    const key: string = `${ITEM_RATE_KEY_PREFIX}${data.projectId.toString()}:${Math.floor(nowMs / 60000)}`;

    try {
      const total: number = await client.incrby(key, data.itemCount);

      if (total === data.itemCount) {
        await client.expire(key, ITEM_RATE_TTL_SECONDS);
      }

      if (total > PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE) {
        return {
          outcome: ProductAnalyticsGateOutcome.RateLimited,
          reason: "rate-limited",
          retryAfterSeconds: Math.max(
            1,
            60 - Math.floor((nowMs % 60000) / 1000),
          ),
        };
      }

      return null;
    } catch (err) {
      logger.warn(
        `ProductAnalyticsEventIngestService: rate counter failed for project ${data.projectId.toString()}`,
      );
      logger.warn(err);

      return {
        outcome: ProductAnalyticsGateOutcome.Unavailable,
        reason: "rate-counter-unavailable",
        retryAfterSeconds: 30,
      };
    }
  }

  /*
   * Claim a batch id for the day. "duplicate" when another request already
   * claimed it - the recorder resent a batch whose answer it lost.
   */
  public static async claimBatch(data: {
    projectId: ObjectID;
    batchId: string;
  }): Promise<"claimed" | "duplicate" | "unavailable"> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return "unavailable";
    }

    try {
      const stored: "OK" | null = await client.set(
        `${BATCH_CLAIM_KEY_PREFIX}${data.projectId.toString()}:${data.batchId}`,
        "1",
        "EX",
        PRODUCT_ANALYTICS_BATCH_CLAIM_TTL_SECONDS,
        "NX",
      );

      return stored === "OK" ? "claimed" : "duplicate";
    } catch (err) {
      logger.warn("ProductAnalyticsEventIngestService: batch claim failed");
      logger.warn(err);
      return "unavailable";
    }
  }

  /* Give a claim back when the batch could not be queued, so a resend lands. */
  public static async releaseBatch(data: {
    projectId: ObjectID;
    batchId: string;
  }): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    try {
      await client.del(
        `${BATCH_CLAIM_KEY_PREFIX}${data.projectId.toString()}:${data.batchId}`,
      );
    } catch (err) {
      logger.warn("ProductAnalyticsEventIngestService: batch release failed");
      logger.warn(err);
    }
  }

  /*
   * The job for an accepted batch. The signed-in user's reference becomes
   * its one-way key here, and only when the application captures identity;
   * the reference itself is never queued or stored.
   */
  public static buildJob(data: {
    projectId: ObjectID;
    policy: SessionReplayGatePolicy;
    batch: ProductAnalyticsParsedBatch;
    receivedAtUnixMs: number;
    countryCode: string;
  }): ProductAnalyticsEventsJobData {
    const capturesIdentity: boolean =
      data.policy.captureUserIdentity &&
      SessionReplayIdentity.isUsableUserRef(data.batch.userRef);

    return {
      projectId: data.projectId.toString(),
      rumApplicationId: data.policy.rumApplicationId.toString(),
      batchId: data.batch.batchId,
      receivedAtUnixMs: data.receivedAtUnixMs,
      countryCode: data.countryCode,
      sessionId: data.batch.sessionId,
      visitorId: data.batch.visitorId,
      identifiedUserKey: capturesIdentity
        ? SessionReplayIdentity.buildUserKey({
            projectId: data.projectId,
            userRef: data.batch.userRef,
          })
        : "",
      userProperties: capturesIdentity ? data.batch.userProperties : {},
      context: data.batch.context,
      events: data.batch.events,
      metrics: data.batch.metrics,
    };
  }

  /* One RumProductAnalyticsEventV1 row per event. */
  public static buildEventRows(
    job: ProductAnalyticsEventsJobData,
  ): Array<JSONObject> {
    return job.events.map((event: ProductAnalyticsParsedEvent): JSONObject => {
      return {
        projectId: job.projectId,
        rumApplicationId: job.rumApplicationId,
        kind: event.kind,
        name: event.name,
        time: OneUptimeDate.toClickhouseDateTime64(new Date(event.time)),
        sessionId: job.sessionId,
        visitorId: job.visitorId,
        identifiedUserKey: job.identifiedUserKey,
        page: event.page,
        deviceType: job.context.deviceType,
        browserName: job.context.browserName,
        osName: job.context.osName,
        countryCode: job.countryCode,
        appVersion: job.context.appVersion,
        properties: { ...event.properties },
        userProperties: { ...job.userProperties },
      };
    });
  }

  /*
   * One Gauge point per metric() call, in the metric store under the RUM
   * application. Its attributes are the ones the page gave, nothing more:
   * no session, no user, so a series per person can never be made of them.
   */
  public static buildMetricRows(data: {
    job: ProductAnalyticsEventsJobData;
    retentionInDays: number;
  }): Array<JSONObject> {
    return data.job.metrics.map(
      (metric: ProductAnalyticsParsedMetric): JSONObject => {
        const time: Date = new Date(metric.time);
        const timestamp: string = OneUptimeDate.toClickhouseDateTime(time);
        const attributes: JSONObject = { ...metric.attributes };

        return {
          _id: ObjectID.generateTimeOrdered().toString(),
          createdAt: OneUptimeDate.toClickhouseDateTime(
            new Date(data.job.receivedAtUnixMs),
          ),
          projectId: data.job.projectId,
          primaryEntityId: data.job.rumApplicationId,
          primaryEntityType: ServiceType.RealUserMonitor,
          name: metric.name,
          aggregationTemporality: null,
          metricPointType: MetricPointType.Gauge,
          time: timestamp,
          startTime: null,
          timeUnixNano: OneUptimeDate.toUnixNano(time).toString(),
          startTimeUnixNano: null,
          attributes: attributes,
          attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
          isMonotonic: null,
          count: null,
          sum: null,
          min: null,
          max: null,
          bucketCounts: [],
          explicitBounds: [],
          value: metric.value,
          retentionDate: OneUptimeDate.toClickhouseDateTime(
            OneUptimeDate.addRemoveDays(time, data.retentionInDays),
          ),
        } as JSONObject;
      },
    );
  }

  public static async processFromQueue(
    job: ProductAnalyticsEventsJobData,
  ): Promise<void> {
    const projectId: ObjectID = new ObjectID(job.projectId);

    /*
     * Events first, once: a retry after the metric points failed must not
     * file the events again, so their landing is remembered by batch id.
     */
    if (job.events.length > 0 && !(await this.wereEventsWritten(job))) {
      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        RumProductAnalyticsEventService,
        this.buildEventRows(job),
      );

      await submission.flushed;
      await this.markEventsWritten(job);

      ProductAnalyticsDerivedMetrics.countEvents(job);
    }

    if (job.metrics.length === 0) {
      return;
    }

    const metadata: TelemetryServiceMetadata =
      await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: "RUM Application",
        resourceId: new ObjectID(job.rumApplicationId),
        primaryEntityType: ServiceType.RealUserMonitor,
        projectId: projectId,
      });

    const retentionInDays: number = resolveTelemetryRetentionInDays({
      pillar: "metrics",
      serviceConfig: metadata.serviceRetentionConfig,
      serviceRetentionInDays: metadata.serviceRetentionInDays,
      projectConfig: metadata.projectRetentionConfig,
      projectRetentionInDays: metadata.projectRetentionInDays,
    });

    const metricSubmission: FanInSubmitResult =
      await TelemetryFanInWriter.submit(
        MetricService,
        this.buildMetricRows({ job: job, retentionInDays: retentionInDays }),
      );

    await metricSubmission.flushed;

    await this.registerMetricNames({
      projectId: projectId,
      names: job.metrics.map((metric: ProductAnalyticsParsedMetric): string => {
        return metric.name;
      }),
    });
  }

  /*
   * Names registered by this process, so the catalog is written once per
   * (project, name) rather than once per batch.
   */
  private static readonly registeredMetricNames: Set<string> =
    new Set<string>();

  private static readonly MAX_REMEMBERED_METRIC_NAMES: number = 50000;

  /*
   * The catalog row is what puts a metric in the metric picker, the Metrics
   * explorer and the Metrics monitor builder. A miss only delays that; the
   * points are already written.
   */
  private static async registerMetricNames(data: {
    projectId: ObjectID;
    names: Array<string>;
  }): Promise<void> {
    const map: Dictionary<MetricType> = {};

    for (const name of data.names) {
      const key: string = `${data.projectId.toString()}:${name}`;

      if (this.registeredMetricNames.has(key)) {
        continue;
      }

      const metricType: MetricType = new MetricType();
      metricType.name = name;
      metricType.description = "";
      metricType.unit = "";
      map[name] = metricType;
    }

    const newNames: Array<string> = Object.keys(map);

    if (newNames.length === 0) {
      return;
    }

    try {
      await TelemetryUtil.indexMetricNameServiceNameMap({
        projectId: data.projectId,
        metricNameServiceNameMap: map,
      });

      if (
        this.registeredMetricNames.size >= this.MAX_REMEMBERED_METRIC_NAMES
      ) {
        this.registeredMetricNames.clear();
      }

      for (const name of newNames) {
        this.registeredMetricNames.add(`${data.projectId.toString()}:${name}`);
      }
    } catch (err) {
      logger.error(
        `ProductAnalyticsEventIngestService: could not register metric names for project ${data.projectId.toString()}.`,
      );
      logger.error(err);
    }
  }

  private static async wereEventsWritten(
    job: ProductAnalyticsEventsJobData,
  ): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return false;
    }

    try {
      return (
        (await client.get(
          `${BATCH_WRITTEN_KEY_PREFIX}${job.projectId}:${job.batchId}`,
        )) !== null
      );
    } catch {
      return false;
    }
  }

  private static async markEventsWritten(
    job: ProductAnalyticsEventsJobData,
  ): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    try {
      await client.set(
        `${BATCH_WRITTEN_KEY_PREFIX}${job.projectId}:${job.batchId}`,
        "1",
        "EX",
        PRODUCT_ANALYTICS_BATCH_CLAIM_TTL_SECONDS,
      );
    } catch (err) {
      logger.warn(
        "ProductAnalyticsEventIngestService: could not remember a written batch",
      );
      logger.warn(err);
    }
  }
}
