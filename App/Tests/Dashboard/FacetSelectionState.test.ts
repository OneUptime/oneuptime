import {
  FacetSelectionState,
  getEmptyFacetSelectionState,
  isFacetSelectionActive,
  isFilterOperator,
  parseFacetSelectionState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The facet chips above a list (Owner, Labels, Status, ...) are mirrored into
 * the URL so they survive "open a row, press Back" and so a filtered view can
 * be pasted to a teammate. That snapshot is also what a saved TableView
 * stores, which means this parser has to cope with:
 *
 *   - a link a user hand-edited,
 *   - a view saved by an older build with a different shape, and
 *   - facet keys that no longer exist.
 *
 * In every case one bad entry must cost at most one chip — never the whole
 * filter bar, and never a crash on a page the user can only reach by
 * navigating back.
 */

describe("isFilterOperator", () => {
  test("accepts the four supported operators", () => {
    expect(isFilterOperator("is")).toBe(true);
    expect(isFilterOperator("is_not")).toBe(true);
    expect(isFilterOperator("is_empty")).toBe(true);
    expect(isFilterOperator("is_not_empty")).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isFilterOperator("contains")).toBe(false);
    expect(isFilterOperator("")).toBe(false);
    expect(isFilterOperator(null)).toBe(false);
    expect(isFilterOperator(undefined)).toBe(false);
    expect(isFilterOperator(5)).toBe(false);
    expect(isFilterOperator({})).toBe(false);
  });
});

describe("getEmptyFacetSelectionState", () => {
  test("has nothing selected", () => {
    expect(getEmptyFacetSelectionState()).toEqual({
      selectedOwnerKeys: [],
      selectedLabelIds: [],
      facetSelections: {},
      ownerOperator: "is",
      labelOperator: "is",
      facetOperators: {},
    });
  });

  test("returns a fresh object each time, so callers can't share arrays", () => {
    const first: FacetSelectionState = getEmptyFacetSelectionState();
    const second: FacetSelectionState = getEmptyFacetSelectionState();

    first.selectedLabelIds.push("a");

    expect(second.selectedLabelIds).toEqual([]);
  });
});

