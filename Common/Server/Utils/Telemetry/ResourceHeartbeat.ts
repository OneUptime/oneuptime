import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import GlobalCache from "../../Infrastructure/GlobalCache";
import InProcessMemo from "../InProcessMemo";
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
  /*
   * Time-based L1 over the whole gate cascade. SingleFlight collapses
   * CONCURRENT duplicates, but sequential batches — the next job for the
   * same host arriving a second later — each still paid 1-3 Redis round
   * trips (liveness SET NX, fingerprint compare-and-claim, rate-limit
   * SET NX) to be told "nothing to do". Once THIS process has settled a
   * heartbeat for a (resource, fingerprint), that answer holds for the
   * rest of the window, so re-asking Redis per batch buys nothing.
   *
   * The memo key includes the FINGERPRINT, so a genuinely changed payload
   * bypasses the memo and reaches the compare-and-claim gate as promptly
   * as it did before — the L1 only ever suppresses re-asking a question
   * whose inputs are identical.
   *
   * Entries live for min(60s, the caller's liveness window, pre-jitter).
   * Within that span the Redis liveness key this process (or another pod)
   * claimed cannot have expired yet (its jittered TTL is >= the window),
   * so a skipped probe would have been refused anyway. The one real trade
   * is cross-pod lastSeen PRECISION: when a DIFFERENT pod's claim expires
   * mid-window, this pod would previously have won the reopened gate on
   * its next batch, and now reacts up to one memo TTL later (any other pod
   * still reacts immediately). That delay is bounded by the existing
   * window — the same staleness the jittered TTL already permits — and
   * sits far inside the 15-minute markDisconnected* thresholds.
   *
   * Outcomes that must retry are NEVER memoized: a failed or lock-skipped
   * metadata write (those release their Redis gates precisely so the next
   * batch retries) and any outcome where a gate probe threw (a Redis
   * outage must keep failing open per batch, not once per memo TTL).
   */
  private static readonly recentHeartbeatMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: 60 * 1000,
      maxEntries: 10_000,
    });

  public static async write<TBaseModel extends BaseModel>(
    input: ResourceHeartbeatWrite<TBaseModel>,
  ): Promise<void> {
    const cacheKey: string = input.id.toString();
    const memoKey: string = `${input.cacheNamespace}:${cacheKey}:${input.fingerprint}`;

    /*
     * L1: this process already settled this exact heartbeat within the
     * window. Zero network cost, no gates touched.
     */
    if (this.recentHeartbeatMemo.get(memoKey)) {
      return;
    }

    /*
     * Collapse duplicate concurrent callers inside THIS process first. One
     * OTLP batch resolves the same resource once per contained resource — the
     * host-metrics collector config OneUptime ships emits hundreds per batch —
     * and without this every one of them independently asks Redis the same
     * question and throws the answer away.
     */
    await SingleFlight.run(memoKey, async () => {
      await this.writeOnce(input, cacheKey, memoKey);
    });
  }

  /**
   * Drop the recent-heartbeat memo. For tests only — suites that reuse one
   * resource id across cases simulate the memo TTL expiring with this, the
   * same way they already clear their fake Redis maps and SingleFlight.
   */
  public static clearRecentHeartbeatMemo(): void {
    this.recentHeartbeatMemo.clear();
  }

  private static async writeOnce<TBaseModel extends BaseModel>(
    input: ResourceHeartbeatWrite<TBaseModel>,
    cacheKey: string,
    memoKey: string,
  ): Promise<void> {
    /*
     * Whether every Redis gate we consulted actually answered. A probe that
     * THREW fell back to a hardcoded outcome (open for liveness, closed for
     * enrichment) — that outcome is a per-batch policy, not a fact about the
     * window, so it must never be memoized into the L1.
     */
    let gatesAnswered: boolean = true;

    /*
     * The memo must expire no later than the PRE-JITTER window, because that
     * is the earliest instant the Redis liveness key claimed alongside it
     * could expire — and never later than the 60-second norm.
     */
    const memoTtlInMs: number =
      Math.min(60, Math.max(input.throttleInSeconds, 0)) * 1000;

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
      gatesAnswered = false;
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
        gatesAnswered = false;
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
        gatesAnswered = false;
      }
    }

    if (!writeLiveness && !writeMetadata) {
      /*
       * Nothing to say. Issue no statement at all — and remember that for
       * the memo TTL, since every gate answered and the same inputs can
       * only produce the same silence for the rest of the window.
       */
      if (gatesAnswered) {
        this.recentHeartbeatMemo.set(memoKey, true, memoTtlInMs);
      }
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
      return;
    }

    /*
     * The write LANDED: nothing is left for this exact input to do this
     * window, so remember that. Memoized only when every gate genuinely
     * answered (an outage outcome is per-batch policy, never a fact) and
     * NOT for the liveness-only lock-skip above `wrote === false` — that
     * case is rare, already free of gate churn next batch, and memoizing
     * a write we did not perform is a subtlety not worth carrying.
     */
    if (wrote && gatesAnswered) {
      this.recentHeartbeatMemo.set(memoKey, true, memoTtlInMs);
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
