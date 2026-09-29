import {
  FacetOperatorMap,
  FacetSelectionMap,
  FacetTileSelection,
  applyFacetTileSelection,
  hasAnyFacetSelection,
  isFacetTileSelectionApplied,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * A summary tile above the device or site list drills in by moving a facet chip
 * — the same chip the user could have moved by hand. This module is the joint
 * between the two halves of that, and both halves fail quietly if it drifts:
 *
 *   - a tile that reads as unlit while its chip is set is a one-way door. The
 *     click that shortened the list will not lengthen it again, and the only
 *     way back is a chip the user has already scrolled past.
 *   - a tile that reads as lit over some other row set is the product lying
 *     about why the list is short.
 *
 * The facet keys below are the production spellings from DeviceFacets /
 * SiteFacets, spelled out rather than imported because those modules pull in the
 * query builders and this one is deliberately free of them.
 */

const STATUS_FACET: string = "deviceStatus";
const INTERFACES_FACET: string = "deviceInterfaces";
const SITE_FACET: string = "deviceSite";
const SITE_TYPE_FACET: string = "siteType";

// "Devices Down / Stale" — one value on one chip, the common shape.
const DOWN_TILE: FacetTileSelection = {
  facetKey: STATUS_FACET,
  values: ["down"],
  operator: "is",
};

// "Unassigned Devices" — the empty-operator shape, no values at all.
const UNASSIGNED_TILE: FacetTileSelection = {
  facetKey: SITE_FACET,
  values: [],
  operator: "is_empty",
};

// The "everything" tile: a total that stands for the unfiltered list.
const EVERYTHING_TILE: FacetTileSelection = {
  facetKey: null,
  values: [],
  operator: "is",
};

// A multi-value tile, which only a multi-select chip can carry.
const MANY_TYPES_TILE: FacetTileSelection = {
  facetKey: SITE_TYPE_FACET,
  values: ["branch", "datacenter", "warehouse"],
  operator: "is",
};

describe("isFacetTileSelectionApplied", () => {
  test("a chip set to exactly the tile's values, on the tile's operator, is applied", () => {
    expect(
      isFacetTileSelectionApplied(
        DOWN_TILE,
        { [STATUS_FACET]: ["down"] },
        { [STATUS_FACET]: "is" },
      ),
    ).toBe(true);
  });

  test("an untouched bar leaves a keyed tile unlit", () => {
    expect(isFacetTileSelectionApplied(DOWN_TILE, {}, {})).toBe(false);
  });

  test("a chip set to a different value leaves the tile unlit", () => {
    expect(
      isFacetTileSelectionApplied(
        DOWN_TILE,
        { [STATUS_FACET]: ["up"] },
        { [STATUS_FACET]: "is" },
      ),
    ).toBe(false);
  });

  /*
   * The chip stores values in the order the user clicked them; a tile hands over
   * a list it built itself. Order must not decide whether the tile looks lit, or
   * the same filter would light the tile or not depending on how it was reached.
   */
  test("value order is ignored", () => {
    expect(
      isFacetTileSelectionApplied(
        MANY_TYPES_TILE,
        { [SITE_TYPE_FACET]: ["warehouse", "branch", "datacenter"] },
        { [SITE_TYPE_FACET]: "is" },
      ),
    ).toBe(true);
  });

  /*
   * The value *set* still has to match exactly. A tile that means "these three
   * types" is not applied while two of them are selected — it would claim to
   * describe a list that holds rows it never counted.
   */
  test("a subset of the tile's values is not the tile", () => {
    expect(
      isFacetTileSelectionApplied(
        MANY_TYPES_TILE,
        { [SITE_TYPE_FACET]: ["branch", "datacenter"] },
        { [SITE_TYPE_FACET]: "is" },
      ),
    ).toBe(false);
  });

  test("a superset of the tile's values is not the tile either", () => {
    expect(
      isFacetTileSelectionApplied(
        MANY_TYPES_TILE,
        {
          [SITE_TYPE_FACET]: ["branch", "datacenter", "warehouse", "campus"],
        },
        { [SITE_TYPE_FACET]: "is" },
      ),
    ).toBe(false);
  });

  /*
   * "Status is down" and "Status is not down" are opposite row sets over
   * identical values, so the operator alone has to be able to unlight a tile.
   */
  test("the same values under a different operator are not the tile", () => {
    expect(
      isFacetTileSelectionApplied(
        DOWN_TILE,
        { [STATUS_FACET]: ["down"] },
        { [STATUS_FACET]: "is_not" },
      ),
    ).toBe(false);
  });

  test("an empty-operator tile is not applied by a chip on 'is'", () => {
    expect(
      isFacetTileSelectionApplied(UNASSIGNED_TILE, { [SITE_FACET]: [] }, {}),
    ).toBe(false);
  });

  /*
   * The bar treats a facet with no operator entry as "is" (that is the default
   * FilterChipDropdown is rendered with), so a tile on "is" has to light up
   * against a chip that has values but no recorded operator — which is the state
   * a chip is in the moment the user picks a value without touching the operator
   * menu.
   */
  test("a facet with no operator entry counts as 'is'", () => {
    expect(
      isFacetTileSelectionApplied(DOWN_TILE, { [STATUS_FACET]: ["down"] }, {}),
    ).toBe(true);
  });

  test("a tile on a non-'is' operator is not lit by a bare selection", () => {
    expect(
      isFacetTileSelectionApplied(
        {
          facetKey: STATUS_FACET,
          values: ["down"],
          operator: "is_not",
        },
        { [STATUS_FACET]: ["down"] },
        {},
      ),
    ).toBe(false);
  });

  describe("the empty-operator tile shape", () => {
    /*
     * "Unassigned devices" names no value at all — it is the Site chip on
     * "is empty". Both halves of that (no values, that operator) have to be
     * recognised or the Sites page's tile can never light the list it opened.
     */
    test("matches a chip on is_empty with nothing selected", () => {
      expect(
        isFacetTileSelectionApplied(
          UNASSIGNED_TILE,
          {},
          { [SITE_FACET]: "is_empty" },
        ),
      ).toBe(true);
    });

    test("an explicitly empty value array is the same thing", () => {
      expect(
        isFacetTileSelectionApplied(
          UNASSIGNED_TILE,
          { [SITE_FACET]: [] },
          { [SITE_FACET]: "is_empty" },
        ),
      ).toBe(true);
    });

    test("is_not_empty is a different tile", () => {
      expect(
        isFacetTileSelectionApplied(
          UNASSIGNED_TILE,
          {},
          { [SITE_FACET]: "is_not_empty" },
        ),
      ).toBe(false);
    });

    /*
     * Changing a chip's operator does not clear the values it already had, so a
     * chip can sit on is_empty with a stale selection under it. That is not the
     * tile: the tile asked for no values.
     */
    test("leftover values under is_empty are not the tile", () => {
      expect(
        isFacetTileSelectionApplied(
          UNASSIGNED_TILE,
          { [SITE_FACET]: ["site-1"] },
          { [SITE_FACET]: "is_empty" },
        ),
      ).toBe(false);
    });
  });

  /*
   * Both sides run through normalizeFacetValues, because both sides are
   * hand-built: a tile's list comes from a count query and a chip's from clicks
   * plus whatever a pasted URL restored. A duplicate or a blank is the same
   * selection, so it cannot change whether the tile is lit.
   */
  describe("normalization of both sides", () => {
    test("duplicates in the tile's values do not matter", () => {
      expect(
        isFacetTileSelectionApplied(
          { facetKey: STATUS_FACET, values: ["down", "down"], operator: "is" },
          { [STATUS_FACET]: ["down"] },
          { [STATUS_FACET]: "is" },
        ),
      ).toBe(true);
    });

    test("duplicates in the chip's values do not matter", () => {
      expect(
        isFacetTileSelectionApplied(
          DOWN_TILE,
          { [STATUS_FACET]: ["down", "down", "down"] },
          { [STATUS_FACET]: "is" },
        ),
      ).toBe(true);
    });

    test("blank strings on either side are ignored", () => {
      expect(
        isFacetTileSelectionApplied(
          { facetKey: STATUS_FACET, values: ["", "down"], operator: "is" },
          { [STATUS_FACET]: ["down", ""] },
          { [STATUS_FACET]: "is" },
        ),
      ).toBe(true);
    });

    test("a chip holding only blanks is not the down tile", () => {
      expect(
        isFacetTileSelectionApplied(
          DOWN_TILE,
          { [STATUS_FACET]: ["", ""] },
          { [STATUS_FACET]: "is" },
        ),
      ).toBe(false);
    });
  });

  /*
   * Chips layer: drilling into a status is an extra constraint, not a reset. So
   * a tile reads its own facet only — a user who had already picked a site and
   * then clicks "Devices Down" must see the Down tile lit, over a list that is
   * still scoped to their site.
   */
  test("another facet being active does not unlight a keyed tile", () => {
    expect(
      isFacetTileSelectionApplied(
        DOWN_TILE,
        { [STATUS_FACET]: ["down"], [SITE_FACET]: ["site-1"] },
        { [STATUS_FACET]: "is", [SITE_FACET]: "is" },
      ),
    ).toBe(true);
  });

  describe("the 'everything' tile", () => {
    test("is applied while nothing else is", () => {
      expect(isFacetTileSelectionApplied(EVERYTHING_TILE, {}, {})).toBe(true);
    });

    test("is not applied once any facet has values", () => {
      expect(
        isFacetTileSelectionApplied(
          EVERYTHING_TILE,
          { [INTERFACES_FACET]: ["some-down"] },
          {},
        ),
      ).toBe(false);
    });

    /*
     * "Site is empty" constrains the list without naming a value, so the total
     * tile cannot claim to describe it — the count on the total tile is of the
     * whole project.
     */
    test("is not applied while a facet sits on an empty operator", () => {
      expect(
        isFacetTileSelectionApplied(
          EVERYTHING_TILE,
          {},
          { [SITE_FACET]: "is_empty" },
        ),
      ).toBe(false);

      expect(
        isFacetTileSelectionApplied(
          EVERYTHING_TILE,
          {},
          { [SITE_FACET]: "is_not_empty" },
        ),
      ).toBe(false);
    });

    /*
     * An "is"/"is_not" operator with nothing selected constrains nothing, and a
     * chip is left in exactly that state by the toggle-off path below. The total
     * tile has to come back on afterwards or a second click on a tile would
     * leave the strip with nothing lit at all.
     */
    test("is applied when a facet was toggled back off", () => {
      expect(
        isFacetTileSelectionApplied(
          EVERYTHING_TILE,
          { [STATUS_FACET]: [] },
          { [STATUS_FACET]: "is" },
        ),
      ).toBe(true);
    });
  });
});

describe("hasAnyFacetSelection", () => {
  test("an untouched bar constrains nothing", () => {
    expect(hasAnyFacetSelection({}, {})).toBe(false);
  });

  test("a selected value counts", () => {
    expect(hasAnyFacetSelection({ [STATUS_FACET]: ["down"] }, {})).toBe(true);
  });

  /*
   * "Has no site" narrows the list without naming a site, so it has to count as
   * a selection even though the value array is empty.
   */
  test("an empty operator counts with nothing selected", () => {
    expect(hasAnyFacetSelection({}, { [SITE_FACET]: "is_empty" })).toBe(true);
    expect(hasAnyFacetSelection({}, { [SITE_FACET]: "is_not_empty" })).toBe(
      true,
    );
  });

  /*
   * "is" and "is_not" over nothing are not constraints at all — the query
   * builders return undefined for them. Counting them would leave the strip
   * permanently drilled-in after one toggle-off.
   */
  test("a value operator alone does not count", () => {
    expect(
      hasAnyFacetSelection(
        {},
        { [STATUS_FACET]: "is", [SITE_FACET]: "is_not" },
      ),
    ).toBe(false);
  });

  test("an empty or blank-only value array does not count", () => {
    expect(hasAnyFacetSelection({ [STATUS_FACET]: [] }, {})).toBe(false);
    expect(hasAnyFacetSelection({ [STATUS_FACET]: [""] }, {})).toBe(false);
    expect(hasAnyFacetSelection({ [STATUS_FACET]: ["", ""] }, {})).toBe(false);
  });

  test("one active facet is enough, whatever the others hold", () => {
    expect(
      hasAnyFacetSelection(
        { [STATUS_FACET]: [], [SITE_FACET]: ["site-1"] },
        { [STATUS_FACET]: "is" },
      ),
    ).toBe(true);
  });

  /*
   * A facet key from an older build, restored off a pasted URL, still filters
   * the table. If it did not count here the total tile would look lit over a
   * list that is quietly filtered by something with no chip on screen.
   */
  test("an unrecognised facet key still counts", () => {
    expect(hasAnyFacetSelection({ someFacetAddedLater: ["x"] }, {})).toBe(true);
  });

  test("tolerates missing maps rather than throwing", () => {
    expect(
      hasAnyFacetSelection(
        undefined as unknown as FacetSelectionMap,
        undefined as unknown as FacetOperatorMap,
      ),
    ).toBe(false);

    expect(
      hasAnyFacetSelection(null as unknown as FacetSelectionMap, {
        [SITE_FACET]: "is_empty",
      }),
    ).toBe(true);
  });

  test("survives non-array junk in a selection map", () => {
    expect(
      hasAnyFacetSelection(
        { [STATUS_FACET]: "down" } as unknown as FacetSelectionMap,
        {},
      ),
    ).toBe(false);
  });
});

interface FacetBarSetters {
  setFacetSelection: jest.Mock;
  clearAllFacets: jest.Mock;
}

function createSetters(): FacetBarSetters {
  return {
    setFacetSelection: jest.fn(),
    clearAllFacets: jest.fn(),
  };
}

function clickTile(
  selection: FacetTileSelection,
  facetSelections: FacetSelectionMap,
  facetOperators: FacetOperatorMap,
  setters: FacetBarSetters,
): void {
  applyFacetTileSelection({
    selection: selection,
    facetSelections: facetSelections,
    facetOperators: facetOperators,
    setFacetSelection: setters.setFacetSelection,
    clearAllFacets: setters.clearAllFacets,
  });
}

describe("applyFacetTileSelection", () => {
  describe("the 'everything' tile", () => {
    test("clears the whole bar and sets nothing", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(
        EVERYTHING_TILE,
        { [STATUS_FACET]: ["down"] },
        { [STATUS_FACET]: "is" },
        setters,
      );

      expect(setters.clearAllFacets).toHaveBeenCalledTimes(1);
      expect(setters.setFacetSelection).not.toHaveBeenCalled();
    });

    /*
     * The total tile is not a toggle. Clicking it on an already unfiltered list
     * has to stay a no-op rather than filtering something, or the one control
     * that means "show me everything" would sometimes do the opposite.
     */
    test("clicking it again still just clears", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(EVERYTHING_TILE, {}, {}, setters);

      expect(setters.clearAllFacets).toHaveBeenCalledTimes(1);
      expect(setters.setFacetSelection).not.toHaveBeenCalled();
    });
  });

  describe("a keyed tile that is not applied yet", () => {
    test("moves its chip to the tile's values and operator", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(DOWN_TILE, {}, {}, setters);

      expect(setters.setFacetSelection).toHaveBeenCalledTimes(1);
      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        STATUS_FACET,
        ["down"],
        "is",
      );
    });

    test("carries the empty operator through for a valueless tile", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(UNASSIGNED_TILE, {}, {}, setters);

      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        SITE_FACET,
        [],
        "is_empty",
      );
    });

    test("replaces whatever that chip held before", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(
        DOWN_TILE,
        { [STATUS_FACET]: ["up"] },
        { [STATUS_FACET]: "is" },
        setters,
      );

      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        STATUS_FACET,
        ["down"],
        "is",
      );
    });

    /*
     * The values are spread straight into the chip's selection and from there
     * into an Includes(...), so a tile built with a duplicate or a blank — a
     * count query returning a null id, say — must not reach the query builder.
     */
    test("normalizes the values it hands over", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(
        {
          facetKey: SITE_TYPE_FACET,
          values: ["branch", "", "branch", "datacenter"],
          operator: "is",
        },
        {},
        {},
        setters,
      );

      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        SITE_TYPE_FACET,
        ["branch", "datacenter"],
        "is",
      );
    });

    /*
     * An operator this build does not know can only come from a tile written
     * against a different vocabulary. It has to land on the bar's default rather
     * than be forwarded into the chip, where nothing downstream would recognise
     * it.
     */
    test("resolves an unrecognised operator to 'is'", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(
        {
          facetKey: STATUS_FACET,
          values: ["down"],
          operator: "sideways" as unknown as FilterOperator,
        },
        {},
        {},
        setters,
      );

      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        STATUS_FACET,
        ["down"],
        "is",
      );
    });
  });

  describe("a keyed tile that is already applied", () => {
    /*
     * The second click is the whole reason the tiles are toggles: it is the only
     * way out of the drill-down that is on screen next to the number that got
     * the user there. Clearing to `[]` on "is" leaves the chip present but
     * unconstrained, which is exactly the state the bar starts in.
     */
    test("toggles its chip back off", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(
        DOWN_TILE,
        { [STATUS_FACET]: ["down"] },
        { [STATUS_FACET]: "is" },
        setters,
      );

      expect(setters.setFacetSelection).toHaveBeenCalledTimes(1);
      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        STATUS_FACET,
        [],
        "is",
      );
    });

    test("resets the operator too, so an empty-operator tile really turns off", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(UNASSIGNED_TILE, {}, { [SITE_FACET]: "is_empty" }, setters);

      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        SITE_FACET,
        [],
        "is",
      );
    });
  });

  /*
   * Drilling in from a tile must never wipe the rest of the bar: a user who
   * filtered to one site and then clicks "Devices Down / Stale" is asking for
   * the down devices *at that site*. clearAllFacets belongs to the "everything"
   * tile alone.
   */
  describe("a keyed tile never clears the bar", () => {
    const CASES: Array<[string, FacetSelectionMap, FacetOperatorMap]> = [
      ["turning it on", {}, {}],
      [
        "turning it off",
        { [STATUS_FACET]: ["down"] },
        { [STATUS_FACET]: "is" },
      ],
      [
        "over another active facet",
        { [SITE_FACET]: ["site-1"] },
        { [SITE_FACET]: "is" },
      ],
    ];

    test.each(CASES)(
      "%s",
      (
        _label: string,
        selections: FacetSelectionMap,
        operators: FacetOperatorMap,
      ) => {
        const setters: FacetBarSetters = createSetters();

        clickTile(DOWN_TILE, selections, operators, setters);

        expect(setters.clearAllFacets).not.toHaveBeenCalled();
        expect(setters.setFacetSelection).toHaveBeenCalledTimes(1);
      },
    );

    test("touches only its own chip", () => {
      const setters: FacetBarSetters = createSetters();

      clickTile(
        DOWN_TILE,
        { [SITE_FACET]: ["site-1"] },
        { [SITE_FACET]: "is" },
        setters,
      );

      expect(setters.setFacetSelection).toHaveBeenCalledTimes(1);
      expect(setters.setFacetSelection).toHaveBeenCalledWith(
        STATUS_FACET,
        ["down"],
        "is",
      );
    });
  });

  /*
   * The round trip against a bar that actually stores what it is told: two
   * clicks on the same tile have to leave the list exactly as wide as it
   * started, with the "everything" tile lit again. Anything else and the tile is
   * a one-way door in practice, however each half behaves in isolation.
   */
  describe("clicking the same tile twice", () => {
    test("lights it, then hands the list back", () => {
      const selections: FacetSelectionMap = {};
      const operators: FacetOperatorMap = {};
      const setFacetSelection: jest.Mock = jest.fn(
        (
          facetKey: string,
          values: Array<string>,
          operator?: FilterOperator,
        ): void => {
          selections[facetKey] = values;
          operators[facetKey] = operator || "is";
        },
      );
      const clearAllFacets: jest.Mock = jest.fn();
      const setters: FacetBarSetters = {
        setFacetSelection: setFacetSelection,
        clearAllFacets: clearAllFacets,
      };

      clickTile(DOWN_TILE, selections, operators, setters);

      expect(
        isFacetTileSelectionApplied(DOWN_TILE, selections, operators),
      ).toBe(true);
      expect(
        isFacetTileSelectionApplied(EVERYTHING_TILE, selections, operators),
      ).toBe(false);

      clickTile(DOWN_TILE, selections, operators, setters);

      expect(
        isFacetTileSelectionApplied(DOWN_TILE, selections, operators),
      ).toBe(false);
      expect(
        isFacetTileSelectionApplied(EVERYTHING_TILE, selections, operators),
      ).toBe(true);
      expect(hasAnyFacetSelection(selections, operators)).toBe(false);
      expect(clearAllFacets).not.toHaveBeenCalled();
    });

    test("does the same for a valueless, empty-operator tile", () => {
      const selections: FacetSelectionMap = {};
      const operators: FacetOperatorMap = {};
      const setters: FacetBarSetters = {
        setFacetSelection: jest.fn(
          (
            facetKey: string,
            values: Array<string>,
            operator?: FilterOperator,
          ): void => {
            selections[facetKey] = values;
            operators[facetKey] = operator || "is";
          },
        ),
        clearAllFacets: jest.fn(),
      };

      clickTile(UNASSIGNED_TILE, selections, operators, setters);

      expect(
        isFacetTileSelectionApplied(UNASSIGNED_TILE, selections, operators),
      ).toBe(true);

      clickTile(UNASSIGNED_TILE, selections, operators, setters);

      expect(
        isFacetTileSelectionApplied(UNASSIGNED_TILE, selections, operators),
      ).toBe(false);
      expect(hasAnyFacetSelection(selections, operators)).toBe(false);
    });

    /*
     * Two different tiles on the same chip are exclusive, not cumulative:
     * clicking "Devices Up" while "Devices Down" is lit moves the chip rather
     * than adding to it, because one status column cannot be two ranges at once.
     */
    test("switching to a sibling tile moves the chip rather than adding to it", () => {
      const selections: FacetSelectionMap = {};
      const operators: FacetOperatorMap = {};
      const setters: FacetBarSetters = {
        setFacetSelection: jest.fn(
          (
            facetKey: string,
            values: Array<string>,
            operator?: FilterOperator,
          ): void => {
            selections[facetKey] = values;
            operators[facetKey] = operator || "is";
          },
        ),
        clearAllFacets: jest.fn(),
      };
      const upTile: FacetTileSelection = {
        facetKey: STATUS_FACET,
        values: ["up"],
        operator: "is",
      };

      clickTile(DOWN_TILE, selections, operators, setters);
      clickTile(upTile, selections, operators, setters);

      expect(selections[STATUS_FACET]).toEqual(["up"]);
      expect(isFacetTileSelectionApplied(upTile, selections, operators)).toBe(
        true,
      );
      expect(
        isFacetTileSelectionApplied(DOWN_TILE, selections, operators),
      ).toBe(false);
    });
  });
});
