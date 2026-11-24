import { KeyedConcurrencyRefusal } from "../../../../Server/Utils/KeyedConcurrencyLimiter";
import {
  PROBE_SCHEDULING_METRICS_KEY,
  PUBLISH_EVERY_MS,
  ProbeSchedulingFleetClient,
  ProbeSchedulingFleetMetrics,
  ProbeSchedulingFleetView,
  STALE_AFTER_MS,
  aggregateProbeScheduling,
} from "../../../../Server/Utils/Probe/ProbeSchedulingFleetMetrics";
import ProbeSchedulingLane from "../../../../Server/Utils/Probe/ProbeSchedulingLane";
import {
  ProbeSchedulingMetrics,
  ProbeSchedulingMetricsSnapshot,
} from "../../../../Server/Utils/Probe/ProbeSchedulingMetrics";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * /metrics/probe-scheduling answers for every App replica from whichever
 * one is asked (issue #10819): each replica writes its own view into one
 * Valkey hash, and a read adds up the fresh ones - queue depths, slots and
 * counts summed, waits and lateness the worst replica's - with the reading
 * replica's own taken live, a stopped replica dropped, a garbled entry
 * ignored, and with Valkey unreachable this replica's view alone.
 */

jest.mock("../../../../Server/Utils/Logger");

// An in-memory hash, as the Valkey client answers.
class FakeValkey implements ProbeSchedulingFleetClient {
  public hashes: Map<string, Map<string, string>> = new Map<
    string,
    Map<string, string>
  >();
  public expiries: Map<string, number> = new Map<string, number>();
  public failing: boolean = false;

  private hash(key: string): Map<string, string> {
    if (this.failing) {
      throw new Error("Valkey is unreachable");
    }
    let hash: Map<string, string> | undefined = this.hashes.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }
    return hash;
  }

  public async hset(key: string, field: string, value: string): Promise<number> {
    this.hash(key).set(field, value);
    return 1;
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hash(key).entries());
  }

  public async hdel(key: string, ...fields: Array<string>): Promise<number> {
    for (const field of fields) {
      this.hash(key).delete(field);
    }
    return fields.length;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.expiries.set(key, seconds);
    return 1;
  }
}

function clockAt(startMs: number): {
  now: () => number;
  move: (ms: number) => void;
} {
  let current: number = startMs;
  return {
    now: (): number => {
      return current;
    },
    move: (ms: number): void => {
      current += ms;
    },
  };
}

// A replica busy to the given degree: what it would write.
function replicaView(data: {
  replica: string;
  at: number;
  waiting: number;
  running: number;
  slotWaitP95Ms: number;
  refused: number;
  testsWaiting?: number;
  testsRefused?: number;
  handedOut: number;
  lagP95Seconds: number;
  lagMaxSeconds: number;
  lateByAnInterval: number;
  testWaitMaxSeconds: number;
}): ProbeSchedulingMetricsSnapshot {
  const summary: (
    p95: number,
    max: number,
    count: number,
  ) => ProbeSchedulingMetricsSnapshot["dispatchLagSeconds"] = (
    p95: number,
    max: number,
    count: number,
  ): ProbeSchedulingMetricsSnapshot["dispatchLagSeconds"] => {
    return { count, mean: p95 / 2, p50: p95 / 2, p95, p99: max, max };
  };

  return {
    replica: data.replica,
    at: data.at,
    windowSeconds: 60,
    lanes: {
      [ProbeSchedulingLane.Work]: {
        running: data.running,
        waiting: data.waiting,
        maxConcurrentRequests: 10,
        slotWaitMs: summary(data.slotWaitP95Ms, data.slotWaitP95Ms * 2, 100),
        refused: data.refused,
        refusedQueueFull: data.refused,
        refusedWaitedTooLong: 0,
      },
      [ProbeSchedulingLane.MonitorTests]: {
        running: 0,
        waiting: data.testsWaiting || 0,
        maxConcurrentRequests: 2,
        slotWaitMs: summary(0, 0, 0),
        refused: data.testsRefused || 0,
        refusedQueueFull: 0,
        refusedWaitedTooLong: data.testsRefused || 0,
      },
    },
    monitorsHandedOut: data.handedOut,
    dispatchLagSeconds: summary(
      data.lagP95Seconds,
      data.lagMaxSeconds,
      data.handedOut,
    ),
    monitorsLateByAnInterval: data.lateByAnInterval,
    monitorTestsHandedOut: 3,
    monitorTestWaitSeconds: summary(
      data.testWaitMaxSeconds / 2,
      data.testWaitMaxSeconds,
      3,
    ),
  };
}

