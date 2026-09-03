import { describe, expect, test } from "@jest/globals";
import {
  DEVICE_SUMMARY_TILES,
  DeviceSummaryTile,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryTiles";
import {
  DEVICE_INTERFACES_FACET_KEY,
  DEVICE_INTERFACES_FACET_OPTIONS,
  DEVICE_STATUS_FACET_KEY,
  DEVICE_STATUS_FACET_OPTIONS,
  DeviceInterfacesFacetValue,
  DeviceStatusFacetValue,
  buildDeviceInterfacesFacetQuery,
  buildDeviceStatusFacetQuery,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import {
  FacetOperatorMap,
  FacetSelectionMap,
  FacetTileSelection,
  isFacetTileSelectionApplied,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";
import { FilterChipDropdownOption } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import IsNull from "Common/Types/BaseDatabase/IsNull";

/*
 * DEVICE_SUMMARY_TILES is the contract between the number on a tile and the rows
 * a click on that tile produces. The tile owns no private query any more: it
 * moves a chip on the facet bar, so the count, the chip the user ends up looking
 * at and the rows the table fetches are all derived from the one `selection`
 * declared here.
 *
 * That makes every way of getting it wrong quiet rather than loud. A tile
 * pointing at a value the chip cannot display lights up a blank chip; a tile
 * whose values the query builder does not recognise leaves the list unnarrowed
 * while the tile looks pressed. So these tests walk each selection all the way
 * out through the chips' own option lists and query builders instead of
 * comparing it against a literal copied out of the module.
 */

const ALL_STATUS_VALUES: Array<DeviceStatusFacetValue> = Object.values(
  DeviceStatusFacetValue,
);

/*
 * The option list behind each chip a tile is allowed to move — i.e. the values
 * the dropdown can actually render a label for.
 */
const FACET_OPTIONS: { [facetKey: string]: Array<FilterChipDropdownOption> } = {
  [DEVICE_STATUS_FACET_KEY]: DEVICE_STATUS_FACET_OPTIONS,
  [DEVICE_INTERFACES_FACET_KEY]: DEVICE_INTERFACES_FACET_OPTIONS,
};

type TileByKeyFunction = (key: string) => DeviceSummaryTile;

const tileByKey: TileByKeyFunction = (key: string): DeviceSummaryTile => {
  const tile: DeviceSummaryTile | undefined = DEVICE_SUMMARY_TILES.find(
    (candidate: DeviceSummaryTile) => {
      return candidate.key === key;
    },
  );

  if (!tile) {
    throw new Error(`No device summary tile with key "${key}"`);
  }

  return tile;
};

type GetFacetOptionValuesFunction = (facetKey: string) => Array<string>;

const getFacetOptionValues: GetFacetOptionValuesFunction = (
  facetKey: string,
): Array<string> => {
  const options: Array<FilterChipDropdownOption> | undefined =
    FACET_OPTIONS[facetKey];

  if (!options) {
    throw new Error(`No option list is exported for the facet "${facetKey}"`);
  }

  return options.map((option: FilterChipDropdownOption) => {
    return option.value;
  });
};

interface FacetBarState {
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
}

type BarStateForFunction = (selection: FacetTileSelection) => FacetBarState;

/** The bar exactly as a click on this tile would leave it. */
const barStateFor: BarStateForFunction = (
  selection: FacetTileSelection,
): FacetBarState => {
  if (selection.facetKey === null) {
    return { facetSelections: {}, facetOperators: {} };
  }

  return {
    facetSelections: { [selection.facetKey]: selection.values },
    facetOperators: { [selection.facetKey]: selection.operator },
  };
};

type StatusTilesFunction = () => Array<DeviceSummaryTile>;

const statusTiles: StatusTilesFunction = (): Array<DeviceSummaryTile> => {
  return DEVICE_SUMMARY_TILES.filter((tile: DeviceSummaryTile) => {
    return tile.selection.facetKey === DEVICE_STATUS_FACET_KEY;
  });
};

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
   * The key is the React key and the `data-testid` suffix. A duplicate makes
   * React reuse one card's DOM for another and makes the E2E selectors
   * ambiguous, so a click lands on whichever card the query happened to find.
   */
  test("the keys are unique", () => {
    const keys: Array<string> = DEVICE_SUMMARY_TILES.map(
      (tile: DeviceSummaryTile) => {
        return tile.key;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  /*
   * The labels are the product surface, unchanged by the move to facets — the
   * tiles became chip-movers, they did not become different tiles.
   */
  test("keeps the original labels", () => {
    expect(
      DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile) => {
        return tile.label;
      }),
    ).toEqual([
      "Devices Up",
      "Devices Down",
      "Devices Pending",
      "Total Interfaces Down",
    ]);
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
    expect(new Set(countFields).size).toBe(countFields.length);
  });

  /*
   * Every field the card renders has to be present: a tile with no caption
   * leaves a card that is a bare number with no statement of what was counted,
   * and a missing colour class renders the count unstyled rather than red.
   */
  test("every tile carries the copy and both colours the card renders", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(tile.label.length).toBeGreaterThan(0);
      expect(tile.caption.length).toBeGreaterThan(0);
      expect(tile.attentionClassName.length).toBeGreaterThan(0);
      expect(tile.allClearClassName.length).toBeGreaterThan(0);
    }
  });

  /*
   * The caption is the only place a card says what it counted, and what it
   * counts is now the outcome of the last poll — not its age. A caption that
   * goes back to promising a time window is a caption that has stopped
   * describing the query underneath it (issue #3220).
   */
  test("the Up and Down captions describe the last poll's outcome", () => {
    expect(tileByKey("devices-up").caption).toContain("reached the device");
    expect(tileByKey("devices-down").caption).toContain(
      "could not reach the device",
    );
  });

  test("no device-status caption promises a freshness window", () => {
    for (const key of ["devices-up", "devices-down", "devices-pending"]) {
      expect(tileByKey(key).caption).not.toMatch(/minutes/i);
    }
  });

  /*
   * The counts now include monitor-backed devices — the server keeps
   * `isReachable` in step with the bound monitor's status — so a caption
   * that credits every verdict to "the last SNMP poll" describes half the
   * fleet. The poll may still be named, but only beside the monitor.
   */
  test("the Up and Down captions credit the bound monitor as well as the poll", () => {
    for (const key of ["devices-up", "devices-down"]) {
      const caption: string = tileByKey(key).caption;

      expect(caption).toContain("bound monitor");
      expect(caption).toContain("SNMP poll");
    }
  });

  test("the Pending caption names a missing monitor as one way to be pending", () => {
    expect(tileByKey("devices-pending").caption.toLowerCase()).toContain(
      "no monitor bound",
    );
  });

  /*
   * Unlike the Sites strip — where the total clears the bar and Unassigned
   * Devices leaves the page — every device tile narrows this page's own list. A
   * null facetKey here would mean the tile clears the bar instead, so the click
   * would widen the list the tile had just counted a subset of.
   */
  test("every tile moves a chip on this page, none clears the bar", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(tile.selection.facetKey).not.toBeNull();
      expect(typeof tile.selection.facetKey).toBe("string");
    }
  });
});

