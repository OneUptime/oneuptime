import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import GlobalCache from "../../Infrastructure/GlobalCache";
import SingleFlight from "../SingleFlight";
import logger from "../Logger";

/*
 * The one place a telemetry resource's liveness heartbeat gets written.
 *
 * Twelve services (Service, Host, DockerHost, PodmanHost, KubernetesCluster,
 * ProxmoxCluster, CephCluster, IoTFleet, CloudResource, ServerlessFunction,
 * RumApplication, DockerSwarmCluster) each carried a hand-copied version of
 * this: read a throttle key, compare a fingerprint, write it back, UPDATE the
 * row. Copying it twelve times copied its defects twelve times, and one of
 * those copies took production down.
 *
 * THE DEFECT. The throttle keyed on the row id but STORED a fingerprint of the
 * incoming metadata, skipping only when the stored fingerprint matched. That
 * works while one producer owns a row. It provides ZERO throttling the moment
 * the fingerprinted payload changes as fast as the batches arrive — and on
 * these paths it does, in two different ways:
 *
 *   - Two producers of the same row disagreeing forever. `Service` is unique
 *     on (projectId, name) alone, so one service.name in dev and prod inside a
 *     project is one row with two fingerprints, each busting the other's key.
 *   - A single producer whose payload is a per-scrape GAUGE. The cluster and
 *     fleet snapshots hash things like `runningTaskCount`, `osdUpCount`,
 *     `onlineDeviceCount` and `capacityUsedPercent` into the fingerprint.
 *     A float utilisation percentage changes on literally every scrape, so
 *     the fingerprint never repeats and the window never engages.
 *
 * Either way the throttle admitted one write per BATCH rather than one per
 * window, against rows shared by every node/pod/device reporting into them.
 * With the autoscaler at 100 pods (~25K concurrent jobs) that was thousands of
 * simultaneous UPDATEs onto ~2,300 rows. Postgres queues row-lock waiters
 * strictly, so they did not collide and retry — they lined up: 1,017 active
 * connections, 892 parked on locks, the tail waiting 3.7 hours. The database
 * was never short of capacity.
 *
 * THE SHAPE. Liveness and enrichment are gated separately, because they are
 * different kinds of fact:
 *
 *   LIVENESS (`lastSeenAt`, collector status) is gated on key PRESENCE, never
 *   on the payload. One heartbeat per resource per window, full stop — no
 *   metadata, however fast it churns, can bust it.
 *
 *   ENRICHMENT (everything harvested from the payload) is gated on TWO keys: a
 *   compare-and-claim so a genuinely changed value still lands promptly, plus
 *   a presence-only rate limiter so a permanently-churning value costs one
 *   write per window instead of one per batch. The fingerprint alone does not
 *   bound churn — it is exactly what failed.
 *
 * Both claims are ATOMIC. The old read-then-write was check-then-act, and at
 * ingest concurrency the losers of that race do not politely retry: they all
 * proceed.
 *
 * Underneath both, the write is `FOR UPDATE SKIP LOCKED`, so a contended
 * writer yields instead of queueing. That layer holds even when every gate
 * above fails open at once — which is exactly what a Redis outage does — and
 * it is what makes failing open affordable. Failing open is required:
 * suppressing a heartbeat strands a healthy resource as "disconnected" while
 * its telemetry is still arriving (issue #3006's failure mode).
 */

export interface ResourceHeartbeatWrite<TBaseModel extends BaseModel> {
  service: DatabaseService<TBaseModel>;
  id: ObjectID;

  /**
   * Redis namespace for this model's liveness key. The two enrichment keys are
   * derived from it, so one namespace per model keeps all three together.
   */
  cacheNamespace: string;

  /** Liveness window in seconds, before jitter. */
  throttleInSeconds: number;

  /**
   * Enrichment rate-limit window in seconds, before jitter. Defaults to the
   * liveness window: enrichment then lands no later than it used to, while
   * the number of writes is bounded for the first time. Raise it only for
   * genuinely static metadata (a service version, a cloud region), never for
   * values a user watches change.
   */
  enrichmentThrottleInSeconds?: number | undefined;

  /**
   * Columns that must always be written and are safe to lose to contention —
   * a concurrent writer is storing the same `now()`.
   */
  liveness: QueryDeepPartialEntity<TBaseModel>;

  /**
   * Columns harvested from the payload. Unlike liveness these can carry
   * information a concurrent writer does not have, so a contended write of
   * them is retried rather than dropped.
   */
  metadata?: QueryDeepPartialEntity<TBaseModel> | undefined;

  /** Stable fingerprint of `metadata`, for change detection. */
  fingerprint: string;

  /** Human-readable row identity for log lines, e.g. "host abc123". */
  describe: string;
}

/** Derived from the model's liveness namespace — see cacheNamespace. */
function fingerprintNamespace(cacheNamespace: string): string {
  return `${cacheNamespace}-fingerprint`;
}

function writeWindowNamespace(cacheNamespace: string): string {
  return `${cacheNamespace}-write-window`;
}

export default class ResourceHeartbeat {
  public static async write<TBaseModel extends BaseModel>(
    input: ResourceHeartbeatWrite<TBaseModel>,
  ): Promise<void> {
    const cacheKey: string = input.id.toString();

    /*
     * Collapse duplicate concurrent callers inside THIS process first. One
     * OTLP batch resolves the same resource once per contained resource — the
     * host-metrics collector config OneUptime ships emits hundreds per batch —
     * and without this every one of them independently asks Redis the same
     * question and throws the answer away.
     */
    await SingleFlight.run(
      `${input.cacheNamespace}:${cacheKey}:${input.fingerprint}`,
      async () => {
        await this.writeOnce(input, cacheKey);
      },
    );
  }

