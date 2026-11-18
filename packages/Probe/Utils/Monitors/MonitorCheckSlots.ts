/*
 * HOW MANY MONITOR CHECKS THIS PROBE RUNS AT ONCE (OneUptime issue #9488).
 *
 * The probe used to check a batch of monitors and then wait for its next
 * minute: PROBE_MONITORING_WORKERS workers fetched PROBE_MONITOR_FETCH_LIMIT
 * monitors each, once a minute. That was also the most it could check in a
 * minute - 50 with Docker Compose's defaults, 10 with a custom probe's - and
 * a probe with more one-minute monitors than that checked each of them
 * every two minutes or more while every page said they were checked every
 * minute.
 *
 * Now a worker fetches again while it is handed full batches, so the probe
 * checks every monitor that is due, and these slots are what keep that
 * bounded: the probe runs at most `capacity` checks at once, the
 * PROBE_MONITORING_WORKERS batches of PROBE_MONITOR_FETCH_LIMIT it always
 * ran at its busiest. A worker reserves room before it asks for monitors,
 * and each check gives its slot back when it settles, so a worker can ask
 * again while one slow check is still running - one slow monitor holds its
 * own slot, never the whole batch it came in.
 *
 * Waiting workers are served in the order they asked, and a worker that
 * wants a whole batch takes what has come free once there is room for
 * `atLeast` of it: a batch of ten does not wait for the last of ten slow
 * checks before it asks for five more monitors.
 */

interface SlotWaiter {
  want: number;
  atLeast: number;
  resolve: (taken: number) => void;
}

export default class MonitorCheckSlots {
  private readonly capacity: number;
  private inUse: number = 0;
  private readonly waiters: Array<SlotWaiter> = [];

  public constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity) || 1);
  }

  // The most checks that run at once.
  public getCapacity(): number {
    return this.capacity;
  }

  // The checks running now, and the room reserved for monitors being fetched.
  public getInUse(): number {
    return this.inUse;
  }

  public getFree(): number {
    return Math.max(0, this.capacity - this.inUse);
  }

  // Workers waiting for room.
  public getWaiting(): number {
    return this.waiters.length;
  }

  /*
   * Waits for room, then takes up to `want` slots - at least `atLeast` of
   * them, and never more than are free - and says how many it took. Resolves
   * at once when that much is free and nobody asked first.
   */
  public reserve(want: number, atLeast: number = want): Promise<number> {
    const wanted: number = Math.max(1, Math.floor(want) || 1);
    const enough: number = Math.min(
      wanted,
      this.capacity,
      Math.max(1, Math.floor(atLeast) || 1),
    );

    if (this.waiters.length === 0 && this.getFree() >= enough) {
      const taken: number = Math.min(wanted, this.getFree());
      this.inUse += taken;
      return Promise.resolve(taken);
    }

    return new Promise<number>((resolve: (taken: number) => void) => {
      this.waiters.push({ want: wanted, atLeast: enough, resolve: resolve });
    });
  }

  /*
   * Takes `count` slots now, room or not: the server handed out more
   * monitors than were asked for, and every one of them is already claimed,
   * so it is checked. The count comes back down as those checks settle.
   */
  public take(count: number): void {
    const taken: number = Math.max(0, Math.floor(count) || 0);

    this.inUse += taken;
  }

  // Gives `count` slots back, and lets the waiting workers in, first come first.
  public release(count: number): void {
    const released: number = Math.max(0, Math.floor(count) || 0);

    if (released === 0) {
      return;
    }

    this.inUse = Math.max(0, this.inUse - released);

    while (this.waiters.length > 0) {
      const first: SlotWaiter = this.waiters[0]!;

      if (this.getFree() < first.atLeast) {
        return;
      }

      this.waiters.shift();

      const taken: number = Math.min(first.want, this.getFree());
      this.inUse += taken;
      first.resolve(taken);
    }
  }

  /*
   * Test seam: forget every check, and answer every waiting worker with no
   * room, which asks for nothing.
   */
  public reset(): void {
    this.inUse = 0;

    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve(0);
    }
  }
}
