import EntitySource from "../../../Types/Telemetry/EntitySource";
import {
  InventoryLiveness,
  INVENTORY_LIVE_WINDOW_MINUTES,
  INVENTORY_STALE_AFTER_MINUTES,
  getInventoryLivenessState,
} from "../../../Types/Telemetry/InventoryLiveness";

const NOW: Date = new Date("2026-09-07T12:00:00.000Z");

describe("inventory heartbeat classification", () => {
  test.each([
    [-60_000, InventoryLiveness.Live],
    [0, InventoryLiveness.Live],
    [30 * 60_000, InventoryLiveness.Live],
    [31 * 60_000 - 1, InventoryLiveness.Live],
    [31 * 60_000, InventoryLiveness.Recent],
    [31 * 60_000 + 1, InventoryLiveness.Recent],
    [1440 * 60_000, InventoryLiveness.Recent],
    [1441 * 60_000 - 1, InventoryLiveness.Recent],
    [1441 * 60_000, InventoryLiveness.Stale],
    [1441 * 60_000 + 1, InventoryLiveness.Stale],
    [365 * 24 * 60 * 60_000, InventoryLiveness.Stale],
  ])(
    "an age of %s ms has status %s",
    (age: number, status: InventoryLiveness) => {
      expect(
        getInventoryLivenessState({
          source: EntitySource.Discovered,
          lastSeenAt: new Date(NOW.getTime() - age),
          now: NOW,
        }),
      ).toBe(status);
    },
  );

  test.each([undefined, null, "not-a-date", new Date(NaN)])(
    "an absent or invalid discovered heartbeat is never seen (%s)",
    (lastSeenAt: Date | string | undefined | null) => {
      expect(
        getInventoryLivenessState({
          source: EntitySource.Discovered,
          lastSeenAt,
          now: NOW,
        }),
      ).toBe(InventoryLiveness.Never);
    },
  );

  test.each([
    EntitySource.Inventory,
    EntitySource.Manual,
    "unknown",
    undefined,
  ])("%s is never aged as telemetry", (source: string | undefined) => {
    for (const lastSeenAt of [
      undefined,
      null,
      "not-a-date",
      NOW,
      new Date("2000-01-01T00:00:00.000Z"),
    ]) {
      expect(getInventoryLivenessState({ source, lastSeenAt, now: NOW })).toBe(
        InventoryLiveness.NotTracked,
      );
    }
  });

  test("serialized dates and Date objects classify identically", () => {
    for (const minutes of [0, 30, 31, 1440, 1441]) {
      const lastSeenAt: Date = new Date(NOW.getTime() - minutes * 60_000);
      expect(
        getInventoryLivenessState({
          source: EntitySource.Discovered,
          lastSeenAt: lastSeenAt.toISOString(),
          now: NOW,
        }),
      ).toBe(
        getInventoryLivenessState({
          source: EntitySource.Discovered,
          lastSeenAt,
          now: NOW,
        }),
      );
    }
  });

  test("thresholds retain the established inventory badge vocabulary", () => {
    expect(INVENTORY_LIVE_WINDOW_MINUTES).toBe(30);
    expect(INVENTORY_STALE_AFTER_MINUTES).toBe(1440);
    expect(Object.values(InventoryLiveness)).toEqual([
      "live",
      "recent",
      "stale",
      "never",
      "not-tracked",
    ]);
  });
});
