import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  DEVICE_FACET_QUERY_FIELDS,
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_INTERFACES_FACET_OPTIONS,
  DEVICE_PROBE_FACET_KEY,
  DEVICE_SITE_FACET_KEY,
  DEVICE_STATUS_FACET_KEY,
  DEVICE_STATUS_FACET_OPTIONS,
  DeviceInterfacesFacetValue,
  DeviceStatusCutoff,
  DeviceStatusFacetValue,
  NETWORK_DEVICES_TABLE_ID,
  UNASSIGNED_DEVICES_FACET_SELECTION,
  buildDeviceInterfacesFacetQuery,
  buildDeviceStatusFacetQuery,
  getDeviceFreshCutoff,
  isTimeBasedDeviceStatus,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import { DEVICE_FRESH_WINDOW_MINUTES } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import {
  FILTER_OPERATOR_LABELS,
  FilterChipDropdownOption,
  FilterOperator,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import CompareBase from "Common/Types/Database/CompareBase";

/*
 * DeviceFacets is the contract between what a chip in the device list's facet
 * bar says and what the database is actually asked. Both the summary tiles and
 * the bar itself go through it, so if a value here stops meaning what the chip
 * claims, the product lies: the chip reads "Status is Down" over a list that is
 * not the down devices, and there is nothing on screen to explain it.
 *
 * The keys and enum values are also the URL / saved-view vocabulary, so their
 * literal strings are pinned — a rename has to be a conscious edit here rather
 * than a silent orphaning of every link already pasted into a ticket.
 */

// The frozen "now" the clock-dependent tests run at.
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");
const MS_PER_MINUTE: number = 60 * 1000;
const FRESH_WINDOW_MS: number = DEVICE_FRESH_WINDOW_MINUTES * MS_PER_MINUTE;

/*
 * An arbitrary cutoff, nowhere near "now", so a query that computed its own
 * window instead of carrying the one it was handed cannot pass by accident.
 */
const CUTOFF: Date = new Date("2001-02-03T04:05:06.007Z");

/*
 * Only Date needs faking; the sinon backend jest 28 uses cannot hijack the
 * read-only `performance` global on current Node. Same list as
 * DeviceStatusUtil.test.ts, which freezes time for the same reason.
 */
function freezeTime(at: Date): void {
  jest.useFakeTimers({
    doNotFake: [
      "performance",
      "hrtime",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  jest.setSystemTime(at);
}

const ALL_OPERATORS: Array<FilterOperator> = Object.keys(
  FILTER_OPERATOR_LABELS,
) as Array<FilterOperator>;

const OPERATORS_OTHER_THAN_IS: Array<FilterOperator> = ALL_OPERATORS.filter(
  (operator: FilterOperator) => {
    return operator !== "is";
  },
);

const ALL_STATUS_VALUES: Array<DeviceStatusFacetValue> = Object.values(
  DeviceStatusFacetValue,
);

const ALL_INTERFACES_VALUES: Array<DeviceInterfacesFacetValue> = Object.values(
  DeviceInterfacesFacetValue,
);

const ALL_FACET_KEYS: Array<string> = [
  DEVICE_STATUS_FACET_KEY,
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_SITE_FACET_KEY,
  DEVICE_PROBE_FACET_KEY,
];

const ALL_QUERY_FIELDS: Array<string> = Object.values(
  DEVICE_FACET_QUERY_FIELDS,
);

/*
 * The values a hand-edited URL, a stale bookmark or a view saved by an older
 * build can hand over. None of them may reach the query builder: the honest
 * answer is "do not constrain this column", never a malformed query.
 */
const JUNK_VALUES: Array<[string, string]> = [
  ["an unknown word", "banana"],
  ["a value that never existed", "stale"],
  ["wrong case", "UP"],
  ["mixed case", "Down"],
  ["leading whitespace", " up"],
  ["trailing whitespace", "up "],
  ["a prefix of a real value", "pen"],
  ["a real value with a suffix", "up-x"],
  ["the empty string", ""],
  ["an Object.prototype member", "constructor"],
  ["a prototype-pollution attempt", "__proto__"],
  ["another prototype member", "toString"],
  ["a number", "0"],
  ["a JSON payload", '{"lastSeenAt":null}'],
  ["a SQL fragment", "1' OR '1'='1"],
];

function optionValues(options: Array<FilterChipDropdownOption>): Array<string> {
  return options.map((option: FilterChipDropdownOption): string => {
    return option.value;
  });
}

/*
 * The exact operator class a query fragment is. `instanceof` passes for a
 * subclass too, and a coalescing subclass of a comparison is precisely the
 * regression the partition tests are watching for.
 */
function operatorNameOf(query: unknown): string {
  return (query as { constructor: { name: string } }).constructor.name;
}

describe("NETWORK_DEVICES_TABLE_ID", () => {
  /*
   * This string is the table's id, its user-preferences key AND the namespace
   * its filter / facet / view state is persisted under in the URL. Renaming it
   * silently discards everyone's saved column layout and breaks every
   * pre-filtered link already shared.
   */
  test("is the namespace saved links and table preferences are stored under", () => {
    expect(NETWORK_DEVICES_TABLE_ID).toBe("network-devices-table");
  });
});

describe("the facet keys", () => {
  /*
   * The keys are what a saved view and a shared URL carry, not the labels. A
   * rename orphans both, so it has to break this test first.
   */
  test("are the strings already in saved views and links", () => {
    expect(DEVICE_STATUS_FACET_KEY).toBe("deviceStatus");
    expect(DEVICE_INTERFACES_FACET_KEY).toBe("deviceInterfaces");
    expect(DEVICE_SITE_FACET_KEY).toBe("deviceSite");
    expect(DEVICE_PROBE_FACET_KEY).toBe("deviceProbe");
  });

  test("are non-empty and distinct from one another", () => {
    for (const key of ALL_FACET_KEYS) {
      expect(key.length).toBeGreaterThan(0);
      expect(key.trim()).toBe(key);
    }

    expect(new Set(ALL_FACET_KEYS).size).toBe(ALL_FACET_KEYS.length);
  });

  /*
   * A key is the chip's own identity in the selection map; the query field is
   * the column it writes. Spelling them the same would make the facet state
   * read like a column filter and vice versa — and the page keeps the two in
   * separate namespaces on purpose.
   */
  test("are distinct from the columns they write to", () => {
    for (const key of ALL_FACET_KEYS) {
      expect(ALL_QUERY_FIELDS).not.toContain(key);
    }
  });
});

describe("DEVICE_FACET_QUERY_FIELDS", () => {
  test("names the columns each chip owns", () => {
    expect(DEVICE_FACET_QUERY_FIELDS.status).toBe("lastSeenAt");
    expect(DEVICE_FACET_QUERY_FIELDS.interfaces).toBe("interfacesDown");
    expect(DEVICE_FACET_QUERY_FIELDS.site).toBe("siteId");
    expect(DEVICE_FACET_QUERY_FIELDS.probe).toBe("probeId");
  });

  /*
   * The foreign key, not the relation. Two reasons, both load-bearing: "is
   * empty" has to be answerable by the column itself, because an unassigned
   * device has no site row to join against; and the column-filter popup spells
   * the same column `site`, so mixing the two spellings survives the query
   * merge as an AND that can never match — an empty table under a chip
   * insisting it is showing something.
   */
  test("uses the foreign key spelling for site and probe, not the relation", () => {
    expect(DEVICE_FACET_QUERY_FIELDS.site).not.toBe("site");
    expect(DEVICE_FACET_QUERY_FIELDS.probe).not.toBe("probe");
    expect(DEVICE_FACET_QUERY_FIELDS.site.endsWith("Id")).toBe(true);
    expect(DEVICE_FACET_QUERY_FIELDS.probe.endsWith("Id")).toBe(true);
  });

  /*
   * The chips' constraints are merged into one query object, so two chips
   * writing the same column would have the later one silently replace the
   * earlier — one chip lit over a list it is not filtering.
   */
  test("gives every chip a column of its own", () => {
    expect(new Set(ALL_QUERY_FIELDS).size).toBe(ALL_QUERY_FIELDS.length);
    expect(ALL_QUERY_FIELDS).toHaveLength(ALL_FACET_KEYS.length);
  });
});

describe("DeviceStatusFacetValue", () => {
  test("carries the wire values that appear in URLs", () => {
    expect(DeviceStatusFacetValue.Up).toBe("up");
    expect(DeviceStatusFacetValue.Down).toBe("down");
    expect(DeviceStatusFacetValue.Pending).toBe("pending");
    expect(ALL_STATUS_VALUES).toHaveLength(3);
  });
});

describe("DeviceInterfacesFacetValue", () => {
  test("carries the wire values that appear in URLs", () => {
    expect(DeviceInterfacesFacetValue.SomeDown).toBe("some-down");
    expect(DeviceInterfacesFacetValue.AllUp).toBe("all-up");
    expect(ALL_INTERFACES_VALUES).toHaveLength(2);
  });
});

describe("buildDeviceStatusFacetQuery", () => {
  /*
   * DeviceSummaryCards counts the "Devices Up" tile with
   * `lastSeenAt: new GreaterThanOrEqual(freshCutoff)`. Anything else here and
   * the tile opens a different set than it counted.
   */
  describe("Up", () => {
    test("is lastSeenAt >= the cutoff", () => {
      const query: unknown = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Up],
        "is",
        CUTOFF,
      );

      expect(query).toBeInstanceOf(GreaterThanOrEqual);
      expect((query as GreaterThanOrEqual<Date>).value).toBe(CUTOFF);
      expect((query as GreaterThanOrEqual<Date>).value.getTime()).toBe(
        CUTOFF.getTime(),
      );
    });

    /*
     * DeviceStatusUtil.getStatus calls a device seen exactly at the cutoff
     * "Up", so the boundary has to be inclusive here too — otherwise a device
     * on the boundary shows an Up pill in a list filtered to Down, or vanishes
     * from both.
     */
    test("includes the boundary, matching the Status pill", () => {
      expect(
        buildDeviceStatusFacetQuery([DeviceStatusFacetValue.Up], "is", CUTOFF),
      ).not.toBeInstanceOf(GreaterThan);
    });
  });

  describe("Down", () => {
    test("is lastSeenAt < the cutoff", () => {
      const query: unknown = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Down],
        "is",
        CUTOFF,
      );

      expect(query).toBeInstanceOf(LessThan);
      expect((query as LessThan<Date>).value).toBe(CUTOFF);
      expect((query as LessThan<Date>).value.getTime()).toBe(CUTOFF.getTime());
    });
  });

  describe("Pending", () => {
    test("is lastSeenAt IS NULL, and carries no date at all", () => {
      const query: unknown = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Pending],
        "is",
        CUTOFF,
      );

      expect(query).toBeInstanceOf(IsNull);
      expect(query).not.toBeInstanceOf(CompareBase);
    });
  });

  describe("the three values partition the fleet", () => {
    /*
     * Up is >= cutoff and Down is < cutoff against the SAME instant. If the
     * two ever drifted apart — a rounded cutoff on one side, a separately
     * derived window on the other — devices in the gap would appear in
     * neither list while still being counted by one of the tiles.
     */
    test("Up and Down meet at exactly one instant, with no gap and no overlap", () => {
      const up: GreaterThanOrEqual<Date> = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Up],
        "is",
        CUTOFF,
      ) as GreaterThanOrEqual<Date>;
      const down: LessThan<Date> = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Down],
        "is",
        CUTOFF,
      ) as LessThan<Date>;

      expect(up.value.getTime()).toBe(down.value.getTime());
      expect(up.value).toBe(down.value);
    });

    /*
     * A never-polled device has to land in Pending and nowhere else. SQL
     * evaluates both `NULL >= x` and `NULL < x` as unknown, so it is dropped
     * from Up and Down — but only as long as those two stay plain
     * comparisons. The moment either becomes a coalescing operator
     * (GreaterThanOrNull, LessThanOrNull) pending devices get counted twice
     * and the three tile counts stop summing to the fleet size.
     */
    test("Up and Down stay plain comparisons, so pending devices match neither", () => {
      const up: unknown = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Up],
        "is",
        CUTOFF,
      );
      const down: unknown = buildDeviceStatusFacetQuery(
        [DeviceStatusFacetValue.Down],
        "is",
        CUTOFF,
      );

      expect(operatorNameOf(up)).toBe("GreaterThanOrEqual");
      expect(operatorNameOf(down)).toBe("LessThan");
    });

    test("every value produces a constraint, so no chip value is a no-op", () => {
      for (const value of ALL_STATUS_VALUES) {
        expect(
          buildDeviceStatusFacetQuery([value], "is", CUTOFF),
        ).toBeDefined();
      }
    });

    test("no two values produce the same constraint", () => {
      const shapes: Array<string> = ALL_STATUS_VALUES.map(
        (value: DeviceStatusFacetValue): string => {
          return JSON.stringify(
            buildDeviceStatusFacetQuery([value], "is", CUTOFF),
          );
        },
      );

      expect(new Set(shapes).size).toBe(shapes.length);
    });
  });

  /*
   * The three values are ranges over one column, so "up or pending" is not
   * expressible as a single field query and "is not up" would silently drop
   * never-polled devices (NULL fails both comparisons) while reading as though
   * it included them. Both are refused outright rather than approximated.
   */
  describe("refuses anything it cannot express honestly", () => {
    test.each(JUNK_VALUES)(
      "%s does not constrain the column",
      (_label: string, raw: string) => {
        expect(
          buildDeviceStatusFacetQuery([raw], "is", CUTOFF),
        ).toBeUndefined();
      },
    );

    test("an empty selection does not constrain the column", () => {
      expect(buildDeviceStatusFacetQuery([], "is", CUTOFF)).toBeUndefined();
    });

    test("a multi-select does not constrain the column", () => {
      expect(
        buildDeviceStatusFacetQuery(
          [DeviceStatusFacetValue.Up, DeviceStatusFacetValue.Down],
          "is",
          CUTOFF,
        ),
      ).toBeUndefined();
      expect(
        buildDeviceStatusFacetQuery(
          [
            DeviceStatusFacetValue.Up,
            DeviceStatusFacetValue.Down,
            DeviceStatusFacetValue.Pending,
          ],
          "is",
          CUTOFF,
        ),
      ).toBeUndefined();
    });

    test("a duplicated value is still a multi-select", () => {
      expect(
        buildDeviceStatusFacetQuery(
          [DeviceStatusFacetValue.Up, DeviceStatusFacetValue.Up],
          "is",
          CUTOFF,
        ),
      ).toBeUndefined();
    });

    test.each(OPERATORS_OTHER_THAN_IS)(
      "the %s operator does not constrain the column",
      (operator: FilterOperator) => {
        for (const value of ALL_STATUS_VALUES) {
          expect(
            buildDeviceStatusFacetQuery([value], operator, CUTOFF),
          ).toBeUndefined();
        }
      },
    );

    /*
     * Derived from FILTER_OPERATOR_LABELS rather than hard-coded, so adding a
     * fifth operator to the chip forces this list to be revisited instead of
     * quietly falling through to whichever branch happens to match.
     */
    test("covers every operator the chip can offer", () => {
      expect(ALL_OPERATORS).toHaveLength(4);
      expect(OPERATORS_OTHER_THAN_IS).toHaveLength(3);
      expect(OPERATORS_OTHER_THAN_IS).not.toContain("is");
    });
  });

  /*
   * ModelTable decides whether to refetch by comparing the serialised query
   * against the previous render's. Given the same cutoff the fragment has to
   * serialise identically, or every render looks like a change — an unbounded
   * refetch loop against the API.
   */
  test("serialises identically for the same cutoff", () => {
    expect(
      JSON.stringify(
        buildDeviceStatusFacetQuery([DeviceStatusFacetValue.Up], "is", CUTOFF),
      ),
    ).toBe(
      JSON.stringify(
        buildDeviceStatusFacetQuery([DeviceStatusFacetValue.Up], "is", CUTOFF),
      ),
    );
  });

  test("moves with the cutoff it is given, and only with that", () => {
    const later: Date = new Date(CUTOFF.getTime() + MS_PER_MINUTE);

    expect(
      JSON.stringify(
        buildDeviceStatusFacetQuery([DeviceStatusFacetValue.Up], "is", later),
      ),
    ).not.toBe(
      JSON.stringify(
        buildDeviceStatusFacetQuery([DeviceStatusFacetValue.Up], "is", CUTOFF),
      ),
    );
  });
});

