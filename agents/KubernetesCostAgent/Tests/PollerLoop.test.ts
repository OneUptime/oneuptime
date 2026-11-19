import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import { floorToWindow, peakKey } from "../AllocationMapper";
import { CostEngineClient } from "../CostEngineClient";
import { CorrectionSchedule, CorrectionWindow } from "../EngineCorrections";
import { Poller } from "../Poller";
import { PrometheusClient } from "../PrometheusClient";
import { Shipper } from "../Shipper";
import {
  CorrectionReading,
  EngineAllocation,
  KubernetesCostAllocationIngestRow,
  KubernetesCostEngineInfo,
  KubernetesCostMemoryPeaksSource,
  PollerStatus,
} from "../Types";

/*
 * Checkpoint / ordering semantics of the poll loop, with the engine and
 * shipper stubbed out. TestEnv pins WINDOW_SECONDS=60,
 * ENGINE_SETTLE_SECONDS=0 and LOOKBACK_WINDOWS=2, so a freshly
 * constructed Poller owes exactly the last two closed 60s windows
 * (plus any window that closes while a test is running — the
 * assertions therefore check "at least" and ordering, not exact
 * counts, to stay clock-safe).
 *
 * tick() is private; tests reach it via element access, which TypeScript
 * permits as the sanctioned escape hatch for testing internals.
 */

const WINDOW_MS: number = 60 * 1000;

interface ShipCall {
  rows: Array<KubernetesCostAllocationIngestRow>;
  costEngine?: KubernetesCostEngineInfo | undefined;
  correction: boolean;
}

class EngineStub {
  public calls: Array<{ windowStart: Date; windowEnd: Date }> = [];
  public failuresRemaining: number = 0;
  public allocationsPerWindow: Array<EngineAllocation> = [
    {
      name: "prod/deployment/api/api-abc/api",
      properties: { namespace: "prod" },
      totalCost: 1,
    },
  ];

  public async fetchAllocations(data: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<EngineAllocation>> {
    this.calls.push(data);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error("engine unavailable");
    }
    return this.allocationsPerWindow;
  }
}

class ShipperStub {
  public calls: Array<ShipCall> = [];
  public failuresRemaining: number = 0;

  public async ship(
    rows: Array<KubernetesCostAllocationIngestRow>,
    costEngine?: KubernetesCostEngineInfo | undefined,
    options?: { correction?: boolean | undefined },
  ): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error("oneuptime unavailable");
    }
    this.calls.push({
      rows,
      costEngine,
      correction: options?.correction === true,
    });
  }
}

class PrometheusStub {
  public calls: number = 0;
  public peaks: Map<string, number> = new Map<string, number>();
  public throwOnCall: boolean = false;

  public async fetchMemoryPeaks(): Promise<Map<string, number>> {
    this.calls++;
    if (this.throwOnCall) {
      /*
       * The real client never throws — it answers with an empty map on any
       * failure. Throwing here proves the poller does not depend on that
       * politeness, since a throw would block the checkpoint and stall
       * spend collection over an enrichment.
       */
      throw new Error("prometheus unavailable");
    }
    return this.peaks;
  }
}

function makePoller(
  engine: EngineStub,
  shipper: ShipperStub,
  prometheus?: PrometheusStub,
): { poller: Poller; tick: () => Promise<void> } {
  const poller: Poller = new Poller(
    engine as unknown as CostEngineClient,
    shipper as unknown as Shipper,
    prometheus as unknown as PrometheusClient,
  );
  const tick: () => Promise<void> = (): Promise<void> => {
    return (poller as unknown as { tick: () => Promise<void> })["tick"]();
  };
  return { poller, tick };
}

