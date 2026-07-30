import { describe, expect, test } from "@jest/globals";
import {
  FACET_DATE_PLACEHOLDER,
  FACET_DATE_RANGE_SEPARATOR,
  buildFacetDateRangeQuery,
  formatFacetDateRange,
  isFacetDateRangeActive,
  parseFacetDateRange,
  serializeFacetDateRange,
  toFacetDate,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetDateRange";
import {
  DATE_FACET_OPERATORS,
  FILTER_OPERATOR_LABELS,
  FilterOperator,
  OPTION_FACET_OPERATORS,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import {
  FacetConflictMap,
  FacetSelectionConstraint,
  buildFacetConflictMap,
  getEmptyFacetSelectionState,
  isFacetActive,
  sanitizeFacetSelectionState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import CompareBase from "Common/Types/Database/CompareBase";
import OneUptimeDate from "Common/Types/Date";

/*
 * FacetDateRange is what a date chip in the facet bar means.
 *
 * The chip is fully controlled — it keeps no private copy of the dates — so
 * this module is simultaneously the codec the URL and saved views round-trip
 * through, the rule for whether the chip counts as "filtering", and the mapping
 * to the query. Those three have to agree: a chip that looks lit over a list it
 * is not narrowing, or a link that comes back holding a different range than it
 * left with, are both failures of this file rather than of the component.
 */

const START: Date = new Date("2026-07-16T09:41:23.456Z");
const END: Date = new Date("2026-07-20T17:02:11.222Z");

const ALL_OPERATORS: Array<FilterOperator> = Object.keys(
  FILTER_OPERATOR_LABELS,
) as Array<FilterOperator>;

/*
 * The values a hand-edited URL, a stale bookmark or a view saved by an older
 * build can hand over. None of them is a date, and none may become a filter.
 *
 * "0" earns its place: the platform's own date parser reads it as the year
 * 2000 through a lenient fallback, so a chip that trusted the parse would show
 * an empty table and explain it with a date nobody picked.
 */
const JUNK_VALUES: Array<[string, string]> = [
  ["an unknown word", "banana"],
  ["the empty string", ""],
  ["only whitespace", "   "],
  ["a bare number", "0"],
  ["another bare number", "1763251200000"],
  ["a day with no year", "07-16"],
  ["a US-style date", "07/16/2026"],
  ["a spelled-out date", "July 16 2026"],
  ["an Object.prototype member", "constructor"],
  ["a prototype-pollution attempt", "__proto__"],
  ["another prototype member", "toString"],
  ["a JSON payload", '{"lastSeenAt":null}'],
  ["a SQL fragment", "1' OR '1'='1"],
  ["a bare separator", FACET_DATE_RANGE_SEPARATOR],
  ["an option-chip value", "pending"],
];

/**
 * The exact operator class a query fragment is — `instanceof` passes for a
 * subclass too, and a subclass of a comparison is exactly what a regression
 * here would look like.
 */
function operatorNameOf(query: unknown): string {
  return (query as { constructor: { name: string } }).constructor.name;
}

const DATE_FACET: FacetSelectionConstraint = {
  key: "lastSeen",
  type: "dateRange",
  isMultiSelect: false,
  supportedOperators: DATE_FACET_OPERATORS,
};

const OPTION_FACET: FacetSelectionConstraint = {
  key: "status",
  isMultiSelect: false,
  supportedOperators: OPTION_FACET_OPERATORS,
};

describe("the operator vocabulary", () => {
  /*
   * These strings are in saved views and shared URLs. Renaming one orphans
   * every link already pasted into a ticket, so it has to break a test first.
   */
  test("carries the wire values that appear in URLs", () => {
    expect(FILTER_OPERATOR_LABELS["before"]).toBe("is before");
    expect(FILTER_OPERATOR_LABELS["after"]).toBe("is after");
    expect(FILTER_OPERATOR_LABELS["between"]).toBe("is between");
  });

  test("every operator has a label the chip can print", () => {
    for (const operator of ALL_OPERATORS) {
      expect(FILTER_OPERATOR_LABELS[operator].length).toBeGreaterThan(0);
    }
  });

  /*
   * A date operator on an option chip has no date to compare against — the
   * values there are option ids. Keeping the two lists disjoint on the date
   * operators is what lets sanitizeFacetSelectionState clamp one back to the
   * other without having to know which chip it is looking at.
   */
  test("the option chips are not offered the date operators", () => {
    expect(OPTION_FACET_OPERATORS).not.toContain("before");
    expect(OPTION_FACET_OPERATORS).not.toContain("after");
    expect(OPTION_FACET_OPERATORS).not.toContain("between");
  });

  /*
   * "is not on this day" over a nullable timestamp drops never-set rows —
   * SQL fails NULL out of the comparison — while reading as though it kept
   * them. There is no single-field query that means what those words say.
   */
  test("the date chips are not offered is_not", () => {
    expect(DATE_FACET_OPERATORS).not.toContain("is_not");
  });

  test("both lists name only operators the vocabulary knows", () => {
    for (const operator of [
      ...DATE_FACET_OPERATORS,
      ...OPTION_FACET_OPERATORS,
    ]) {
      expect(ALL_OPERATORS).toContain(operator);
    }
  });
});

describe("toFacetDate", () => {
  test("reads an ISO instant, the form the chip stores", () => {
    expect(toFacetDate(START.toISOString())).toEqual(START);
  });

  test("reads a bare calendar date, the form a date input produces", () => {
    const parsed: Date | null = toFacetDate("2026-07-16");

    expect(parsed).not.toBeNull();
    expect(Number.isNaN(parsed!.getTime())).toBe(false);
  });

  test.each(JUNK_VALUES)("%s is not a date", (_label: string, raw: string) => {
    expect(toFacetDate(raw)).toBeNull();
  });

  test("null and undefined are not dates", () => {
    expect(toFacetDate(null)).toBeNull();
    expect(toFacetDate(undefined)).toBeNull();
  });

  /*
   * The specific failure this guards: the platform's date parser falls back to
   * the browser's own, which reads "0" as the year 2000 rather than rejecting
   * it. Anything that reaches the query builder has to have been a date first.
   */
  test("never returns an Invalid Date", () => {
    for (const [, raw] of JUNK_VALUES) {
      const parsed: Date | null = toFacetDate(raw);

      expect(parsed === null || !Number.isNaN(parsed.getTime())).toBe(true);
    }
  });
});

describe("serializeFacetDateRange / parseFacetDateRange", () => {
  /*
   * The pair is a codec: whatever the popover holds has to survive a URL, a
   * saved view and a Back navigation unchanged. A range that came back as a
   * different range would filter the list differently from the link that was
   * shared, with nothing on screen to say so.
   */
  test("round-trips a single date", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: null },
      "is",
    );

    expect(parseFacetDateRange(values)).toEqual({ start: START, end: null });
  });

  test.each(["is", "before", "after"] as Array<FilterOperator>)(
    "round-trips a single date under %s",
    (operator: FilterOperator) => {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: null },
        operator,
      );

      expect(parseFacetDateRange(values).start).toEqual(START);
    },
  );

  test("round-trips a range", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: END },
      "between",
    );

    expect(parseFacetDateRange(values)).toEqual({ start: START, end: END });
  });

  /*
   * The two instants live inside ONE array entry. The shared selection
   * plumbing treats a facet's values as a set — it dedupes them, and clamps a
   * single-select facet to its first — so a two-entry range would come back
   * from "between the 1st and the 1st" as a single date, and from any restore
   * as its start alone.
   */
  test("keeps a range in a single value, whatever the two dates are", () => {
    expect(
      serializeFacetDateRange({ start: START, end: END }, "between"),
    ).toHaveLength(1);
    expect(
      serializeFacetDateRange({ start: START, end: START }, "between"),
    ).toHaveLength(1);
  });

  test("round-trips a range whose two ends are the same day", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: START },
      "between",
    );

    expect(parseFacetDateRange(values)).toEqual({ start: START, end: START });
  });

  /*
   * The user is mid-way through entering a range. Dropping the half they have
   * typed would clear the input from under the cursor the moment they picked
   * the first of the two dates.
   */
  test("keeps a half-entered range", () => {
    expect(
      parseFacetDateRange(
        serializeFacetDateRange({ start: START, end: null }, "between"),
      ),
    ).toEqual({ start: START, end: null });

    expect(
      parseFacetDateRange(
        serializeFacetDateRange({ start: null, end: END }, "between"),
      ),
    ).toEqual({ start: null, end: END });
  });

  /*
   * Switching operators re-encodes. Left alone, an end date would outlive the
   * switch to "before" — invisible in the popover, still riding along in the
   * next link the user shares.
   */
  test("drops the end date when the operator stops taking one", () => {
    for (const operator of ["is", "before", "after"] as Array<FilterOperator>) {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: END },
        operator,
      );

      expect(parseFacetDateRange(values).end).toBeNull();
      expect(values[0]).not.toContain(FACET_DATE_RANGE_SEPARATOR);
    }
  });

  test("an operator that takes no date stores nothing", () => {
    for (const operator of [
      "is_empty",
      "is_not_empty",
    ] as Array<FilterOperator>) {
      expect(
        serializeFacetDateRange({ start: START, end: END }, operator),
      ).toEqual([]);
    }
  });

  test("an empty range stores nothing", () => {
    for (const operator of DATE_FACET_OPERATORS) {
      expect(
        serializeFacetDateRange({ start: null, end: null }, operator),
      ).toEqual([]);
    }
  });

  describe("parsing what it did not write", () => {
    test("no values is no range", () => {
      expect(parseFacetDateRange([])).toEqual({ start: null, end: null });
      expect(parseFacetDateRange(null)).toEqual({ start: null, end: null });
      expect(parseFacetDateRange(undefined)).toEqual({
        start: null,
        end: null,
      });
    });

    test.each(JUNK_VALUES)("%s is no range", (_label: string, raw: string) => {
      expect(parseFacetDateRange([raw])).toEqual({ start: null, end: null });
    });

    test("junk on one side leaves the other side readable", () => {
      expect(
        parseFacetDateRange([
          `${START.toISOString()}${FACET_DATE_RANGE_SEPARATOR}banana`,
        ]),
      ).toEqual({ start: START, end: null });
    });

    /*
     * Only the first entry counts. The single-select clamp already reduces a
     * date facet to one value, so honouring extras here would mean the chip and
     * the query disagreed about which of them was the filter.
     */
    test("extra values are ignored", () => {
      expect(
        parseFacetDateRange([START.toISOString(), END.toISOString()]),
      ).toEqual({ start: START, end: null });
    });
  });
});

