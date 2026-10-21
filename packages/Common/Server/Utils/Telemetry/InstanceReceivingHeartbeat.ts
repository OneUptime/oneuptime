import InstanceReceivingPeriodService from "../../Services/InstanceReceivingPeriodService";
import { ClickhouseAppInstance } from "../../Infrastructure/ClickhouseDatabase";
import Redis from "../../Infrastructure/Redis";
import { ReceivesIngressTraffic } from "../../EnvironmentConfig";
import GracefulShutdown, { ShutdownPriority } from "../GracefulShutdown";
import logger from "../Logger";
import ReceivingCoverage from "./ReceivingCoverage";
import { RECEIVING_HEARTBEAT_INTERVAL_MS } from "../../../Utils/Telemetry/ReceivingGaps";

/*
 * The receiving heartbeat: how OneUptime knows, afterwards, when it was not
 * receiving data (issue #2825).
 *
 * Every RECEIVING_HEARTBEAT_INTERVAL_MS, a process that takes ingress
 * traffic records in the InstanceReceivingPeriod ledger that it is
 * receiving - but only while it really can: its routes are all mounted (it
 * starts after the startup gate opens), it can queue what it is sent (Valkey)
 * and store it (ClickHouse, and Postgres, which the write itself needs).
 *
 * So the ledger's gaps are exactly the stretches no process could take in
 * and store data: every replica down at once (a docker-compose restart or
 * upgrade, a full rollout), the app tier down while workers kept running
 * (RECEIVES_INGRESS_TRAFFIC=false on the workers), or a datastore down. A
 * rolling update, where some replica is always up, leaves no gap.
 */
export default class InstanceReceivingHeartbeat {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static beatInFlight: Promise<boolean> | null = null;
  private static lastPruneAtMs: number = 0;
  private static stopped: boolean = false;

  // Old periods are pruned at most this often, per process.
  public static readonly PRUNE_INTERVAL_MS: number = 6 * 60 * 60_000;

  /*
   * Starts heartbeating from this process, at once and then every interval.
   * A process that takes no ingress traffic never does.
   */
  public static start(): void {
    if (!ReceivesIngressTraffic) {
      logger.info(
        "RECEIVES_INGRESS_TRAFFIC=false: this process does not record that OneUptime is receiving data.",
      );
      return;
    }

    if (this.timer) {
      return;
    }

    this.stopped = false;

    void this.beat();

    this.timer = setInterval(() => {
      void this.beat();
    }, RECEIVING_HEARTBEAT_INTERVAL_MS);

    // Never the reason a process stays alive.
    this.timer.unref?.();

    /*
     * Stop vouching as soon as the process stops taking requests, not when
     * its datastores close: a replica that is draining is no longer
     * receiving.
     */
    GracefulShutdown.registerHandler(
      "InstanceReceivingHeartbeat",
      ShutdownPriority.HttpServer,
      () => {
        this.stop();
      },
    );
  }

  public static stop(): void {
    this.stopped = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /*
   * One heartbeat. Returns whether it was recorded. Never throws: a failed
   * heartbeat is simply a missing one, which is what it should be.
   */
  public static async beat(): Promise<boolean> {
    // A slow database must not stack heartbeats on top of each other.
    if (this.beatInFlight) {
      return await this.beatInFlight;
    }

    this.beatInFlight = this.recordIfReceiving().finally(() => {
      this.beatInFlight = null;
    });

    return await this.beatInFlight;
  }

  private static async recordIfReceiving(): Promise<boolean> {
    if (this.stopped) {
      return false;
    }

    try {
      if (!(await this.canReceive())) {
        return false;
      }

      const startedNewPeriod: boolean =
        await InstanceReceivingPeriodService.recordReceiving();

      if (startedNewPeriod) {
        /*
         * The gap that just closed is now readable; drop the cached open gap
         * so this process's own checks see the reconnect grace at once.
         */
        ReceivingCoverage.clearCache();
        logger.info(
          "This instance is receiving data again. The time it was not receiving is not held against any resource.",
        );
      }

      await this.pruneOccasionally();

      return true;
    } catch (err) {
      logger.error("Could not record that this instance is receiving data");
      logger.error(err);
      return false;
    }
  }

  /*
   * Whether this process can take in and store data right now: Valkey for
   * the ingest queue, ClickHouse for telemetry. Postgres is proven by the
   * heartbeat's own write.
   */
  private static async canReceive(): Promise<boolean> {
    const [queueReachable, telemetryStoreReachable]: [boolean, boolean] =
      await Promise.all([
        Redis.checkConnnectionStatus(),
        ClickhouseAppInstance.checkConnnectionStatus(),
      ]);

    return queueReachable && telemetryStoreReachable;
  }

  private static async pruneOccasionally(): Promise<void> {
    const nowMs: number = Date.now();

    if (nowMs - this.lastPruneAtMs < this.PRUNE_INTERVAL_MS) {
      return;
    }

    this.lastPruneAtMs = nowMs;

    try {
      await InstanceReceivingPeriodService.pruneOldPeriods();
    } catch (err) {
      logger.error("Could not prune old receiving periods");
      logger.error(err);
    }
  }
}
