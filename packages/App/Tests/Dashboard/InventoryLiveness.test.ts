import { describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import {
  INVENTORY_LIVE_WINDOW_MINUTES,
  INVENTORY_STALE_AFTER_MINUTES,
  InventoryLiveness,
  InventoryLivenessResult,
  formatMinutesAgo,
  getInventoryLiveness,
  isStaleLiveness,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryLiveness";
import {
  INVENTORY_SOURCE_ORDER,
  getInventoryDeleteCaveat,
  getInventorySourceDescriptor,
  getInventorySourceLabel,
  isDeletePermanentForSource,
  sourceHasLivenessSignal,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySource";

/*
 * The rule these tests defend is the one the old Entities page got wrong by
 * omission: `lastSeenAt` is only a liveness signal where something is bumping
 * it. Discovered rows are bumped on every reconcile; mirrored and manual rows
 * never are. Aging all three the same way paints a stale warning on every
 * network device and every hand-registered vendor API in the project.
 *
 * `now` is injected everywhere, so every boundary below is exact rather than
 * approximately-right-if-the-suite-is-fast.
 */

const NOW: Date = new Date("2026-08-13T12:00:00.000Z");

type MinutesBeforeNowFunction = (minutes: number) => Date;

const minutesBeforeNow: MinutesBeforeNowFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

type ClassifyFunction = (
  source: string | undefined,
  minutesAgo: number,
) => InventoryLiveness;

const classify: ClassifyFunction = (
  source: string | undefined,
  minutesAgo: number,
): InventoryLiveness => {
  return getInventoryLiveness({
    source,
    lastSeenAt: minutesBeforeNow(minutesAgo),
    now: NOW,
  }).liveness;
};

describe("the thresholds themselves", () => {
  test("the live window is shorter than the stale cutoff", () => {
    expect(INVENTORY_LIVE_WINDOW_MINUTES).toBeLessThan(
      INVENTORY_STALE_AFTER_MINUTES,
    );
  });

  test("stale is at least a full day, so an hourly job never trips it", () => {
    expect(INVENTORY_STALE_AFTER_MINUTES).toBeGreaterThanOrEqual(24 * 60);
  });
});

describe("only sources with a heartbeat are aged", () => {
  test("discovered rows have a liveness signal", () => {
    expect(sourceHasLivenessSignal(EntitySource.Discovered)).toBe(true);
  });

  test.each([EntitySource.Inventory, EntitySource.Manual])(
    "%s rows do not",
    (source: EntitySource) => {
      expect(sourceHasLivenessSignal(source)).toBe(false);
    },
  );

  test.each([EntitySource.Inventory, EntitySource.Manual])(
    "a year-old %s row is NotTracked, never Stale",
    (source: EntitySource) => {
      expect(classify(source, 365 * 24 * 60)).toBe(
        InventoryLiveness.NotTracked,
      );
    },
  );

  test("a mirrored row with no lastSeenAt at all is still NotTracked", () => {
    expect(
      getInventoryLiveness({
        source: EntitySource.Inventory,
        lastSeenAt: undefined,
        now: NOW,
      }).liveness,
    ).toBe(InventoryLiveness.NotTracked);
  });

  test("an unknown source is NotTracked rather than assumed live", () => {
    expect(classify("brand-new-source", 5)).toBe(InventoryLiveness.NotTracked);
  });

  test("a missing source is NotTracked", () => {
    expect(classify(undefined, 5)).toBe(InventoryLiveness.NotTracked);
  });

  test("NotTracked carries no pill classes to render", () => {
    const result: InventoryLivenessResult = getInventoryLiveness({
      source: EntitySource.Manual,
      lastSeenAt: minutesBeforeNow(10),
      now: NOW,
    });

    expect(result.pillClassName).toBe("");
    expect(result.label).toBe("");
    expect(result.minutesSinceLastSeen).toBeNull();
  });
});

describe("discovered rows are classified by age", () => {
  test("seen right now is Live", () => {
    expect(classify(EntitySource.Discovered, 0)).toBe(InventoryLiveness.Live);
  });

  test("the live window is inclusive at its upper edge", () => {
    expect(
      classify(EntitySource.Discovered, INVENTORY_LIVE_WINDOW_MINUTES),
    ).toBe(InventoryLiveness.Live);
  });

  test("one minute past the live window is Recent", () => {
    expect(
      classify(EntitySource.Discovered, INVENTORY_LIVE_WINDOW_MINUTES + 1),
    ).toBe(InventoryLiveness.Recent);
  });

  test("the stale cutoff is inclusive at its upper edge", () => {
    expect(
      classify(EntitySource.Discovered, INVENTORY_STALE_AFTER_MINUTES),
    ).toBe(InventoryLiveness.Recent);
  });

  test("one minute past the stale cutoff is Stale", () => {
    expect(
      classify(EntitySource.Discovered, INVENTORY_STALE_AFTER_MINUTES + 1),
    ).toBe(InventoryLiveness.Stale);
  });

  test("a discovered row that has never reported is Never, not Stale", () => {
    /*
     * The two mean different things to a reader: "never seen" is a setup
     * problem, "gone quiet" is a change in something that used to work.
     */
    expect(
      getInventoryLiveness({
        source: EntitySource.Discovered,
        lastSeenAt: null,
        now: NOW,
      }).liveness,
    ).toBe(InventoryLiveness.Never);
  });

  test("every classified state reports an age and a pill class", () => {
    for (const minutesAgo of [0, INVENTORY_LIVE_WINDOW_MINUTES + 1, 5000]) {
      const result: InventoryLivenessResult = getInventoryLiveness({
        source: EntitySource.Discovered,
        lastSeenAt: minutesBeforeNow(minutesAgo),
        now: NOW,
      });

      expect(result.minutesSinceLastSeen).toBe(minutesAgo);
      expect(result.pillClassName.length).toBeGreaterThan(0);
      expect(result.label.length).toBeGreaterThan(0);
      expect(result.description.length).toBeGreaterThan(0);
    }
  });
});

describe("hostile and skewed inputs", () => {
  test("a future lastSeenAt clamps to zero rather than reading negative", () => {
    // Clock skew between an ingest node and the browser is routine.
    const result: InventoryLivenessResult = getInventoryLiveness({
      source: EntitySource.Discovered,
      lastSeenAt: new Date(NOW.getTime() + 10 * 60 * 1000),
      now: NOW,
    });

    expect(result.minutesSinceLastSeen).toBe(0);
    expect(result.liveness).toBe(InventoryLiveness.Live);
  });

  test("an unparseable date does not silently classify as Live", () => {
    /*
     * NaN compares false against every threshold, so a naive implementation
     * falls through to the one answer that suppresses the warning.
     */
    expect(
      getInventoryLiveness({
        source: EntitySource.Discovered,
        lastSeenAt: "not-a-date",
        now: NOW,
      }).liveness,
    ).toBe(InventoryLiveness.Never);
  });

  test("an ISO string is accepted as well as a Date", () => {
    expect(
      getInventoryLiveness({
        source: EntitySource.Discovered,
        lastSeenAt: minutesBeforeNow(5).toISOString(),
        now: NOW,
      }).liveness,
    ).toBe(InventoryLiveness.Live);
  });
});

describe("isStaleLiveness is the only definition of stale", () => {
  test("only Stale is stale", () => {
    expect(isStaleLiveness(InventoryLiveness.Stale)).toBe(true);

    for (const liveness of [
      InventoryLiveness.Live,
      InventoryLiveness.Recent,
      InventoryLiveness.Never,
      InventoryLiveness.NotTracked,
    ]) {
      expect(isStaleLiveness(liveness)).toBe(false);
    }
  });
});

describe("formatMinutesAgo", () => {
  test.each([
    [0, "just now"],
    [1, "1m ago"],
    [59, "59m ago"],
    [60, "1h ago"],
    [90, "1h ago"],
    [23 * 60, "23h ago"],
    [24 * 60, "1d ago"],
    [29 * 24 * 60, "29d ago"],
    [30 * 24 * 60, "1mo ago"],
    [365 * 24 * 60, "1y ago"],
  ])("%i minutes reads as %s", (minutes: number, expected: string) => {
    expect(formatMinutesAgo(minutes)).toBe(expected);
  });

  test("the unit only ever coarsens as the age grows", () => {
    /*
     * Guards the boundary arithmetic: a unit that jumps back (say "1mo" at
     * 30d but "720h" at 31d) would be a wrong `<` somewhere.
     */
    const order: Array<string> = ["m", "h", "d", "mo", "y"];

    type UnitOfFunction = (minutes: number) => number;

    const unitOf: UnitOfFunction = (minutes: number): number => {
      const rendered: string = formatMinutesAgo(minutes);

      if (rendered === "just now") {
        return 0;
      }

      const unit: string = rendered.replace(/^\d+/, "").replace(" ago", "");

      return order.indexOf(unit);
    };

    let previous: number = 0;

    for (let minutes: number = 0; minutes <= 800 * 24 * 60; minutes += 137) {
      const current: number = unitOf(minutes);

      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe("source descriptors", () => {
  test("every EntitySource has a descriptor", () => {
    for (const source of Object.values(EntitySource)) {
      expect(getInventorySourceDescriptor(source)).not.toBeNull();
    }
  });

  test("the declared order lists every source exactly once", () => {
    expect(new Set(INVENTORY_SOURCE_ORDER)).toEqual(
      new Set(Object.values(EntitySource)),
    );
    expect(INVENTORY_SOURCE_ORDER.length).toBe(
      Object.values(EntitySource).length,
    );
  });

  test("labels never leak the wire value", () => {
    for (const source of Object.values(EntitySource)) {
      expect(getInventorySourceLabel(source)).not.toBe(source);
    }
  });

  test("only manual rows are permanently deletable", () => {
    expect(isDeletePermanentForSource(EntitySource.Manual)).toBe(true);
    expect(isDeletePermanentForSource(EntitySource.Discovered)).toBe(false);
    expect(isDeletePermanentForSource(EntitySource.Inventory)).toBe(false);
  });

  test("every source that comes back explains that it comes back", () => {
    for (const source of Object.values(EntitySource)) {
      if (isDeletePermanentForSource(source)) {
        expect(getInventoryDeleteCaveat(source)).toBeNull();
        continue;
      }

      expect(getInventoryDeleteCaveat(source)!.length).toBeGreaterThan(0);
    }
  });

  test("an unknown source is treated as impermanent and warned about", () => {
    /*
     * The safe default: promising a permanence we cannot deliver is the one
     * failure mode that surprises a user after the fact.
     */
    expect(isDeletePermanentForSource("brand-new-source")).toBe(false);
    expect(getInventoryDeleteCaveat("brand-new-source")).not.toBeNull();
  });

  test("an undefined source resolves to nothing rather than throwing", () => {
    expect(getInventorySourceDescriptor(undefined)).toBeNull();
    expect(getInventorySourceLabel(undefined)).toBe("Unknown");
    expect(sourceHasLivenessSignal(undefined)).toBe(false);
  });
});