test("ships the lookback windows oldest-first and advances the checkpoint", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { tick } = makePoller(engine, shipper);

  const latestClosedBefore: number = floorToWindow(Date.now(), 60);

  await tick();

  // At least the two lookback windows were queried and shipped.
  assert.ok(engine.calls.length >= 2);
  assert.strictEqual(shipper.calls.length, engine.calls.length);

  // Windows are contiguous, hourly-grid-aligned, and strictly ascending.
  for (let i: number = 0; i < engine.calls.length; i++) {
    const call: { windowStart: Date; windowEnd: Date } = engine.calls[i]!;
    assert.strictEqual(
      call.windowEnd.getTime() - call.windowStart.getTime(),
      WINDOW_MS,
    );
    assert.strictEqual(call.windowStart.getTime() % WINDOW_MS, 0);
    if (i > 0) {
      assert.strictEqual(
        call.windowStart.getTime(),
        engine.calls[i - 1]!.windowEnd.getTime(),
      );
    }
  }

  // First shipped window is the start of the lookback.
  assert.strictEqual(
    engine.calls[0]!.windowStart.getTime(),
    latestClosedBefore - 2 * WINDOW_MS,
  );

  // A second tick with no newly closed window ships nothing new.
  const callsAfterFirstTick: number = engine.calls.length;
  await tick();
  assert.ok(engine.calls.length - callsAfterFirstTick <= 1);
});

test("an engine failure keeps the checkpoint so the window retries next tick", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.failuresRemaining = 1;
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  await tick();

  // The failing window was attempted, nothing shipped, error surfaced.
  assert.strictEqual(shipper.calls.length, 0);
  assert.match(poller.lastError() || "", /engine unavailable/);
  const failedWindowStart: number = engine.calls[0]!.windowStart.getTime();

  // Next tick retries the SAME window and proceeds through the backlog.
  await tick();
  assert.strictEqual(engine.calls[1]!.windowStart.getTime(), failedWindowStart);
  assert.ok(shipper.calls.length >= 2);
  assert.strictEqual(poller.lastError(), null);
});

test("a ship failure keeps the checkpoint so nothing is skipped", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  shipper.failuresRemaining = 1;
  const { poller, tick } = makePoller(engine, shipper);

  await tick();
  assert.match(poller.lastError() || "", /oneuptime unavailable/);
  const failedWindowStart: number = engine.calls[0]!.windowStart.getTime();

  await tick();
  // Retried from the same window; backlog then drains in order.
  const retriedWindowStart: number = engine.calls[1]!.windowStart.getTime();
  assert.strictEqual(retriedWindowStart, failedWindowStart);
  assert.ok(shipper.calls.length >= 2);
});

test("empty windows advance the checkpoint without shipping", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.allocationsPerWindow = [];
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  await tick();

  assert.ok(engine.calls.length >= 2);
  assert.strictEqual(shipper.calls.length, 0);
  assert.strictEqual(poller.lastError(), null);

  // Checkpoint advanced past the drained backlog: another tick is ~idle.
  const callsAfterFirstTick: number = engine.calls.length;
  await tick();
  assert.ok(engine.calls.length - callsAfterFirstTick <= 1);
});

test("shipped rows carry the mapped allocation fields", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.allocationsPerWindow = [
    {
      name: "prod/deployment/api/api-abc/api",
      properties: {
        namespace: "prod",
        controllerKind: "deployment",
        controller: "api",
        pod: "api-abc",
        container: "api",
        node: "node-1",
      },
      cpuCost: 0.5,
      cpuCostAdjustment: -0.1,
      totalCost: 0.9,
    },
  ];
  const shipper: ShipperStub = new ShipperStub();
  const { tick } = makePoller(engine, shipper);

  await tick();

  assert.ok(shipper.calls.length >= 1);
  const row: KubernetesCostAllocationIngestRow = shipper.calls[0]!.rows[0]!;
  assert.strictEqual(row.namespace, "prod");
  assert.strictEqual(row.controllerKind, "deployment");
  assert.strictEqual(row.controllerName, "api");
  assert.strictEqual(row.podName, "api-abc");
  assert.ok(Math.abs((row.cpuCost || 0) - 0.4) < 1e-9);
  assert.strictEqual(row.totalCost, 0.9);
  // The requested window is stamped when the engine reports none.
  assert.strictEqual(new Date(row.windowStart).getTime() % WINDOW_MS, 0);
});

test("stop() prevents further ticks from doing work", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  poller.stop();
  await tick();

  assert.strictEqual(engine.calls.length, 0);
  assert.strictEqual(shipper.calls.length, 0);
});

/*
 * Progress bookkeeping. These are the facts Health.ts renders its verdict
 * from, so what matters is that a stalled poller cannot look like a quiet
 * one: failures accumulate, and lastWindowCompletedAtMs stays at 0 for as
 * long as no window drains.
 */

