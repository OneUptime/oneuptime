import { describe, expect, test } from "@jest/globals";
import {
  ATTRIBUTE_FACET_KEY_PREFIX,
  DisplayedFacetValues,
  FACET_EXCLUDE_KEY_PREFIX,
  FacetChipReading,
  FacetSectionSelection,
  FacetSelections,
  FacetValueSelection,
  FacetValueState,
  SERVICE_FACET_KEY,
  buildFacetSelections,
  getBaseFacetKey,
  getDisplayedFacetValues,
  getFacetChipsToClear,
  getFacetSectionSelection,
  getFacetValueSelection,
  getSelectedValuesByKey,
  isExcludeFacetKey,
  readFacetChip,
  toExcludeFacetKey,
  withSelectedFacetValues,
} from "../../../../UI/Components/TelemetryViewer/FacetSelection";
import {
  ActiveFilter,
  FacetValue,
} from "../../../../UI/Components/TelemetryViewer/types";
import { buildSearchTokenValue } from "../../../../Types/Telemetry/TelemetrySearchQuery";

/*
 * The one reading every telemetry facet sidebar takes of its explorer's
 * chips: which row each chip lights, in what state, and which chips a click
 * on a lit row takes off.
 *
 * The bug it fixes: a click on a checked value went to the explorer's
 * "include" handler, and Traces, Metrics and Exceptions only ever added -
 * the value stayed checked. Span Type could not be cleared at all, and a
 * Host Name holding `*`, `?` or a space never even showed as checked,
 * because its chip holds the value escaped for the search grammar. Every
 * one of those is a row of the tables below.
 */

const SERVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

function chip(
  facetKey: string,
  value: string,
  extra: Partial<ActiveFilter> = {},
): ActiveFilter {
  return {
    facetKey: facetKey,
    value: value,
    displayKey: facetKey,
    displayValue: value,
    ...extra,
  };
}

function reading(facetKey: string, value: string): FacetChipReading | null {
  return readFacetChip({ facetKey: facetKey, value: value });
}

describe("the exclude marker on a chip's key", () => {
  test("is a leading '!', added once and read back to the facet", () => {
    expect(FACET_EXCLUDE_KEY_PREFIX).toBe("!");
    expect(toExcludeFacetKey("severityName")).toBe("!severityName");
    expect(toExcludeFacetKey("!severityName")).toBe("!severityName");
    expect(isExcludeFacetKey("!severityName")).toBe(true);
    expect(isExcludeFacetKey("severityName")).toBe(false);
    expect(getBaseFacetKey("!severityName")).toBe("severityName");
    expect(getBaseFacetKey("severityName")).toBe("severityName");
    expect(getBaseFacetKey(toExcludeFacetKey("attributes.k"))).toBe(
      "attributes.k",
    );
  });
});