describe("isFacetDateRangeActive", () => {
  /*
   * The chip's lit state, the bar's filter count and the table's "nothing
   * matches the filters" copy all read this, and the query builder has to
   * agree with it — a chip that claims a filter the table is not applying is
   * the whole failure mode the facet bar exists to avoid.
   */
  test("a single date is a filter", () => {
    for (const operator of ["is", "before", "after"] as Array<FilterOperator>) {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: null },
        operator,
      );

      expect(isFacetDateRangeActive(values, operator)).toBe(true);
      expect(buildFacetDateRangeQuery(values, operator)).toBeDefined();
    }
  });

  test("a complete range is a filter", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: END },
      "between",
    );

    expect(isFacetDateRangeActive(values, "between")).toBe(true);
    expect(buildFacetDateRangeQuery(values, "between")).toBeDefined();
  });

  test("a half-entered range is not a filter yet", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: null },
      "between",
    );

    expect(isFacetDateRangeActive(values, "between")).toBe(false);
    expect(buildFacetDateRangeQuery(values, "between")).toBeUndefined();
  });

  test("no date is not a filter", () => {
    for (const operator of [
      "is",
      "before",
      "after",
      "between",
    ] as Array<FilterOperator>) {
      expect(isFacetDateRangeActive([], operator)).toBe(false);
    }
  });

  test("the empty operators are a filter without any date", () => {
    expect(isFacetDateRangeActive([], "is_empty")).toBe(true);
    expect(isFacetDateRangeActive([], "is_not_empty")).toBe(true);
  });

  /*
   * The invariant the two have to keep between them: lit exactly when
   * filtering. Checked across every operator and every shape of selection
   * rather than case by case, so a new operator cannot land on one side only.
   */
  test("says yes exactly when a query is produced", () => {
    const selections: Array<Array<string>> = [
      [],
      serializeFacetDateRange({ start: START, end: null }, "is"),
      serializeFacetDateRange({ start: START, end: END }, "between"),
      serializeFacetDateRange({ start: START, end: null }, "between"),
      serializeFacetDateRange({ start: null, end: END }, "between"),
      ["banana"],
    ];

    for (const operator of DATE_FACET_OPERATORS) {
      for (const values of selections) {
        expect(isFacetDateRangeActive(values, operator)).toBe(
          buildFacetDateRangeQuery(values, operator) !== undefined,
        );
      }
    }
  });
});