describe("aggregateProbeScheduling", () => {
  test("sums queues, slots and counts; takes the worst replica's waits and lateness", () => {
    const view: ProbeSchedulingFleetView = aggregateProbeScheduling(
      [
        replicaView({
          replica: "a",
          at: 0,
          waiting: 12,
          running: 10,
          slotWaitP95Ms: 900,
          refused: 4,
          testsWaiting: 1,
          testsRefused: 1,
          handedOut: 6000,
          lagP95Seconds: 8,
          lagMaxSeconds: 20,
          lateByAnInterval: 0,
          testWaitMaxSeconds: 4,
        }),
        replicaView({
          replica: "b",
          at: 0,
          waiting: 3,
          running: 9,
          slotWaitP95Ms: 2500,
          refused: 0,
          handedOut: 5500,
          lagP95Seconds: 31,
          lagMaxSeconds: 75,
          lateByAnInterval: 120,
          testWaitMaxSeconds: 9,
        }),
      ],
      true,
    );

    expect(view).toMatchObject({
      replicasReporting: 2,
      fleetWide: true,
      windowSeconds: 60,
      queueDepth: 15,
      running: 19,
      slots: 20,
      slotWaitP95Ms: 2500,
      slotWaitMaxMs: 5000,
      refusalsPerMinute: 5,
      monitorTestQueueDepth: 1,
      monitorTestSlots: 4,
      monitorTestRefusalsPerMinute: 1,
      monitorsHandedOutPerMinute: 11500,
      dispatchLagP95Seconds: 31,
      dispatchLagMaxSeconds: 75,
      monitorsLateByAnIntervalPerMinute: 120,
      monitorTestsHandedOutPerMinute: 6,
      monitorTestWaitMaxSeconds: 9,
    });
    // The busiest replica first, and none of them named.
    expect(
      view.replicas.map((replica: { queueDepth: number }): number => {
        return replica.queueDepth;
      }),
    ).toEqual([12, 3]);
    expect(JSON.stringify(view)).not.toContain('"a"');
    expect(JSON.stringify(view.replicas)).not.toContain("replica");
  });

  test("no replica at all is an idle fleet", () => {
    expect(aggregateProbeScheduling([], true)).toMatchObject({
      replicasReporting: 0,
      queueDepth: 0,
      refusalsPerMinute: 0,
      dispatchLagP95Seconds: 0,
      replicas: [],
    });
  });
});