describe("readFacetChip: the row a chip lights", () => {
  test("a column chip lights its own facet's row for its raw value, included", () => {
    expect(reading("statusCode", "2")).toEqual({
      facetKeys: ["statusCode"],
      value: "2",
      state: FacetValueState.Included,
    });
    expect(reading("severityText", "Error")).toEqual({
      facetKeys: ["severityText"],
      value: "Error",
      state: FacetValueState.Included,
    });
  });

  test("Span Type's synthetic chip lights the 'Root spans' row", () => {
    expect(reading("spanType", "root")).toEqual({
      facetKeys: ["spanType"],
      value: "root",
      state: FacetValueState.Included,
    });
  });

  test("a column value is read raw: a column chip is not search grammar", () => {
    // Exception types, span names and severities are stored as they are.
    for (const value of [
      "System.*Exception",
      "a?b",
      "GET /api/*",
      "!important",
      "~approx",
      "(a OR b)",
      ">5",
      '"quoted"',
      "",
    ]) {
      expect(reading("exceptionType", value)).toEqual({
        facetKeys: ["exceptionType"],
        value: value,
        state: FacetValueState.Included,
      });
    }
  });

  test("an exclusion, marked on the key, lights the facet's row as excluded", () => {
    expect(reading("!severityName", "Low")).toEqual({
      facetKeys: ["severityName"],
      value: "Low",
      state: FacetValueState.Excluded,
    });
    expect(reading(toExcludeFacetKey("primaryEntityId"), SERVICE_ID)).toEqual({
      facetKeys: ["primaryEntityId"],
      value: SERVICE_ID,
      state: FacetValueState.Excluded,
    });
  });

  test("the legacy serviceId chip lights the Service facet, under either key", () => {
    expect(reading("serviceId", SERVICE_ID)).toEqual({
      facetKeys: [SERVICE_FACET_KEY, "serviceId"],
      value: SERVICE_ID,
      state: FacetValueState.Included,
    });
    expect(reading("primaryEntityId", SERVICE_ID)).toEqual({
      facetKeys: [SERVICE_FACET_KEY],
      value: SERVICE_ID,
      state: FacetValueState.Included,
    });
  });

  /*
   * The Traces Host Name and Service Instance facets store a clicked value
   * as a token that means exactly that value (buildSearchTokenValue). The
   * sidebar used to compare the raw facet value with the escaped token, so
   * these values never showed as checked - and a click added another chip.
   */
  test.each([
    ["/api/*"],
    ["a?b"],
    ["my host"],
    ["  padded  "],
    ['say "hi"'],
    ["back\\slash"],
    ["trail\\"],
    ["!important"],
    ["~approx"],
    ["(a)"],
    ["[x]"],
    [">5"],
    ["<=3"],
    ["-dash"],
    ["*"],
    ["a OR b"],
    ["x,y"],
    ["plain-host-01"],
  ])(
    "REGRESSION: an attribute chip for %j lights that very value",
    (literal: string) => {
      const token: string = buildSearchTokenValue(literal);

      expect(reading("attributes.resource.host.name", token)).toEqual({
        facetKeys: ["resource.host.name", "attributes.resource.host.name"],
        value: literal,
        state: FacetValueState.Included,
      });
    },
  );

  test("an attribute chip's not-equal token lights its value as excluded", () => {
    expect(
      reading("attributes.host.name", `!${buildSearchTokenValue("web 01")}`),
    ).toEqual({
      facetKeys: ["host.name", "attributes.host.name"],
      value: "web 01",
      state: FacetValueState.Excluded,
    });
    expect(reading("attributes.host.name", "!web-01")).toEqual({
      facetKeys: ["host.name", "attributes.host.name"],
      value: "web-01",
      state: FacetValueState.Excluded,
    });
  });

  test("leaving out what leaves a value out keeps it", () => {
    expect(reading("!attributes.host.name", "!web-01")).toEqual({
      facetKeys: ["host.name", "attributes.host.name"],
      value: "web-01",
      state: FacetValueState.Included,
    });
    expect(reading("!attributes.host.name", "web-01")).toEqual({
      facetKeys: ["host.name", "attributes.host.name"],
      value: "web-01",
      state: FacetValueState.Excluded,
    });
  });

  test("an attribute chip that stands for more than one value lights no row", () => {
    for (const token of [
      "a*",
      "*a",
      "a?c",
      "~abc",
      "(a OR b)",
      "[a, b]",
      ">10",
      ">=10",
      "<10",
      "<=10",
      "*",
    ]) {
      expect(
        `${token}: ${JSON.stringify(reading("attributes.k", token))}`,
      ).toBe(`${token}: null`);
    }
  });

  test("a chip with no facet behind it lights nothing", () => {
    expect(reading("", "x")).toBeNull();
    expect(reading(FACET_EXCLUDE_KEY_PREFIX, "x")).toBeNull();
    expect(reading(ATTRIBUTE_FACET_KEY_PREFIX, "x")).toBeNull();
    expect(readFacetChip(undefined as unknown as ActiveFilter)).toBeNull();
  });
});