describe("buildDeviceInterfacesFacetQuery", () => {
  describe("SomeDown", () => {
    /*
     * The tile counts interfaces; the list can only show devices. So the
     * constraint is "devices with at least one interface down" — which is
     * strictly greater than zero. `GreaterThanOrEqual(0)` would match the
     * whole fleet.
     */
    test("is interfacesDown > 0", () => {
      const query: unknown = buildDeviceInterfacesFacetQuery(
        [DeviceInterfacesFacetValue.SomeDown],
        "is",
      );

      expect(query).toBeInstanceOf(GreaterThan);
      expect(query).not.toBeInstanceOf(GreaterThanOrEqual);
      expect((query as GreaterThan<number>).value).toBe(0);
    });
  });

  describe("AllUp", () => {
    /*
     * The reason this is `EqualTo(0)` and not a bare `0`: the server's query
     * builder skips falsy values, so a plain zero reaches the ORM as no filter
     * at all and the chip lights up over the entire, unfiltered fleet.
     */
    test("is an EqualTo(0), never a bare zero the query builder would drop", () => {
      const query: unknown = buildDeviceInterfacesFacetQuery(
        [DeviceInterfacesFacetValue.AllUp],
        "is",
      );

      expect(query).toBeTruthy();
      expect(typeof query).not.toBe("number");
      expect(query).not.toBe(0);
      expect(query).toBeInstanceOf(EqualTo);
      expect((query as EqualTo<number>).value).toBe(0);
    });

    /*
     * "All up" and "some down" are complements over the same column, so they
     * must not both match a device with zero interfaces down.
     */
    test("is the complement of SomeDown, not an overlapping range", () => {
      const someDown: unknown = buildDeviceInterfacesFacetQuery(
        [DeviceInterfacesFacetValue.SomeDown],
        "is",
      );
      const allUp: unknown = buildDeviceInterfacesFacetQuery(
        [DeviceInterfacesFacetValue.AllUp],
        "is",
      );

      expect((someDown as GreaterThan<number>).value).toBe(
        (allUp as EqualTo<number>).value,
      );
      expect(operatorNameOf(someDown)).toBe("GreaterThan");
      expect(operatorNameOf(allUp)).toBe("EqualTo");
    });
  });

  test("does not touch lastSeenAt — a stale device can still have interfaces down", () => {
    for (const value of ALL_INTERFACES_VALUES) {
      const query: unknown = buildDeviceInterfacesFacetQuery([value], "is");

      expect(query).not.toBeInstanceOf(IsNull);
      expect((query as CompareBase<number>).value).toBe(0);
    }
  });

  describe("refuses anything it cannot express honestly", () => {
    test.each(JUNK_VALUES)(
      "%s does not constrain the column",
      (_label: string, raw: string) => {
        expect(buildDeviceInterfacesFacetQuery([raw], "is")).toBeUndefined();
      },
    );

    /*
     * The status values live on a different chip. Feeding one here — which a
     * URL with the two facet keys swapped would do — must not resolve to a
     * constraint on the interface count.
     */
    test.each(ALL_STATUS_VALUES)(
      "the other chip's %s value does not constrain the column",
      (value: DeviceStatusFacetValue) => {
        expect(buildDeviceInterfacesFacetQuery([value], "is")).toBeUndefined();
      },
    );

    test("an empty selection does not constrain the column", () => {
      expect(buildDeviceInterfacesFacetQuery([], "is")).toBeUndefined();
    });

    test("a multi-select does not constrain the column", () => {
      expect(
        buildDeviceInterfacesFacetQuery(
          [
            DeviceInterfacesFacetValue.SomeDown,
            DeviceInterfacesFacetValue.AllUp,
          ],
          "is",
        ),
      ).toBeUndefined();
    });

    test.each(OPERATORS_OTHER_THAN_IS)(
      "the %s operator does not constrain the column",
      (operator: FilterOperator) => {
        for (const value of ALL_INTERFACES_VALUES) {
          expect(
            buildDeviceInterfacesFacetQuery([value], operator),
          ).toBeUndefined();
        }
      },
    );
  });

  /*
   * Nothing here reads the clock, so the fragment is stable across renders on
   * its own — no snapshot needed, and no refetch loop either.
   */
  test("serialises identically every time, with no clock in it", () => {
    for (const value of ALL_INTERFACES_VALUES) {
      expect(
        JSON.stringify(buildDeviceInterfacesFacetQuery([value], "is")),
      ).toBe(JSON.stringify(buildDeviceInterfacesFacetQuery([value], "is")));
    }
  });
});

