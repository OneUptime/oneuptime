import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import { floorToWindow, peakKey } from "../AllocationMapper";
import { CostEngineClient } from "../CostEngineClient";
import { Poller } from "../Poller";
import { PrometheusClient } from "../PrometheusClient";
import { Shipper } from "../Shipper";
import {
  EngineAllocation,
  KubernetesCostAllocationIngestRow,
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
  ): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error("oneuptime unavailable");
    }
    this.calls.push({ rows });
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
