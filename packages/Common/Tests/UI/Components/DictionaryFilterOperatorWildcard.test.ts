import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryFilterOperatorOption,
  buildDictionaryValue,
  detectOperatorFromValue,
  formatDictionaryValueForDisplay,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import { ObjectType } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The "matches" / "does not match" rows of the structured attribute-filter
 * builder — the one used by log and trace monitor criteria, the metric query
 * form and the dashboard table widget.
 *
 * The search bar and this builder compile to the SAME operators, so a filter
 * a user can express by typing must also be expressible by picking, and both
 * must round-trip: the form is re-populated from stored values every time it
 * is reopened, and an operator the detector does not recognise silently
 * reverts to "equals" the next time someone edits the row.
 */

describe("the matches operators are offered in the picker", () => {
  test.each([
    [DictionaryFilterOperator.Matches, "matches"],
    [DictionaryFilterOperator.NotMatches, "does not match"],
  ])(
    "%s is listed as %p",
    (operator: DictionaryFilterOperator, label: string) => {
      const option: DictionaryFilterOperatorOption | undefined =
        DICTIONARY_FILTER_OPERATOR_OPTIONS.find(
          (candidate: DictionaryFilterOperatorOption) => {
            return candidate.operator === operator;
          },
        );

      expect(option).toBeDefined();
      expect(option!.label).toBe(label);
    },
  );

  test("they take a value input, unlike is-empty", () => {
    const option: DictionaryFilterOperatorOption =
      DICTIONARY_FILTER_OPERATOR_OPTIONS.find(
        (candidate: DictionaryFilterOperatorOption) => {
          return candidate.operator === DictionaryFilterOperator.Matches;
        },
      )!;

    expect(option.hidesValueInput).toBeUndefined();
    expect(option.expectsMultiValue).toBeUndefined();
  });
});

describe("buildDictionaryValue", () => {
  test("matches builds a Wildcard carrying the glob", () => {
    const value: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.Matches,
      rawValue: "api-*",
    });

    expect(value).toBeInstanceOf(Wildcard);
    expect((value as Wildcard<string>).toPatterns()).toEqual(["api-%"]);
  });

  test("does-not-match builds a NotWildcard", () => {
    expect(
      buildDictionaryValue({
        operator: DictionaryFilterOperator.NotMatches,
        rawValue: "api-*",
      }),
    ).toBeInstanceOf(NotWildcard);
  });

  test("an OR-separated value becomes a multi-glob disjunction", () => {
    const value: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.Matches,
      rawValue: "api-* OR web-*",
    });

    expect((value as Wildcard<string>).toPatterns()).toEqual([
      "api-%",
      "web-%",
    ]);
  });

  test("blank entries are dropped, so a trailing OR is not a filter on nothing", () => {
    const value: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.Matches,
      rawValue: "api-* OR ",
    });

    expect((value as Wildcard<string>).values).toEqual(["api-*"]);
  });
});

describe("detectOperatorFromValue", () => {
  test("recognises a hydrated Wildcard instance", () => {
    expect(detectOperatorFromValue(new Wildcard("api-*")).operator).toBe(
      DictionaryFilterOperator.Matches,
    );
  });

  test("recognises a NotWildcard instance", () => {
    expect(detectOperatorFromValue(new NotWildcard("api-*")).operator).toBe(
      DictionaryFilterOperator.NotMatches,
    );
  });

  test("recognises the raw {_type, value} shape straight out of storage", () => {
    /*
     * A stored filter is not always hydrated by the time the form reads it,
     * so the detector has to handle both. Missing this is invisible until
     * someone reopens a monitor's criteria and finds the operator reset to
     * "equals".
     */
    const detected: { operator: DictionaryFilterOperator; rawValue: string } =
      detectOperatorFromValue({
        _type: ObjectType.Wildcard,
        value: ["api-*"],
      });

    expect(detected.operator).toBe(DictionaryFilterOperator.Matches);
    expect(detected.rawValue).toBe("api-*");
  });

  test("a multi-glob value comes back joined for the single-value input", () => {
    expect(
      detectOperatorFromValue(new Wildcard(["api-*", "web-*"])).rawValue,
    ).toBe("api-* OR web-*");
  });

  test("build then detect then build is stable", () => {
    const first: DictionaryEntryValue = buildDictionaryValue({
      operator: DictionaryFilterOperator.Matches,
      rawValue: "api-* OR web-*",
    });
    const detected: { operator: DictionaryFilterOperator; rawValue: string } =
      detectOperatorFromValue(first);
    const second: DictionaryEntryValue = buildDictionaryValue(detected);

    expect((second as Wildcard<string>).values).toEqual(
      (first as Wildcard<string>).values,
    );
  });
});

describe("formatDictionaryValueForDisplay", () => {
  test("a wildcard chip says what it matches", () => {
    expect(formatDictionaryValueForDisplay(new Wildcard("api-*"))).toBe(
      "matches api-*",
    );
  });

  test("a negated wildcard chip says so", () => {
    expect(formatDictionaryValueForDisplay(new NotWildcard("api-*"))).toBe(
      "does not match api-*",
    );
  });

  test("it never returns an object, which React cannot render", () => {
    /*
     * Handing an operator instance to React as a child throws and took the
     * whole monitor-criteria modal down with it, leaving no way to reach
     * Save. Every attribute-filter renderer goes through this function.
     */
    expect(typeof formatDictionaryValueForDisplay(new Wildcard("a*"))).toBe(
      "string",
    );
  });
});
