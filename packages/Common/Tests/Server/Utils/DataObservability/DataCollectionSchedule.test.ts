import { describe, expect, test } from "@jest/globals";
import {
  getNextCollectionTime,
  TABLE_HEALTH_COLLECTION_INTERVAL_IN_MINUTES,
} from "../../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";

/*
 * Collections run on a five-minute tick. Each ends a little after its tick, and
 * what it sets as next must still be due at the next one: seconds past it, a
 * store would be collected every other tick, every ten minutes.
 */

describe("the next collection", () => {
  const TICK: number = Date.parse("2026-11-04T12:55:00.000Z");
  const MINUTE: number = 60 * 1000;

  test("a store collected just after a tick is due at the next tick", () => {
    const next: Date = getNextCollectionTime(
      new Date(TICK + 4 * 1000),
      TABLE_HEALTH_COLLECTION_INTERVAL_IN_MINUTES,
    );

    expect(next.getTime()).toBeLessThanOrEqual(TICK + 5 * MINUTE);
  });

  test("a store collected right after a tick is not due again before the next one", () => {
    const next: Date = getNextCollectionTime(
      new Date(TICK + 4 * 1000),
      TABLE_HEALTH_COLLECTION_INTERVAL_IN_MINUTES,
    );

    expect(next.getTime()).toBeGreaterThan(TICK + 3 * MINUTE);
  });

  test("an hourly check started just after a tick is due an hour of ticks later", () => {
    const next: Date = getNextCollectionTime(new Date(TICK + 2 * 1000), 60);

    expect(next.getTime()).toBeLessThanOrEqual(TICK + 60 * MINUTE);
    expect(next.getTime()).toBeGreaterThan(TICK + 55 * MINUTE);
  });
});