test("a completed window records progress even when it shipped nothing", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.allocationsPerWindow = []; // Fresh install: the lookback is empty.
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  const before: PollerStatus = poller.status();
  assert.strictEqual(before.lastWindowCompletedAtMs, 0);
  assert.strictEqual(before.windowsCompleted, 0);
  assert.ok(before.startedAtMs > 0);

  await tick();

  const after: PollerStatus = poller.status();
  assert.ok(after.windowsCompleted >= 2);
  assert.ok(after.lastWindowCompletedAtMs >= before.startedAtMs);
  assert.strictEqual(after.consecutivePollFailures, 0);
  assert.strictEqual(shipper.calls.length, 0);
});

test("consecutive engine failures accumulate and record no progress", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.failuresRemaining = 3;
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  await tick();
  assert.strictEqual(poller.status().consecutivePollFailures, 1);
  await tick();
  assert.strictEqual(poller.status().consecutivePollFailures, 2);
  await tick();

  const stalled: PollerStatus = poller.status();
  assert.strictEqual(stalled.consecutivePollFailures, 3);
  // The stalled poller has nothing to show for three ticks.
  assert.strictEqual(stalled.lastWindowCompletedAtMs, 0);
  assert.strictEqual(stalled.windowsCompleted, 0);
  assert.match(stalled.lastPollError || "", /engine unavailable/);
});

test("a clean tick clears the failure streak", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.failuresRemaining = 2;
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  await tick();
  await tick();
  assert.strictEqual(poller.status().consecutivePollFailures, 2);

  await tick(); // Engine recovers and the backlog drains.

  const recovered: PollerStatus = poller.status();
  assert.strictEqual(recovered.consecutivePollFailures, 0);
  assert.strictEqual(recovered.lastPollError, null);
  assert.ok(recovered.windowsCompleted >= 2);
});

test("a ship failure counts as a failed tick, not as progress", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  shipper.failuresRemaining = 1;
  const { poller, tick } = makePoller(engine, shipper);

  await tick();

  const status: PollerStatus = poller.status();
  assert.strictEqual(status.consecutivePollFailures, 1);
  // The window it failed on never completed, so nothing is recorded.
  assert.strictEqual(status.windowsCompleted, 0);
  assert.strictEqual(status.lastWindowCompletedAtMs, 0);
});

test("an idle tick with no closed window keeps the streak at zero", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  await tick(); // Drains the backlog.
  const drained: number = poller.status().windowsCompleted;

  await tick(); // Nothing due (or at most one newly closed window).

  const idle: PollerStatus = poller.status();
  assert.strictEqual(idle.consecutivePollFailures, 0);
  assert.ok(idle.windowsCompleted - drained <= 1);
});

test("stamps shipped rows with the memory peaks Prometheus reported", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  engine.allocationsPerWindow = [
    {
      name: "prod/deployment/api/api-abc/api",
      properties: { namespace: "prod", pod: "api-abc", container: "api" },
      totalCost: 1,
    },
  ];

  const shipper: ShipperStub = new ShipperStub();
  const prometheus: PrometheusStub = new PrometheusStub();
  prometheus.peaks = new Map<string, number>([
    [
      peakKey({ namespace: "prod", podName: "api-abc", containerName: "api" }),
      734003200,
    ],
  ]);

  const { tick } = makePoller(engine, shipper, prometheus);
  await tick();

  assert.ok(shipper.calls.length > 0);
  const row: KubernetesCostAllocationIngestRow = shipper.calls[0]!.rows[0]!;
  assert.strictEqual(row.ramBytesUsageMax, 734003200);
});

/*
 * Peaks are an enrichment on top of spend. If Prometheus being down could
 * block a window, an unrelated outage would stop cost collection entirely —
 * the same stall failure mode the engine-settle logic exists to avoid.
 */
test("a prometheus failure does not stop the window from shipping", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const prometheus: PrometheusStub = new PrometheusStub();
  prometheus.throwOnCall = true;

  const { poller, tick } = makePoller(engine, shipper, prometheus);
  await tick();

  assert.ok(prometheus.calls > 0);
  assert.ok(shipper.calls.length > 0);
  const row: KubernetesCostAllocationIngestRow = shipper.calls[0]!.rows[0]!;
  assert.strictEqual(row.ramBytesUsageMax, undefined);

  // And the checkpoint still advanced, so the window is not retried forever.
  const status: PollerStatus = poller.status();
  assert.ok(status.windowsCompleted > 0);
  assert.strictEqual(status.lastPollError, null);
});