describe("buildFacetSelections: what each row shows", () => {
  test("nothing filtering, nothing lit", () => {
    expect(buildFacetSelections(undefined).size).toBe(0);
    expect(buildFacetSelections(null).size).toBe(0);
    expect(buildFacetSelections([]).size).toBe(0);
  });

  test("a user chip lights its row, and is what a click takes off", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("statusCode", "2", { displayValue: "Error" }),
    ]);

    expect(getFacetValueSelection(selections, "statusCode", "2")).toEqual({
      state: FacetValueState.Included,
      chips: [{ facetKey: "statusCode", value: "2" }],
      isLocked: false,
      displayValue: "Error",
    });
    expect(getFacetValueSelection(selections, "statusCode", "0")).toBe(
      undefined,
    );
  });

  test("an excluded value is lit as excluded, its exclusion chip the one to take off", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("!severityName", "Low"),
    ]);

    expect(getFacetValueSelection(selections, "severityName", "Low")).toEqual({
      state: FacetValueState.Excluded,
      chips: [{ facetKey: "!severityName", value: "Low" }],
      isLocked: false,
      displayValue: undefined,
    });
  });

  test("a value both kept and left out reads as kept, as the explorers compile it", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("!severityName", "Low"),
      chip("severityName", "Low"),
    ]);

    expect(getFacetValueSelection(selections, "severityName", "Low")).toEqual({
      state: FacetValueState.Included,
      chips: [{ facetKey: "severityName", value: "Low" }],
      isLocked: false,
      displayValue: undefined,
    });
  });

  test("a value only the page filters on is locked: lit, with nothing to take off", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("primaryEntityId", SERVICE_ID, {
        readOnly: true,
        displayValue: "checkout-api",
      }),
    ]);

    expect(
      getFacetValueSelection(selections, "primaryEntityId", SERVICE_ID),
    ).toEqual({
      state: FacetValueState.Included,
      chips: [],
      isLocked: true,
      displayValue: "checkout-api",
    });
    expect(
      getFacetChipsToClear(selections, "primaryEntityId", SERVICE_ID),
    ).toEqual([]);
  });

  test("the reader's own chip beside the page's one is still theirs to take off", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("primaryEntityId", SERVICE_ID, { readOnly: true }),
      chip("primaryEntityId", SERVICE_ID),
    ]);

    expect(
      getFacetValueSelection(selections, "primaryEntityId", SERVICE_ID),
    ).toEqual({
      state: FacetValueState.Included,
      chips: [{ facetKey: "primaryEntityId", value: SERVICE_ID }],
      isLocked: false,
      displayValue: undefined,
    });
  });

  test("every chip that lights a row is taken off by one click: the serviceId alias too", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("serviceId", SERVICE_ID),
      chip("primaryEntityId", SERVICE_ID),
      chip("primaryEntityId", OTHER_SERVICE_ID),
    ]);

    expect(
      getFacetChipsToClear(selections, "primaryEntityId", SERVICE_ID),
    ).toEqual([
      { facetKey: "serviceId", value: SERVICE_ID },
      { facetKey: "primaryEntityId", value: SERVICE_ID },
    ]);
    expect(
      getFacetChipsToClear(selections, "primaryEntityId", OTHER_SERVICE_ID),
    ).toEqual([{ facetKey: "primaryEntityId", value: OTHER_SERVICE_ID }]);
  });

  test("the same chip twice is one chip to take off", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("kind", "SPAN_KIND_SERVER"),
      chip("kind", "SPAN_KIND_SERVER"),
    ]);

    expect(
      getFacetChipsToClear(selections, "kind", "SPAN_KIND_SERVER"),
    ).toEqual([{ facetKey: "kind", value: "SPAN_KIND_SERVER" }]);
  });

  test("REGRESSION: an escaped Host Name chip lights the row and is taken off as stored", () => {
    const token: string = buildSearchTokenValue("ip 10.0.0.1 /api/*");
    const selections: FacetSelections = buildFacetSelections([
      chip(`attributes.resource.host.name`, token),
    ]);

    const selection: FacetValueSelection | undefined = getFacetValueSelection(
      selections,
      "resource.host.name",
      "ip 10.0.0.1 /api/*",
    );

    expect(selection?.state).toBe(FacetValueState.Included);
    expect(
      getFacetChipsToClear(
        selections,
        "resource.host.name",
        "ip 10.0.0.1 /api/*",
      ),
    ).toEqual([{ facetKey: "attributes.resource.host.name", value: token }]);
  });

  test("the chip's name for a value is kept only when it says more than the value", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("severityText", "Error", { displayValue: "Error" }),
      chip("primaryEntityId", SERVICE_ID, { displayValue: "  " }),
      chip("hostId", OTHER_SERVICE_ID, { displayValue: "web-01" }),
    ]);

    expect(
      getFacetValueSelection(selections, "severityText", "Error")?.displayValue,
    ).toBeUndefined();
    expect(
      getFacetValueSelection(selections, "primaryEntityId", SERVICE_ID)
        ?.displayValue,
    ).toBeUndefined();
    expect(
      getFacetValueSelection(selections, "hostId", OTHER_SERVICE_ID)
        ?.displayValue,
    ).toBe("web-01");
  });

  test("chips that stand for no one value light nothing, and are never taken off by a row", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("attributes.http.route", "/api/*"),
      chip("attributes.http.route", "~orders"),
    ]);

    expect(selections.size).toBe(0);
  });
});

