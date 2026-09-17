import {
  FacetSelectionConstraint,
  FacetSelectionState,
  getEmptyFacetSelectionState,
  isFacetActive,
  isFacetSelectionActive,
  isFilterOperator,
  normalizeFacetValues,
  parseFacetSelectionState,
  resolveFacetOperator,
  sanitizeFacetSelectionState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
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
  test("accepts the operators every chip kind offers", () => {
    expect(isFilterOperator("is")).toBe(true);
    expect(isFilterOperator("is_not")).toBe(true);
    expect(isFilterOperator("is_empty")).toBe(true);
    expect(isFilterOperator("is_not_empty")).toBe(true);
    // Date chips.
    expect(isFilterOperator("before")).toBe(true);
    expect(isFilterOperator("between")).toBe(true);
    // Text and number chips.
    expect(isFilterOperator("contains")).toBe(true);
    expect(isFilterOperator("greater_than")).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isFilterOperator("matches")).toBe(false);
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

/*
 * Everything that moves a chip from outside the bar — a summary tile, a deep
 * link, a "show me these" affordance elsewhere in the product — goes through
 * these two before the value reaches state. The bar spreads a selection straight
 * into an `Includes(...)`, so a duplicate becomes a redundant OR term and a blank
 * string becomes a constraint no row can satisfy: the chip lights up over an
 * empty table with nothing on screen to explain it.
 */
describe("normalizeFacetValues", () => {
  test("leaves a clean list alone", () => {
    expect(normalizeFacetValues(["online", "offline"])).toEqual([
      "online",
      "offline",
    ]);
  });

  test("drops duplicates and keeps the first occurrence's position", () => {
    expect(normalizeFacetValues(["b", "a", "b", "c", "a"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("drops empty strings", () => {
    expect(normalizeFacetValues(["", "online", ""])).toEqual(["online"]);
  });

  /*
   * A caller building a selection out of a query result can easily hand over a
   * null id for a row that has none, and TypeScript does not see it because the
   * result is typed loosely on the way in.
   */
  test("drops values that are not strings at all", () => {
    expect(
      normalizeFacetValues([
        "online",
        5,
        null,
        undefined,
        {},
        [],
        true,
      ] as unknown as Array<string>),
    ).toEqual(["online"]);
  });

  test("returns an empty list for nothing", () => {
    expect(normalizeFacetValues(null)).toEqual([]);
    expect(normalizeFacetValues(undefined)).toEqual([]);
    expect(normalizeFacetValues([])).toEqual([]);
  });

  test("returns an empty list for something that is not a list", () => {
    expect(normalizeFacetValues("online" as unknown as Array<string>)).toEqual(
      [],
    );
    expect(normalizeFacetValues(5 as unknown as Array<string>)).toEqual([]);
    expect(
      normalizeFacetValues({ 0: "online" } as unknown as Array<string>),
    ).toEqual([]);
  });

  /*
   * The caller is usually holding the array this came from — a tile's constant
   * definition, or the state the bar is about to compare against. Editing it in
   * place would rewrite that definition for every later click.
   */
  test("does not mutate or alias its input", () => {
    const input: Array<string> = ["b", "", "b", "a"];
    const normalized: Array<string> = normalizeFacetValues(input);

    expect(input).toEqual(["b", "", "b", "a"]);
    expect(normalized).not.toBe(input);

    normalized.push("c");

    expect(input).toEqual(["b", "", "b", "a"]);
  });
});

/*
 * "is" is what the whole bar assumes for a facet with no operator entry — it is
 * what FilterChipDropdown renders and what the query builders are handed when
 * nobody touched the operator menu. So an unrecognised value has to land there
 * rather than reach the query builder, where it would match no branch and
 * silently drop the constraint the chip claims to apply.
 */
describe("resolveFacetOperator", () => {
  test("keeps every operator the bar supports", () => {
    const operators: Array<FilterOperator> = [
      "is",
      "is_not",
      "is_empty",
      "is_not_empty",
    ];

    for (const operator of operators) {
      expect(resolveFacetOperator(operator)).toBe(operator);
    }
  });

  test("an absent operator is 'is'", () => {
    expect(resolveFacetOperator(null)).toBe("is");
    expect(resolveFacetOperator(undefined)).toBe("is");
  });

  test("anything unrecognised is 'is'", () => {
    const junk: Array<unknown> = [
      "",
      "IS",
      " is",
      "is ",
      "matches",
      "isnt",
      "is_empty_",
      "__proto__",
      "constructor",
      0,
      {},
      [],
      true,
    ];

    for (const value of junk) {
      expect(resolveFacetOperator(value as unknown as FilterOperator)).toBe(
        "is",
      );
    }
  });

  test("never returns something the operator guard would reject", () => {
    for (const value of ["is_not", "nonsense", null, undefined]) {
      expect(
        isFilterOperator(
          resolveFacetOperator(value as unknown as FilterOperator),
        ),
      ).toBe(true);
    }
  });
});

/*
 * A restored selection can hold things its chip cannot express: the URL param is
 * hand-editable, and a saved view may have been written by a build whose chips
 * offered more operators or allowed multi-select.
 *
 * Left alone, both produce a chip that claims a filter the table is not applying.
 * The device Status chip is the sharp case — it offers only "is", so it renders no
 * operator switcher at all, and a stray "is_not" would leave the user staring at
 * "Status is not Down" above the entire unfiltered fleet with nothing to click but
 * the clear button.
 */
describe("sanitizeFacetSelectionState", () => {
  const STATUS: FacetSelectionConstraint = {
    key: "deviceStatus",
    isMultiSelect: false,
    supportedOperators: ["is"],
  };
  const SITE: FacetSelectionConstraint = {
    key: "deviceSite",
    isMultiSelect: true,
    supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
  };

  function stateWith(
    facetSelections: { [key: string]: Array<string> },
    facetOperators: { [key: string]: FilterOperator },
  ): FacetSelectionState {
    return {
      ...getEmptyFacetSelectionState(),
      facetSelections: facetSelections,
      facetOperators: facetOperators,
    };
  }

  test("an operator the facet never offered falls back to one it does", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ deviceStatus: ["down"] }, { deviceStatus: "is_not" }),
      [STATUS, SITE],
    );

    expect(sanitized.facetOperators["deviceStatus"]).toBe("is");
    // The values survive — the user asked for Down, just not for "not Down".
    expect(sanitized.facetSelections["deviceStatus"]).toEqual(["down"]);
  });

  test("every unsupported operator is clamped, not just is_not", () => {
    for (const operator of [
      "is_not",
      "is_empty",
      "is_not_empty",
    ] as Array<FilterOperator>) {
      expect(
        sanitizeFacetSelectionState(stateWith({}, { deviceStatus: operator }), [
          STATUS,
        ]).facetOperators["deviceStatus"],
      ).toBe("is");
    }
  });

  test("an operator the facet does offer is left alone", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ deviceSite: ["a"] }, { deviceSite: "is_not" }),
      [STATUS, SITE],
    );

    expect(sanitized.facetOperators["deviceSite"]).toBe("is_not");
    expect(sanitized.facetSelections["deviceSite"]).toEqual(["a"]);
  });

  /*
   * The chip shows only the first value of a single-select facet, so honouring a
   * longer list would filter by something the chip is not showing — and the device
   * Status builder refuses a multi-value selection outright, which would drop the
   * constraint entirely while the chip still claimed it.
   */
  test("a single-select facet keeps only its first value", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ deviceStatus: ["down", "up", "pending"] }, {}),
      [STATUS],
    );

    expect(sanitized.facetSelections["deviceStatus"]).toEqual(["down"]);
  });

  test("a multi-select facet keeps all of its values", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ deviceSite: ["a", "b", "c"] }, {}),
      [SITE],
    );

    expect(sanitized.facetSelections["deviceSite"]).toEqual(["a", "b", "c"]);
  });

  test("a facet with no supportedOperators list accepts all four", () => {
    const anyOperator: FacetSelectionConstraint = { key: "loose" };

    for (const operator of [
      "is",
      "is_not",
      "is_empty",
      "is_not_empty",
    ] as Array<FilterOperator>) {
      expect(
        sanitizeFacetSelectionState(stateWith({}, { loose: operator }), [
          anyOperator,
        ]).facetOperators["loose"],
      ).toBe(operator);
    }
  });

  // A facet this build no longer defines is left as it is, to be ignored downstream.
  test("keys with no matching facet are untouched", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ retired: ["x", "y"] }, { retired: "is_not_empty" }),
      [STATUS, SITE],
    );

    expect(sanitized.facetSelections["retired"]).toEqual(["x", "y"]);
    expect(sanitized.facetOperators["retired"]).toBe("is_not_empty");
  });

  test("the owner and label selections are passed straight through", () => {
    const state: FacetSelectionState = {
      ...getEmptyFacetSelectionState(),
      selectedOwnerKeys: ["user:1"],
      selectedLabelIds: ["label-1"],
      ownerOperator: "is_not",
      labelOperator: "is_empty",
    };

    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(state, [
      STATUS,
    ]);

    expect(sanitized.selectedOwnerKeys).toEqual(["user:1"]);
    expect(sanitized.selectedLabelIds).toEqual(["label-1"]);
    expect(sanitized.ownerOperator).toBe("is_not");
    expect(sanitized.labelOperator).toBe("is_empty");
  });

  test("a table with no extra facets gets its state back unchanged", () => {
    const state: FacetSelectionState = stateWith(
      { anything: ["a", "b"] },
      { anything: "is_not" },
    );

    expect(sanitizeFacetSelectionState(state, [])).toBe(state);
  });

  // The caller's state is React state elsewhere; clamping must not reach into it.
  test("does not mutate the state it was given", () => {
    const state: FacetSelectionState = stateWith(
      { deviceStatus: ["down", "up"] },
      { deviceStatus: "is_not" },
    );

    sanitizeFacetSelectionState(state, [STATUS]);

    expect(state.facetSelections["deviceStatus"]).toEqual(["down", "up"]);
    expect(state.facetOperators["deviceStatus"]).toBe("is_not");
  });

  /*
   * The whole point: after clamping, the state is one every chip can render and
   * every query builder can honour.
   */
  test("leaves nothing a chip could not display", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith(
        { deviceStatus: ["down", "up"], deviceSite: ["a", "b"] },
        { deviceStatus: "is_empty", deviceSite: "is_empty" },
      ),
      [STATUS, SITE],
    );

    for (const facet of [STATUS, SITE]) {
      const operator: FilterOperator | undefined =
        sanitized.facetOperators[facet.key];
      expect(facet.supportedOperators).toContain(operator);

      if (!facet.isMultiSelect) {
        expect(
          (sanitized.facetSelections[facet.key] || []).length,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

/*
 * Custom field chips arrive asynchronously — the definitions have to be
 * fetched — while a shared link is restored synchronously on the first render.
 * So a selection routinely exists before the facet that owns it does, and this
 * parser is the only thing standing between that and a lost filter.
 *
 * The asymmetry with the column-filter popup's `sanitizeFilterData`, which
 * drops any key it does not recognise, is deliberate and load-bearing: here an
 * unknown key survives, and useResourceOwners reconciles it once the facet
 * list settles.
 */
describe("selections whose facet has not arrived yet", () => {
  test("parse preserves a custom field key verbatim", () => {
    const state: FacetSelectionState = parseFacetSelectionState({
      facetSelections: { "customField:Severity Band": ["P1"] },
      facetOperators: { "customField:Severity Band": "is_not" },
    } as JSONObject);

    expect(state.facetSelections["customField:Severity Band"]).toEqual(["P1"]);
    expect(state.facetOperators["customField:Severity Band"]).toBe("is_not");
  });

  test("sanitize against an empty facet list leaves it alone", () => {
    /*
     * This runs on the first render, before the definitions land. Clamping
     * here would throw away the link's filter a moment before the chip that
     * could show it appears.
     */
    const restored: FacetSelectionState = {
      ...getEmptyFacetSelectionState(),
      facetSelections: { "customField:Team": ["Payments"] },
      facetOperators: { "customField:Team": "contains" },
    };

    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      restored,
      [],
    );

    expect(sanitized.facetSelections["customField:Team"]).toEqual(["Payments"]);
    expect(sanitized.facetOperators["customField:Team"]).toBe("contains");
  });

  test("counts as an active selection while the facet is missing", () => {
    // Otherwise the URL effect reads the link as "nothing selected" and deletes it.
    expect(
      isFacetSelectionActive({
        ...getEmptyFacetSelectionState(),
        facetSelections: { "customField:Team": ["Payments"] },
      }),
    ).toBe(true);
  });
});

describe("text and number chips", () => {
  const TEXT: FacetSelectionConstraint = {
    key: "customField:Ticket",
    type: "text",
    supportedOperators: [
      "is",
      "is_not",
      "contains",
      "not_contains",
      "starts_with",
      "ends_with",
      "is_empty",
      "is_not_empty",
    ],
  };

  const NUMBER: FacetSelectionConstraint = {
    key: "customField:Impacted Users",
    type: "number",
    supportedOperators: [
      "is",
      "is_not",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
      "is_empty",
      "is_not_empty",
    ],
  };

  function stateWith(
    facetSelections: { [key: string]: Array<string> },
    facetOperators: { [key: string]: FilterOperator },
  ): FacetSelectionState {
    return {
      ...getEmptyFacetSelectionState(),
      facetSelections: facetSelections,
      facetOperators: facetOperators,
    };
  }

  test("accepts the text and numeric operators", () => {
    for (const operator of [
      "contains",
      "not_contains",
      "starts_with",
      "ends_with",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
    ]) {
      expect(isFilterOperator(operator)).toBe(true);
    }
  });

  test("keeps a typed operator the chip offers", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ [TEXT.key]: ["JIRA-1"] }, { [TEXT.key]: "contains" }),
      [TEXT],
    );

    expect(sanitized.facetOperators[TEXT.key]).toBe("contains");
    expect(sanitized.facetSelections[TEXT.key]).toEqual(["JIRA-1"]);
  });

  test("keeps only the first value — the input can show one", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      stateWith({ [TEXT.key]: ["a", "b"] }, {}),
      [TEXT],
    );

    expect(sanitized.facetSelections[TEXT.key]).toEqual(["a"]);
  });

  test("drops a blank text value", () => {
    // A lit chip over an unfiltered list is worse than an empty chip.
    expect(
      sanitizeFacetSelectionState(stateWith({ [TEXT.key]: ["   "] }, {}), [
        TEXT,
      ]).facetSelections[TEXT.key],
    ).toEqual([]);
  });

  test("keeps a numeric value that is a number", () => {
    expect(
      sanitizeFacetSelectionState(
        stateWith({ [NUMBER.key]: ["42"] }, { [NUMBER.key]: "greater_than" }),
        [NUMBER],
      ).facetSelections[NUMBER.key],
    ).toEqual(["42"]);
  });

  test("drops a numeric value that is not a number", () => {
    /*
     * The number input can only show a number, so a hand-edited URL carrying
     * anything else would leave the chip lit with an empty box under it.
     */
    for (const value of ["abc", "", "Infinity", "1,000"]) {
      expect(
        sanitizeFacetSelectionState(stateWith({ [NUMBER.key]: [value] }, {}), [
          NUMBER,
        ]).facetSelections[NUMBER.key],
      ).toEqual([]);
    }
  });

  test("a negative or decimal number survives", () => {
    for (const value of ["-5", "3.14", "0"]) {
      expect(
        sanitizeFacetSelectionState(stateWith({ [NUMBER.key]: [value] }, {}), [
          NUMBER,
        ]).facetSelections[NUMBER.key],
      ).toEqual([value]);
    }
  });

  test("an operator the chip does not offer still clamps", () => {
    expect(
      sanitizeFacetSelectionState(
        stateWith({ [NUMBER.key]: ["42"] }, { [NUMBER.key]: "contains" }),
        [NUMBER],
      ).facetOperators[NUMBER.key],
    ).toBe("is");
  });

  test("a typed chip is active once it holds a value", () => {
    expect(isFacetActive(TEXT, ["JIRA-1"], "contains")).toBe(true);
    expect(isFacetActive(TEXT, [], "contains")).toBe(false);
    expect(isFacetActive(TEXT, [], "is_empty")).toBe(true);
  });
});