  private static async writeOnce<TBaseModel extends BaseModel>(
    input: ResourceHeartbeatWrite<TBaseModel>,
    cacheKey: string,
  ): Promise<void> {
    /*
     * Liveness gate. Presence-only and jittered: a fleet-wide restart would
     * otherwise re-synchronise every resource's window and rebuild the herd on
     * a fixed period.
     */
    let writeLiveness: boolean = true;
    try {
      writeLiveness = await GlobalCache.setStringIfNotExists(
        input.cacheNamespace,
        cacheKey,
        "1",
        {
          expiresInSeconds: GlobalCache.withJitter(input.throttleInSeconds),
        },
      );
    } catch {
      /*
       * Cache unavailable — fail OPEN and refresh liveness anyway. Suppressing
       * the heartbeat during a Redis outage is how a healthy resource is shown
       * as disconnected while its data keeps arriving. Affordable only because
       * the write below cannot queue.
       */
      writeLiveness = true;
    }

    const hasMetadata: boolean =
      Boolean(input.metadata) && Object.keys(input.metadata!).length > 0;

    /*
     * Enrichment gate 1: has the payload actually changed? Compare-and-claim,
     * so a genuinely new value is written promptly rather than waiting out a
     * window.
     */
    let metadataChanged: boolean = false;
    if (hasMetadata) {
      try {
        metadataChanged = await GlobalCache.setStringIfChanged(
          fingerprintNamespace(input.cacheNamespace),
          cacheKey,
          input.fingerprint,
          {
            expiresInSeconds: GlobalCache.withJitter(
              input.enrichmentThrottleInSeconds ?? input.throttleInSeconds,
            ),
          },
        );
      } catch {
        /*
         * Fail CLOSED for enrichment, unlike liveness. These columns are
         * descriptive; nothing is mis-reported by writing them a little later,
         * and letting a Redis outage open this gate restores the per-batch
         * write storm this exists to prevent.
         */
        metadataChanged = false;
      }
    }

    /*
     * Enrichment gate 2: the rate limiter. Change detection cannot tell a
     * meaningful update apart from a gauge that moves every scrape — both
     * present as "it changed". Since the churning case is unbounded, this
     * bounds both.
     */
    let writeMetadata: boolean = false;
    if (metadataChanged) {
      try {
        writeMetadata = await GlobalCache.setStringIfNotExists(
          writeWindowNamespace(input.cacheNamespace),
          cacheKey,
          "1",
          {
            expiresInSeconds: GlobalCache.withJitter(
              input.enrichmentThrottleInSeconds ?? input.throttleInSeconds,
            ),
          },
        );
      } catch {
        writeMetadata = false;
      }
    }

    if (!writeLiveness && !writeMetadata) {
      // Nothing to say. Issue no statement at all.
      return;
    }

    /*
     * Liveness rides along even on an enrichment-only write: refreshing it
     * early is harmless (it is a floor, not a sample), and splitting the two
     * into separate statements would double the writes we just halved.
     */
    const data: QueryDeepPartialEntity<TBaseModel> = {
      ...(input.liveness as Record<string, unknown>),
      ...(writeMetadata
        ? ((input.metadata || {}) as Record<string, unknown>)
        : {}),
    } as QueryDeepPartialEntity<TBaseModel>;

    let wrote: boolean = false;

    try {
      wrote = await input.service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: input.id,
        data: data,
      });
    } catch (err) {
      /*
       * Liveness must survive bad metadata. Every enrichment value is a
       * collector-supplied attribute, so if one of them makes Postgres reject
       * the statement it takes `lastSeenAt` down with it and the resource
       * silently stops looking alive — the disconnection sweep then flips a
       * perfectly healthy resource 15 minutes later with telemetry arriving
       * the whole time. That was issue #3006. Retry with liveness only, so
       * enrichment is what gets dropped, never the heartbeat.
       */
      logger.warn(
        `ResourceHeartbeat: metadata write failed for ${input.describe}, falling back to a liveness-only update: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      await this.releaseGates(input.cacheNamespace, cacheKey, writeMetadata);

      await input.service.updateColumnsByIdIfUnlockedWithoutHooks({
        id: input.id,
        data: input.liveness,
      });

      return;
    }

    if (!wrote && writeMetadata) {
      /*
       * The row was locked, so this write was SKIPPED rather than applied. For
       * liveness that is a non-event — whoever holds the lock is storing the
       * same timestamp. Enrichment is different: the holder may be writing an
       * older payload, and the gates just claimed would suppress ours for the
       * rest of the window. Release them so the next batch re-attempts.
       *
       * This cannot become a retry storm: each attempt is a non-blocking
       * statement that returns immediately when contended.
       */
      await this.releaseGates(input.cacheNamespace, cacheKey, true);
    }
  }

  /**
   * Re-open the gates so the next batch retries. When enrichment was at stake
   * those are the gates that must not stay claimed after a write that never
   * happened; otherwise it is the liveness gate.
   */
  private static async releaseGates(
    cacheNamespace: string,
    cacheKey: string,
    hadMetadata: boolean,
  ): Promise<void> {
    const namespaces: Array<string> = hadMetadata
      ? [
          fingerprintNamespace(cacheNamespace),
          writeWindowNamespace(cacheNamespace),
        ]
      : [cacheNamespace];

    for (const namespace of namespaces) {
      try {
        await GlobalCache.deleteKey(namespace, cacheKey);
      } catch {
        // Best effort — the retry is what actually matters.
      }
    }
  }
}
