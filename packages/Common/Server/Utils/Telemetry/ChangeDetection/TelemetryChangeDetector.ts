import OneUptimeDate from "../../../../Types/Date";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import ChangeEventService from "../../../Services/ChangeEventService";
import type { TelemetryServiceMetadata } from "../../../Services/OpenTelemetryIngestService";
import InProcessMemo from "../../InProcessMemo";
import logger from "../../Logger";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
} from "../ChangeEventRow";
import TelemetryFanInWriter from "../TelemetryFanInWriter";
import {
  KubernetesRolloutSignal,
  ServiceVersionSignal,
  buildKubernetesRolloutChangeEntry,
  buildServiceVersionChangeEntry,
  extractKubernetesRolloutSignal,
  extractServiceVersionSignal,
  isWorkloadServiceTelemetry,
  kubernetesRolloutScopeKey,
  readResourceAttribute,
  scopedValueKey,
  serviceVersionScopeKey,
} from "./TelemetryChangeSignals";

/*
 * Records the changes OneUptime sees in the telemetry it already receives:
 * a service that starts reporting a new service.version, a Kubernetes
 * Deployment whose pods start running a new ReplicaSet. Each becomes a
 * change event, so the deploy is on every chart of the service and in front
 * of OneUptime AI when it investigates an incident, without a pipeline
 * having to post it.
 *
 * Called for every OTLP resource block the ingest workers resolve, so the
 * steady state must cost nothing: a value this process has checked lately
 * is answered from an in-process memo, and only a value it has not is taken
 * to Redis. There, one atomic SET NX per (scope, value) decides which worker
 * sees it first - that worker alone swaps the scope's latest value and
 * learns what it was. The first value a scope ever reports is its baseline,
 * not a change: telemetry that starts arriving for a service that has run
 * for months is not a deploy.
 *
 * What it does not see: a rollback to a value reported in the last
 * SEEN_TTL_IN_DAYS (the value is known, so nothing is new - a
 * `kubectl rollout undo` scales an old ReplicaSet back up), and anything a
 * resource does not report. A rollback OneUptime AI runs is recorded where
 * the command runs (OwnChangeRecorder).
 *
 * Best effort by design: every failure is logged and swallowed, and the
 * ingest path never waits for it (observeResource).
 */

/*
 * How long a value is remembered after it was last reported, and a scope's
 * latest value with it.
 */
export const SEEN_TTL_IN_DAYS: number = 30;

/*
 * The most changes one scope records in an hour. A service whose "version"
 * changes with every pod (a build timestamp, a hostname) is not deploying
 * every minute; past this, its changes are not recorded until the hour is
 * over.
 */
export const MAX_CHANGES_PER_SCOPE_PER_HOUR: number = 6;

/*
 * How long this process trusts that it already checked a value. The memo
 * only saves the Redis round trip for values seen moments ago; Redis is
 * what decides.
 */
export const SEEN_MEMO_TTL_IN_MS: number = 10 * 60 * 1000;
export const SEEN_MEMO_MAX_ENTRIES: number = 50_000;

export const CHANGE_DETECTION_SEEN_NAMESPACE: string = "change-detection-seen";
export const CHANGE_DETECTION_LATEST_NAMESPACE: string =
  "change-detection-latest";
export const CHANGE_DETECTION_COUNT_NAMESPACE: string =
  "change-detection-count";

export interface ObserveResourceData {
  projectId: ObjectID;
  // What the resource block resolved to (OtelIngestBaseService.resolveTelemetryResource).
  metadata: TelemetryServiceMetadata;
  // The block's raw OTLP resource attributes.
  attributes: JSONArray;
  kubernetesClusterId?: ObjectID | null | undefined;
  // When the telemetry arrived; now when unknown.
  observedAt?: Date | string | null | undefined;
}

export default class TelemetryChangeDetector {
  private static seenMemo: InProcessMemo<true> = new InProcessMemo<true>({
    ttlInMs: SEEN_MEMO_TTL_IN_MS,
    maxEntries: SEEN_MEMO_MAX_ENTRIES,
  });

  // Scopes this process already warned about, so a noisy one logs once an hour.
  private static warnedNoisyScopes: InProcessMemo<true> =
    new InProcessMemo<true>({
      ttlInMs: 60 * 60 * 1000,
      maxEntries: 10_000,
    });