describe("getDeviceFreshCutoff", () => {
  test("is the freshness window in the past", () => {
    const cutoff: Date = getDeviceFreshCutoff();
    const age: number = Date.now() - cutoff.getTime();

    expect(cutoff).toBeInstanceOf(Date);
    expect(Number.isNaN(cutoff.getTime())).toBe(false);
    // Tolerance for the wall clock advancing between the two reads.
    expect(age).toBeGreaterThanOrEqual(FRESH_WINDOW_MS - 2000);
    expect(age).toBeLessThanOrEqual(FRESH_WINDOW_MS + 2000);
  });

  describe("with the clock frozen", () => {
    beforeEach(() => {
      freezeTime(NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("is exactly the window ago", () => {
      expect(getDeviceFreshCutoff().getTime()).toBe(
        NOW.getTime() - FRESH_WINDOW_MS,
      );
    });

    /*
     * The Status column's pill, the tile counts and the chip's query all have
     * to agree on where "up" ends. They agree because all of them read this
     * one constant.
     */
    test("uses the same window as the Status pill", () => {
      expect(DEVICE_FRESH_WINDOW_MINUTES).toBe(15);
    });

    /*
     * A fresh object every call is exactly why DeviceStatusCutoff exists:
     * handed straight to ModelTable this compares unequal on every render.
     */
    test("returns a new Date object every call, snapshot-free", () => {
      expect(getDeviceFreshCutoff()).not.toBe(getDeviceFreshCutoff());
      expect(getDeviceFreshCutoff().getTime()).toBe(
        getDeviceFreshCutoff().getTime(),
      );
    });
  });
});

/*
 * The cutoff cannot be rebuilt per render: the merged query goes to ModelTable,
 * which decides whether to refetch by comparing it against the previous
 * render's, so a fresh Date every render looks like a change every render — an
 * endless refetch loop. Object identity is therefore the property that matters,
 * and it is what these assert.
 */
describe("DeviceStatusCutoff", () => {
  beforeEach(() => {
    freezeTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("has taken no snapshot before it is asked for one", () => {
    expect(new DeviceStatusCutoff().getSelection()).toBeNull();
  });

  test("snapshots on the very first call, and reports what for", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const first: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    expect(first.getTime()).toBe(NOW.getTime() - FRESH_WINDOW_MS);
    expect(cutoff.getSelection()).toBe(DeviceStatusFacetValue.Up);
  });

  test("hands back the identical Date for repeated calls with the same selection", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const first: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Down);

    expect(cutoff.getCutoffFor(DeviceStatusFacetValue.Down)).toBe(first);
    expect(cutoff.getCutoffFor(DeviceStatusFacetValue.Down)).toBe(first);
    expect(cutoff.getCutoffFor(DeviceStatusFacetValue.Down)).toBe(first);
  });

  /*
   * The snapshot going stale is the deliberate trade: re-deriving it on a
   * timer would send anyone reading page 3 back to page 1 every tick and drop
   * any bulk selection they had made. The page says when the window was taken
   * instead.
   */
  test("holds the snapshot still even as the clock moves on", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const first: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    jest.setSystemTime(new Date(NOW.getTime() + 60 * MS_PER_MINUTE));

    const again: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    expect(again).toBe(first);
    expect(again.getTime()).toBe(NOW.getTime() - FRESH_WINDOW_MS);
  });

  test("takes a new snapshot when the selection changes", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const up: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    jest.setSystemTime(new Date(NOW.getTime() + 5 * MS_PER_MINUTE));

    const down: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Down);

    expect(down).not.toBe(up);
    expect(down.getTime() - up.getTime()).toBe(5 * MS_PER_MINUTE);
    expect(cutoff.getSelection()).toBe(DeviceStatusFacetValue.Down);
  });

  /*
   * Switching away and back is a fresh look at the fleet, not a return to the
   * old window — otherwise the note on the page would claim a window the user
   * has just re-taken.
   */
  test("re-snapshots when the same selection is picked again after another", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const firstUp: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    cutoff.getCutoffFor(DeviceStatusFacetValue.Pending);
    jest.setSystemTime(new Date(NOW.getTime() + 9 * MS_PER_MINUTE));

    const secondUp: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    expect(secondUp).not.toBe(firstUp);
    expect(secondUp.getTime()).toBe(
      NOW.getTime() + 9 * MS_PER_MINUTE - FRESH_WINDOW_MS,
    );
  });

  test("clearing the chip is itself a selection change", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const up: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Up);

    jest.setSystemTime(new Date(NOW.getTime() + MS_PER_MINUTE));

    const cleared: Date = cutoff.getCutoffFor("");

    expect(cleared).not.toBe(up);
    expect(cutoff.getSelection()).toBe("");
    // And the empty selection is itself snapshotted, not re-derived per call.
    expect(cutoff.getCutoffFor("")).toBe(cleared);
  });

  /*
   * The page syncs this with the live selection every render, `null` included, and
   * that clear is load-bearing.
   *
   * Keyed on the value alone, "pick Down at 10:00, clear the chip, pick Down again
   * at 11:00" would hand back the 09:45 cutoff — so a device that went stale in
   * between would be missing from the Down list while the Status column painted it
   * Down, and the note under the bar would name 11:00. That disagreement is the
   * exact confusion the note exists to prevent.
   */
  test("clearing the chip and re-picking the same value takes a fresh window", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const first: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Down);

    // The chip is cleared: the page reports the live selection, which is now null.
    expect(cutoff.getCutoffFor(null)).not.toBe(first);
    expect(cutoff.getSelection()).toBeNull();

    jest.setSystemTime(new Date(NOW.getTime() + 60 * MS_PER_MINUTE));

    const second: Date = cutoff.getCutoffFor(DeviceStatusFacetValue.Down);

    expect(second).not.toBe(first);
    expect(second.getTime()).toBe(
      NOW.getTime() + 60 * MS_PER_MINUTE - FRESH_WINDOW_MS,
    );
  });

  // A cleared chip is still a snapshot, not a fresh window on every render.
  test("holds one snapshot while the chip stays cleared", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();
    const cleared: Date = cutoff.getCutoffFor(null);

    jest.setSystemTime(new Date(NOW.getTime() + 4 * MS_PER_MINUTE));

    expect(cutoff.getCutoffFor(null)).toBe(cleared);
  });

  /*
   * State per instance, not per module: two tables on screen (or a page
   * remounting) must not share one snapshot, or one of them silently filters
   * against the other's window.
   */
  test("each instance keeps its own snapshot", () => {
    const one: DeviceStatusCutoff = new DeviceStatusCutoff();
    const first: Date = one.getCutoffFor(DeviceStatusFacetValue.Up);

    jest.setSystemTime(new Date(NOW.getTime() + 3 * MS_PER_MINUTE));

    const two: DeviceStatusCutoff = new DeviceStatusCutoff();

    expect(two.getSelection()).toBeNull();
    expect(two.getCutoffFor(DeviceStatusFacetValue.Up)).not.toBe(first);
    expect(one.getCutoffFor(DeviceStatusFacetValue.Up)).toBe(first);
  });

  /*
   * The point of the whole mechanism, end to end: the query handed to
   * ModelTable has to serialise identically render after render while the
   * selection is unchanged, and change the moment the user picks another
   * value.
   */
  test("keeps the built query byte-identical across renders", () => {
    const cutoff: DeviceStatusCutoff = new DeviceStatusCutoff();

    function build(selection: DeviceStatusFacetValue): string {
      return JSON.stringify(
        buildDeviceStatusFacetQuery(
          [selection],
          "is",
          cutoff.getCutoffFor(selection),
        ),
      );
    }

    const first: string = build(DeviceStatusFacetValue.Up);

    jest.setSystemTime(new Date(NOW.getTime() + 7 * MS_PER_MINUTE));

    expect(build(DeviceStatusFacetValue.Up)).toBe(first);
    expect(build(DeviceStatusFacetValue.Down)).not.toBe(first);
  });
});