describe("ProbeSchedulingFleetMetrics", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a replica writes its view into the shared hash, kept for a few minutes", async () => {
    const valkey: FakeValkey = new FakeValkey();
    const metrics: ProbeSchedulingMetrics = new ProbeSchedulingMetrics({
      replica: "app-7:42",
      now: clockAt(1_000).now,
    });
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      metrics,
      (): ProbeSchedulingFleetClient => {
        return valkey;
      },
    );

    await fleet.publish();

    const written: string | undefined = valkey.hashes
      .get(PROBE_SCHEDULING_METRICS_KEY)
      ?.get("app-7:42");
    expect(JSON.parse(written!)).toMatchObject({ replica: "app-7:42", at: 1_000 });
    expect(valkey.expiries.get(PROBE_SCHEDULING_METRICS_KEY)).toBe(300);
  });

  test("a read adds up the fresh views of every replica, with its own taken live", async () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(1_000_000);
    const valkey: FakeValkey = new FakeValkey();
    const metrics: ProbeSchedulingMetrics = new ProbeSchedulingMetrics({
      replica: "self",
      now: clock.now,
    });
    metrics.observe(() => {
      return { running: 10, waiting: 5, maxConcurrentRequests: 10 };
    });
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      metrics,
      (): ProbeSchedulingFleetClient => {
        return valkey;
      },
      clock.now,
    );

    // What this replica wrote a while ago is replaced by its live view.
    await valkey.hset(
      PROBE_SCHEDULING_METRICS_KEY,
      "self",
      JSON.stringify(
        replicaView({
          replica: "self",
          at: clock.now() - 20_000,
          waiting: 99,
          running: 10,
          slotWaitP95Ms: 0,
          refused: 0,
          handedOut: 0,
          lagP95Seconds: 0,
          lagMaxSeconds: 0,
          lateByAnInterval: 0,
          testWaitMaxSeconds: 0,
        }),
      ),
    );
    await valkey.hset(
      PROBE_SCHEDULING_METRICS_KEY,
      "other",
      JSON.stringify(
        replicaView({
          replica: "other",
          at: clock.now() - 5_000,
          waiting: 7,
          running: 10,
          slotWaitP95Ms: 1200,
          refused: 2,
          handedOut: 3000,
          lagP95Seconds: 12,
          lagMaxSeconds: 30,
          lateByAnInterval: 0,
          testWaitMaxSeconds: 3,
        }),
      ),
    );

    const view: ProbeSchedulingFleetView = await fleet.read();

    expect(view).toMatchObject({
      replicasReporting: 2,
      fleetWide: true,
      queueDepth: 12,
      slotWaitP95Ms: 1200,
      refusalsPerMinute: 2,
      dispatchLagP95Seconds: 12,
    });
  });

  test("a replica that stopped writing drops out, and its entry is removed", async () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(2_000_000);
    const valkey: FakeValkey = new FakeValkey();
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      new ProbeSchedulingMetrics({ replica: "self", now: clock.now }),
      (): ProbeSchedulingFleetClient => {
        return valkey;
      },
      clock.now,
    );

    await valkey.hset(
      PROBE_SCHEDULING_METRICS_KEY,
      "gone",
      JSON.stringify(
        replicaView({
          replica: "gone",
          at: clock.now() - STALE_AFTER_MS - 1,
          waiting: 50,
          running: 10,
          slotWaitP95Ms: 5000,
          refused: 9,
          handedOut: 1,
          lagP95Seconds: 600,
          lagMaxSeconds: 600,
          lateByAnInterval: 1,
          testWaitMaxSeconds: 60,
        }),
      ),
    );

    const view: ProbeSchedulingFleetView = await fleet.read();

    expect(view).toMatchObject({
      replicasReporting: 1,
      queueDepth: 0,
      dispatchLagP95Seconds: 0,
    });
    expect(
      valkey.hashes.get(PROBE_SCHEDULING_METRICS_KEY)!.has("gone"),
    ).toBe(false);
  });

  test("an entry that is not a replica's view is ignored and removed", async () => {
    const valkey: FakeValkey = new FakeValkey();
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(3_000_000);
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      new ProbeSchedulingMetrics({ replica: "self", now: clock.now }),
      (): ProbeSchedulingFleetClient => {
        return valkey;
      },
      clock.now,
    );

    await valkey.hset(PROBE_SCHEDULING_METRICS_KEY, "garbled", "{not json");
    await valkey.hset(
      PROBE_SCHEDULING_METRICS_KEY,
      "wrong-shape",
      JSON.stringify({ queueDepth: 1000 }),
    );

    const view: ProbeSchedulingFleetView = await fleet.read();
    expect(view.replicasReporting).toBe(1);
    expect(view.queueDepth).toBe(0);
    expect(valkey.hashes.get(PROBE_SCHEDULING_METRICS_KEY)!.size).toBe(0);
  });

  test("with Valkey unreachable, a read is this replica's view alone, and says so", async () => {
    const valkey: FakeValkey = new FakeValkey();
    valkey.failing = true;
    const metrics: ProbeSchedulingMetrics = new ProbeSchedulingMetrics({
      replica: "self",
      now: clockAt(0).now,
    });
    metrics.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.QueueFull,
    );
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      metrics,
      (): ProbeSchedulingFleetClient => {
        return valkey;
      },
    );

    await expect(fleet.publish()).resolves.toBeUndefined();
    expect(await fleet.read()).toMatchObject({
      replicasReporting: 1,
      fleetWide: false,
      refusalsPerMinute: 1,
    });
  });

  test("with no Valkey client at all, the same", async () => {
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      new ProbeSchedulingMetrics({ replica: "self", now: clockAt(0).now }),
      (): null => {
        return null;
      },
    );

    await expect(fleet.publish()).resolves.toBeUndefined();
    expect((await fleet.read()).fleetWide).toBe(false);
  });

  test("publishing starts once, writes at once and every few seconds, and never holds the process", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });

    const valkey: FakeValkey = new FakeValkey();
    const writes: Mock<() => void> = jest.fn();
    const original: FakeValkey["hset"] = valkey.hset.bind(valkey);
    valkey.hset = async (
      key: string,
      field: string,
      value: string,
    ): Promise<number> => {
      writes();
      return await original(key, field, value);
    };
    const fleet: ProbeSchedulingFleetMetrics = new ProbeSchedulingFleetMetrics(
      new ProbeSchedulingMetrics({ replica: "self" }),
      (): ProbeSchedulingFleetClient => {
        return valkey;
      },
    );

    fleet.ensurePublishing();
    fleet.ensurePublishing();
    await Promise.resolve();
    expect(writes).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(PUBLISH_EVERY_MS * 3);
    await Promise.resolve();
    expect(writes).toHaveBeenCalledTimes(4);

    fleet.stopPublishing();
    jest.advanceTimersByTime(PUBLISH_EVERY_MS * 3);
    expect(writes).toHaveBeenCalledTimes(4);
  });
});
