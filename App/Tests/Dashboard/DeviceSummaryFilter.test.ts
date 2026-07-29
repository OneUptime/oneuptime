import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  DEVICE_SUMMARY_FILTER_URL_PARAM,
  DEVICE_SUMMARY_TILES,
  DeviceSummaryFilterDefinition,
  DeviceSummaryFilterKey,
  DeviceSummaryTile,
  getDeviceFreshCutoff,
  getDeviceSummaryFilterConflictingFilterFields,
  getDeviceSummaryFilterDefinition,
  getDeviceSummaryFilterQuery,
  isDeviceSummaryFilterTimeBased,
  parseDeviceSummaryFilterKey,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryFilter";
import { DEVICE_FRESH_WINDOW_MINUTES } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import Query from "Common/Types/BaseDatabase/Query";

/*
 * DeviceSummaryFilter is the contract between a number on a tile and the rows
 * that number counted. If the two ever describe different sets, the product
 * lies: the tile says "3 devices down", the list it opens shows 5, and there
 * is nothing on screen to explain the difference.
 *
 * So these tests pin the query fragments field-by-field and operator-by-
 * operator against the count queries in DeviceSummaryCards.tsx, rather than
 * merely checking that "some query" comes back.
 */

// The frozen "now" the time-dependent tests run at.
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");
const MS_PER_MINUTE: number = 60 * 1000;

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

const ALL_KEYS: Array<DeviceSummaryFilterKey> = Object.values(
  DeviceSummaryFilterKey,
);

describe("DeviceSummaryFilterKey", () => {
  /*
   * These strings are in shared URLs. Renaming one silently breaks every link
   * already pasted into a ticket or a chat, so the rename has to be a
   * conscious edit of this test.
   */
  test("the wire values are stable", () => {
    expect(DeviceSummaryFilterKey.Up).toBe("up");
    expect(DeviceSummaryFilterKey.Down).toBe("down");
    expect(DeviceSummaryFilterKey.Pending).toBe("pending");
    expect(DeviceSummaryFilterKey.InterfacesDown).toBe("interfaces-down");
    expect(DeviceSummaryFilterKey.NoSite).toBe("no-site");
  });

  test("there are exactly five, and they are distinct", () => {
    expect(ALL_KEYS).toHaveLength(5);
    expect(new Set(ALL_KEYS).size).toBe(5);
  });

  test("the URL parameter name is stable", () => {
    expect(DEVICE_SUMMARY_FILTER_URL_PARAM).toBe("deviceFilter");
  });
});

describe("parseDeviceSummaryFilterKey", () => {
  test.each(ALL_KEYS)("round-trips %s", (key: DeviceSummaryFilterKey) => {
    expect(parseDeviceSummaryFilterKey(key)).toBe(key);
  });

  describe("absent values read as no filter", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
    ])("%s", (_label: string, raw: string | null | undefined) => {
      expect(parseDeviceSummaryFilterKey(raw)).toBeNull();
    });
  });

  /*
   * The parameter is in the address bar, so its value is whatever anyone
   * chooses to type. Nothing but an exact key may reach the query builder —
   * an unrecognised value has to degrade to the unfiltered list, never to a
   * malformed query or a thrown error that blanks the page.
   */
  describe("hostile and stale values read as no filter", () => {
    test.each([
      ["unknown word", "banana"],
      ["a key that used to exist", "devices-up"],
      ["wrong case", "UP"],
      ["mixed case", "Down"],
      ["leading whitespace", " up"],
      ["trailing whitespace", "up "],
      ["a prefix of a real key", "pen"],
      ["a real key with a suffix", "up-x"],
      ["an Object.prototype member", "constructor"],
      ["a prototype-pollution attempt", "__proto__"],
      ["another prototype member", "toString"],
      ["a number", "0"],
      ["a JSON payload", '{"lastSeenAt":null}'],
      ["a SQL fragment", "1' OR '1'='1"],
    ])("%s", (_label: string, raw: string) => {
      expect(parseDeviceSummaryFilterKey(raw)).toBeNull();
    });
  });

  test("never returns a value that is not one of the keys", () => {
    for (const raw of ["up", "down", "nonsense", "", "__proto__"]) {
      const parsed: DeviceSummaryFilterKey | null =
        parseDeviceSummaryFilterKey(raw);
      if (parsed !== null) {
        expect(ALL_KEYS).toContain(parsed);
      }
    }
  });
});