/*
 * Gates the "window taken at HH:MM" note. Up and Down are the only two values
 * defined against the freshness window, so they are the only two whose result
 * set is a snapshot; Pending is a plain NULL check and never drifts. A wrong
 * answer here either hides the explanation for a row whose pill has since
 * changed, or puts a misleading note over a list that cannot go stale.
 */
describe("isTimeBasedDeviceStatus", () => {
  test("up and down are", () => {
    expect(isTimeBasedDeviceStatus(DeviceStatusFacetValue.Up)).toBe(true);
    expect(isTimeBasedDeviceStatus(DeviceStatusFacetValue.Down)).toBe(true);
  });

  test("pending is not — a never-polled device does not go stale", () => {
    expect(isTimeBasedDeviceStatus(DeviceStatusFacetValue.Pending)).toBe(false);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
  ])("%s is not", (_label: string, value: string | null | undefined) => {
    expect(isTimeBasedDeviceStatus(value)).toBe(false);
  });

  test.each(JUNK_VALUES)("%s is not", (_label: string, raw: string) => {
    expect(isTimeBasedDeviceStatus(raw)).toBe(false);
  });

  test.each(ALL_INTERFACES_VALUES)(
    "the other chip's %s value is not",
    (value: DeviceInterfacesFacetValue) => {
      expect(isTimeBasedDeviceStatus(value)).toBe(false);
    },
  );

  /*
   * The real invariant, rather than a second hand-maintained list: a value is
   * time-based exactly when the query built for it carries a Date. Checked
   * against the query builder itself so the two cannot drift.
   */
  test("says yes exactly when the query carries the cutoff", () => {
    for (const value of ALL_STATUS_VALUES) {
      const query: unknown = buildDeviceStatusFacetQuery([value], "is", CUTOFF);
      const carriesTheCutoff: boolean =
        query instanceof CompareBase && query.value instanceof Date;

      expect(isTimeBasedDeviceStatus(value)).toBe(carriesTheCutoff);
    }
  });
});