/*
 * #9633 / #9634: the engine the poller read the window from says which it
 * is and where its prices come from, and the shipment carries that.
 */
test("ships what the engine says about itself with each window", async (): Promise<void> => {
  const engine: EngineStub & { describe: () => KubernetesCostEngineInfo } =
    Object.assign(new EngineStub(), {
      describe: (): KubernetesCostEngineInfo => {
        return {
          engine: "OpenCost",
          service: "",
          bundledEngineUnused: false,
          pricingSource: "default-rates",
          pricingProvider: "",
        };
      },
    });
  const shipper: ShipperStub = new ShipperStub();
  const { tick } = makePoller(engine, shipper);

  await tick();

  assert.ok(shipper.calls.length > 0);
  for (const call of shipper.calls) {
    assert.strictEqual(call.costEngine?.pricingSource, "default-rates");
    assert.strictEqual(call.costEngine?.engine, "OpenCost");
  }
});

/*
 * #9970: each shipment says where its memory peaks come from, so the page
 * that advises stopping the bundled engine says when that stops them too.
 */
const KUBECOST3_DESCRIBED: KubernetesCostEngineInfo = {
  engine: "Kubecost",
  service: "kubecost/kubecost-frontend",
  bundledEngineUnused: true,
  pricingSource: "default-rates",
  pricingProvider: "",
};

test("ships where the memory peaks come from beside what the engine says", async (): Promise<void> => {
  const engine: EngineStub & { describe: () => KubernetesCostEngineInfo } =
    Object.assign(new EngineStub(), {
      describe: (): KubernetesCostEngineInfo => {
        return { ...KUBECOST3_DESCRIBED };
      },
    });
  const shipper: ShipperStub = new ShipperStub();
  const prometheus: PrometheusStub & {
    memoryPeaksFrom: () => KubernetesCostMemoryPeaksSource;
  } = Object.assign(new PrometheusStub(), {
    memoryPeaksFrom: (): KubernetesCostMemoryPeaksSource => {
      return "bundled";
    },
  });
  const { tick } = makePoller(engine, shipper, prometheus);

  await tick();

  assert.ok(shipper.calls.length > 0);
  for (const call of shipper.calls) {
    assert.strictEqual(call.costEngine?.memoryPeaksFrom, "bundled");
    // What the engine said stands beside it.
    assert.strictEqual(call.costEngine?.bundledEngineUnused, true);
    assert.strictEqual(call.costEngine?.service, "kubecost/kubecost-frontend");
  }
});

test("a Prometheus client that cannot say where its peaks come from ships none named", async (): Promise<void> => {
  const engine: EngineStub & { describe: () => KubernetesCostEngineInfo } =
    Object.assign(new EngineStub(), {
      describe: (): KubernetesCostEngineInfo => {
        return { ...KUBECOST3_DESCRIBED };
      },
    });
  const shipper: ShipperStub = new ShipperStub();
  const { tick } = makePoller(engine, shipper, new PrometheusStub());

  await tick();

  assert.ok(shipper.calls.length > 0);
  assert.strictEqual(shipper.calls[0]!.costEngine?.memoryPeaksFrom, "");
});

test("an engine that says nothing about itself ships rows as before", async (): Promise<void> => {
  const engine: EngineStub = new EngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { tick } = makePoller(engine, shipper);

  await tick();

  assert.ok(shipper.calls.length > 0);
  assert.strictEqual(shipper.calls[0]!.costEngine, undefined);
});

/*
 * A Kubecost answers from what its aggregator has collected, in batches
 * behind the clock: on kind, an hour read two minutes after it closed was
 * there up to its first twenty minutes. A window whose rows do not reach its
 * end yet is read again at a later tick rather than shipped, since an hour
 * is shipped only once.
 */
class CollectingEngineStub extends EngineStub {
  // How far the engine has data (ms): the rows of a later window stop here.
  public collectedThroughMs: number = 0;
  public judged: Array<Date> = [];

  public async isWindowComplete(data: {
    windowStart: Date;
    windowEnd: Date;
    allocations: Array<EngineAllocation>;
  }): Promise<boolean> {
    this.judged.push(data.windowEnd);
    return data.windowEnd.getTime() <= this.collectedThroughMs;
  }
}