describe("getDeviceFreshCutoff", () => {
  beforeEach(() => {
    freezeTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("is the freshness window ago", () => {
    expect(getDeviceFreshCutoff().getTime()).toBe(
      NOW.getTime() - DEVICE_FRESH_WINDOW_MINUTES * MS_PER_MINUTE,
    );
  });

  /*
   * The Status column's pill, the tile counts and the drill-down query all
   * have to agree on where "up" ends. They agree because all three read this
   * one constant.
   */
  test("uses the same window as the Status pill", () => {
    expect(DEVICE_FRESH_WINDOW_MINUTES).toBe(15);
  });
});

describe("getDeviceSummaryFilterQuery", () => {
  beforeEach(() => {
    freezeTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("no selection is an empty fragment, not a special case", () => {
    expect(getDeviceSummaryFilterQuery(null)).toEqual({});
  });

  test("every key produces a fragment naming exactly one column", () => {
    for (const key of ALL_KEYS) {
      expect(Object.keys(getDeviceSummaryFilterQuery(key))).toHaveLength(1);
    }
  });

  /*
   * The fragment is merged over the page's base query, which is what carries
   * `isArchived: false`. If the fragment started carrying scoping of its own,
   * one of the two would eventually be edited without the other.
   */
  test.each(ALL_KEYS)(
    "%s carries no scoping of its own",
    (key: DeviceSummaryFilterKey) => {
      const query: Query<NetworkDevice> = getDeviceSummaryFilterQuery(key);
      expect(query.projectId).toBeUndefined();
      expect(query.isArchived).toBeUndefined();
    },
  );

  describe("Up — the devices the 'Devices Up' tile counted", () => {
    /*
     * DeviceSummaryCards counts these with
     * `lastSeenAt: new GreaterThanOrEqual(freshCutoff)`. Anything else here
     * and the tile opens a different set than it counted.
     */
    test("is lastSeenAt >= the fresh cutoff", () => {
      const query: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Up,
      );

      expect(query.lastSeenAt).toBeInstanceOf(GreaterThanOrEqual);
      expect(
        (query.lastSeenAt as GreaterThanOrEqual<Date>).value.getTime(),
      ).toBe(getDeviceFreshCutoff().getTime());
    });

    test("is inclusive of the boundary, matching DeviceStatusUtil", () => {
      // getStatus() calls a device seen exactly at the cutoff "Up".
      expect(
        getDeviceSummaryFilterQuery(DeviceSummaryFilterKey.Up).lastSeenAt,
      ).not.toBeInstanceOf(GreaterThan);
    });
  });

  describe("Down — the devices the 'Devices Down / Stale' tile counted", () => {
    test("is lastSeenAt < the fresh cutoff", () => {
      const query: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Down,
      );

      expect(query.lastSeenAt).toBeInstanceOf(LessThan);
      expect((query.lastSeenAt as LessThan<Date>).value.getTime()).toBe(
        getDeviceFreshCutoff().getTime(),
      );
    });
  });

  describe("Pending — the devices the 'Devices Pending' tile counted", () => {
    test("is lastSeenAt IS NULL", () => {
      const query: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Pending,
      );

      expect(query.lastSeenAt).toBeInstanceOf(IsNull);
    });

    /*
     * A never-polled device has to land in Pending and nowhere else. SQL
     * evaluates both `NULL >= x` and `NULL < x` as unknown, so it is dropped
     * from Up and Down — but only as long as those two stay comparisons.
     * The moment either becomes a coalescing operator (GreaterThanOrNull,
     * LessThanOrNull) pending devices get counted twice.
     */
    test("Up and Down stay plain comparisons, so pending devices match neither", () => {
      const up: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Up,
      );
      const down: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Down,
      );

      expect(up.lastSeenAt!.constructor.name).toBe("GreaterThanOrEqual");
      expect(down.lastSeenAt!.constructor.name).toBe("LessThan");
    });
  });

  describe("the three status filters partition the fleet", () => {
    test("all three filter the same column", () => {
      for (const key of [
        DeviceSummaryFilterKey.Up,
        DeviceSummaryFilterKey.Down,
        DeviceSummaryFilterKey.Pending,
      ]) {
        expect(Object.keys(getDeviceSummaryFilterQuery(key))).toEqual([
          "lastSeenAt",
        ]);
      }
    });

    /*
     * Up is >= cutoff and Down is < cutoff at the SAME instant. If the two
     * ever drifted apart — a rounded cutoff on one side, a different window
     * on the other — devices in the gap would appear in neither list while
     * still being counted by one of the tiles.
     */
    test("Up and Down meet exactly at one instant, with no gap and no overlap", () => {
      const up: GreaterThanOrEqual<Date> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Up,
      ).lastSeenAt as GreaterThanOrEqual<Date>;
      const down: LessThan<Date> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.Down,
      ).lastSeenAt as LessThan<Date>;

      expect(up.value.getTime()).toBe(down.value.getTime());
    });
  });

  describe("InterfacesDown — the 'Total Interfaces Down' tile", () => {
    /*
     * The tile counts interfaces; the list can only show devices. So the
     * filter is "devices with at least one interface down" — the same query
     * DeviceSummaryCards uses to fetch the devices it sums over.
     */
    test("is interfacesDown > 0", () => {
      const query: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.InterfacesDown,
      );

      expect(query.interfacesDown).toBeInstanceOf(GreaterThan);
      expect((query.interfacesDown as GreaterThan<number>).value).toBe(0);
    });

    test("does not touch lastSeenAt — a stale device can still have interfaces down", () => {
      expect(
        getDeviceSummaryFilterQuery(DeviceSummaryFilterKey.InterfacesDown)
          .lastSeenAt,
      ).toBeUndefined();
    });
  });

  describe("NoSite — where the Sites page's 'Unassigned Devices' tile lands", () => {
    /*
     * Matches the count query in SiteSummaryCards, which is
     * `siteId: new IsNull()` — the FK, not the relation. A site-less device
     * has no NetworkSite row to join against.
     */
    test("is siteId IS NULL", () => {
      const query: Query<NetworkDevice> = getDeviceSummaryFilterQuery(
        DeviceSummaryFilterKey.NoSite,
      );

      expect(query.siteId).toBeInstanceOf(IsNull);
      expect(query.site).toBeUndefined();
    });
  });

  /*
   * The Devices page memoises this fragment on the selected key. These two
   * tests are why: the value embeds the wall clock, and ModelTable decides
   * whether to refetch by JSON-comparing the previous `query` prop with the
   * next one. Rebuilt on every render, it would compare unequal on every
   * render — an unbounded refetch loop against the API.
   *
   * If the memo is ever "simplified" away, the second test below is the
   * standing explanation of what that costs.
   */
  describe("serialised stability (why the page memoises)", () => {
    test("two calls at the same instant serialise identically", () => {
      expect(
        JSON.stringify(getDeviceSummaryFilterQuery(DeviceSummaryFilterKey.Up)),
      ).toBe(
        JSON.stringify(getDeviceSummaryFilterQuery(DeviceSummaryFilterKey.Up)),
      );
    });

    test("two calls a second apart do not", () => {
      const first: string = JSON.stringify(
        getDeviceSummaryFilterQuery(DeviceSummaryFilterKey.Up),
      );

      jest.setSystemTime(new Date(NOW.getTime() + 1000));

      expect(
        JSON.stringify(getDeviceSummaryFilterQuery(DeviceSummaryFilterKey.Up)),
      ).not.toBe(first);
    });

    test("the clock-free filters are stable whenever they are built", () => {
      for (const key of [
        DeviceSummaryFilterKey.Pending,
        DeviceSummaryFilterKey.InterfacesDown,
        DeviceSummaryFilterKey.NoSite,
      ]) {
        const first: string = JSON.stringify(getDeviceSummaryFilterQuery(key));
        jest.setSystemTime(new Date(NOW.getTime() + 60 * MS_PER_MINUTE));
        expect(JSON.stringify(getDeviceSummaryFilterQuery(key))).toBe(first);
      }
    });
  });
});