/*
 * The options are what the chip can display. A value selectable in the URL
 * with no option behind it renders as a chip the user cannot read or clear;
 * an option with no branch in the query builder is a menu entry that does
 * nothing.
 */
describe("DEVICE_STATUS_FACET_OPTIONS", () => {
  test("offers every status value exactly once, in the order the tiles use", () => {
    expect(optionValues(DEVICE_STATUS_FACET_OPTIONS)).toEqual([
      "up",
      "down",
      "pending",
    ]);
  });

  test("every option's value is a real facet value", () => {
    for (const value of optionValues(DEVICE_STATUS_FACET_OPTIONS)) {
      expect(ALL_STATUS_VALUES).toContain(value);
    }
  });

  test("every facet value has exactly one option", () => {
    const values: Array<string> = optionValues(DEVICE_STATUS_FACET_OPTIONS);

    expect(new Set(values).size).toBe(values.length);

    for (const value of ALL_STATUS_VALUES) {
      expect(
        values.filter((candidate: string) => {
          return candidate === value;
        }),
      ).toHaveLength(1);
    }
  });

  test("every option is readable and distinct in the dropdown", () => {
    const labels: Array<string> = DEVICE_STATUS_FACET_OPTIONS.map(
      (option: FilterChipDropdownOption): string => {
        return option.label;
      },
    );

    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }

    expect(new Set(labels).size).toBe(labels.length);
  });

  /*
   * The sublabels are the only place the dropdown explains what "up" means, so
   * they have to quote the same window the query uses rather than a number
   * typed out by hand that can drift from the constant.
   */
  test("the time-based options explain themselves with the real window", () => {
    for (const option of DEVICE_STATUS_FACET_OPTIONS) {
      expect(option.sublabel).toBeTruthy();

      if (isTimeBasedDeviceStatus(option.value)) {
        expect(option.sublabel).toContain(
          `${DEVICE_FRESH_WINDOW_MINUTES} minutes`,
        );
      }
    }
  });
});