describe("the chip each tile stands for", () => {
  test("Devices Up selects Up on the Status chip", () => {
    expect(tileByKey("devices-up").selection).toEqual({
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Up],
      operator: "is",
    });
  });

  test("Devices Down / Stale selects Down on the Status chip", () => {
    expect(tileByKey("devices-down").selection).toEqual({
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Down],
      operator: "is",
    });
  });

  test("Devices Pending selects Pending on the Status chip", () => {
    expect(tileByKey("devices-pending").selection).toEqual({
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Pending],
      operator: "is",
    });
  });

  /*
   * The count is of interfaces but the rows are devices, so this tile moves the
   * Interfaces chip to "Some down" — a predicate about devices — rather than
   * anything that would claim to list interfaces.
   */
  test("Total Interfaces Down selects Some down on the Interfaces chip", () => {
    expect(tileByKey("interfaces-down").selection).toEqual({
      facetKey: DEVICE_INTERFACES_FACET_KEY,
      values: [DeviceInterfacesFacetValue.SomeDown],
      operator: "is",
    });
  });

  /*
   * A tile may only select values its chip can display. Selecting anything else
   * lights the chip up over a value the dropdown has no label for, so the bar
   * renders a chip that reads as blank while the table is genuinely filtered —
   * the user can see the list is short and cannot see why.
   */
  test("every selected value is one the chip offers", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      const offered: Array<string> = getFacetOptionValues(
        tile.selection.facetKey!,
      );

      expect(tile.selection.values.length).toBeGreaterThan(0);
      for (const value of tile.selection.values) {
        expect(offered).toContain(value);
      }
    }
  });

  /*
   * The Status and Interfaces chips are single-select ranges over one column:
   * "is not up" would silently drop never-polled devices (NULL loses both
   * comparisons) while reading as though it included them, and their builders
   * return undefined for every operator but "is". A tile arriving on any other
   * operator therefore filters nothing at all.
   */
  test("every selection uses the only operator its chip supports", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(tile.selection.operator).toBe("is");
    }
  });

  test("no two tiles move the same chip to the same values", () => {
    const fingerprints: Array<string> = DEVICE_SUMMARY_TILES.map(
      (tile: DeviceSummaryTile) => {
        return JSON.stringify(tile.selection);
      },
    );

    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});