describe("buildFacetDateRangeQuery", () => {
  describe("is", () => {
    /*
     * A day, not an instant. These chips sit over timestamp columns, so an
     * equality against the picked midnight would match only a row written on
     * that exact millisecond — "on the 16th" reliably returning nothing.
     */
    test("is the whole picked day", () => {
      const query: unknown = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: null }, "is"),
        "is",
      );

      expect(query).toBeInstanceOf(InBetween);
      expect((query as InBetween<Date>).startValue).toEqual(
        OneUptimeDate.getStartOfDay(START),
      );
      expect((query as InBetween<Date>).endValue).toEqual(
        OneUptimeDate.getEndOfDay(START),
      );
    });

    test("is not an equality", () => {
      const query: unknown = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: null }, "is"),
        "is",
      );

      expect(query).not.toBeInstanceOf(EqualTo);
      expect(operatorNameOf(query)).toBe("InBetween");
    });

    test("brackets the picked instant on both sides", () => {
      const query: InBetween<Date> = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: null }, "is"),
        "is",
      ) as InBetween<Date>;

      expect(query.startValue.getTime()).toBeLessThanOrEqual(START.getTime());
      expect(query.endValue.getTime()).toBeGreaterThanOrEqual(START.getTime());
    });
  });

  describe("before and after", () => {
    test("before is a LessThan on the picked date", () => {
      const query: unknown = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: null }, "before"),
        "before",
      );

      expect(query).toBeInstanceOf(LessThan);
      expect((query as CompareBase<Date>).value).toEqual(START);
    });

    test("after is a GreaterThan on the picked date", () => {
      const query: unknown = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: null }, "after"),
        "after",
      );

      expect(query).toBeInstanceOf(GreaterThan);
      expect((query as CompareBase<Date>).value).toEqual(START);
    });

    /*
     * Plain comparisons, so a NULL column matches neither — the same way the
     * column-filter popup's date entry has always behaved, and the reason a
     * date chip does not need to say anything about never-set rows.
     */
    test("neither is a null test", () => {
      for (const operator of ["before", "after"] as Array<FilterOperator>) {
        const query: unknown = buildFacetDateRangeQuery(
          serializeFacetDateRange({ start: START, end: null }, operator),
          operator,
        );

        expect(query).not.toBeInstanceOf(IsNull);
        expect(query).not.toBeInstanceOf(NotNull);
      }
    });

    test("the two are opposites, not the same fragment", () => {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: null },
        "before",
      );

      expect(
        JSON.stringify(buildFacetDateRangeQuery(values, "before")),
      ).not.toBe(JSON.stringify(buildFacetDateRangeQuery(values, "after")));
    });
  });

  describe("between", () => {
    test("spans the start of the first day to the end of the last", () => {
      const query: unknown = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: END }, "between"),
        "between",
      );

      expect(query).toBeInstanceOf(InBetween);
      expect((query as InBetween<Date>).startValue).toEqual(
        OneUptimeDate.getStartOfDay(START),
      );
      expect((query as InBetween<Date>).endValue).toEqual(
        OneUptimeDate.getEndOfDay(END),
      );
    });

    /*
     * Both ends inclusive. A range that quietly excluded the last day named
     * would be off by one in the direction nobody checks.
     */
    test("includes both of the days the user named", () => {
      const query: InBetween<Date> = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: END }, "between"),
        "between",
      ) as InBetween<Date>;

      expect(query.startValue.getTime()).toBeLessThanOrEqual(START.getTime());
      expect(query.endValue.getTime()).toBeGreaterThanOrEqual(END.getTime());
    });

    test("a single day is a range from its start to its end", () => {
      const query: InBetween<Date> = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: START }, "between"),
        "between",
      ) as InBetween<Date>;

      expect(query.startValue).toEqual(OneUptimeDate.getStartOfDay(START));
      expect(query.endValue).toEqual(OneUptimeDate.getEndOfDay(START));
    });

    /*
     * A backwards range is the user's to make — the inputs do not stop it —
     * and it is honestly empty. What must not happen is a silent reordering
     * into a range they did not ask for.
     */
    test("does not quietly reorder a backwards range", () => {
      const query: InBetween<Date> = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: END, end: START }, "between"),
        "between",
      ) as InBetween<Date>;

      expect(query.startValue.getTime()).toBeGreaterThan(
        query.endValue.getTime(),
      );
    });
  });

  describe("the empty operators", () => {
    test("is_empty asks the column for NULL", () => {
      expect(buildFacetDateRangeQuery([], "is_empty")).toBeInstanceOf(IsNull);
    });

    test("is_not_empty asks the column for any value", () => {
      expect(buildFacetDateRangeQuery([], "is_not_empty")).toBeInstanceOf(
        NotNull,
      );
    });

    /*
     * They mean "has no value" regardless of what is stored, so a leftover
     * range must not turn them into a date comparison.
     */
    test("ignore any range left behind by another operator", () => {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: END },
        "between",
      );

      expect(buildFacetDateRangeQuery(values, "is_empty")).toBeInstanceOf(
        IsNull,
      );
      expect(buildFacetDateRangeQuery(values, "is_not_empty")).toBeInstanceOf(
        NotNull,
      );
    });
  });

  describe("isDateTime", () => {
    /*
     * The opt-in for a column the user picks an instant on rather than a day.
     * Default is day granularity, because that is what a date input offers and
     * what every date column filter in the product has always meant.
     */
    test("takes the picked instants as-is rather than widening to days", () => {
      const query: InBetween<Date> = buildFacetDateRangeQuery(
        serializeFacetDateRange({ start: START, end: END }, "between"),
        "between",
        { isDateTime: true },
      ) as InBetween<Date>;

      expect(query.startValue).toEqual(START);
      expect(query.endValue).toEqual(END);
    });

    test("is not the default", () => {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: END },
        "between",
      );

      expect(
        JSON.stringify(buildFacetDateRangeQuery(values, "between")),
      ).not.toBe(
        JSON.stringify(
          buildFacetDateRangeQuery(values, "between", { isDateTime: true }),
        ),
      );
    });
  });

  describe("refuses anything it cannot express honestly", () => {
    test.each(JUNK_VALUES)(
      "%s does not constrain the column",
      (_label: string, raw: string) => {
        for (const operator of [
          "is",
          "before",
          "after",
          "between",
        ] as Array<FilterOperator>) {
          expect(buildFacetDateRangeQuery([raw], operator)).toBeUndefined();
        }
      },
    );

    test("an empty selection does not constrain the column", () => {
      for (const operator of [
        "is",
        "before",
        "after",
        "between",
      ] as Array<FilterOperator>) {
        expect(buildFacetDateRangeQuery([], operator)).toBeUndefined();
      }
    });

    test("a half-entered range does not constrain the column", () => {
      expect(
        buildFacetDateRangeQuery(
          serializeFacetDateRange({ start: START, end: null }, "between"),
          "between",
        ),
      ).toBeUndefined();

      expect(
        buildFacetDateRangeQuery(
          serializeFacetDateRange({ start: null, end: END }, "between"),
          "between",
        ),
      ).toBeUndefined();
    });

    /*
     * The operator no date chip offers. Only a hand-edited URL can pair it
     * with a date, and there is no honest single-field query for it — so it
     * has to fall through to "do not constrain", not to a nearby branch.
     */
    test("is_not does not constrain the column", () => {
      expect(
        buildFacetDateRangeQuery(
          serializeFacetDateRange({ start: START, end: null }, "is"),
          "is_not",
        ),
      ).toBeUndefined();
    });
  });

  /*
   * ModelTable decides whether to refetch by comparing the serialised query
   * against the previous render's. Nothing here reads the clock — every date
   * comes from the selection — so the same selection must serialise
   * identically, or the table refetches forever.
   */
  test("serialises identically every time, with no clock in it", () => {
    for (const operator of DATE_FACET_OPERATORS) {
      const values: Array<string> = serializeFacetDateRange(
        { start: START, end: END },
        operator,
      );

      expect(JSON.stringify(buildFacetDateRangeQuery(values, operator))).toBe(
        JSON.stringify(buildFacetDateRangeQuery(values, operator)),
      );
    }
  });

  /*
   * A GreaterThan serialising to the same JSON as a LessThan would mean the
   * chip's operator switcher moved nothing. Every operator has to produce a
   * distinguishable fragment.
   */
  test("no two operators produce the same constraint", () => {
    const fragments: Array<string> = DATE_FACET_OPERATORS.map(
      (operator: FilterOperator): string => {
        return JSON.stringify(
          buildFacetDateRangeQuery(
            serializeFacetDateRange({ start: START, end: END }, operator),
            operator,
          ),
        );
      },
    );

    expect(new Set(fragments).size).toBe(fragments.length);
  });
});