describe("DEVICE_INTERFACES_FACET_OPTIONS", () => {
  test("offers both interface values exactly once", () => {
    expect(optionValues(DEVICE_INTERFACES_FACET_OPTIONS)).toEqual([
      "some-down",
      "all-up",
    ]);
  });

  test("every option's value is a real facet value", () => {
    for (const value of optionValues(DEVICE_INTERFACES_FACET_OPTIONS)) {
      expect(ALL_INTERFACES_VALUES).toContain(value);
    }
  });

  test("every facet value has exactly one option", () => {
    const values: Array<string> = optionValues(DEVICE_INTERFACES_FACET_OPTIONS);

    expect(new Set(values).size).toBe(values.length);

    for (const value of ALL_INTERFACES_VALUES) {
      expect(
        values.filter((candidate: string) => {
          return candidate === value;
        }),
      ).toHaveLength(1);
    }
  });

  test("every option is readable and distinct in the dropdown", () => {
    const labels: Array<string> = DEVICE_INTERFACES_FACET_OPTIONS.map(
      (option: FilterChipDropdownOption): string => {
        return option.label;
      },
    );

    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }

    expect(new Set(labels).size).toBe(labels.length);
  });

  /*
   * Every option the menu offers has to resolve to a constraint — otherwise
   * picking it lights a chip over an unchanged list.
   */
  test("every option the menu offers actually filters", () => {
    for (const value of optionValues(DEVICE_INTERFACES_FACET_OPTIONS)) {
      expect(buildDeviceInterfacesFacetQuery([value], "is")).toBeTruthy();
    }
  });
});

