import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import { floorToWindow } from "../AllocationMapper";
import { CostEngineClient } from "../CostEngineClient";
import { Poller } from "../Poller";
import { Shipper } from "../Shipper";
import { EngineAllocation, KubernetesCostAllocationIngestRow } from "../Types";

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

function makePoller(
  engine: EngineStub,
  shipper: ShipperStub,
): { poller: Poller; tick: () => Promise<void> } {
  const poller: Poller = new Poller(
    engine as unknown as CostEngineClient,
    shipper as unknown as Shipper,
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