describe("formatFacetDateRange", () => {
  test("prints a single date at day precision", () => {
    const text: string = formatFacetDateRange(
      serializeFacetDateRange({ start: START, end: null }, "is"),
      "is",
    );

    expect(text).toBe(OneUptimeDate.getDateAsLocalFormattedString(START, true));
  });

  test("prints both ends of a range", () => {
    const text: string = formatFacetDateRange(
      serializeFacetDateRange({ start: START, end: END }, "between"),
      "between",
    );

    expect(text).toContain(
      OneUptimeDate.getDateAsLocalFormattedString(START, true),
    );
    expect(text).toContain(
      OneUptimeDate.getDateAsLocalFormattedString(END, true),
    );
  });

  /*
   * A range the user is still filling in has to read as unfinished. Printing
   * only the end they have entered would make it look like a single-date
   * filter that the table is not, in fact, applying.
   */
  test("marks the end of a range that is not entered yet", () => {
    const text: string = formatFacetDateRange(
      serializeFacetDateRange({ start: START, end: null }, "between"),
      "between",
    );

    expect(text).toContain(
      OneUptimeDate.getDateAsLocalFormattedString(START, true),
    );
    expect(text).toContain(FACET_DATE_PLACEHOLDER);
  });

  /*
   * The chip prints a time nowhere, because the popover offers no way to
   * change one — a filter the user cannot see the whole of is a filter they
   * cannot correct.
   */
  test("never prints a time", () => {
    for (const operator of DATE_FACET_OPERATORS) {
      const text: string = formatFacetDateRange(
        serializeFacetDateRange({ start: START, end: END }, operator),
        operator,
      );

      expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});

describe("isFacetActive", () => {
  /*
   * The one question every "is this chip filtering" caller asks, answered per
   * chip kind. An option chip is active as soon as it holds a value; a date
   * chip is not active until its range is complete, because until then the
   * query builder produces nothing.
   */
  test("an option chip is active as soon as it holds a value", () => {
    expect(isFacetActive(OPTION_FACET, ["up"], "is")).toBe(true);
    expect(isFacetActive(OPTION_FACET, [], "is")).toBe(false);
  });

  test("an option chip is active on the empty operators", () => {
    expect(isFacetActive(OPTION_FACET, [], "is_empty")).toBe(true);
    expect(isFacetActive(OPTION_FACET, [], "is_not_empty")).toBe(true);
  });

  test("a date chip is active once its range is complete", () => {
    expect(
      isFacetActive(
        DATE_FACET,
        serializeFacetDateRange({ start: START, end: END }, "between"),
        "between",
      ),
    ).toBe(true);
  });

  test("a date chip is not active while its range is half-entered", () => {
    expect(
      isFacetActive(
        DATE_FACET,
        serializeFacetDateRange({ start: START, end: null }, "between"),
        "between",
      ),
    ).toBe(false);
  });

  test("an unspecified operator reads as the default", () => {
    expect(isFacetActive(OPTION_FACET, ["up"], undefined)).toBe(true);
    expect(
      isFacetActive(
        DATE_FACET,
        serializeFacetDateRange({ start: START, end: null }, "is"),
        undefined,
      ),
    ).toBe(true);
  });
});

describe("sanitizeFacetSelectionState, for a date chip", () => {
  type StateWith = (
    values: Array<string>,
    operator: FilterOperator,
  ) => ReturnType<typeof getEmptyFacetSelectionState>;

  const stateWith: StateWith = (
    values: Array<string>,
    operator: FilterOperator,
  ) => {
    const state: ReturnType<typeof getEmptyFacetSelectionState> =
      getEmptyFacetSelectionState();
    state.facetSelections[DATE_FACET.key] = values;
    state.facetOperators[DATE_FACET.key] = operator;
    return state;
  };

  test("keeps a range it can read", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: END },
      "between",
    );

    expect(
      sanitizeFacetSelectionState(stateWith(values, "between"), [DATE_FACET])
        .facetSelections[DATE_FACET.key],
    ).toEqual(values);
  });

  /*
   * A range the chip cannot render would leave it lit with blank inputs —
   * claiming a filter the user can neither see nor correct. Coming back empty
   * over the full list is at least a state the bar can express.
   */
  test.each(JUNK_VALUES)(
    "drops %s rather than leaving the chip lit and blank",
    (_label: string, raw: string) => {
      expect(
        sanitizeFacetSelectionState(stateWith([raw], "is"), [DATE_FACET])
          .facetSelections[DATE_FACET.key],
      ).toEqual([]);
    },
  );

  test("drops a half-entered range restored from a link", () => {
    expect(
      sanitizeFacetSelectionState(
        stateWith(
          serializeFacetDateRange({ start: START, end: null }, "between"),
          "between",
        ),
        [DATE_FACET],
      ).facetSelections[DATE_FACET.key],
    ).toEqual([]);
  });

  /*
   * The chip renders no operator it was not given, so an operator it does not
   * offer would be invisible AND unchangeable — the switcher would show
   * something else while the query used this.
   */
  test("clamps an operator the chip does not offer", () => {
    const sanitized: ReturnType<typeof getEmptyFacetSelectionState> =
      sanitizeFacetSelectionState(
        stateWith(
          serializeFacetDateRange({ start: START, end: null }, "is"),
          "is_not",
        ),
        [DATE_FACET],
      );

    expect(DATE_FACET_OPERATORS).toContain(
      sanitized.facetOperators[DATE_FACET.key],
    );
    expect(sanitized.facetOperators[DATE_FACET.key]).not.toBe("is_not");
  });

  /*
   * The mirror image: an option chip must not come back holding a date
   * operator, which it has no date to satisfy.
   */
  test("clamps a date operator off an option chip", () => {
    const state: ReturnType<typeof getEmptyFacetSelectionState> =
      getEmptyFacetSelectionState();
    state.facetSelections[OPTION_FACET.key] = ["up"];
    state.facetOperators[OPTION_FACET.key] = "between";

    const sanitized: ReturnType<typeof getEmptyFacetSelectionState> =
      sanitizeFacetSelectionState(state, [OPTION_FACET]);

    expect(sanitized.facetOperators[OPTION_FACET.key]).toBe("is");
    // The user's value is kept — only the operator it cannot use is corrected.
    expect(sanitized.facetSelections[OPTION_FACET.key]).toEqual(["up"]);
  });

  test("a date chip with nothing selected stays empty", () => {
    expect(
      sanitizeFacetSelectionState(stateWith([], "is"), [DATE_FACET])
        .facetSelections[DATE_FACET.key],
    ).toEqual([]);
  });

  /*
   * A restored range and a freshly picked one have to produce the same query,
   * or a shared link shows different rows than the session that made it.
   */
  test("a surviving range still builds the query it was saved as", () => {
    const values: Array<string> = serializeFacetDateRange(
      { start: START, end: END },
      "between",
    );

    const restored: Array<string> = sanitizeFacetSelectionState(
      stateWith(values, "between"),
      [DATE_FACET],
    ).facetSelections[DATE_FACET.key]!;

    expect(JSON.stringify(buildFacetDateRangeQuery(restored, "between"))).toBe(
      JSON.stringify(buildFacetDateRangeQuery(values, "between")),
    );
  });
});