/*
 * The contract the Sites page links against: its "Unassigned Devices" tile
 * counts `siteId IS NULL` and has to land the device list showing exactly those
 * rows. Both sides read this constant, so the two cannot disagree — but only as
 * long as it keeps naming the Site chip on its "is empty" operator.
 */
describe("UNASSIGNED_DEVICES_FACET_SELECTION", () => {
  test("moves the Site chip, not some other chip", () => {
    expect(UNASSIGNED_DEVICES_FACET_SELECTION.facetKey).toBe(
      DEVICE_SITE_FACET_KEY,
    );
    // `null` would mean "clear every chip", i.e. land on the unfiltered list.
    expect(UNASSIGNED_DEVICES_FACET_SELECTION.facetKey).not.toBeNull();
  });

  /*
   * "is empty" needs no values, and it is not "is not empty": the inverse
   * would open every *assigned* device — the exact complement of the count the
   * user clicked.
   */
  test("is the empty operator with no values to select", () => {
    expect(UNASSIGNED_DEVICES_FACET_SELECTION.values).toEqual([]);
    expect(UNASSIGNED_DEVICES_FACET_SELECTION.operator).toBe("is_empty");
  });

  test("asks the column, which is the only thing that can answer 'no site'", () => {
    expect(DEVICE_FACET_QUERY_FIELDS.site).toBe("siteId");
  });
});
