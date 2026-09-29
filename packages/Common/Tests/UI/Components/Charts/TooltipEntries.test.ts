import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_TOOLTIP_MAX_ENTRIES,
  PREVIOUS_PERIOD_SERIES_SUFFIX,
  PreparedTooltipEntries,
  SortableTooltipItem,
  prepareTooltipEntries,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/TooltipEntries";

/*
 * The tooltip ordering contract: on a grouped chart the series that is
 * spiking AT THE HOVERED TIMESTAMP must be the first tooltip line, the
 * list must stay readable at high cardinality (cap + "+N more"), and
 * non-data entries (hidden series, band fills) must never displace a real
 * reading. The chips already rank by peak; the tooltip is the only place
 * the user reads per-timestamp values, so its order is what answers
 * "which host is this spike?".
 */

interface TestItem extends SortableTooltipItem {
  color?: string;
}

function item(category: string, value: number, type?: string): TestItem {
  return { category, value, ...(type ? { type } : {}) };
}

function categories(prepared: PreparedTooltipEntries<TestItem>): Array<string> {
  return prepared.entries.map((entry: TestItem) => {
    return entry.category;
  });
}

describe("prepareTooltipEntries", () => {
  test("orders entries by value at the hovered point, highest first", () => {
    const prepared: PreparedTooltipEntries<TestItem> = prepareTooltipEntries([
      item("host-b", 10),
      item("host-a", 90),
      item("host-c", 40),
    ]);

    expect(categories(prepared)).toEqual(["host-a", "host-c", "host-b"]);
    expect(prepared.overflowCount).toBe(0);
    expect(prepared.totalCount).toBe(3);
  });

  test("breaks value ties by natural name order (cpu2 before cpu10)", () => {
    const prepared: PreparedTooltipEntries<TestItem> = prepareTooltipEntries([
      item("cpu10", 5),
      item("cpu2", 5),
      item("cpu1", 5),
    ]);

    expect(categories(prepared)).toEqual(["cpu1", "cpu2", "cpu10"]);
  });

  test("sorts non-finite values last and drops band tuples entirely", () => {
    const prepared: PreparedTooltipEntries<TestItem> = prepareTooltipEntries([
      item("nan-series", NaN),
      item("real-low", 1),
      item("infinite", Infinity),
      item("real-high", 7),
      /*
       * The anomaly band's dataKey yields a [low, high] tuple at runtime
       * — a shaded region, not a series, so it must not render as a row
       * nor count toward the overflow footer.
       */
      item("band", [2, 9] as unknown as number),
    ]);

    expect(categories(prepared).slice(0, 2)).toEqual(["real-high", "real-low"]);
    // Non-finite tail keeps natural name order among itself.
    expect(categories(prepared).slice(2)).toEqual(["infinite", "nan-series"]);
    expect(prepared.totalCount).toBe(4);
  });

  test('filters out type "none" entries (hidden click-target lines, band fills)', () => {
    const prepared: PreparedTooltipEntries<TestItem> = prepareTooltipEntries([
      item("visible", 3),
      item("hidden", 99, "none"),
    ]);

    expect(categories(prepared)).toEqual(["visible"]);
    expect(prepared.totalCount).toBe(1);
    expect(prepared.overflowCount).toBe(0);
  });

  test("caps at the default and reports the overflow", () => {
    const payload: Array<TestItem> = Array.from(
      { length: 25 },
      (_: unknown, index: number) => {
        return item(`series-${index}`, index);
      },
    );

    const prepared: PreparedTooltipEntries<TestItem> =
      prepareTooltipEntries(payload);

    expect(prepared.entries).toHaveLength(DEFAULT_TOOLTIP_MAX_ENTRIES);
    expect(prepared.overflowCount).toBe(25 - DEFAULT_TOOLTIP_MAX_ENTRIES);
    expect(prepared.totalCount).toBe(25);
    // The cap keeps the HIGHEST values, not the first-mounted series.
    expect(categories(prepared)[0]).toBe("series-24");
    expect(categories(prepared)[DEFAULT_TOOLTIP_MAX_ENTRIES - 1]).toBe(
      `series-${25 - DEFAULT_TOOLTIP_MAX_ENTRIES}`,
    );
  });

  test("exactly at the cap means no overflow", () => {
    const payload: Array<TestItem> = Array.from(
      { length: DEFAULT_TOOLTIP_MAX_ENTRIES },
      (_: unknown, index: number) => {
        return item(`series-${index}`, index);
      },
    );

    const prepared: PreparedTooltipEntries<TestItem> =
      prepareTooltipEntries(payload);

    expect(prepared.entries).toHaveLength(DEFAULT_TOOLTIP_MAX_ENTRIES);
    expect(prepared.overflowCount).toBe(0);
  });

  test("honors a custom cap and rejects nonsense caps", () => {
    const payload: Array<TestItem> = [item("a", 1), item("b", 2), item("c", 3)];

    expect(prepareTooltipEntries(payload, 2).entries).toHaveLength(2);
    expect(prepareTooltipEntries(payload, 2).overflowCount).toBe(1);

    // Zero, negative, and fractional caps fall back to the default.
    expect(prepareTooltipEntries(payload, 0).entries).toHaveLength(3);
    expect(prepareTooltipEntries(payload, -5).entries).toHaveLength(3);
    expect(prepareTooltipEntries(payload, 1.5).entries).toHaveLength(3);
  });

  test("tolerates empty, null, and undefined payloads", () => {
    for (const payload of [[], null, undefined]) {
      const prepared: PreparedTooltipEntries<TestItem> = prepareTooltipEntries(
        payload as Array<TestItem>,
      );
      expect(prepared.entries).toEqual([]);
      expect(prepared.overflowCount).toBe(0);
      expect(prepared.totalCount).toBe(0);
    }
  });

  test("previous-period ghosts sort after every live series, whatever their value", () => {
    const prepared: PreparedTooltipEntries<TestItem> = prepareTooltipEntries([
      item(`host-a${PREVIOUS_PERIOD_SERIES_SUFFIX}`, 999),
      item("host-a", 10),
      item("host-b", 50),
      item(`host-b${PREVIOUS_PERIOD_SERIES_SUFFIX}`, 60),
    ]);

    expect(categories(prepared)).toEqual([
      "host-b",
      "host-a",
      // Ghost tier keeps its own value ordering.
      `host-a${PREVIOUS_PERIOD_SERIES_SUFFIX}`,
      `host-b${PREVIOUS_PERIOD_SERIES_SUFFIX}`,
    ]);
  });

  test("ghosts never displace live readings under the cap", () => {
    const payload: Array<TestItem> = [];
    for (let index: number = 0; index < DEFAULT_TOOLTIP_MAX_ENTRIES; index++) {
      payload.push(item(`live-${index}`, index));
      payload.push(item(`live-${index}${PREVIOUS_PERIOD_SERIES_SUFFIX}`, 1e6));
    }

    const prepared: PreparedTooltipEntries<TestItem> =
      prepareTooltipEntries(payload);

    expect(
      prepared.entries.every((entry: TestItem) => {
        return !entry.category.endsWith(PREVIOUS_PERIOD_SERIES_SUFFIX);
      }),
    ).toBe(true);
    expect(prepared.overflowCount).toBe(DEFAULT_TOOLTIP_MAX_ENTRIES);
  });

  test("does not mutate the input payload", () => {
    const payload: Array<TestItem> = [item("low", 1), item("high", 2)];
    prepareTooltipEntries(payload);
    expect(
      payload.map((entry: TestItem) => {
        return entry.category;
      }),
    ).toEqual(["low", "high"]);
  });
});
