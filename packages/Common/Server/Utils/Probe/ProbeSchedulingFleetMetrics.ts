import Redis from "../../Infrastructure/Redis";
import logger from "../Logger";
import { readClock } from "../RollingHistogram";
import ProbeSchedulingLane from "./ProbeSchedulingLane";
import ProbeSchedulingMetricsInstance, {
  ProbeSchedulingLaneMetrics,
  ProbeSchedulingMetrics,
  ProbeSchedulingMetricsSnapshot,
} from "./ProbeSchedulingMetrics";

/*
 * EVERY APP REPLICA'S PROBE SCHEDULING, FROM ANY ONE OF THEM (issue #10819).
 *
 * KEDA's metrics-api scaler, a dashboard or an operator's curl reads
 * /metrics/probe-scheduling from whichever App replica the Service sends
 * it to, and the probe scheduling limit is per replica
 * (ProbeSchedulingLimiter). So every replica that serves probes writes its
 * own view (ProbeSchedulingMetrics) into one Valkey hash every
 * PUBLISH_EVERY_MS, and a read adds up the views written in the last
 * STALE_AFTER_MS - a replica that stopped drops out - with the reading
 * replica's own view taken live. Queue depths, slots and counts are summed;
 * waits and lateness are the worst replica's, so a hot replica is never
 * averaged away.
 *
 * Metrics must never break serving: with Valkey unreachable a read answers
 * with this replica's view alone (fleetWide: false), and a failed write is
 * dropped.
 */

export const PROBE_SCHEDULING_METRICS_KEY: string = "probe-scheduling-metrics";
export const PUBLISH_EVERY_MS: number = 10 * 1000;
export const STALE_AFTER_MS: number = 30 * 1000;
const KEY_TTL_SECONDS: number = 5 * 60;

