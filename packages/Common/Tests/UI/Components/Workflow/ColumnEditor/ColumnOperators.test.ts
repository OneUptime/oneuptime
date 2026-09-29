/*
 * Which comparisons each kind of column offers.
 *
 * The rule that matters most here is the one about REPRESENTABLE_OPERATOR_TYPES:
 * an operator the editor offers but cannot read back would lock the whole value
 * to the JSON editor the next time the step is opened, which is the worst kind
 * of bug in this file because it only shows up on the second visit.
 */

import { ObjectType } from "../../../../../Types/JSON";
import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
} from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  defaultOperatorForControl,
  isKnownOperator,
  operatorLabelFor,
  operatorsForControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnOperators";
import { ModelColumnControl } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { describe, expect, test } from "@jest/globals";

/*
 * A copy of the private list in ModelColumnEditor, kept here deliberately: if
 * the two ever disagree this test is the thing that notices.
 */
const REPRESENTABLE_OBJECT_TYPES: Array<string> = [
  ObjectType.EqualTo,
  ObjectType.NotEqual,
  ObjectType.Search,
  ObjectType.NotContains,
  ObjectType.StartsWith,
  ObjectType.EndsWith,
  ObjectType.GreaterThan,
  ObjectType.GreaterThanOrEqual,
  ObjectType.LessThan,
  ObjectType.LessThanOrEqual,
  ObjectType.IsNull,
  ObjectType.NotNull,
  ObjectType.Includes,
  ObjectType.IncludesNone,
];

/*
 * The UI operator names and the wire object types are separate vocabularies:
 * "Contains" serializes as a Search, and the two null checks are named for what
 * they show rather than for the class behind them.
 */
const WIRE_TYPE_FOR_OPERATOR: Record<string, string> = {
  [DictionaryFilterOperator.EqualTo]: ObjectType.EqualTo,
  [DictionaryFilterOperator.NotEqual]: ObjectType.NotEqual,
  [DictionaryFilterOperator.Contains]: ObjectType.Search,
  [DictionaryFilterOperator.NotContains]: ObjectType.NotContains,
  [DictionaryFilterOperator.StartsWith]: ObjectType.StartsWith,
  [DictionaryFilterOperator.EndsWith]: ObjectType.EndsWith,
  [DictionaryFilterOperator.GreaterThan]: ObjectType.GreaterThan,
  [DictionaryFilterOperator.GreaterThanOrEqual]: ObjectType.GreaterThanOrEqual,
  [DictionaryFilterOperator.LessThan]: ObjectType.LessThan,
  [DictionaryFilterOperator.LessThanOrEqual]: ObjectType.LessThanOrEqual,
  [DictionaryFilterOperator.IsEmpty]: ObjectType.IsNull,
  [DictionaryFilterOperator.IsNotEmpty]: ObjectType.NotNull,
  [DictionaryFilterOperator.IsAnyOf]: ObjectType.Includes,
  [DictionaryFilterOperator.IsNoneOf]: ObjectType.IncludesNone,
};

describe("operatorsForControl — nothing offered that cannot be read back", () => {
  test("every operator offered for every control round-trips through the editor", () => {
    for (const control of Object.values(ModelColumnControl)) {
      for (const operator of operatorsForControl(control)) {
        const wireType: string | undefined = WIRE_TYPE_FOR_OPERATOR[operator];

        expect(wireType).toBeDefined();
        expect(REPRESENTABLE_OBJECT_TYPES).toContain(wireType);
      }
    }
  });

  test("every operator offered is one the dictionary layer knows how to build", () => {
    for (const control of Object.values(ModelColumnControl)) {
      for (const operator of operatorsForControl(control)) {
        expect(isKnownOperator(operator)).toBe(true);
      }
    }
  });

  test("equals is offered by every control, and is the default", () => {
    for (const control of Object.values(ModelColumnControl)) {
      expect(operatorsForControl(control)).toContain(
        DictionaryFilterOperator.EqualTo,
      );
      expect(defaultOperatorForControl(control)).toBe(
        DictionaryFilterOperator.EqualTo,
      );
    }
  });
});

