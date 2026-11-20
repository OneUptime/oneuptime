import {
  ENGINE_SETTLE_SECONDS,
  LOOKBACK_WINDOWS,
  POLL_INTERVAL_SECONDS,
  WINDOW_SECONDS,
} from "./Config";
import {
  attachMemoryPeaks,
  floorToWindow,
  mapAllocationToRow,
} from "./AllocationMapper";
import {
  CorrectionSchedule,
  CorrectionWindow,
  collapseByIdentity,
  correctionFingerprint,
} from "./EngineCorrections";
import Logger from "./Logger";
import { PrometheusClient } from "./PrometheusClient";
import { Shipper } from "./Shipper";
import {
  CorrectionReading,
  CostEngineSource,
  EngineAllocation,
  KubernetesCostAllocationIngestRow,
  KubernetesCostEngineInfo,
  KubernetesCostMemoryPeaksSource,
  PollerStatus,
} from "./Types";

export class Poller {
  private readonly engine: CostEngineSource;
  private readonly shipper: Shipper;
  private readonly prometheus: PrometheusClient;

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

  /*
   * Progress bookkeeping for /healthz. A window that drained counts even
   * when the engine reported no allocations: an empty window is a round
   * trip the engine answered, which is exactly what a stalled agent cannot
   * do. Shipping is tracked separately by the Shipper, because an engine
   * that answers 200 with nothing, forever, drains windows happily and
   * still never delivers a row.
   */
  private readonly startedAtMs: number = Date.now();
  private lastWindowCompletedAtMs: number = 0;
  private windowsCompleted: number = 0;
  private consecutivePollFailures: number = 0;

  /*
   * The hours to read again once a Kubecost has reconciled them with the
   * cloud bill (#9969, EngineCorrections), and what came of it.
   */
  private readonly corrections: CorrectionSchedule;
  // The engines, by address, this process has seen reconcile with a bill.
  private readonly reconcilingEngines: Set<string> = new Set<string>();
  private correctionsSeeded: boolean = false;
  private windowsCorrected: number = 0;
  private lastCorrectionErr: string | null = null;

  public constructor(
    engine: CostEngineSource,
    shipper: Shipper,
    prometheus?: PrometheusClient,
    corrections?: CorrectionSchedule,
  ) {
    this.engine = engine;
    this.shipper = shipper;
    this.prometheus = prometheus || new PrometheusClient();
    this.corrections = corrections || new CorrectionSchedule();

    const latestClosed: number = floorToWindow(Date.now(), WINDOW_SECONDS);
    this.checkpointMs = Math.max(
      0,
      latestClosed - LOOKBACK_WINDOWS * WINDOW_SECONDS * 1000,
    );
  }

  public lastError(): string | null {
    return this.lastPollErr;
  }

  public status(): PollerStatus {
    return {
      startedAtMs: this.startedAtMs,
      lastWindowCompletedAtMs: this.lastWindowCompletedAtMs,
      windowsCompleted: this.windowsCompleted,
      consecutivePollFailures: this.consecutivePollFailures,
      lastPollError: this.lastPollErr,
      ...(this.corrections.size() > 0 || this.windowsCorrected > 0
        ? {
            corrections: {
              windowsToReadAgain: this.corrections.size(),
              windowsCorrected: this.windowsCorrected,
              lastCorrectionError: this.lastCorrectionErr,
            },
          }
        : {}),
    };
  }

