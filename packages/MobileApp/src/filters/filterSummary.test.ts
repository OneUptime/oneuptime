import { describe, expect, test } from "@jest/globals";
import { getActiveFilterItems, summarizeFacet } from "./filterSummary";
import { emptyFilters, type RecordFilters } from "./recordFilters";
import {
  NO_OPTIONS,
  type FilterOption,
  type FilterOptionList,
  type FilterSheetOptions,
} from "./filterOptions";

/*
 * The chips under a list's search say what each filter keeps, in words. A
 * value whose name is still loading is counted, never shown as an id, and
 * a facet the list does not ask has no chip.
 */

function list(options: Array<FilterOption>): FilterOptionList {
  return { options: options, isLoading: false, isError: false };
}

const OPTIONS: FilterSheetOptions = {
  people: list([
    { id: "u-priya", label: "Priya Shah", detail: "priya@example.test" },
    { id: "u-jordan", label: "Jordan Lee" },
  ]),
  teams: list([{ id: "t-platform", label: "Platform" }]),
  states: list([
    { id: "s-open", label: "Investigating" },
    { id: "s-ack", label: "Acknowledged" },
  ]),
  severities: list([
    { id: "sev-critical", label: "Critical" },
    { id: "sev-major", label: "Major" },
    { id: "sev-minor", label: "Minor" },
  ]),
  labels: list([{ id: "l-payments", label: "payments" }]),
  monitors: list([{ id: "m-api", label: "Checkout API" }]),
  monitorTypes: list([{ id: "Website", label: "Website" }]),
};

function filters(overrides: Partial<RecordFilters>): RecordFilters {
  return { ...emptyFilters(), ...overrides };
}

describe("summarizeFacet", () => {
  test("Owner: You first, then teams, then people", () => {
    expect(summarizeFacet("owner", filters({ ownedByMe: true }), OPTIONS)).toBe(
      "You",
    );
    expect(
      summarizeFacet(
        "owner",
        filters({ ownedByMe: true, ownerTeamIds: ["t-platform"] }),
        OPTIONS,
      ),
    ).toBe("You or Platform");
    expect(
      summarizeFacet(
        "owner",
        filters({
          ownedByMe: true,
          ownerTeamIds: ["t-platform"],
          ownerUserIds: ["u-priya"],
        }),
        OPTIONS,
      ),
    ).toBe("You, Platform +1");
  });

  test("severities read in the project's order, whatever order they were picked", () => {
    expect(
      summarizeFacet(
        "severity",
        filters({ severityIds: ["sev-major", "sev-critical"] }),
        OPTIONS,
      ),
    ).toBe("Critical or Major");
  });

  test("a value still loading is counted, not shown as its id", () => {
    const loading: FilterSheetOptions = { ...OPTIONS, labels: NO_OPTIONS };
    expect(
      summarizeFacet("label", filters({ labelIds: ["l-payments"] }), loading),
    ).toBe("1 selected");
  });

  test("a monitor type is its own name", () => {
    expect(
      summarizeFacet(
        "monitorType",
        filters({ monitorTypes: ["Website", "API"] }),
        OPTIONS,
      ),
    ).toBe("Website or API");
  });

  test.each([
    ["state", { stateIds: ["s-ack"] }, "Acknowledged"],
    ["monitor", { monitorIds: ["m-api"] }, "Checkout API"],
    ["label", { labelIds: ["l-payments"] }, "payments"],
  ] as Array<
    [Parameters<typeof summarizeFacet>[0], Partial<RecordFilters>, string]
  >)(
    "%s reads its value's name",
    (
      facet: Parameters<typeof summarizeFacet>[0],
      overrides: Partial<RecordFilters>,
      expected: string,
    ) => {
      expect(summarizeFacet(facet, filters(overrides), OPTIONS)).toBe(expected);
    },
  );
});

describe("getActiveFilterItems", () => {
  test("one chip per active facet, in the sheet's order, titled as the sheet titles it", () => {
    expect(
      getActiveFilterItems(
        "monitors",
        filters({
          labelIds: ["l-payments"],
          ownedByMe: true,
          stateIds: ["s-open"],
        }),
        OPTIONS,
      ),
    ).toEqual([
      { facet: "owner", title: "Owner", summary: "You" },
      { facet: "state", title: "Status", summary: "Investigating" },
      { facet: "label", title: "Labels", summary: "payments" },
    ]);
  });

  test("a facet the list does not ask has no chip", () => {
    expect(
      getActiveFilterItems(
        "incidentEpisodes",
        filters({ monitorIds: ["m-api"] }),
        OPTIONS,
      ),
    ).toEqual([]);
  });

  test("no filters, no chips", () => {
    expect(getActiveFilterItems("alerts", emptyFilters(), OPTIONS)).toEqual([]);
  });
});
