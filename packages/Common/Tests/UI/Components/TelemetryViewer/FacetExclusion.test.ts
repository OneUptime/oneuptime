import { describe, expect, test } from "@jest/globals";
import {
  FacetChoiceChip,
  FacetFilterGroups,
  chooseFacetValueInChips,
  chooseFacetValueInMap,
  getEffectiveExcludedValues,
  getFacetChoiceChipKey,
  groupFacetChips,
  groupFacetFilters,
} from "../../../../UI/Components/TelemetryViewer/FacetExclusion";
import { FacetValueState } from "../../../../UI/Components/TelemetryViewer/FacetSelection";

/*
 * Keeping a facet value, or leaving it out, in every telemetry explorer.
 *
 * Two rules every explorer shares, pinned here once:
 *  - a value ends up in exactly the state asked for - never a toggle - and
 *    a value in the other state MOVES, so "Severity: debug" and "Severity
 *    is not: debug" are never both applied;
 *  - asking for the state a value is already in hands back the very same
 *    collection, so an explorer can tell a no-op from a change and skip a
 *    refetch.
 */

const mapOf: (
  entries: Array<[string, Array<string>]>,
) => Map<string, Set<string>> = (
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> => {
  return new Map<string, Set<string>>(
    entries.map(([key, values]: [string, Array<string>]) => {
      return [key, new Set<string>(values)];
    }),
  );
};

const plain: (
  map: Map<string, Set<string>>,
) => Array<[string, Array<string>]> = (
  map: Map<string, Set<string>>,
): Array<[string, Array<string>]> => {
  return Array.from(map.entries()).map(
    ([key, values]: [string, Set<string>]): [string, Array<string>] => {
      return [key, Array.from(values)];
    },
  );
};

describe("the chip key a choice is stored under", () => {
  test("the facet's own key to keep a value, the `!` key to leave it out", () => {
    expect(
      getFacetChoiceChipKey("severityText", FacetValueState.Included),
    ).toBe("severityText");
    expect(
      getFacetChoiceChipKey("severityText", FacetValueState.Excluded),
    ).toBe("!severityText");
  });

  test("reads the facet out of either key first", () => {
    expect(
      getFacetChoiceChipKey("!severityText", FacetValueState.Included),
    ).toBe("severityText");
    expect(
      getFacetChoiceChipKey("!severityText", FacetValueState.Excluded),
    ).toBe("!severityText");
  });
});

describe("a choice in a map of chips (Logs, Security Events)", () => {
  test("leaving a value out adds it under the `!` key", () => {
    const next: Map<string, Set<string>> = chooseFacetValueInMap(
      mapOf([["severityText", ["error"]]]),
      "severityText",
      "debug",
      FacetValueState.Excluded,
    );

    expect(plain(next)).toEqual([
      ["severityText", ["error"]],
      ["!severityText", ["debug"]],
    ]);
  });

  test("leaving out a value that is kept MOVES it, and an emptied group goes", () => {
    const next: Map<string, Set<string>> = chooseFacetValueInMap(
      mapOf([["severityText", ["debug"]]]),
      "severityText",
      "debug",
      FacetValueState.Excluded,
    );

    expect(plain(next)).toEqual([["!severityText", ["debug"]]]);
  });

  test("keeping a value that is left out moves it back", () => {
    const next: Map<string, Set<string>> = chooseFacetValueInMap(
      mapOf([["!severityText", ["debug", "trace"]]]),
      "severityText",
      "debug",
      FacetValueState.Included,
    );

    expect(plain(next)).toEqual([
      ["!severityText", ["trace"]],
      ["severityText", ["debug"]],
    ]);
  });

  test("asking for the state a value is already in hands back the same map", () => {
    const kept: Map<string, Set<string>> = mapOf([["severityText", ["error"]]]);
    const leftOut: Map<string, Set<string>> = mapOf([
      ["!severityText", ["debug"]],
    ]);

    expect(
      chooseFacetValueInMap(
        kept,
        "severityText",
        "error",
        FacetValueState.Included,
      ),
    ).toBe(kept);
    expect(
      chooseFacetValueInMap(
        leftOut,
        "severityText",
        "debug",
        FacetValueState.Excluded,
      ),
    ).toBe(leftOut);
  });

  test("a value in both states (a hand-edited link) is moved to the one asked for", () => {
    const next: Map<string, Set<string>> = chooseFacetValueInMap(
      mapOf([
        ["severityText", ["debug"]],
        ["!severityText", ["debug"]],
      ]),
      "severityText",
      "debug",
      FacetValueState.Excluded,
    );

    expect(plain(next)).toEqual([["!severityText", ["debug"]]]);

    const moved: Map<string, Set<string>> = chooseFacetValueInMap(
      mapOf([
        ["severityText", ["debug"]],
        ["!severityText", ["debug"]],
      ]),
      "severityText",
      "debug",
      FacetValueState.Included,
    );

    expect(plain(moved)).toEqual([["severityText", ["debug"]]]);
  });

  test("an empty value changes nothing", () => {
    const previous: Map<string, Set<string>> = mapOf([]);

    expect(
      chooseFacetValueInMap(
        previous,
        "severityText",
        "",
        FacetValueState.Excluded,
      ),
    ).toBe(previous);
  });

  test("never changes the map it was handed", () => {
    const previous: Map<string, Set<string>> = mapOf([
      ["severityText", ["debug"]],
    ]);

    chooseFacetValueInMap(
      previous,
      "severityText",
      "debug",
      FacetValueState.Excluded,
    );

    expect(plain(previous)).toEqual([["severityText", ["debug"]]]);
  });
});

interface Chip extends FacetChoiceChip {
  displayKey: string;
}

const chip: (facetKey: string, value: string, readOnly?: boolean) => Chip = (
  facetKey: string,
  value: string,
  readOnly?: boolean,
): Chip => {
  return readOnly
    ? { facetKey, value, displayKey: "Status", readOnly: true }
    : { facetKey, value, displayKey: "Status" };
};

describe("a choice in a list of chips (Traces, Metrics, Exceptions)", () => {
  const build: (value: string) => (chipKey: string) => Chip = (
    value: string,
  ): ((chipKey: string) => Chip) => {
    return (chipKey: string): Chip => {
      return chip(chipKey, value);
    };
  };

  test("leaving a value out appends the chip the explorer builds, under the `!` key", () => {
    const next: Array<Chip> = chooseFacetValueInChips<Chip>(
      [chip("statusCode", "0")],
      "statusCode",
      "2",
      FacetValueState.Excluded,
      build("2"),
    );

    expect(next).toEqual([chip("statusCode", "0"), chip("!statusCode", "2")]);
  });

  test("leaving out a kept value replaces its chip; keeping it again moves it back", () => {
    const leftOut: Array<Chip> = chooseFacetValueInChips<Chip>(
      [chip("statusCode", "2")],
      "statusCode",
      "2",
      FacetValueState.Excluded,
      build("2"),
    );

    expect(leftOut).toEqual([chip("!statusCode", "2")]);

    const keptAgain: Array<Chip> = chooseFacetValueInChips<Chip>(
      leftOut,
      "statusCode",
      "2",
      FacetValueState.Included,
      build("2"),
    );

    expect(keptAgain).toEqual([chip("statusCode", "2")]);
  });

  test("asking for the state a value is already in hands back the same list", () => {
    const previous: Array<Chip> = [chip("!statusCode", "2")];

    expect(
      chooseFacetValueInChips<Chip>(
        previous,
        "statusCode",
        "2",
        FacetValueState.Excluded,
        build("2"),
      ),
    ).toBe(previous);
  });

  test("the page's own read-only chip is never moved: it is not the reader's", () => {
    const previous: Array<Chip> = [chip("statusCode", "2", true)];

    const next: Array<Chip> = chooseFacetValueInChips<Chip>(
      previous,
      "statusCode",
      "2",
      FacetValueState.Excluded,
      build("2"),
    );

    expect(next).toEqual([
      chip("statusCode", "2", true),
      chip("!statusCode", "2"),
    ]);
  });

  test("an empty value changes nothing", () => {
    const previous: Array<Chip> = [];

    expect(
      chooseFacetValueInChips<Chip>(
        previous,
        "statusCode",
        "",
        FacetValueState.Excluded,
        build(""),
      ),
    ).toBe(previous);
  });
});

describe("each facet's kept and left-out values, read apart", () => {
  test("from a map of chips, by the facet they filter", () => {
    const groups: FacetFilterGroups = groupFacetFilters([
      ["severityText", ["error", "error", ""]],
      ["!severityText", ["debug"]],
      ["!hostId", ["h1"]],
      ["!", ["ignored"]],
    ]);

    expect(Array.from(groups.included.entries())).toEqual([
      ["severityText", ["error"]],
    ]);
    expect(Array.from(groups.excluded.entries())).toEqual([
      ["severityText", ["debug"]],
      ["hostId", ["h1"]],
    ]);
  });

  test("from a list of chips, read-only ones included", () => {
    const groups: FacetFilterGroups = groupFacetChips([
      chip("statusCode", "2", true),
      chip("!kind", "SPAN_KIND_CLIENT"),
    ]);

    expect(groups.included.get("statusCode")).toEqual(["2"]);
    expect(groups.excluded.get("kind")).toEqual(["SPAN_KIND_CLIENT"]);
  });

  test("a value left out beside kept values of the same facet changes nothing, and is dropped", () => {
    const groups: FacetFilterGroups = groupFacetFilters([
      ["severityText", ["error"]],
      ["!severityText", ["debug"]],
      ["!environment", ["staging"]],
    ]);

    expect(getEffectiveExcludedValues(groups, "severityText")).toEqual([]);
    expect(getEffectiveExcludedValues(groups, "environment")).toEqual([
      "staging",
    ]);
    expect(getEffectiveExcludedValues(groups, "kind")).toEqual([]);
  });
});