test("a window the engine has not collected all of is read again later, unshipped, and is no failure", async (): Promise<void> => {
  const engine: CollectingEngineStub = new CollectingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  // Collected through the first owed window only.
  const latestClosed: number = floorToWindow(Date.now(), 60);
  engine.collectedThroughMs = latestClosed - WINDOW_MS;

  await tick();

  // The first window shipped; the next was read, judged partial, and kept.
  const shippedBefore: number = shipper.calls.length;
  assert.ok(shippedBefore >= 1);
  assert.ok(
    engine.judged.some((windowEnd: Date): boolean => {
      return windowEnd.getTime() > engine.collectedThroughMs;
    }),
  );
  assert.strictEqual(poller.status().consecutivePollFailures, 0);
  assert.strictEqual(poller.status().lastPollError, null);

  // The aggregator catches up: the window is read again, and ships whole.
  engine.collectedThroughMs = Date.now() + WINDOW_MS;
  await tick();

  assert.ok(shipper.calls.length > shippedBefore);
  // The waiting window was read twice, and every window shipped once.
  const ends: Array<number> = engine.calls.map(
    (call: { windowStart: Date; windowEnd: Date }): number => {
      return call.windowEnd.getTime();
    },
  );
  assert.ok(ends.length > shipper.calls.length);
  assert.deepStrictEqual(ends, [...ends].sort());
});

test("a window not collected at all ships nothing and completes nothing", async (): Promise<void> => {
  const engine: CollectingEngineStub = new CollectingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick } = makePoller(engine, shipper);

  engine.collectedThroughMs = 0;
  await tick();
  await tick();

  // Read each tick, shipped never.
  assert.strictEqual(engine.calls.length, 2);
  assert.strictEqual(shipper.calls.length, 0);
  assert.strictEqual(poller.status().consecutivePollFailures, 0);
  assert.strictEqual(poller.status().windowsCompleted, 0);
});

/*
 * #9969: a Kubecost that reads the cloud's bill reconciles each hour with it
 * about two days on, after the hour shipped. The poller reads such an hour
 * again at the schedule's ages, and ships a reading that changed as a
 * correction. Here the schedule reads each hour again ten minutes after it
 * closed, on a clock the tests move ahead.
 */
const KUBECOST_URL: string = "http://kubecost-cost-analyzer.kubecost.svc:9090";
const READ_AGAIN_AFTER_MS: number = 10 * 60 * 1000;

class ReconcilingEngineStub extends EngineStub {
  public pricingSource: KubernetesCostEngineInfo["pricingSource"] =
    "billing-integration";
  // What a later reading answers, per window start (ms); by default, cost 2.
  public later: Map<number, CorrectionReading> = new Map<
    number,
    CorrectionReading
  >();
  // What every other later reading answers, when set.
  public everyOtherReading: CorrectionReading | null = null;
  public rereads: Array<{ windowStart: Date; engineUrl: string }> = [];

  public describe(): KubernetesCostEngineInfo {
    return {
      engine: "Kubecost",
      service: "kubecost/kubecost-cost-analyzer",
      bundledEngineUnused: true,
      pricingSource: this.pricingSource,
      pricingProvider: "AWS",
    };
  }

  public engineUrl(): string {
    return KUBECOST_URL;
  }

  public async rereadAllocations(data: {
    windowStart: Date;
    windowEnd: Date;
    engineUrl: string;
  }): Promise<CorrectionReading> {
    this.rereads.push({
      windowStart: data.windowStart,
      engineUrl: data.engineUrl,
    });

    return (
      this.later.get(data.windowStart.getTime()) ||
      this.everyOtherReading || {
        status: "read",
        allocations: [{ ...this.allocationsPerWindow[0]!, totalCost: 2 }],
      }
    );
  }
}

function makeCorrectingPoller(
  engine: EngineStub,
  shipper: ShipperStub,
): {
  poller: Poller;
  tick: () => Promise<void>;
  corrections: CorrectionSchedule;
  later: (ms: number) => void;
} {
  let aheadMs: number = 0;
  const corrections: CorrectionSchedule = new CorrectionSchedule({
    readAgesMs: [READ_AGAIN_AFTER_MS],
    // Every window owed a reading is read in one tick here.
    readsPerTick: 100,
    now: (): number => {
      return Date.now() + aheadMs;
    },
  });
  const poller: Poller = new Poller(
    engine as unknown as CostEngineClient,
    shipper as unknown as Shipper,
    undefined,
    corrections,
  );
  const tick: () => Promise<void> = (): Promise<void> => {
    return (poller as unknown as { tick: () => Promise<void> })["tick"]();
  };
  return {
    poller,
    tick,
    corrections,
    later: (ms: number): void => {
      aheadMs = ms;
    },
  };
}

