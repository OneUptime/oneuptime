import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  buildDictionaryValue,
  formatDictionaryValueForDisplay,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import { describe, expect, test } from "@jest/globals";

/*
 * `formatDictionaryValueForDisplay` is the one place an attribute filter is
 * turned into text. It exists because everything except the implicit `=`
 * operator is stored as an operator *object*, and a caller that put one on
 * screen unrendered threw
 *
 *   Objects are not valid as a React child (found: object with keys {_values})
 *
 * which unmounted the monitoring-criteria modal and left no way to save a log
 * monitor. So these tests care about two things: that the text is right, and
 * that a string always comes back.
 */

describe("formatDictionaryValueForDisplay", () => {
  describe("bare values (the implicit = operator)", () => {
    test("a string renders as itself, with no operator prefix", () => {
      expect(formatDictionaryValueForDisplay("web")).toBe("web");
    });

    test("numbers and booleans stringify", () => {
      expect(formatDictionaryValueForDisplay(42)).toBe("42");
      expect(formatDictionaryValueForDisplay(0)).toBe("0");
      expect(formatDictionaryValueForDisplay(true)).toBe("true");
      expect(formatDictionaryValueForDisplay(false)).toBe("false");
    });

    test("an EqualTo wrapper reads the same as the bare string", () => {
      expect(formatDictionaryValueForDisplay(new EqualTo<string>("web"))).toBe(
        "web",
      );
    });

    test("null and undefined render as empty rather than throwing", () => {
      expect(formatDictionaryValueForDisplay(null)).toBe("");
      expect(formatDictionaryValueForDisplay(undefined)).toBe("");
    });
  });

  describe("single-value operators name themselves", () => {
    test.each([
      [new NotEqual<string>("web"), "does not equal web"],
      [new Search<string>("web"), "contains web"],
      [new NotContains<string>("web"), "does not contain web"],
      [new StartsWith<string>("web"), "starts with web"],
      [new EndsWith<string>("web"), "ends with web"],
      [new GreaterThan<number>(5), "greater than 5"],
      [new GreaterThanOrEqual<number>(5), "greater than or equal 5"],
      [new LessThan<number>(5), "less than 5"],
      [new LessThanOrEqual<number>(5), "less than or equal 5"],
    ])("%p renders as %p", (value: unknown, expected: string) => {
      expect(formatDictionaryValueForDisplay(value)).toBe(expected);
    });
  });

  describe("value-less operators are the whole filter", () => {
    test("IsNull reads as 'is empty'", () => {
      expect(formatDictionaryValueForDisplay(new IsNull())).toBe("is empty");
    });

    test("NotNull reads as 'is not empty'", () => {
      expect(formatDictionaryValueForDisplay(new NotNull())).toBe(
        "is not empty",
      );
    });
  });

  describe("membership operators list their values", () => {
    test("Includes — the exact shape from the reported crash", () => {
      expect(formatDictionaryValueForDisplay(new Includes(["web"]))).toBe(
        "is any of web",
      );
    });

    test("several values are comma separated", () => {
      expect(
        formatDictionaryValueForDisplay(new Includes(["web", "api", "worker"])),
      ).toBe("is any of web, api, worker");
    });

    test("IncludesNone reads as exclusion", () => {
      expect(
        formatDictionaryValueForDisplay(new IncludesNone(["web", "api"])),
      ).toBe("is none of web, api");
    });

    test("an empty membership list shows the operator alone", () => {
      /*
       * An empty Includes is a no-op downstream ("All"), so there is nothing
       * to name — but it must still not render a dangling separator.
       */
      expect(formatDictionaryValueForDisplay(new Includes([]))).toBe(
        "is any of",
      );
      expect(formatDictionaryValueForDisplay(new IncludesNone([]))).toBe(
        "is none of",
      );
    });
  });

  describe("values read back from storage, before hydration", () => {
    /*
     * A saved monitor round-trips through JSON, so a filter reaches the UI as
     * the `{_type, value}` shape toJSON() emits rather than as a class
     * instance. Both have to render.
     */
    test("a serialized Includes", () => {
      expect(
        formatDictionaryValueForDisplay({
          _type: "Includes",
          value: ["web", "api"],
        }),
      ).toBe("is any of web, api");
    });

    test("a serialized Search", () => {
      expect(
        formatDictionaryValueForDisplay({ _type: "Search", value: "web" }),
      ).toBe("contains web");
    });

    test("a serialized IsNull", () => {
      expect(
        formatDictionaryValueForDisplay({ _type: "IsNull", value: null }),
      ).toBe("is empty");
    });

    test("a serialized NotEqual", () => {
      expect(
        formatDictionaryValueForDisplay({ _type: "NotEqual", value: "web" }),
      ).toBe("does not equal web");
    });
  });

  describe("nothing gets through as an object", () => {
    /*
     * The regression guard that generalises the bug report. Steve hit it on
     * two operators; the defect was in every one of them, so assert the whole
     * dropdown at once — a new operator added without display handling fails
     * here rather than in a customer's browser.
     */
    test.each(
      DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
        (option: DictionaryFilterOperatorOption) => {
          return [option.operator, option] as [
            DictionaryFilterOperator,
            DictionaryFilterOperatorOption,
          ];
        },
      ),
    )(
      "%s produces renderable text",
      (
        operator: DictionaryFilterOperator,
        option: DictionaryFilterOperatorOption,
      ) => {
        const stored: DictionaryEntryValue = buildDictionaryValue({
          operator,
          rawValue: option.expectsNumericValue ? "5" : "web",
          rawValues: ["web", "api"],
        });

        const text: string = formatDictionaryValueForDisplay(stored);

        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain("[object Object]");
      },
    );

    test("an unrecognised object does not leak through", () => {
      const text: string = formatDictionaryValueForDisplay({
        something: "unexpected",
      });

      expect(typeof text).toBe("string");
      expect(text).not.toContain("[object Object]");
    });
  });

  describe("round trip with the form", () => {
    /*
     * What the criteria form writes has to be what the chip reads — these
     * pin the two halves together rather than testing the formatter alone.
     */
    test.each([
      [DictionaryFilterOperator.Contains, "contains web"],
      [DictionaryFilterOperator.NotContains, "does not contain web"],
      [DictionaryFilterOperator.StartsWith, "starts with web"],
      [DictionaryFilterOperator.EndsWith, "ends with web"],
      [DictionaryFilterOperator.NotEqual, "does not equal web"],
      [DictionaryFilterOperator.EqualTo, "web"],
    ])(
      "%s written by the form renders as %p",
      (operator: DictionaryFilterOperator, expected: string) => {
        expect(
          formatDictionaryValueForDisplay(
            buildDictionaryValue({ operator, rawValue: "web" }),
          ),
        ).toBe(expected);
      },
    );

    test("a multi-select written by the form renders its selection", () => {
      expect(
        formatDictionaryValueForDisplay(
          buildDictionaryValue({
            operator: DictionaryFilterOperator.IsAnyOf,
            rawValue: "",
            rawValues: ["web", "api"],
          }),
        ),
      ).toBe("is any of web, api");
    });
  });
});