describe("parseFacetSelectionState", () => {
  test("returns the empty state for null / undefined", () => {
    expect(parseFacetSelectionState(null)).toEqual(
      getEmptyFacetSelectionState(),
    );
    expect(parseFacetSelectionState(undefined)).toEqual(
      getEmptyFacetSelectionState(),
    );
  });

  test("returns the empty state for a non-object", () => {
    expect(parseFacetSelectionState("nope" as unknown as JSONObject)).toEqual(
      getEmptyFacetSelectionState(),
    );
    expect(parseFacetSelectionState([] as unknown as JSONObject)).toEqual(
      getEmptyFacetSelectionState(),
    );
  });

  test("reads a well-formed snapshot", () => {
    expect(
      parseFacetSelectionState({
        selectedOwnerKeys: ["user:1", "team:2"],
        selectedLabelIds: ["label-a"],
        facetSelections: { monitorStatus: ["online", "offline"] },
        ownerOperator: "is_not",
        labelOperator: "is",
        facetOperators: { monitorStatus: "is_not" },
      }),
    ).toEqual({
      selectedOwnerKeys: ["user:1", "team:2"],
      selectedLabelIds: ["label-a"],
      facetSelections: { monitorStatus: ["online", "offline"] },
      ownerOperator: "is_not",
      labelOperator: "is",
      facetOperators: { monitorStatus: "is_not" },
    });
  });

  test("drops non-string owner keys but keeps the rest", () => {
    expect(
      parseFacetSelectionState({
        selectedOwnerKeys: ["user:1", 5, null, "team:2"],
      } as unknown as JSONObject).selectedOwnerKeys,
    ).toEqual(["user:1", "team:2"]);
  });

  test("drops owner keys that aren't an array at all", () => {
    expect(
      parseFacetSelectionState({
        selectedOwnerKeys: "user:1",
      } as unknown as JSONObject).selectedOwnerKeys,
    ).toEqual([]);
  });

  test("drops empty-string ids", () => {
    expect(
      parseFacetSelectionState({ selectedLabelIds: ["a", "", "b"] })
        .selectedLabelIds,
    ).toEqual(["a", "b"]);
  });

  test("keeps only the facet selections that are arrays", () => {
    expect(
      parseFacetSelectionState({
        facetSelections: {
          good: ["a"],
          bad: "not-an-array",
          alsoBad: 5,
        },
      } as unknown as JSONObject).facetSelections,
    ).toEqual({ good: ["a"] });
  });

  test("falls back to 'is' for an unrecognised operator", () => {
    const parsed: FacetSelectionState = parseFacetSelectionState({
      ownerOperator: "sideways",
      labelOperator: 5,
    } as unknown as JSONObject);

    expect(parsed.ownerOperator).toBe("is");
    expect(parsed.labelOperator).toBe("is");
  });

  test("drops per-facet operators that aren't valid", () => {
    expect(
      parseFacetSelectionState({
        facetOperators: { good: "is_not", bad: "like" },
      } as unknown as JSONObject).facetOperators,
    ).toEqual({ good: "is_not" });
  });

  test("one malformed field does not discard the others", () => {
    const parsed: FacetSelectionState = parseFacetSelectionState({
      selectedOwnerKeys: "broken",
      selectedLabelIds: ["label-a"],
      ownerOperator: "garbage",
      labelOperator: "is_not",
    } as unknown as JSONObject);

    expect(parsed.selectedOwnerKeys).toEqual([]);
    expect(parsed.selectedLabelIds).toEqual(["label-a"]);
    expect(parsed.ownerOperator).toBe("is");
    expect(parsed.labelOperator).toBe("is_not");
  });

  test("keeps an unknown facet key rather than throwing (the facet may load later)", () => {
    expect(
      parseFacetSelectionState({
        facetSelections: { someFacetAddedLater: ["x"] },
      }).facetSelections,
    ).toEqual({ someFacetAddedLater: ["x"] });
  });

  test("round-trips through JSON unchanged", () => {
    const state: FacetSelectionState = {
      selectedOwnerKeys: ["user:1"],
      selectedLabelIds: ["label-a", "label-b"],
      facetSelections: { monitorStatus: ["online"] },
      ownerOperator: "is_not_empty",
      labelOperator: "is",
      facetOperators: { monitorStatus: "is" },
    };

    expect(
      parseFacetSelectionState(JSON.parse(JSON.stringify(state)) as JSONObject),
    ).toEqual(state);
  });
});

describe("isFacetSelectionActive", () => {
  test("an untouched filter bar is not active", () => {
    expect(isFacetSelectionActive(getEmptyFacetSelectionState())).toBe(false);
  });

  test("a selected owner makes it active", () => {
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        selectedOwnerKeys: ["user:1"],
      }),
    ).toBe(true);
  });

  test("a selected label makes it active", () => {
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        selectedLabelIds: ["label-a"],
      }),
    ).toBe(true);
  });

  test("a selected extra-facet value makes it active", () => {
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        facetSelections: { monitorStatus: ["online"] },
      }),
    ).toBe(true);
  });

  test("a presence operator is active even with nothing selected", () => {
    /*
     * "has no owner" constrains the list without naming a single owner, so it
     * has to count as active or it would never reach the URL.
     */
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        ownerOperator: "is_empty",
      }),
    ).toBe(true);

    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        facetOperators: { monitorStatus: "is_not_empty" },
      }),
    ).toBe(true);
  });

  test("an 'is'/'is_not' operator with nothing selected is not active", () => {
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        ownerOperator: "is_not",
        facetOperators: { monitorStatus: "is" },
      }),
    ).toBe(false);
  });

  test("an empty selection array is not active", () => {
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        facetSelections: { monitorStatus: [] },
      }),
    ).toBe(false);
  });
});