/*
 * The three Status counts are presented as a breakdown of the fleet — they are
 * meant to sum to it. That only holds while the three tiles select three
 * different values and between them use up every value the chip has: a missing
 * value is a slice of the fleet no tile can reach, and a duplicated one is two
 * tiles opening the same rows under different numbers.
 */
describe("the Status tiles partition the fleet", () => {
  test("there are exactly three of them", () => {
    expect(statusTiles()).toHaveLength(3);
  });

  test("they select three different values", () => {
    const selected: Array<string> = statusTiles().flatMap(
      (tile: DeviceSummaryTile) => {
        return tile.selection.values;
      },
    );

    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
  });

  test("between them they cover every Status value", () => {
    const selected: Array<string> = statusTiles().flatMap(
      (tile: DeviceSummaryTile) => {
        return tile.selection.values;
      },
    );

    expect([...selected].sort()).toEqual([...ALL_STATUS_VALUES].sort());
  });

  /*
   * Each tile takes exactly one value. Two values on one Status tile would not
   * even produce a filter — the builder refuses a multi-value Status selection,
   * because three ranges over one column cannot be OR'd into a single field
   * query.
   */
  test("each selects a single value", () => {
    for (const tile of statusTiles()) {
      expect(tile.selection.values).toHaveLength(1);
    }
  });
});

/*
 * The end of the chain: the values a tile hands the bar have to be values the
 * bar's own query builder recognises. An unrecognised one comes back as
 * `undefined` — "do not constrain this column" — so the click would light the
 * chip, leave the list untouched, and offer nothing to explain the mismatch
 * between the tile's number and the row count underneath it.
 */
describe("every selection reaches a real query", () => {
  test("each Status tile's values build a constraint", () => {
    for (const tile of statusTiles()) {
      expect(
        buildDeviceStatusFacetQuery(
          tile.selection.values,
          tile.selection.operator,
        ),
      ).not.toBeUndefined();
    }
  });

  /*
   * And the constraint is the one DeviceSummaryCards counted with, per tile:
   * `isReachable` true for Up, false for Down, IS NULL for Pending. Swap any
   * two and the tile opens a different set than it counted.
   */
  test("each Status tile builds the constraint its count was taken with", () => {
    expect(
      buildDeviceStatusFacetQuery(
        tileByKey("devices-up").selection.values,
        tileByKey("devices-up").selection.operator,
      ),
    ).toBe(true);

    expect(
      buildDeviceStatusFacetQuery(
        tileByKey("devices-down").selection.values,
        tileByKey("devices-down").selection.operator,
      ),
    ).toBe(false);

    expect(
      buildDeviceStatusFacetQuery(
        tileByKey("devices-pending").selection.values,
        tileByKey("devices-pending").selection.operator,
      ),
    ).toBeInstanceOf(IsNull);
  });

  /*
   * true / false / NULL are the only three states of the column, so the three
   * tiles partition the fleet exactly and their counts always sum to its size
   * — with no instant-in-time for a device to fall through between them, which
   * is what the old pair of window comparisons could not promise.
   */
  test("the three Status tiles partition the column with no gap", () => {
    const constraints: Array<unknown> = [
      "devices-up",
      "devices-down",
      "devices-pending",
    ].map((key: string): unknown => {
      return buildDeviceStatusFacetQuery(
        tileByKey(key).selection.values,
        tileByKey(key).selection.operator,
      );
    });

    expect(constraints[0]).toBe(true);
    expect(constraints[1]).toBe(false);
    expect(constraints[2]).toBeInstanceOf(IsNull);
    expect(new Set(constraints.map(String)).size).toBe(3);
  });

  /*
   * The interfaces tile counts interfaces and the list can only show devices,
   * so its constraint is "at least one interface down" — the same query the
   * card sums its count over.
   */
  test("the Interfaces tile's values build interfacesDown > 0", () => {
    const query: unknown = buildDeviceInterfacesFacetQuery(
      tileByKey("interfaces-down").selection.values,
      tileByKey("interfaces-down").selection.operator,
    );

    expect(query).toBeDefined();
    expect(query).toBeInstanceOf(GreaterThan);
    expect((query as GreaterThan<number>).value).toBe(0);
  });
});