describe("operatorsForControl — filtered by what the column can mean", () => {
  test("a number offers the ordering comparisons and no substring ones", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.Number,
    );

    expect(operators).toContain(DictionaryFilterOperator.GreaterThan);
    expect(operators).toContain(DictionaryFilterOperator.LessThanOrEqual);
    expect(operators).not.toContain(DictionaryFilterOperator.Contains);
    expect(operators).not.toContain(DictionaryFilterOperator.StartsWith);
  });

  test("an ID offers neither substring nor ordering — both are footguns on a uuid", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.ObjectId,
    );

    expect(operators).toContain(DictionaryFilterOperator.EqualTo);
    expect(operators).toContain(DictionaryFilterOperator.IsAnyOf);
    expect(operators).not.toContain(DictionaryFilterOperator.Contains);
    expect(operators).not.toContain(DictionaryFilterOperator.GreaterThan);
  });

  test("a boolean offers only the four comparisons that mean anything", () => {
    expect(operatorsForControl(ModelColumnControl.Boolean)).toEqual([
      DictionaryFilterOperator.EqualTo,
      DictionaryFilterOperator.NotEqual,
      DictionaryFilterOperator.IsEmpty,
      DictionaryFilterOperator.IsNotEmpty,
    ]);
  });

  test("a date offers ordering but not membership lists", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.Date,
    );

    expect(operators).toContain(DictionaryFilterOperator.GreaterThan);
    expect(operators).not.toContain(DictionaryFilterOperator.IsAnyOf);
    expect(operators).not.toContain(DictionaryFilterOperator.Contains);
  });

  test("text keeps every operator it had before this filter existed", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.Text,
    );

    expect(operators).toContain(DictionaryFilterOperator.Contains);
    expect(operators).toContain(DictionaryFilterOperator.NotContains);
    expect(operators).toContain(DictionaryFilterOperator.StartsWith);
    expect(operators).toContain(DictionaryFilterOperator.EndsWith);
    expect(operators).toContain(DictionaryFilterOperator.IsAnyOf);
  });

  test("a column no row can hold still gets the widest list, not the narrowest", () => {
    /*
     * It is never offered in the picker, but a condition stored against one
     * still renders, and narrowing that row would rewrite what it does.
     */
    expect(operatorsForControl(ModelColumnControl.Unsupported)).toEqual(
      operatorsForControl(ModelColumnControl.Text),
    );
  });
});

describe("operatorsForControl — the operator already saved is never dropped", () => {
  test("a contains saved against an ID column stays in that row's list", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.ObjectId,
      DictionaryFilterOperator.Contains,
    );

    expect(operators).toContain(DictionaryFilterOperator.Contains);
  });

  test("an operator that is already in the list is not listed twice", () => {
    const operators: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.Number,
      DictionaryFilterOperator.GreaterThan,
    );

    expect(
      operators.filter((operator: DictionaryFilterOperator) => {
        return operator === DictionaryFilterOperator.GreaterThan;
      }).length,
    ).toBe(1);
  });

  test("the returned array is a copy — a caller cannot mutate the shared list", () => {
    const first: Array<DictionaryFilterOperator> = operatorsForControl(
      ModelColumnControl.Text,
    );
    first.push(DictionaryFilterOperator.GreaterThan);

    expect(operatorsForControl(ModelColumnControl.Text)).not.toContain(
      DictionaryFilterOperator.GreaterThan,
    );
  });
});

describe("operatorLabelFor", () => {
  test("a date reads in date language", () => {
    expect(
      operatorLabelFor(
        DictionaryFilterOperator.GreaterThan,
        ModelColumnControl.Date,
      ),
    ).toBe("is after");
    expect(
      operatorLabelFor(
        DictionaryFilterOperator.LessThanOrEqual,
        ModelColumnControl.Date,
      ),
    ).toBe("is on or before");
  });

  test("a boolean reads as is / is not", () => {
    expect(
      operatorLabelFor(
        DictionaryFilterOperator.EqualTo,
        ModelColumnControl.Boolean,
      ),
    ).toBe("is");
    expect(
      operatorLabelFor(
        DictionaryFilterOperator.NotEqual,
        ModelColumnControl.Boolean,
      ),
    ).toBe("is not");
  });

  test("the null checks are worded as set / not set on every control", () => {
    for (const control of Object.values(ModelColumnControl)) {
      expect(operatorLabelFor(DictionaryFilterOperator.IsEmpty, control)).toBe(
        "is not set",
      );
      expect(
        operatorLabelFor(DictionaryFilterOperator.IsNotEmpty, control),
      ).toBe("is set");
    }
  });

  test("anything without an override keeps the shared wording", () => {
    for (const option of DICTIONARY_FILTER_OPERATOR_OPTIONS) {
      const label: string = operatorLabelFor(
        option.operator,
        ModelColumnControl.Text,
      );

      expect(label.length).toBeGreaterThan(0);
    }

    expect(
      operatorLabelFor(
        DictionaryFilterOperator.Contains,
        ModelColumnControl.Text,
      ),
    ).toBe("contains");
  });

  test("an unknown operator falls back rather than rendering blank", () => {
    const label: string = operatorLabelFor(
      "SomethingElse" as DictionaryFilterOperator,
      ModelColumnControl.Text,
    );

    const first: DictionaryFilterOperatorOption =
      DICTIONARY_FILTER_OPERATOR_OPTIONS[0]!;

    expect(label).toBe(first.label);
  });
});