const firstReadings: (shipper: ShipperStub) => Array<ShipCall> = (
  shipper: ShipperStub,
): Array<ShipCall> => {
  return shipper.calls.filter((call: ShipCall): boolean => {
    return !call.correction;
  });
};

const correctionsOf: (shipper: ShipperStub) => Array<ShipCall> = (
  shipper: ShipperStub,
): Array<ShipCall> => {
  return shipper.calls.filter((call: ShipCall): boolean => {
    return call.correction;
  });
};

test("an hour a Kubecost reconciles is read again, and a reading that changed ships as a correction", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick, later } = makeCorrectingPoller(engine, shipper);

  await tick();

  const shipped: number = firstReadings(shipper).length;
  assert.ok(shipped >= 2);
  // Not before its age.
  assert.deepStrictEqual(correctionsOf(shipper), []);

  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  await tick();

  const corrections: Array<ShipCall> = correctionsOf(shipper);
  assert.ok(corrections.length >= shipped);
  for (const correction of corrections) {
    assert.strictEqual(correction.rows.length, 1);
    assert.strictEqual(correction.rows[0]!.totalCost, 2);
    // It says who priced it, as a first reading does.
    assert.strictEqual(
      correction.costEngine?.pricingSource,
      "billing-integration",
    );
  }
  // Every later reading asked the Kubecost that priced the hour.
  for (const reread of engine.rereads) {
    assert.strictEqual(reread.engineUrl, KUBECOST_URL);
  }

  const status: PollerStatus = poller.status();
  assert.ok((status.corrections?.windowsCorrected || 0) >= shipped);
  assert.strictEqual(status.corrections?.lastCorrectionError, null);
  // An extra on hours already shipped: the poll itself is untouched.
  assert.strictEqual(status.consecutivePollFailures, 0);
  assert.strictEqual(status.lastPollError, null);
});

test("a later reading that matches what was shipped is not sent again", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { tick, later, corrections } = makeCorrectingPoller(engine, shipper);

  await tick();

  for (const call of firstReadings(shipper)) {
    engine.later.set(Date.parse(call.rows[0]!.windowStart), {
      status: "read",
      allocations: [...engine.allocationsPerWindow],
    });
  }

  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  await tick();

  const readAgain: Set<number> = new Set<number>(
    engine.rereads.map((reread: { windowStart: Date }): number => {
      return reread.windowStart.getTime();
    }),
  );

  /*
   * The shipped hours were read again, matched, and only the seeded hours
   * (whose first reading this process never saw) went out.
   */
  for (const call of firstReadings(shipper)) {
    assert.ok(readAgain.has(Date.parse(call.rows[0]!.windowStart)));
  }
  for (const correction of correctionsOf(shipper)) {
    assert.ok(!engine.later.has(Date.parse(correction.rows[0]!.windowStart)));
  }
  // Read at their one age, then forgotten.
  for (const call of firstReadings(shipper)) {
    assert.strictEqual(
      corrections.get(Date.parse(call.rows[0]!.windowStart)),
      undefined,
    );
  }
});

test("an hour the engine cannot give again now is asked again at the next tick", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick, later } = makeCorrectingPoller(engine, shipper);

  await tick();
  const hour: number = Date.parse(
    firstReadings(shipper)[0]!.rows[0]!.windowStart,
  );

  // The Kubecost is away for a moment.
  engine.everyOtherReading = { status: "unavailable", reason: "HTTP 502" };
  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  await tick();

  assert.deepStrictEqual(correctionsOf(shipper), []);
  assert.strictEqual(
    poller.status().corrections?.lastCorrectionError,
    "HTTP 502",
  );
  assert.strictEqual(poller.status().consecutivePollFailures, 0);

  // Back: the hours are read again, and the corrections go out.
  engine.everyOtherReading = null;
  await tick();

  assert.ok(
    correctionsOf(shipper).some((call: ShipCall): boolean => {
      return Date.parse(call.rows[0]!.windowStart) === hour;
    }),
  );
  assert.strictEqual(poller.status().corrections?.lastCorrectionError, null);
});