// The slice of the Valkey client the fleet view needs; injectable for tests.
export interface ProbeSchedulingFleetClient {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  hdel(key: string, ...fields: Array<string>): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

// One replica's view, as the endpoint shows it: by number, never by name.
export interface ProbeSchedulingReplicaView {
  queueDepth: number;
  running: number;
  slots: number;
  slotWaitP95Ms: number;
  refusedLastMinute: number;
  // Answers that asked their connection to reconnect, both lanes.
  reconnectsAskedLastMinute: number;
  monitorTestQueueDepth: number;
  monitorsHandedOutLastMinute: number;
  dispatchLagP95Seconds: number;
}

export interface ProbeSchedulingFleetView {
  // App replicas whose view is in here.
  replicasReporting: number;
  // False: Valkey could not be read, and this is one replica's view.
  fleetWide: boolean;
  windowSeconds: number;
  // The work lane: requests waiting for a slot now, running, and slots.
  queueDepth: number;
  running: number;
  slots: number;
  // How long work requests waited for a slot (the worst replica's).
  slotWaitP95Ms: number;
  slotWaitMaxMs: number;
  // Probe requests answered busy, both lanes.
  refusalsPerMinute: number;
  /*
   * Answers that asked their probe's connection to reconnect, both lanes:
   * a replica with requests waiting for a slot asks a few a second, so the
   * probes' connections move to replicas with room (issue #11392).
   */
  reconnectsAskedPerMinute: number;
  // The monitor test lane.
  monitorTestQueueDepth: number;
  monitorTestSlots: number;
  monitorTestRefusalsPerMinute: number;
  monitorTestReconnectsAskedPerMinute: number;
  // Monitors handed out, and how late past when they were due.
  monitorsHandedOutPerMinute: number;
  dispatchLagP50Seconds: number;
  dispatchLagP95Seconds: number;
  dispatchLagMaxSeconds: number;
  // Handed out a whole interval or more late: a check that was skipped.
  monitorsLateByAnIntervalPerMinute: number;
  // Test Monitor runs handed out, and how long they waited for a probe.
  monitorTestsHandedOutPerMinute: number;
  monitorTestWaitP95Seconds: number;
  monitorTestWaitMaxSeconds: number;
  replicas: Array<ProbeSchedulingReplicaView>;
}

function lane(
  snapshot: ProbeSchedulingMetricsSnapshot,
  name: ProbeSchedulingLane,
): ProbeSchedulingLaneMetrics | undefined {
  return snapshot.lanes[name];
}

function round(value: number, digits: number = 2): number {
  const factor: number = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

// Whether `value` is a snapshot a replica wrote (anything else is dropped).
function isSnapshot(value: unknown): value is ProbeSchedulingMetricsSnapshot {
  const candidate: Partial<ProbeSchedulingMetricsSnapshot> | null =
    value && typeof value === "object"
      ? (value as Partial<ProbeSchedulingMetricsSnapshot>)
      : null;

  return Boolean(
    candidate &&
      typeof candidate.at === "number" &&
      typeof candidate.replica === "string" &&
      candidate.lanes &&
      typeof candidate.lanes === "object" &&
      candidate.dispatchLagSeconds &&
      candidate.monitorTestWaitSeconds,
  );
}

// Adds up replicas' views (see the comment at the top).
export function aggregateProbeScheduling(
  snapshots: Array<ProbeSchedulingMetricsSnapshot>,
  fleetWide: boolean,
): ProbeSchedulingFleetView {
  const view: ProbeSchedulingFleetView = {
    replicasReporting: snapshots.length,
    fleetWide: fleetWide,
    windowSeconds: snapshots[0]?.windowSeconds || 60,
    queueDepth: 0,
    running: 0,
    slots: 0,
    slotWaitP95Ms: 0,
    slotWaitMaxMs: 0,
    refusalsPerMinute: 0,
    reconnectsAskedPerMinute: 0,
    monitorTestQueueDepth: 0,
    monitorTestSlots: 0,
    monitorTestRefusalsPerMinute: 0,
    monitorTestReconnectsAskedPerMinute: 0,
    monitorsHandedOutPerMinute: 0,
    dispatchLagP50Seconds: 0,
    dispatchLagP95Seconds: 0,
    dispatchLagMaxSeconds: 0,
    monitorsLateByAnIntervalPerMinute: 0,
    monitorTestsHandedOutPerMinute: 0,
    monitorTestWaitP95Seconds: 0,
    monitorTestWaitMaxSeconds: 0,
    replicas: [],
  };

  // Per minute, whatever the window.
  const perMinute: number = 60 / Math.max(1, view.windowSeconds);

  for (const snapshot of snapshots) {
    const work: ProbeSchedulingLaneMetrics | undefined = lane(
      snapshot,
      ProbeSchedulingLane.Work,
    );
    const tests: ProbeSchedulingLaneMetrics | undefined = lane(
      snapshot,
      ProbeSchedulingLane.MonitorTests,
    );

    view.queueDepth += work?.waiting || 0;
    view.running += work?.running || 0;
    view.slots += work?.maxConcurrentRequests || 0;
    view.slotWaitP95Ms = Math.max(
      view.slotWaitP95Ms,
      work?.slotWaitMs.p95 || 0,
    );
    view.slotWaitMaxMs = Math.max(
      view.slotWaitMaxMs,
      work?.slotWaitMs.max || 0,
    );
    view.refusalsPerMinute +=
      ((work?.refused || 0) + (tests?.refused || 0)) * perMinute;
    // A view an older replica wrote has no reconnects: none counted.
    view.reconnectsAskedPerMinute +=
      ((work?.reconnectsAsked || 0) + (tests?.reconnectsAsked || 0)) *
      perMinute;
    view.monitorTestQueueDepth += tests?.waiting || 0;
    view.monitorTestSlots += tests?.maxConcurrentRequests || 0;
    view.monitorTestRefusalsPerMinute += (tests?.refused || 0) * perMinute;
    view.monitorTestReconnectsAskedPerMinute +=
      (tests?.reconnectsAsked || 0) * perMinute;
    view.monitorsHandedOutPerMinute += snapshot.monitorsHandedOut * perMinute;
    view.dispatchLagP50Seconds = Math.max(
      view.dispatchLagP50Seconds,
      snapshot.dispatchLagSeconds.p50,
    );
    view.dispatchLagP95Seconds = Math.max(
      view.dispatchLagP95Seconds,
      snapshot.dispatchLagSeconds.p95,
    );
    view.dispatchLagMaxSeconds = Math.max(
      view.dispatchLagMaxSeconds,
      snapshot.dispatchLagSeconds.max,
    );
    view.monitorsLateByAnIntervalPerMinute +=
      snapshot.monitorsLateByAnInterval * perMinute;
    view.monitorTestsHandedOutPerMinute +=
      snapshot.monitorTestsHandedOut * perMinute;
    view.monitorTestWaitP95Seconds = Math.max(
      view.monitorTestWaitP95Seconds,
      snapshot.monitorTestWaitSeconds.p95,
    );
    view.monitorTestWaitMaxSeconds = Math.max(
      view.monitorTestWaitMaxSeconds,
      snapshot.monitorTestWaitSeconds.max,
    );

    view.replicas.push({
      queueDepth: work?.waiting || 0,
      running: work?.running || 0,
      slots: work?.maxConcurrentRequests || 0,
      slotWaitP95Ms: round(work?.slotWaitMs.p95 || 0),
      refusedLastMinute: (work?.refused || 0) + (tests?.refused || 0),
      reconnectsAskedLastMinute:
        (work?.reconnectsAsked || 0) + (tests?.reconnectsAsked || 0),
      monitorTestQueueDepth: tests?.waiting || 0,
      monitorsHandedOutLastMinute: snapshot.monitorsHandedOut,
      dispatchLagP95Seconds: round(snapshot.dispatchLagSeconds.p95),
    });
  }

  view.slotWaitP95Ms = round(view.slotWaitP95Ms);
  view.slotWaitMaxMs = round(view.slotWaitMaxMs);
  view.refusalsPerMinute = Math.round(view.refusalsPerMinute);
  view.monitorTestRefusalsPerMinute = Math.round(
    view.monitorTestRefusalsPerMinute,
  );
  view.reconnectsAskedPerMinute = Math.round(view.reconnectsAskedPerMinute);
  view.monitorTestReconnectsAskedPerMinute = Math.round(
    view.monitorTestReconnectsAskedPerMinute,
  );
  view.monitorsHandedOutPerMinute = Math.round(view.monitorsHandedOutPerMinute);
  view.dispatchLagP50Seconds = round(view.dispatchLagP50Seconds);
  view.dispatchLagP95Seconds = round(view.dispatchLagP95Seconds);
  view.dispatchLagMaxSeconds = round(view.dispatchLagMaxSeconds);
  view.monitorsLateByAnIntervalPerMinute = Math.round(
    view.monitorsLateByAnIntervalPerMinute,
  );
  view.monitorTestsHandedOutPerMinute = Math.round(
    view.monitorTestsHandedOutPerMinute,
  );
  view.monitorTestWaitP95Seconds = round(view.monitorTestWaitP95Seconds);
  view.monitorTestWaitMaxSeconds = round(view.monitorTestWaitMaxSeconds);

  // The busiest replica first.
  view.replicas.sort(
    (
      left: ProbeSchedulingReplicaView,
      right: ProbeSchedulingReplicaView,
    ): number => {
      return right.queueDepth - left.queueDepth;
    },
  );

  return view;
}

export class ProbeSchedulingFleetMetrics {
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(
    private readonly metrics: ProbeSchedulingMetrics = ProbeSchedulingMetricsInstance,
    private readonly client: () => ProbeSchedulingFleetClient | null = (): ProbeSchedulingFleetClient | null => {
      return Redis.getClient() as unknown as ProbeSchedulingFleetClient | null;
    },
    private readonly now: () => number = readClock,
  ) {}

  /*
   * Starts writing this replica's view every PUBLISH_EVERY_MS, once: from
   * the first probe request this replica schedules. The timer never keeps
   * the process alive.
   */
  public ensurePublishing(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval((): void => {
      this.publish().catch((): void => {
        // publish never rejects; nothing to do.
      });
    }, PUBLISH_EVERY_MS);

    this.timer.unref?.();

    this.publish().catch((): void => {
      // publish never rejects; nothing to do.
    });
  }

  public stopPublishing(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Writes this replica's view. Never throws.
  public async publish(): Promise<void> {
    try {
      const client: ProbeSchedulingFleetClient | null = this.client();

      if (!client) {
        return;
      }

      const snapshot: ProbeSchedulingMetricsSnapshot = this.metrics.snapshot();

      await client.hset(
        PROBE_SCHEDULING_METRICS_KEY,
        snapshot.replica,
        JSON.stringify(snapshot),
      );
      await client.expire(PROBE_SCHEDULING_METRICS_KEY, KEY_TTL_SECONDS);
    } catch (error) {
      logger.debug("Could not write this replica's probe scheduling metrics.");
      logger.debug(error);
    }
  }

  /*
   * Every replica's view, added up, with this replica's taken live. Never
   * throws: with Valkey unreachable, this replica's view alone.
   */
  public async read(): Promise<ProbeSchedulingFleetView> {
    const own: ProbeSchedulingMetricsSnapshot = this.metrics.snapshot();

    try {
      const client: ProbeSchedulingFleetClient | null = this.client();

      if (!client) {
        return aggregateProbeScheduling([own], false);
      }

      const written: Record<string, string> =
        (await client.hgetall(PROBE_SCHEDULING_METRICS_KEY)) || {};
      const snapshots: Array<ProbeSchedulingMetricsSnapshot> = [own];
      const stale: Array<string> = [];

      for (const [replica, value] of Object.entries(written)) {
        if (replica === own.replica) {
          continue;
        }

        let snapshot: unknown = null;

        try {
          snapshot = JSON.parse(value);
        } catch {
          snapshot = null;
        }

        if (
          !isSnapshot(snapshot) ||
          this.now() - snapshot.at > STALE_AFTER_MS
        ) {
          stale.push(replica);
          continue;
        }

        snapshots.push(snapshot);
      }

      if (stale.length > 0) {
        await client
          .hdel(PROBE_SCHEDULING_METRICS_KEY, ...stale)
          .catch((): void => {
            // Dropped at the next read.
          });
      }

      return aggregateProbeScheduling(snapshots, true);
    } catch (error) {
      logger.debug(
        "Could not read the App replicas' probe scheduling metrics.",
      );
      logger.debug(error);
      return aggregateProbeScheduling([own], false);
    }
  }
}

export default new ProbeSchedulingFleetMetrics();