  /*
   * What the engine says about itself, with where the rows' memory peaks
   * come from (#9970): the page that advises stopping the bundled engine
   * says so when the peaks come from its Prometheus. Undefined from an
   * engine that says nothing.
   */
  private describeEngine(): KubernetesCostEngineInfo | undefined {
    const described: KubernetesCostEngineInfo | undefined =
      typeof this.engine.describe === "function"
        ? this.engine.describe()
        : undefined;

    if (!described) {
      return undefined;
    }

    const memoryPeaksFrom: KubernetesCostMemoryPeaksSource =
      typeof this.prometheus.memoryPeaksFrom === "function"
        ? this.prometheus.memoryPeaksFrom()
        : "";

    return { ...described, memoryPeaksFrom };
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

  /*
   * A window just shipped from a Kubecost that reconciles its prices with a
   * cloud bill is read again once it has (#9969). So is one from a Kubecost
   * this process has seen reconcile: its word on the bill comes from an API
   * of its own (/model/cloudCost/status), and a moment that API does not
   * answer must not cost an hour its later readings. The first such window
   * also hands the schedule the hours before it that this process did not
   * track: those a previous process may have shipped, and its own while the
   * engine could not say yet (a Kubecost 3 says nothing for its first twenty
   * minutes).
   */
  private trackForCorrection(data: {
    windowStartMs: number;
    windowEndMs: number;
    rows: Array<KubernetesCostAllocationIngestRow>;
    costEngine: KubernetesCostEngineInfo | undefined;
  }): void {
    const engineUrl: string =
      typeof this.engine.engineUrl === "function"
        ? this.engine.engineUrl() || ""
        : "";

    if (!engineUrl || typeof this.engine.rereadAllocations !== "function") {
      return;
    }

    if (data.costEngine?.pricingSource === "billing-integration") {
      this.reconcilingEngines.add(engineUrl);
    }

    if (!this.reconcilingEngines.has(engineUrl)) {
      return;
    }

    if (!this.correctionsSeeded) {
      this.correctionsSeeded = true;
      this.corrections.seed({
        throughMs: data.windowStartMs,
        windowMs: WINDOW_SECONDS * 1000,
        engineUrl,
      });
    }

    this.corrections.track({
      windowStartMs: data.windowStartMs,
      windowEndMs: data.windowEndMs,
      engineUrl,
      fingerprint: correctionFingerprint(data.rows),
    });
  }

  /*
   * Reads again the hours owed a later reading, and ships each that differs
   * from what was shipped as a correction (#9969, EngineCorrections). Never
   * throws, and never counts against the poll: corrections are an extra on
   * hours already shipped, and must not hold back the hours still to ship.
   */
  private async readCorrections(): Promise<void> {
    if (typeof this.engine.rereadAllocations !== "function") {
      return;
    }

    for (const window of this.corrections.due()) {
      if (this.stopped) {
        return;
      }

      if (!(await this.readCorrection(window))) {
        /*
         * The engine or OneUptime did not answer: the rest wait for the next
         * tick too, rather than each wait out its own timeout now.
         */
        return;
      }
    }
  }

  /*
   * One later reading. False when it could not be made or sent: the window
   * stays owed, and is tried again at the next tick.
   */
  private async readCorrection(window: CorrectionWindow): Promise<boolean> {
    const windowStart: Date = new Date(window.windowStartMs);
    const windowEnd: Date = new Date(window.windowEndMs);

    let reading: CorrectionReading;

    try {
      reading = await this.engine.rereadAllocations!({
        windowStart,
        windowEnd,
        engineUrl: window.engineUrl,
      });
    } catch (err: unknown) {
      reading = {
        status: "unavailable",
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (reading.status === "unavailable" || reading.status === "elsewhere") {
      /*
       * Asked again later, until the window is past its ages. A window of
       * another engine than the one in use costs nothing to pass over, so
       * the windows of the engine in use are read meanwhile; an engine that
       * did not answer stops the pass until the next tick.
       */
      this.lastCorrectionErr = reading.reason;
      Logger.debug("could not read a cost window again; trying later", {
        windowStart: windowStart.toISOString(),
        reason: reading.reason,
      });
      return reading.status === "elsewhere";
    }

    if (reading.status === "nothing") {
      Logger.debug(
        "a later reading of a cost window is not whole; keeping it",
        {
          windowStart: windowStart.toISOString(),
          reason: reading.reason,
        },
      );
      this.corrections.read(window, null);
      return true;
    }

    const rows: Array<KubernetesCostAllocationIngestRow> = collapseByIdentity(
      reading.allocations.map(
        (allocation: EngineAllocation): KubernetesCostAllocationIngestRow => {
          return mapAllocationToRow({ allocation, windowStart, windowEnd });
        },
      ),
    );
    const fingerprint: string = correctionFingerprint(rows);

    if (fingerprint === window.fingerprint) {
      this.corrections.read(window, fingerprint);
      return true;
    }

    try {
      await this.shipper.ship(rows, this.describeEngine(), {
        correction: true,
      });
    } catch (err: unknown) {
      this.lastCorrectionErr = err instanceof Error ? err.message : String(err);
      Logger.warn(
        "could not ship a later reading of a cost window; trying again at the next tick",
        {
          windowStart: windowStart.toISOString(),
          error: this.lastCorrectionErr,
        },
      );
      return false;
    }

    this.corrections.read(window, fingerprint);
    this.windowsCorrected++;
    this.lastCorrectionErr = null;

    Logger.info(
      "shipped a later reading of a cost window, as the engine reconciled it",
      {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        rows: rows.length,
      },
    );

    return true;
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;

    try {
      await this.pollWindows();
      await this.readCorrections();
    } finally {
      this.running = false;
    }
  }

  // Ships every closed window past the checkpoint; never throws.
  private async pollWindows(): Promise<void> {
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

        /*
         * A Kubecost answers from what its aggregator has collected, in
         * batches behind the clock: on kind, two minutes after 17:00, the
         * hour that had just closed was there up to 16:15 or 16:20, and an
         * hour is shipped once. Read it again at a later tick until it is
         * whole, without counting a failure (EngineCollection).
         */
        if (
          typeof this.engine.isWindowComplete === "function" &&
          !(await this.engine.isWindowComplete({
            windowStart,
            windowEnd,
            allocations,
          }))
        ) {
          break;
        }

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

          /*
           * Enrich with per-container memory peaks before shipping.
           *
           * Guarded here as well as inside the client: peaks are an
           * enrichment, and letting anything from that path reach the tick's
           * catch would leave the checkpoint pinned and stall SPEND
           * collection over a Prometheus outage. The client already answers
           * with an empty map on failure, but the poller must not depend on
           * a collaborator's politeness for something it can do without.
           */
          let peaks: Map<string, number> = new Map<string, number>();
          try {
            peaks = await this.prometheus.fetchMemoryPeaks({
              windowStart,
              windowEnd,
            });
          } catch (err: unknown) {
            const message: string =
              err instanceof Error ? err.message : String(err);
            Logger.warn("memory peak collection failed; shipping without it", {
              windowStart: windowStart.toISOString(),
              error: message,
            });
          }

          attachMemoryPeaks({ rows, peaks });

          /*
           * Which engine priced the rows, and where its prices come from
           * (CostEngineResolver): the pages say so beside the figures.
           */
          const costEngine: KubernetesCostEngineInfo | undefined =
            this.describeEngine();

          await this.shipper.ship(rows, costEngine);

          Logger.info("shipped cost window", {
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            rows: rows.length,
            containersWithMemoryPeak: peaks.size,
          });

          this.trackForCorrection({
            windowStartMs,
            windowEndMs,
            rows,
            costEngine,
          });
        } else {
          Logger.info("cost window had no allocations; skipping", {
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
          });
        }

        this.checkpointMs = windowEndMs;
        this.lastPollErr = null;
        this.lastWindowCompletedAtMs = Date.now();
        this.windowsCompleted++;
      }

      /*
       * The tick ran end to end. That includes the do-nothing tick where no
       * window is closed yet — which is only reachable once the backlog is
       * drained, so it is genuine progress, not silence: a broken engine
       * pins the checkpoint in the past and every tick has work that throws.
       */
      this.consecutivePollFailures = 0;
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      this.lastPollErr = message;
      this.consecutivePollFailures++;
      Logger.error("cost poll failed; will retry next tick", {
        error: message,
        consecutiveFailures: this.consecutivePollFailures,
      });
    }
  }
}