/*
 * `isFacetTileSelectionApplied` drives both the pressed state of a tile and
 * whether a second click narrows or backs out. Exactly one tile may report
 * applied for a given bar: a second one lighting up claims the list is showing
 * its rows too, and — because the same predicate decides the toggle — makes the
 * next click on it clear a chip the user never set from there.
 */
describe("a tile's pressed state", () => {
  test("each tile's own selection lights exactly that tile", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      const state: FacetBarState = barStateFor(tile.selection);

      const applied: Array<string> = DEVICE_SUMMARY_TILES.filter(
        (candidate: DeviceSummaryTile) => {
          return isFacetTileSelectionApplied(
            candidate.selection,
            state.facetSelections,
            state.facetOperators,
          );
        },
      ).map((candidate: DeviceSummaryTile) => {
        return candidate.key;
      });

      expect(applied).toEqual([tile.key]);
    }
  });

  test("an untouched bar lights none of them", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(isFacetTileSelectionApplied(tile.selection, {}, {})).toBe(false);
    }
  });

  /*
   * A cleared chip is the state a second click leaves behind, and the tile has
   * to read as unpressed there — otherwise the toggle sticks on and the tile
   * can never be turned off.
   */
  test("a chip cleared back to no values lights none of them", () => {
    for (const tile of DEVICE_SUMMARY_TILES) {
      expect(
        isFacetTileSelectionApplied(
          tile.selection,
          { [tile.selection.facetKey!]: [] },
          { [tile.selection.facetKey!]: "is" },
        ),
      ).toBe(false);
    }
  });

  /*
   * The bar also carries Owner and Labels chips the tiles know nothing about.
   * Narrowing further with one of those must not unpress the tile — the tile's
   * rows are still the rows being shown, just fewer of them.
   */
  test("an unrelated chip alongside it does not unpress it", () => {
    const tile: DeviceSummaryTile = tileByKey("devices-down");
    const state: FacetBarState = barStateFor(tile.selection);

    state.facetSelections["someOtherFacet"] = ["a4f1"];
    state.facetOperators["someOtherFacet"] = "is";

    expect(
      isFacetTileSelectionApplied(
        tile.selection,
        state.facetSelections,
        state.facetOperators,
      ),
    ).toBe(true);
  });

  /*
   * The chip stores whatever the user clicked, which can include a value twice
   * over a reload. Duplicates are noise, not a different selection, so the tile
   * stays pressed and its second click still backs out.
   */
  test("a duplicated value on the chip does not unpress it", () => {
    const tile: DeviceSummaryTile = tileByKey("devices-pending");

    expect(
      isFacetTileSelectionApplied(
        tile.selection,
        {
          [tile.selection.facetKey!]: [
            ...tile.selection.values,
            ...tile.selection.values,
          ],
        },
        { [tile.selection.facetKey!]: tile.selection.operator },
      ),
    ).toBe(true);
  });
});
