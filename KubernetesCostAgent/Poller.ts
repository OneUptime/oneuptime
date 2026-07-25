import {
  ENGINE_SETTLE_SECONDS,
  LOOKBACK_WINDOWS,
  POLL_INTERVAL_SECONDS,
  WINDOW_SECONDS,
} from "./Config";
import { floorToWindow, mapAllocationToRow } from "./AllocationMapper";
import { CostEngineClient } from "./CostEngineClient";
import Logger from "./Logger";
import { Shipper } from "./Shipper";
import { EngineAllocation, KubernetesCostAllocationIngestRow } from "./Types";

export class Poller {
  private readonly engine: CostEngineClient;
  private readonly shipper: Shipper;

  /*
   * End (ms) of the newest window that was fully shipped. Windows are
   * shipped strictly in order; a failed window blocks the checkpoint so
   * nothing is skipped. In-memory only — on restart the agent re-ships the
   * last LOOKBACK_WINDOWS closed windows and the server's already-ingested
   * check makes that idempotent.
   */
  private checkpointMs: number;

  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private stopped: boolean = false;
  private lastPollErr: string | null = null;

  public constructor(engine: CostEngineClient, shipper: Shipper) {
    this.engine = engine;
    this.shipper = shipper;

    const latestClosed: number = floorToWindow(Date.now(), WINDOW_SECONDS);
    this.checkpointMs = Math.max(
      0,
      latestClosed - LOOKBACK_WINDOWS * WINDOW_SECONDS * 1000,
    );
  }

  public lastError(): string | null {
    return this.lastPollErr;
  }

  public start(): void {
    Logger.info("cost poller started", {
      windowSeconds: WINDOW_SECONDS,
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      lookbackWindows: LOOKBACK_WINDOWS,
      firstWindowStart: new Date(this.checkpointMs).toISOString(),
    });

    void this.tick();
    this.timer = setInterval((): void => {
      void this.tick();
    }, POLL_INTERVAL_SECONDS * 1000);
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;

    try {
      /*
       * Ship every closed-and-settled window past the checkpoint, oldest
       * first. Normally that is zero or one window per tick; after
       * downtime it catches up in order.
       */
      const windowMs: number = WINDOW_SECONDS * 1000;
      const settleMs: number = ENGINE_SETTLE_SECONDS * 1000;

      while (!this.stopped) {
        const windowStartMs: number = this.checkpointMs;
        const windowEndMs: number = windowStartMs + windowMs;

        if (windowEndMs + settleMs > Date.now()) {
          break; // Window still open or not settled yet.
        }

        const windowStart: Date = new Date(windowStartMs);
        const windowEnd: Date = new Date(windowEndMs);

        const allocations: Array<EngineAllocation> =
          await this.engine.fetchAllocations({ windowStart, windowEnd });

        if (allocations.length > 0) {
          const rows: Array<KubernetesCostAllocationIngestRow> =
            allocations.map(
              (
                allocation: EngineAllocation,
              ): KubernetesCostAllocationIngestRow => {
                return mapAllocationToRow({
                  allocation,
                  windowStart,
                  windowEnd,
                });
              },
            );

          await this.shipper.ship(rows);

          Logger.info("shipped cost window", {
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            rows: rows.length,
          });
        } else {
          Logger.info("cost window had no allocations; skipping", {
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
          });
        }

        this.checkpointMs = windowEndMs;
        this.lastPollErr = null;
      }
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      this.lastPollErr = message;
      Logger.error("cost poll failed; will retry next tick", {
        error: message,
      });
    } finally {
      this.running = false;
    }
  }
}