describe("buildFacetConflictMap", () => {
  /*
   * Two chips over one column cannot both apply: the merged query is a single
   * object, so the later one replaces the earlier outright while both stay lit
   * and claim to apply. The map is what turns that into "activating either
   * clears the other".
   */
  test("pairs the two chips a facet declares itself exclusive with", () => {
    const map: FacetConflictMap = buildFacetConflictMap([
      { key: "status", exclusiveWith: ["lastSeen"] },
      { key: "lastSeen" },
    ]);

    expect(map["status"]).toEqual(["lastSeen"]);
  });

  /*
   * The half-working failure this exists to rule out: declared on one side
   * only, the map would clear the second chip when the first moved but not the
   * reverse — so whichever the user reached for second would be the one
   * silently overwritten, which is the whole bug.
   */
  test("is symmetric whichever side declares it", () => {
    const declaredForward: FacetConflictMap = buildFacetConflictMap([
      { key: "status", exclusiveWith: ["lastSeen"] },
      { key: "lastSeen" },
    ]);
    const declaredBackward: FacetConflictMap = buildFacetConflictMap([
      { key: "status" },
      { key: "lastSeen", exclusiveWith: ["status"] },
    ]);

    expect(declaredForward).toEqual(declaredBackward);
    expect(declaredForward["lastSeen"]).toEqual(["status"]);
  });

  test("declaring it on both sides is the same as declaring it on one", () => {
    expect(
      buildFacetConflictMap([
        { key: "status", exclusiveWith: ["lastSeen"] },
        { key: "lastSeen", exclusiveWith: ["status"] },
      ]),
    ).toEqual(
      buildFacetConflictMap([
        { key: "status", exclusiveWith: ["lastSeen"] },
        { key: "lastSeen" },
      ]),
    );
  });

  test("a chip can conflict with more than one other", () => {
    const map: FacetConflictMap = buildFacetConflictMap([
      { key: "status", exclusiveWith: ["lastSeen", "firstSeen"] },
      { key: "lastSeen" },
      { key: "firstSeen" },
    ]);

    expect([...map["status"]!].sort()).toEqual(["firstSeen", "lastSeen"]);
    expect(map["lastSeen"]).toEqual(["status"]);
    expect(map["firstSeen"]).toEqual(["status"]);
  });

  test("chips that declare nothing are absent from the map", () => {
    const map: FacetConflictMap = buildFacetConflictMap([
      { key: "status", exclusiveWith: ["lastSeen"] },
      { key: "lastSeen" },
      { key: "site" },
    ]);

    expect(map["site"]).toBeUndefined();
  });

  test("no facets is no conflicts", () => {
    expect(buildFacetConflictMap([])).toEqual({});
  });

  /*
   * A chip excluded with itself would clear its own selection the instant the
   * user made one — a chip that can never be set.
   */
  test("a facet cannot be exclusive with itself", () => {
    expect(
      buildFacetConflictMap([{ key: "status", exclusiveWith: ["status"] }]),
    ).toEqual({});
  });

  /*
   * A key nothing declares is a typo in a page's facet list. It costs nothing
   * to carry — no chip answers to it — but it must not corrupt the real pair.
   */
  test("a key no facet claims does not disturb the rest", () => {
    const map: FacetConflictMap = buildFacetConflictMap([
      { key: "status", exclusiveWith: ["lastSeen", "typo"] },
      { key: "lastSeen" },
    ]);

    expect(map["lastSeen"]).toEqual(["status"]);
    expect([...map["status"]!].sort()).toEqual(["lastSeen", "typo"]);
  });

  test("a blank key is not a conflict", () => {
    expect(
      buildFacetConflictMap([
        { key: "status", exclusiveWith: [""] },
        { key: "", exclusiveWith: ["status"] },
      ]),
    ).toEqual({});
  });

  test("a repeated declaration does not repeat the entry", () => {
    expect(
      buildFacetConflictMap([
        { key: "status", exclusiveWith: ["lastSeen", "lastSeen"] },
        { key: "lastSeen", exclusiveWith: ["status"] },
      ])["status"],
    ).toEqual(["lastSeen"]);
  });
});
