import { describe, expect, test } from "@jest/globals";
import {
  CRITERIA_FILTER_CONDITION_WORDS,
  CRITERIA_FILTER_COUNT,
  CRITERIA_FILTER_COUNT_WITH_CONDITION,
  getCriteriaFilterCountText,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilterCount";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * How many filters a folded monitor criteria says it has - in its header
 * and in its folded Filters section, which used to say it two ways ("2
 * filters (ALL)" and "2 filters, ALL match", the second never translated).
 * Both now read one helper, and name ALL or ANY only from two filters.
 */

const FILTER: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 3000,
};

function filters(count: number): Array<CriteriaFilter> {
  return Array.from({ length: count }, (): CriteriaFilter => {
    return { ...FILTER };
  });
}

const ENGLISH: Translator = createTranslator(undefined, "en");

// German for the sentences this helper looks up, as the locale files hold them.
const GERMAN_WORDS: Record<string, string> = {
  "{{count}} filters": "{{count}} Filter",
  "{{count}} filters_one": "{{count}} Filter",
  "{{count}} filters ({{condition}})": "{{count}} Filter ({{condition}})",
  "{{count}} filters ({{condition}})_one": "{{count}} Filter ({{condition}})",
  ALL: "ALLE",
  ANY: "EINER",
};

const GERMAN: Translator = createTranslator(
  (key: string): string | undefined => {
    return GERMAN_WORDS[key];
  },
  "de",
);

describe("a criteria's filter count", () => {
  test("is said by plural sentences the locale files hold", () => {
    expect(CRITERIA_FILTER_COUNT).toEqual({
      one: "{{count}} filter",
      other: "{{count}} filters",
    });
    expect(CRITERIA_FILTER_COUNT_WITH_CONDITION).toEqual({
      one: "{{count}} filter ({{condition}})",
      other: "{{count}} filters ({{condition}})",
    });
    expect(CRITERIA_FILTER_CONDITION_WORDS).toEqual({
      [FilterCondition.All]: "ALL",
      [FilterCondition.Any]: "ANY",
    });
  });

  test.each([FilterCondition.All, FilterCondition.Any, undefined])(
    "names no condition with none or one filter (%s)",
    (filterCondition: FilterCondition | undefined) => {
      expect(
        getCriteriaFilterCountText({
          translator: ENGLISH,
          filters: [],
          filterCondition: filterCondition,
        }),
      ).toBe("0 filters");
      expect(
        getCriteriaFilterCountText({
          translator: ENGLISH,
          filters: undefined,
          filterCondition: filterCondition,
        }),
      ).toBe("0 filters");
      expect(
        getCriteriaFilterCountText({
          translator: ENGLISH,
          filters: filters(1),
          filterCondition: filterCondition,
        }),
      ).toBe("1 filter");
    },
  );

  test("names the condition from two filters on", () => {
    expect(
      getCriteriaFilterCountText({
        translator: ENGLISH,
        filters: filters(2),
        filterCondition: FilterCondition.All,
      }),
    ).toBe("2 filters (ALL)");
    expect(
      getCriteriaFilterCountText({
        translator: ENGLISH,
        filters: filters(3),
        filterCondition: FilterCondition.Any,
      }),
    ).toBe("3 filters (ANY)");
  });

  test("reads a criteria saved without a condition as ALL, as it is evaluated", () => {
    expect(
      getCriteriaFilterCountText({
        translator: ENGLISH,
        filters: filters(2),
        filterCondition: undefined,
      }),
    ).toBe("2 filters (ALL)");
  });

  test("is translated whole, the condition word with it", () => {
    expect(
      getCriteriaFilterCountText({
        translator: GERMAN,
        filters: filters(1),
        filterCondition: FilterCondition.Any,
      }),
    ).toBe("1 Filter");
    expect(
      getCriteriaFilterCountText({
        translator: GERMAN,
        filters: filters(2),
        filterCondition: FilterCondition.Any,
      }),
    ).toBe("2 Filter (EINER)");
  });
});