test("a reading the engine cannot give whole keeps the hour as shipped, and is not asked for again", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { tick, later } = makeCorrectingPoller(engine, shipper);

  await tick();
  const hour: number = Date.parse(
    firstReadings(shipper)[0]!.rows[0]!.windowStart,
  );

  engine.later.set(hour, {
    status: "nothing",
    reason: "the engine has nothing for the window",
  });
  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  await tick();
  await tick();

  const askedForHour: number = engine.rereads.filter(
    (reread: { windowStart: Date }): boolean => {
      return reread.windowStart.getTime() === hour;
    },
  ).length;

  assert.strictEqual(askedForHour, 1);
  assert.ok(
    !correctionsOf(shipper).some((call: ShipCall): boolean => {
      return Date.parse(call.rows[0]!.windowStart) === hour;
    }),
  );
});

test("a correction OneUptime does not take is sent again at the next tick, and never fails the poll", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick, later } = makeCorrectingPoller(engine, shipper);

  await tick();
  const shipped: number = firstReadings(shipper).length;

  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  shipper.failuresRemaining = 1;
  await tick();

  assert.match(
    poller.status().corrections?.lastCorrectionError || "",
    /oneuptime unavailable/,
  );
  assert.strictEqual(poller.status().consecutivePollFailures, 0);
  assert.strictEqual(poller.status().lastPollError, null);

  await tick();

  assert.ok(correctionsOf(shipper).length >= shipped);
  assert.strictEqual(poller.status().corrections?.lastCorrectionError, null);
});

test("an hour priced by an engine that does not reconcile is never read again", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  engine.pricingSource = "list-prices";
  const shipper: ShipperStub = new ShipperStub();
  const { poller, tick, later, corrections } = makeCorrectingPoller(
    engine,
    shipper,
  );

  await tick();
  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  await tick();

  assert.deepStrictEqual(engine.rereads, []);
  assert.deepStrictEqual(correctionsOf(shipper), []);
  assert.strictEqual(corrections.size(), 0);
  // And /healthz says nothing of corrections.
  assert.strictEqual(poller.status().corrections, undefined);
});

test("an engine that cannot read a window again is never asked to", async (): Promise<void> => {
  const engine: EngineStub & {
    describe: () => KubernetesCostEngineInfo;
    engineUrl: () => string;
  } = Object.assign(new EngineStub(), {
    describe: (): KubernetesCostEngineInfo => {
      return {
        engine: "Kubecost",
        service: "",
        bundledEngineUnused: false,
        pricingSource: "billing-integration",
        pricingProvider: "AWS",
      };
    },
    engineUrl: (): string => {
      return KUBECOST_URL;
    },
  });
  const shipper: ShipperStub = new ShipperStub();
  const { tick, later, corrections } = makeCorrectingPoller(engine, shipper);

  await tick();
  later(READ_AGAIN_AFTER_MS + WINDOW_MS);
  await tick();

  assert.strictEqual(corrections.size(), 0);
  assert.deepStrictEqual(correctionsOf(shipper), []);
});

test("the first hour from a Kubecost that reads the bill brings in the hours a previous process shipped", async (): Promise<void> => {
  const engine: ReconcilingEngineStub = new ReconcilingEngineStub();
  const shipper: ShipperStub = new ShipperStub();
  const { tick, corrections } = makeCorrectingPoller(engine, shipper);

  await tick();

  const firstShippedStart: number = Math.min(
    ...firstReadings(shipper).map((call: ShipCall): number => {
      return Date.parse(call.rows[0]!.windowStart);
    }),
  );

  /*
   * The windows before this process's first, back to the last age, each
   * without a fingerprint: every later reading of them is sent.
   */
  const seeded: CorrectionWindow | undefined = corrections.get(
    firstShippedStart - WINDOW_MS,
  );
  assert.ok(seeded);
  assert.strictEqual(seeded!.fingerprint, null);
  assert.strictEqual(seeded!.engineUrl, KUBECOST_URL);

  // And this process's own windows keep what they shipped.
  assert.ok(corrections.get(firstShippedStart)?.fingerprint);
  assert.ok(corrections.size() > firstReadings(shipper).length);
});