  /*
   * The ingest path's entry point: starts the check and returns at once.
   * Never throws and never delays ingest.
   */
  public static observeResource(data: ObserveResourceData): void {
    TelemetryChangeDetector.observe(data).catch((error: unknown) => {
      logger.debug(
        `Change detection skipped a resource block: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  // The check itself, awaitable for tests. Resolves when its rows are stored.
  public static async observe(data: ObserveResourceData): Promise<void> {
    const time: Date = TelemetryChangeDetector.getObservedAt(data.observedAt);
    const isService: boolean =
      data.metadata.primaryEntityType === ServiceType.OpenTelemetry;

    const writes: Array<Promise<void>> = [];

    if (isService) {
      const versionSignal: ServiceVersionSignal | null =
        extractServiceVersionSignal(data.attributes);

      if (versionSignal) {
        writes.push(
          TelemetryChangeDetector.detectServiceVersionChange({
            data,
            signal: versionSignal,
            time,
          }),
        );
      }
    }

    const rolloutSignal: KubernetesRolloutSignal | null =
      extractKubernetesRolloutSignal(data.attributes);

    /*
     * A service's block reports a rollout only when it is the workload's
     * own telemetry; another would file the rollout under the wrong service
     * (isWorkloadServiceTelemetry). A block that resolved to no service
     * reports it as the cluster's.
     */
    if (
      rolloutSignal &&
      (!isService ||
        isWorkloadServiceTelemetry({
          attributes: data.attributes,
          serviceName: data.metadata.serviceName,
          signal: rolloutSignal,
        }))
    ) {
      writes.push(
        TelemetryChangeDetector.detectKubernetesRollout({
          data,
          signal: rolloutSignal,
          time,
          isService,
        }),
      );
    }

    await Promise.all(writes);
  }

  // Forget what this process checked; tests start each case clean with it.
  public static resetMemo(): void {
    TelemetryChangeDetector.seenMemo = new InProcessMemo<true>({
      ttlInMs: SEEN_MEMO_TTL_IN_MS,
      maxEntries: SEEN_MEMO_MAX_ENTRIES,
    });
    TelemetryChangeDetector.warnedNoisyScopes = new InProcessMemo<true>({
      ttlInMs: 60 * 60 * 1000,
      maxEntries: 10_000,
    });
  }

  private static async detectServiceVersionChange(input: {
    data: ObserveResourceData;
    signal: ServiceVersionSignal;
    time: Date;
  }): Promise<void> {
    const { data, signal, time } = input;

    const scopeKey: string = serviceVersionScopeKey({
      projectId: data.projectId,
      serviceId: data.metadata.primaryEntityId,
      environment: signal.environment,
    });

    const previousVersion: string | null =
      await TelemetryChangeDetector.claimNewValue({
        scopeKey,
        value: signal.version,
      });

    if (!previousVersion) {
      return;
    }

    if (!(await TelemetryChangeDetector.isWithinHourlyBudget(scopeKey))) {
      return;
    }

    const entry: ParsedChangeEventEntry = buildServiceVersionChangeEntry({
      serviceName: data.metadata.serviceName,
      signal,
      previousVersion,
      time,
    });

    await TelemetryChangeDetector.write({
      entry,
      projectId: data.projectId,
      serviceMetadata: data.metadata,
      dedupKey: scopedValueKey(scopeKey, signal.version),
    });
  }

  private static async detectKubernetesRollout(input: {
    data: ObserveResourceData;
    signal: KubernetesRolloutSignal;
    time: Date;
    isService: boolean;
  }): Promise<void> {
    const { data, signal, time } = input;

    const scopeKey: string = kubernetesRolloutScopeKey({
      projectId: data.projectId,
      kubernetesClusterId: data.kubernetesClusterId,
      signal,
    });

    const previousReplicaSetName: string | null =
      await TelemetryChangeDetector.claimNewValue({
        scopeKey,
        value: signal.replicaSetName,
      });

    if (!previousReplicaSetName) {
      return;
    }

    if (!(await TelemetryChangeDetector.isWithinHourlyBudget(scopeKey))) {
      return;
    }

    const entry: ParsedChangeEventEntry = buildKubernetesRolloutChangeEntry({
      signal,
      previousReplicaSetName,
      kubernetesClusterId: data.kubernetesClusterId,
      serviceVersion: readResourceAttribute(data.attributes, "service.version"),
      time,
    });

    await TelemetryChangeDetector.write({
      entry,
      projectId: data.projectId,
      // A rollout is the service's when the block resolved to one.
      serviceMetadata: input.isService ? data.metadata : null,
      dedupKey: scopedValueKey(scopeKey, signal.replicaSetName),
    });
  }

  /*
   * The scope's previous value when `value` is new to it, null otherwise:
   * when this process or another already saw it, or when it is the first
   * value the scope ever reports (its baseline).
   */
  private static async claimNewValue(data: {
    scopeKey: string;
    value: string;
  }): Promise<string | null> {
    const valueKey: string = scopedValueKey(data.scopeKey, data.value);

    if (TelemetryChangeDetector.seenMemo.get(valueKey)) {
      return null;
    }

    TelemetryChangeDetector.seenMemo.set(valueKey, true);

    const ttl: { expiresInSeconds: number } = {
      expiresInSeconds: OneUptimeDate.getSecondsInDays(SEEN_TTL_IN_DAYS),
    };

    /*
     * A value still reported stays seen: its expiry counts from its last
     * sighting, not its first. Otherwise a version that has run for
     * SEEN_TTL_IN_DAYS would be "new" again - and, next to a canary's
     * version, recorded as a deploy from it.
     */
    const isFirstSighting: boolean =
      await GlobalCache.setStringIfNotExistsOrExtend(
        CHANGE_DETECTION_SEEN_NAMESPACE,
        valueKey,
        "1",
        ttl,
      );

    if (!isFirstSighting) {
      /*
       * And so does the scope's latest value: were it to expire while its
       * values are still known, the next deploy would find none and be
       * taken for a baseline. One evicted from the cache is restored from
       * what the scope reports.
       */
      const isExtended: boolean = await GlobalCache.extendExpiry(
        CHANGE_DETECTION_LATEST_NAMESPACE,
        data.scopeKey,
        ttl,
      );

      if (!isExtended) {
        await GlobalCache.setStringIfNotExists(
          CHANGE_DETECTION_LATEST_NAMESPACE,
          data.scopeKey,
          data.value,
          ttl,
        );
      }

      return null;
    }

    const previous: string | null = await GlobalCache.swapString(
      CHANGE_DETECTION_LATEST_NAMESPACE,
      data.scopeKey,
      data.value,
      ttl,
    );

    if (!previous || previous === data.value) {
      return null;
    }

    return previous;
  }

  private static async isWithinHourlyBudget(
    scopeKey: string,
  ): Promise<boolean> {
    const hour: number = Math.floor(
      OneUptimeDate.getCurrentDate().getTime() / (60 * 60 * 1000),
    );

    const count: number = await GlobalCache.incrementWithExpiry(
      CHANGE_DETECTION_COUNT_NAMESPACE,
      `${scopeKey}:${hour}`,
      { expiresInSeconds: 60 * 60 },
    );

    if (count <= MAX_CHANGES_PER_SCOPE_PER_HOUR) {
      return true;
    }

    if (!TelemetryChangeDetector.warnedNoisyScopes.get(scopeKey)) {
      TelemetryChangeDetector.warnedNoisyScopes.set(scopeKey, true);
      logger.warn(
        `Change detection: a resource reported more than ${MAX_CHANGES_PER_SCOPE_PER_HOUR} new versions or ReplicaSets this hour; not recording more until the hour is over (scope ${scopeKey}).`,
      );
    }

    return false;
  }

  private static async write(data: {
    entry: ParsedChangeEventEntry;
    projectId: ObjectID;
    serviceMetadata: TelemetryServiceMetadata | null;
    dedupKey: string;
  }): Promise<void> {
    const retentionDays: number = data.serviceMetadata
      ? resolveTelemetryRetentionInDays({
          pillar: "metrics",
          serviceConfig: data.serviceMetadata.serviceRetentionConfig,
          serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
          projectConfig: data.serviceMetadata.projectRetentionConfig,
          projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
        })
      : DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS;

    const row: JSONObject = buildChangeEventDbRow({
      parsed: data.entry,
      projectId: data.projectId,
      serviceMetadata: data.serviceMetadata,
      retentionDays,
    });

    /*
     * Its own token, not the ingest job's: a retried job claims nothing it
     * claimed before, so a row this attempt writes is never one the last
     * attempt landed under the job's token.
     */
    const submission: { flushed: Promise<void> } =
      await TelemetryFanInWriter.submit(ChangeEventService, [row], {
        dedupToken: `change-detection:${data.dedupKey}`,
      });

    await submission.flushed;
  }

  private static getObservedAt(value: Date | string | null | undefined): Date {
    if (value) {
      const date: Date = value instanceof Date ? value : new Date(value);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return OneUptimeDate.getCurrentDate();
  }
}