describe("getDeviceSummaryFilterDefinition", () => {
  test.each(ALL_KEYS)(
    "%s has a chip label and empty-state copy",
    (key: DeviceSummaryFilterKey) => {
      const definition: DeviceSummaryFilterDefinition =
        getDeviceSummaryFilterDefinition(key);

      expect(definition.key).toBe(key);
      expect(definition.chipLabel.length).toBeGreaterThan(0);
      expect(definition.emptyMessage.length).toBeGreaterThan(0);
    },
  );

  test("no two filters present the same chip", () => {
    const labels: Array<string> = ALL_KEYS.map(
      (key: DeviceSummaryFilterKey) => {
        return getDeviceSummaryFilterDefinition(key).chipLabel;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  /*
   * The tile says "Total Interfaces Down" and its count is a number of
   * interfaces; the rows underneath are devices. The chip is the only place
   * that discrepancy can be explained, so it has to name devices.
   */
  test("the interfaces chip says devices, because that is what the rows are", () => {
    expect(
      getDeviceSummaryFilterDefinition(DeviceSummaryFilterKey.InterfacesDown)
        .chipLabel,
    ).toBe("Devices with interfaces down");
  });

  test("the empty-state copy explains the filtered set, not the fleet", () => {
    expect(
      getDeviceSummaryFilterDefinition(DeviceSummaryFilterKey.Down)
        .emptyMessage,
    ).toContain(`${DEVICE_FRESH_WINDOW_MINUTES} minutes`);
  });
});

/*
 * BaseModelTable builds its request as `{...props.query, ...columnFilterQuery}`
 * — the popup's filters are spread OVER the page's query. So a tile filter and
 * a column filter naming the same field cannot coexist: the column filter wins
 * outright and the chip is left claiming a constraint that was dropped. The
 * Devices page removes the offending column filter for as long as the tile
 * filter is active, and this is the list it removes.
 */
describe("getDeviceSummaryFilterConflictingFilterFields", () => {
  test("no selection conflicts with nothing", () => {
    expect(getDeviceSummaryFilterConflictingFilterFields(null)).toEqual([]);
  });

  test.each([
    DeviceSummaryFilterKey.Up,
    DeviceSummaryFilterKey.Down,
    DeviceSummaryFilterKey.Pending,
  ])(
    "%s owns the Last Seen At column filter",
    (key: DeviceSummaryFilterKey) => {
      expect(getDeviceSummaryFilterConflictingFilterFields(key)).toEqual([
        "lastSeenAt",
      ]);
    },
  );

  /*
   * The count and this filter use the foreign key; the device table's "Site"
   * filter goes through the relation. Different keys, same column — so they
   * survive the merge as an AND that can never match, emptying the table under
   * a chip that says these are the unassigned devices. Both names have to go.
   */
  test("the no-site filter owns both spellings of the site column", () => {
    expect(
      getDeviceSummaryFilterConflictingFilterFields(
        DeviceSummaryFilterKey.NoSite,
      ),
    ).toEqual(["site", "siteId"]);
  });

  test("the interfaces filter conflicts with nothing the table offers", () => {
    expect(
      getDeviceSummaryFilterConflictingFilterFields(
        DeviceSummaryFilterKey.InterfacesDown,
      ),
    ).toEqual([]);
  });

  /*
   * The real invariant: whatever column a filter constrains, the field the
   * table offers over that same column must be listed. Checked against the
   * query fragments themselves so a new filter cannot be added without either
   * declaring its conflicts or being deliberately exempted here.
   */
  test.each(ALL_KEYS)(
    "%s declares a conflict for every column it constrains",
    (key: DeviceSummaryFilterKey) => {
      const declared: Array<string> =
        getDeviceSummaryFilterConflictingFilterFields(key);

      for (const column of Object.keys(getDeviceSummaryFilterQuery(key))) {
        if (column === "interfacesDown") {
          // The device table offers no filter over interface counts.
          continue;
        }

        expect(declared).toContain(column);
      }
    },
  );
});

/*
 * Up and Down are the only two defined against the wall clock, so they are the
 * only two whose result set is a snapshot. The page labels those with the
 * moment the snapshot was taken; labelling the others would be noise.
 */
describe("isDeviceSummaryFilterTimeBased", () => {
  test("up and down are", () => {
    expect(isDeviceSummaryFilterTimeBased(DeviceSummaryFilterKey.Up)).toBe(
      true,
    );
    expect(isDeviceSummaryFilterTimeBased(DeviceSummaryFilterKey.Down)).toBe(
      true,
    );
  });

  test.each([
    DeviceSummaryFilterKey.Pending,
    DeviceSummaryFilterKey.InterfacesDown,
    DeviceSummaryFilterKey.NoSite,
  ])("%s is not", (key: DeviceSummaryFilterKey) => {
    expect(isDeviceSummaryFilterTimeBased(key)).toBe(false);
  });

  test("no selection is not", () => {
    expect(isDeviceSummaryFilterTimeBased(null)).toBe(false);
  });

  /*
   * The two lists have to agree: a filter is time-based exactly when its query
   * carries a cutoff Date. Pinned by serialising the same filter at two
   * different instants — only a clock-dependent one changes.
   */
  test("matches which filters actually read the clock", () => {
    freezeTime(NOW);

    try {
      for (const key of ALL_KEYS) {
        const first: string = JSON.stringify(getDeviceSummaryFilterQuery(key));
        jest.setSystemTime(new Date(NOW.getTime() + 60 * MS_PER_MINUTE));
        const second: string = JSON.stringify(getDeviceSummaryFilterQuery(key));

        expect(isDeviceSummaryFilterTimeBased(key)).toBe(first !== second);
        jest.setSystemTime(NOW);
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("DEVICE_SUMMARY_TILES", () => {
  test("is the four tiles the page has always shown, in order", () => {
    expect(
      DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {
        return tile.key;
      }),
    ).toEqual([
      "devices-up",
      "devices-down",
      "devices-pending",
      "interfaces-down",
    ]);
  });

  /*
   * The labels are the product surface, unchanged by this feature — the
   * tiles became clickable, they did not become different tiles.
   */
  test("keeps the original labels", () => {
    expect(
      DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {
        return tile.label;
      }),
    ).toEqual([
      "Devices Up",
      "Devices Down / Stale",
      "Devices Pending",
      "Total Interfaces Down",
    ]);
  });

  test("every tile drills into a distinct filter", () => {
    const filterKeys: Array<DeviceSummaryFilterKey> = DEVICE_SUMMARY_TILES.map(
      (tile: DeviceSummaryTile) => {
        return tile.filterKey;
      },
    );

    expect(new Set(filterKeys).size).toBe(DEVICE_SUMMARY_TILES.length);
    for (const filterKey of filterKeys) {
      expect(ALL_KEYS).toContain(filterKey);
    }
  });

  test("each tile reads a distinct count", () => {
    const countFields: Array<string> = DEVICE_SUMMARY_TILES.map(
      (tile: DeviceSummaryTile) => {
        return tile.countField;
      },
    );

    expect(countFields).toEqual([
      "devicesUp",
      "devicesDown",
      "devicesPending",
      "interfacesDown",
    ]);
  });

  /*
   * NoSite is reachable only by following the Sites page's Unassigned
   * Devices tile. Adding it to the strip here would put a fifth card on a
   * four-column grid and duplicate a count that belongs to the other page.
   */
  test("does not surface the cross-page 'no site' filter as a tile", () => {
    expect(
      DEVICE_SUMMARY_TILES.some((tile: DeviceSummaryTile) => {
        return tile.filterKey === DeviceSummaryFilterKey.NoSite;
      }),
    ).toBe(false);
  });

  test("every tile keeps both a resting and an attention colour", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(tile.attentionClassName.length).toBeGreaterThan(0);
      expect(tile.allClearClassName).toBe("text-gray-900");
      expect(tile.caption.length).toBeGreaterThan(0);
    }
  });

  test("the captions still quote the freshness window", () => {
    const upTile: DeviceSummaryTile = DEVICE_SUMMARY_TILES[0]!;
    const downTile: DeviceSummaryTile = DEVICE_SUMMARY_TILES[1]!;

    expect(upTile.caption).toContain(`${DEVICE_FRESH_WINDOW_MINUTES} minutes`);
    expect(downTile.caption).toContain(
      `${DEVICE_FRESH_WINDOW_MINUTES} minutes`,
    );
  });
});
