import { describe, expect, test } from "@jest/globals";
import MonitorCheckSlots from "../../../Utils/Monitors/MonitorCheckSlots";

/*
 * The slots that bound how many monitor checks a probe runs at once
 * (OneUptime issue #9488). A worker reserves room before it asks the server
 * for monitors and each check gives its slot back when it settles, so the
 * probe can keep asking while monitors are due without ever running more
 * checks than PROBE_MONITORING_WORKERS x PROBE_MONITOR_FETCH_LIMIT.
 */

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

// A reservation, and whether it has been answered yet.
function watch(reservation: Promise<number>): {
  taken: () => number | undefined;
} {
  let taken: number | undefined = undefined;

  void reservation.then((value: number) => {
    taken = value;
  });

  return {
    taken: (): number | undefined => {
      return taken;
    },
  };
}

describe("MonitorCheckSlots", () => {
  test("holds at least one slot, whatever it is given", () => {
    expect(new MonitorCheckSlots(0).getCapacity()).toBe(1);
    expect(new MonitorCheckSlots(-5).getCapacity()).toBe(1);
    expect(new MonitorCheckSlots(Number.NaN).getCapacity()).toBe(1);
    expect(new MonitorCheckSlots(7.9).getCapacity()).toBe(7);
    expect(new MonitorCheckSlots(50).getCapacity()).toBe(50);
  });

  test("a reservation with room is answered at once, with what was asked for", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(50);

    await expect(slots.reserve(10, 5)).resolves.toBe(10);
    expect(slots.getInUse()).toBe(10);
    expect(slots.getFree()).toBe(40);
  });

  test("with less room than a batch but enough to ask, it takes what is free", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 5);
    slots.release(6);

    // Six free of the ten wanted: enough to ask, so six are taken.
    await expect(slots.reserve(10, 5)).resolves.toBe(6);
    expect(slots.getFree()).toBe(0);
  });

  test("with too little room it waits, and is answered once enough comes free", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 5);

    const waiting: { taken: () => number | undefined } = watch(
      slots.reserve(10, 5),
    );

    await flushMicrotasks();
    expect(waiting.taken()).toBeUndefined();
    expect(slots.getWaiting()).toBe(1);

    // Checks settle one at a time: four free is not yet enough to ask.
    for (let settled: number = 0; settled < 4; settled++) {
      slots.release(1);
    }

    await flushMicrotasks();
    expect(waiting.taken()).toBeUndefined();

    slots.release(1);
    await flushMicrotasks();

    // Five free: the waiting worker asks for those five, not the ten.
    expect(waiting.taken()).toBe(5);
    expect(slots.getWaiting()).toBe(0);
    expect(slots.getInUse()).toBe(10);
  });

  test("one slow check out of a batch does not hold the next request back", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 5);

    const next: { taken: () => number | undefined } = watch(
      slots.reserve(10, 5),
    );

    // Nine of the batch's ten checks settle; the tenth is still running.
    for (let settled: number = 0; settled < 9; settled++) {
      slots.release(1);
    }

    await flushMicrotasks();

    // The next request went out with room for five; four more are free.
    expect(next.taken()).toBe(5);
    expect(slots.getFree()).toBe(4);
  });

  test("waiting workers are answered in the order they asked; a later one never jumps ahead", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 10);

    const first: { taken: () => number | undefined } = watch(
      slots.reserve(10, 8),
    );
    // Would fit in less room, but asked second.
    const second: { taken: () => number | undefined } = watch(
      slots.reserve(2, 2),
    );

    slots.release(3);
    await flushMicrotasks();

    expect(first.taken()).toBeUndefined();
    expect(second.taken()).toBeUndefined();

    slots.release(5);
    await flushMicrotasks();

    expect(first.taken()).toBe(8);
    expect(second.taken()).toBeUndefined();

    slots.release(2);
    await flushMicrotasks();

    expect(second.taken()).toBe(2);
  });

  test("a reservation that does not wait never jumps ahead of workers already waiting", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 10);

    const waiting: { taken: () => number | undefined } = watch(
      slots.reserve(10, 10),
    );

    slots.release(4);

    // Four free would answer this one, but the worker before it waits for ten.
    const later: { taken: () => number | undefined } = watch(
      slots.reserve(4, 4),
    );

    await flushMicrotasks();
    expect(waiting.taken()).toBeUndefined();
    expect(later.taken()).toBeUndefined();

    slots.release(6);
    await flushMicrotasks();
    expect(waiting.taken()).toBe(10);
  });

  test("one release lets in every waiting worker there is room for", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(20);

    await slots.reserve(20, 20);

    const a: { taken: () => number | undefined } = watch(slots.reserve(5, 5));
    const b: { taken: () => number | undefined } = watch(slots.reserve(5, 5));
    const c: { taken: () => number | undefined } = watch(slots.reserve(5, 5));

    slots.release(12);
    await flushMicrotasks();

    expect(a.taken()).toBe(5);
    expect(b.taken()).toBe(5);
    // Two left: not enough for the third.
    expect(c.taken()).toBeUndefined();
    expect(slots.getFree()).toBe(2);
  });

  test("a batch wanted bigger than every slot is answered with every slot", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(5);

    await expect(slots.reserve(10, 10)).resolves.toBe(5);
    expect(slots.getFree()).toBe(0);
  });

  test("more checks than slots, when the server hands out more than it was asked for, are counted and come back", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 5);
    slots.take(5);

    expect(slots.getInUse()).toBe(15);
    expect(slots.getFree()).toBe(0);

    const waiting: { taken: () => number | undefined } = watch(
      slots.reserve(10, 5),
    );

    // Ten settle: five in use, five free - enough to ask again.
    slots.release(10);
    await flushMicrotasks();

    expect(waiting.taken()).toBe(5);
    expect(slots.getInUse()).toBe(10);
  });

  test("counts it cannot use are ignored, and nothing goes below zero", () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    slots.release(3);
    slots.release(-2);
    slots.release(Number.NaN);
    slots.take(-4);
    slots.take(Number.NaN);

    expect(slots.getInUse()).toBe(0);
    expect(slots.getFree()).toBe(10);
  });

  test("reset frees every slot and answers every waiting worker with no room", async () => {
    const slots: MonitorCheckSlots = new MonitorCheckSlots(10);

    await slots.reserve(10, 10);

    const waiting: Promise<number> = slots.reserve(10, 5);

    slots.reset();

    await expect(waiting).resolves.toBe(0);
    expect(slots.getInUse()).toBe(0);
    expect(slots.getWaiting()).toBe(0);
  });
});