describe("one facet section's three sets", () => {
  test("kept, left out and locked values, each where it belongs", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("severityName", "Critical"),
      chip("!severityName", "Low"),
      chip("severityName", "High", { readOnly: true }),
      chip("className", "DNS Activity"),
    ]);

    const section: FacetSectionSelection = getFacetSectionSelection(
      selections,
      "severityName",
    );

    expect(Array.from(section.includedValues).sort()).toEqual([
      "Critical",
      "High",
    ]);
    expect(Array.from(section.excludedValues)).toEqual(["Low"]);
    expect(Array.from(section.lockedValues)).toEqual(["High"]);

    const empty: FacetSectionSelection = getFacetSectionSelection(
      selections,
      "statusName",
    );
    expect(empty.includedValues.size).toBe(0);
    expect(empty.excludedValues.size).toBe(0);
    expect(empty.lockedValues.size).toBe(0);
  });

  test("every value that is filtering counts as in use, excluded ones too", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("severityName", "Critical"),
      chip("!severityName", "Low"),
      chip("attributes.host.name", buildSearchTokenValue("web 01")),
    ]);

    const byKey: Record<string, Set<string>> = getSelectedValuesByKey(
      selections,
    );

    expect(Array.from(byKey["severityName"]!).sort()).toEqual([
      "Critical",
      "Low",
    ]);
    expect(Array.from(byKey["host.name"]!)).toEqual(["web 01"]);
    expect(Array.from(byKey["attributes.host.name"]!)).toEqual(["web 01"]);
  });
});

describe("withSelectedFacetValues: a filtering value keeps its row", () => {
  const values: Array<FacetValue> = [
    { value: "Critical", count: 4 },
    { value: "High", count: 2 },
  ];

  test("a value the answer left out is added at 0, named as its chip names it", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("!severityName", "Low"),
      chip("primaryEntityId", SERVICE_ID, { displayValue: "checkout-api" }),
    ]);

    expect(
      withSelectedFacetValues(values, selections.get("severityName")),
    ).toEqual([
      { value: "Critical", count: 4 },
      { value: "High", count: 2 },
      { value: "Low", count: 0 },
    ]);
    expect(
      withSelectedFacetValues([], selections.get("primaryEntityId")),
    ).toEqual([{ value: SERVICE_ID, count: 0, displayName: "checkout-api" }]);
  });

  test("values already listed keep their place, count and the very array", () => {
    const selections: FacetSelections = buildFacetSelections([
      chip("severityName", "High"),
    ]);

    expect(
      withSelectedFacetValues(values, selections.get("severityName")),
    ).toBe(values);
    expect(withSelectedFacetValues(values, undefined)).toBe(values);
    expect(withSelectedFacetValues(values, new Map())).toBe(values);
  });
});

describe("getDisplayedFacetValues: a checked value is never folded away", () => {
  const values: Array<FacetValue> = Array.from(
    { length: 9 },
    (_value: unknown, index: number): FacetValue => {
      return { value: `v${index + 1}`, count: 100 - index };
    },
  );

  function shown(result: DisplayedFacetValues): Array<string> {
    return result.displayed.map((value: FacetValue): string => {
      return value.value;
    });
  }

  test("the first rows, and every pinned value past them in list order", () => {
    const result: DisplayedFacetValues = getDisplayedFacetValues({
      values: values,
      visibleCount: 5,
      showAll: false,
      pinnedValues: new Set<string>(["v9", "v7", "v2"]),
    });

    expect(shown(result)).toEqual(["v1", "v2", "v3", "v4", "v5", "v7", "v9"]);
    expect(result.hiddenCount).toBe(2);
  });

  test("nothing pinned: the first rows, the rest held back", () => {
    const result: DisplayedFacetValues = getDisplayedFacetValues({
      values: values,
      visibleCount: 5,
      showAll: false,
      pinnedValues: new Set<string>(),
    });

    expect(shown(result)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
    expect(result.hiddenCount).toBe(4);
  });

  test("show all: every value, nothing held back", () => {
    const result: DisplayedFacetValues = getDisplayedFacetValues({
      values: values,
      visibleCount: 5,
      showAll: true,
      pinnedValues: new Set<string>(["v9"]),
    });

    expect(shown(result)).toHaveLength(9);
    expect(result.hiddenCount).toBe(0);
  });

  test("a list that fits holds nothing back", () => {
    const result: DisplayedFacetValues = getDisplayedFacetValues({
      values: values.slice(0, 3),
      visibleCount: 5,
      showAll: false,
      pinnedValues: new Set<string>(["v2"]),
    });

    expect(shown(result)).toEqual(["v1", "v2", "v3"]);
    expect(result.hiddenCount).toBe(0);
  });
});
