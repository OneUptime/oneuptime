/*
 * The comparisons an If / Else step offers, and how a stored condition reads
 * back as one of them (ConditionComparison).
 */

import {
  ConditionOperator,
  ConditionValueType,
} from "../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  CONDITION_COMPARISON_GROUPS,
  CONDITION_COMPARISONS,
  CONDITION_VALUE_TYPE_LABELS,
  ConditionComparison,
  ConditionComparisonGroup,
  ConditionComparisonId,
  ConditionComparisonKind,
  StoredCondition,
  comparisonForStoredCondition,
  getConditionComparison,
} from "../../../Types/Workflow/Components/ConditionComparison";
import { describe, expect, test } from "@jest/globals";

type StoredFunction = (overrides: Partial<StoredCondition>) => StoredCondition;

const stored: StoredFunction = (
  overrides: Partial<StoredCondition>,
): StoredCondition => {
  return {
    operator: undefined,
    compareWith: undefined,
    valueToCheckType: undefined,
    compareWithType: undefined,
    ...overrides,
  };
};

type IdOfFunction = (
  comparison: ConditionComparison | null,
) => ConditionComparisonId | null;

const idOf: IdOfFunction = (
  comparison: ConditionComparison | null,
): ConditionComparisonId | null => {
  return comparison ? comparison.id : null;
};

describe("CONDITION_COMPARISONS", () => {
  test("has exactly one entry per comparison id", () => {
    const ids: Array<ConditionComparisonId> = CONDITION_COMPARISONS.map(
      (comparison: ConditionComparison): ConditionComparisonId => {
        return comparison.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      [...Object.values(ConditionComparisonId)].sort(),
    );
  });

  test("labels are unique, so the dropdown never shows two of the same", () => {
    const labels: Array<string> = CONDITION_COMPARISONS.map(
      (comparison: ConditionComparison): string => {
        return comparison.label;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  test("every stored operator is offered by exactly one non-shortcut comparison", () => {
    for (const operator of Object.values(ConditionOperator)) {
      const offering: Array<ConditionComparison> = CONDITION_COMPARISONS.filter(
        (comparison: ConditionComparison): boolean => {
          return (
            comparison.operator === operator &&
            comparison.kind !== ConditionComparisonKind.TrueOrFalse
          );
        },
      );

      expect(offering).toHaveLength(1);
    }
  });

  test("the one-value comparisons do not use Compare with", () => {
    for (const comparison of CONDITION_COMPARISONS) {
      const isOneValue: boolean =
        comparison.kind === ConditionComparisonKind.Presence ||
        comparison.kind === ConditionComparisonKind.TrueOrFalse;

      expect(comparison.usesCompareWith).toBe(!isOneValue);
    }
  });

  test("only is true and is false fix Compare with, and both store ==", () => {
    const fixed: Array<ConditionComparison> = CONDITION_COMPARISONS.filter(
      (comparison: ConditionComparison): boolean => {
        return comparison.fixedCompareWith !== undefined;
      },
    );

    expect(
      fixed.map((comparison: ConditionComparison): string => {
        return `${comparison.id}:${comparison.fixedCompareWith}`;
      }),
    ).toEqual(["is true:true", "is false:false"]);

    for (const comparison of fixed) {
      expect(comparison.operator).toBe(ConditionOperator.EqualTo);
      expect(comparison.kind).toBe(ConditionComparisonKind.TrueOrFalse);
    }
  });

  test("text comparisons are of the Text kind, ordering ones of Order", () => {
    expect(getConditionComparison(ConditionComparisonId.Contains).kind).toBe(
      ConditionComparisonKind.Text,
    );
    expect(getConditionComparison(ConditionComparisonId.EndsWith).kind).toBe(
      ConditionComparisonKind.Text,
    );
    expect(getConditionComparison(ConditionComparisonId.LessThan).kind).toBe(
      ConditionComparisonKind.Order,
    );
    expect(getConditionComparison(ConditionComparisonId.EqualTo).kind).toBe(
      ConditionComparisonKind.Equality,
    );
    expect(getConditionComparison(ConditionComparisonId.IsEmpty).kind).toBe(
      ConditionComparisonKind.Presence,
    );
  });
});

describe("CONDITION_COMPARISON_GROUPS", () => {
  test("lists every comparison exactly once", () => {
    const listed: Array<ConditionComparisonId> =
      CONDITION_COMPARISON_GROUPS.flatMap(
        (group: ConditionComparisonGroup): Array<ConditionComparisonId> => {
          return group.ids;
        },
      );

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(
      [...Object.values(ConditionComparisonId)].sort(),
    );
  });

  test("the first group, equal and not equal, has no title", () => {
    const first: ConditionComparisonGroup = CONDITION_COMPARISON_GROUPS[0]!;

    expect(first.title).toBeUndefined();
    expect(first.ids).toEqual([
      ConditionComparisonId.EqualTo,
      ConditionComparisonId.NotEqualTo,
    ]);

    for (const group of CONDITION_COMPARISON_GROUPS.slice(1)) {
      expect(typeof group.title).toBe("string");
      expect(group.title!.length).toBeGreaterThan(0);
    }
  });

  test("each titled group holds comparisons of a single kind", () => {
    for (const group of CONDITION_COMPARISON_GROUPS.slice(1)) {
      const kinds: Set<ConditionComparisonKind> = new Set(
        group.ids.map((id: ConditionComparisonId): ConditionComparisonKind => {
          return getConditionComparison(id).kind;
        }),
      );

      expect(kinds.size).toBe(1);
    }
  });
});

describe("getConditionComparison", () => {
  test("returns the comparison for each id", () => {
    for (const id of Object.values(ConditionComparisonId)) {
      const comparison: ConditionComparison = getConditionComparison(id);

      expect(comparison).toBeDefined();
      expect(comparison.id).toBe(id);
    }
  });

  test("returns the very entry in the list", () => {
    expect(getConditionComparison(ConditionComparisonId.StartsWith)).toBe(
      CONDITION_COMPARISONS.find((comparison: ConditionComparison) => {
        return comparison.id === ConditionComparisonId.StartsWith;
      }),
    );
  });

  test("an id that is not a comparison finds nothing", () => {
    expect(
      getConditionComparison("nope" as ConditionComparisonId),
    ).toBeUndefined();
  });
});

describe("CONDITION_COMPARE_AS_OPTIONS and CONDITION_VALUE_TYPE_LABELS", () => {
  test("Compare as offers Text, Number and True / False, never Null or Undefined", () => {
    expect(
      CONDITION_COMPARE_AS_OPTIONS.map(
        (option: { type: ConditionValueType }): ConditionValueType => {
          return option.type;
        },
      ),
    ).toEqual([
      ConditionValueType.Text,
      ConditionValueType.Number,
      ConditionValueType.Boolean,
    ]);
  });

  test("each Compare as option uses the same label as the value type", () => {
    for (const option of CONDITION_COMPARE_AS_OPTIONS) {
      expect(option.label).toBe(CONDITION_VALUE_TYPE_LABELS[option.type]);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  test("every value type has a label", () => {
    for (const type of Object.values(ConditionValueType)) {
      expect(typeof CONDITION_VALUE_TYPE_LABELS[type]).toBe("string");
    }

    expect(CONDITION_VALUE_TYPE_LABELS[ConditionValueType.Null]).toBe("Null");
    expect(CONDITION_VALUE_TYPE_LABELS[ConditionValueType.Undefined]).toBe(
      "Undefined",
    );
  });
});

describe("comparisonForStoredCondition", () => {
  test("each stored operator reads as its own comparison", () => {
    const expected: Array<[ConditionOperator, ConditionComparisonId]> = [
      [ConditionOperator.EqualTo, ConditionComparisonId.EqualTo],
      [ConditionOperator.NotEqualTo, ConditionComparisonId.NotEqualTo],
      [ConditionOperator.Contains, ConditionComparisonId.Contains],
      [ConditionOperator.DoesNotContain, ConditionComparisonId.DoesNotContain],
      [ConditionOperator.StartsWith, ConditionComparisonId.StartsWith],
      [ConditionOperator.EndsWith, ConditionComparisonId.EndsWith],
      [ConditionOperator.GreaterThan, ConditionComparisonId.GreaterThan],
      [
        ConditionOperator.GreaterThanOrEqualTo,
        ConditionComparisonId.GreaterThanOrEqualTo,
      ],
      [ConditionOperator.LessThan, ConditionComparisonId.LessThan],
      [
        ConditionOperator.LessThanOrEqualTo,
        ConditionComparisonId.LessThanOrEqualTo,
      ],
      [ConditionOperator.IsEmpty, ConditionComparisonId.IsEmpty],
      [ConditionOperator.IsNotEmpty, ConditionComparisonId.IsNotEmpty],
    ];

    for (const [operator, id] of expected) {
      expect(idOf(comparisonForStoredCondition(stored({ operator })))).toBe(id);
    }
  });

  test("nothing stored reads as is equal to", () => {
    expect(idOf(comparisonForStoredCondition(stored({})))).toBe(
      ConditionComparisonId.EqualTo,
    );
    expect(idOf(comparisonForStoredCondition(stored({ operator: "" })))).toBe(
      ConditionComparisonId.EqualTo,
    );
    expect(idOf(comparisonForStoredCondition(stored({ operator: null })))).toBe(
      ConditionComparisonId.EqualTo,
    );
    expect(
      idOf(comparisonForStoredCondition(stored({ operator: "   " }))),
    ).toBe(ConditionComparisonId.EqualTo);
  });

  test("operators are matched trimmed, in any case, with spaces collapsed", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({ operator: "  Does   NOT Contain " }),
        ),
      ),
    ).toBe(ConditionComparisonId.DoesNotContain);
    expect(
      idOf(comparisonForStoredCondition(stored({ operator: "IS EMPTY" }))),
    ).toBe(ConditionComparisonId.IsEmpty);
  });

  test("the legacy strict operators read as equal and not equal", () => {
    expect(
      idOf(comparisonForStoredCondition(stored({ operator: "===" }))),
    ).toBe(ConditionComparisonId.EqualTo);
    expect(
      idOf(comparisonForStoredCondition(stored({ operator: "!==" }))),
    ).toBe(ConditionComparisonId.NotEqualTo);
  });

  test("an operator the step does not know reads as nothing", () => {
    expect(comparisonForStoredCondition(stored({ operator: "=~" }))).toBeNull();
    expect(
      comparisonForStoredCondition(stored({ operator: "matches" })),
    ).toBeNull();
    expect(comparisonForStoredCondition(stored({ operator: 42 }))).toBeNull();
  });

  test("== with both sides compared as true or false and Compare with true reads as is true", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: "true",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.IsTrue);
  });

  test("Compare with may be stored as a real boolean too", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: true,
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.IsTrue);
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: false,
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.IsFalse);
  });

  test("Compare with false reads as is false", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: "false",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.IsFalse);
  });

  test("a missing operator with a true / false shape still reads as is true", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: undefined,
            compareWith: "true",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.IsTrue);
  });

  test("one side boolean and the other text meet at boolean, so it still reads as is true", () => {
    /*
     * getEffectiveConditionTypes raises text to the more specific type on the
     * other side, so a Compare with stored as text "true" against a boolean
     * value compares as true or false.
     */
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: "true",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: undefined,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.IsTrue);
  });

  test("== true compared as text stays is equal to", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: "true",
            valueToCheckType: ConditionValueType.Text,
            compareWithType: ConditionValueType.Text,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.EqualTo);
  });

  test("== true with a null side is not is true: null types are never raised", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "==",
            compareWith: "true",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Null,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.EqualTo);
  });

  test("== with a boolean shape but Compare with something else stays is equal to", () => {
    for (const compareWith of ["yes", "1", 1, "TRUE", "", null, undefined]) {
      expect(
        idOf(
          comparisonForStoredCondition(
            stored({
              operator: "==",
              compareWith,
              valueToCheckType: ConditionValueType.Boolean,
              compareWithType: ConditionValueType.Boolean,
            }),
          ),
        ),
      ).toBe(ConditionComparisonId.EqualTo);
    }
  });

  test("the strict === with a true / false shape is not a shortcut, only is equal to", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "===",
            compareWith: "true",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.EqualTo);
  });

  test("!= with a true / false shape stays is not equal to", () => {
    expect(
      idOf(
        comparisonForStoredCondition(
          stored({
            operator: "!=",
            compareWith: "true",
            valueToCheckType: ConditionValueType.Boolean,
            compareWithType: ConditionValueType.Boolean,
          }),
        ),
      ),
    ).toBe(ConditionComparisonId.NotEqualTo);
  });

  test("never returns a true / false shortcut for a plain operator", () => {
    for (const operator of Object.values(ConditionOperator)) {
      const comparison: ConditionComparison | null =
        comparisonForStoredCondition(stored({ operator }));

      expect(comparison).not.toBeNull();
      expect(comparison!.kind).not.toBe(ConditionComparisonKind.TrueOrFalse);
    }
  });
});
