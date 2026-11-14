import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import DictionaryForm, {
  DICTIONARY_OPERATOR_ROWS_CLASS_NAME,
  DictionaryOperatorRowClassNames,
  getDictionaryOperatorRowClassNames,
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import Includes from "../../../Types/BaseDatabase/Includes";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";

/*
 * A FILTER ROW WITH AN OPERATOR, LAID OUT BY THE ROOM IT HAS (#7282).
 *
 * The operator sat in a fifth of the row behind a clear button, so
 * "matches" and "does not match" both read "matc..." in English and
 * "stim..." in German, and every operator worded in another language was
 * cut. The rows now hold the room their list is drawn in (a container
 * query): one line with room for it, two lines (the key, the operator and
 * Delete, then the type and the value) with less, and each field under the
 * one before it on a phone. The operator and the type are never cleared
 * (a filter always compares somehow, a value always has a type) and are
 * shown whole, on a second line in a narrow box, never cut.
 *
 * jsdom lays nothing out, so this pins the classes each width reads and
 * the props the boxes are drawn with; the layouts themselves were checked
 * in Chromium at 390, 620, 700 and 1280 pixels, in German, Russian,
 * Persian and Arabic, light and dark.
 */

// Every Dropdown the form draws, with the props it was drawn with.
const mockDrawnDropdowns: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Dropdown/Dropdown",
  ) as Record<string, unknown>;
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  const ActualDropdown: React.FunctionComponent<Record<string, unknown>> =
    actual["default"] as React.FunctionComponent<Record<string, unknown>>;

  return {
    ...actual,
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockDrawnDropdowns.push(props);
      return ReactModule.createElement(ActualDropdown, props);
    },
  };
});

const TWO_FILTERS: Dictionary<DictionaryEntryValue> = {
  "http.route": new Wildcard("/api/checkout/*"),
  "deployment.environment": new Includes(["production", "staging"]),
};

const ALL_TYPES: Array<ValueType> = [
  ValueType.Text,
  ValueType.Number,
  ValueType.Boolean,
];

function renderFilters(options: {
  enableOperators: boolean;
  valueTypes?: Array<ValueType> | undefined;
}): void {
  render(
    <DictionaryForm
      enableOperators={options.enableOperators}
      {...(options.valueTypes ? { valueTypes: options.valueTypes } : {})}
      keyPlaceholder="Key"
      valuePlaceholder="Value"
      addButtonSuffix="Attribute Filter"
      initialValue={TWO_FILTERS}
      onChange={() => {
        return undefined;
      }}
    />,
  );
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId("dictionary-row");
}

const SPACES: RegExp = /\s+/;

function classesIn(text: string): Array<string> {
  return text.split(SPACES).filter(Boolean);
}

const WITH_TYPES: DictionaryOperatorRowClassNames =
  getDictionaryOperatorRowClassNames(true);
const WITHOUT_TYPES: DictionaryOperatorRowClassNames =
  getDictionaryOperatorRowClassNames(false);

// The container query variants a row's classes use, read from its classes.
const RANGE_VARIANT: RegExp =
  /^\[@container\(min-width:([\d.]+)rem\)_and_\(max-width:([\d.]+)rem\)\]:/;
const FROM_VARIANT: RegExp = /^\[@container\(min-width:([\d.]+)rem\)\]:/;

interface Tiers {
  twoLinesFrom: number;
  twoLinesTo: number;
  oneLineFrom: number;
  twoLines: string;
  oneLine: string;
}

function tiersOf(classNames: DictionaryOperatorRowClassNames): Tiers {
  const all: Array<string> = classesIn(Object.values(classNames).join(" "));
  const ranges: Set<string> = new Set();
  const froms: Set<string> = new Set();

  for (const name of all) {
    const range: RegExpExecArray | null = RANGE_VARIANT.exec(name);
    const from: RegExpExecArray | null = FROM_VARIANT.exec(name);
    if (range) {
      ranges.add(range[0]);
    }
    if (from) {
      froms.add(from[0]);
    }
  }
  expect(ranges.size).toBe(1);
  expect(froms.size).toBe(1);

  const twoLines: string = Array.from(ranges)[0]!;
  const oneLine: string = Array.from(froms)[0]!;
  const range: RegExpExecArray = RANGE_VARIANT.exec(twoLines)!;

  return {
    twoLinesFrom: Number(range[1]),
    twoLinesTo: Number(range[2]),
    oneLineFrom: Number(FROM_VARIANT.exec(oneLine)![1]),
    twoLines: twoLines,
    oneLine: oneLine,
  };
}

function under(
  variant: string,
  classNames: DictionaryOperatorRowClassNames,
): Record<keyof DictionaryOperatorRowClassNames, Array<string>> {
  const pick: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return classesIn(text)
      .filter((name: string): boolean => {
        return name.startsWith(variant);
      })
      .map((name: string): string => {
        return name.substring(variant.length);
      });
  };

  return {
    row: pick(classNames.row),
    key: pick(classNames.key),
    operator: pick(classNames.operator),
    type: pick(classNames.type),
    value: pick(classNames.value),
    delete: pick(classNames.delete),
  };
}

beforeEach(() => {
  mockDrawnDropdowns.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("the three layouts a filter row with an operator takes", () => {
  test.each([
    ["with a choice of type", WITH_TYPES, 54],
    ["without one", WITHOUT_TYPES, 44],
  ])(
    "%s: two lines from 36rem, one line from %srem, and the two never apply at once",
    (
      _case: string,
      classNames: DictionaryOperatorRowClassNames,
      oneLineFrom: number,
    ) => {
      const tiers: Tiers = tiersOf(classNames);

      expect(tiers.twoLinesFrom).toBe(36);
      expect(tiers.oneLineFrom).toBe(oneLineFrom);
      expect(tiers.twoLinesTo).toBeLessThan(tiers.oneLineFrom);
      expect(tiers.oneLineFrom - tiers.twoLinesTo).toBeLessThanOrEqual(0.01);
    },
  );

  test.each([
    ["with a choice of type", WITH_TYPES],
    ["without one", WITHOUT_TYPES],
  ])(
    "%s, on a phone each field is under the one before it, Delete beside the key, a line between filters",
    (_case: string, classNames: DictionaryOperatorRowClassNames) => {
      expect(classesIn(classNames.row)).toEqual(
        expect.arrayContaining([
          "grid",
          "grid-cols-[minmax(0,1fr)_auto]",
          "border-t",
          "first:border-t-0",
          "pt-4",
          "first:pt-0",
        ]),
      );
      expect(classNames.key.split(" ")).toEqual(
        expect.arrayContaining(["col-start-1", "row-start-1", "min-w-0"]),
      );
      for (const field of [
        classNames.operator,
        classNames.type,
        classNames.value,
      ]) {
        expect(field.split(" ")).toEqual(
          expect.arrayContaining(["col-start-1", "min-w-0"]),
        );
      }
      expect(classNames.delete.split(" ")).toEqual(
        expect.arrayContaining(["col-start-2", "row-start-1"]),
      );
    },
  );

  test("with a choice of type, two lines: the key, the operator and Delete, then the type and the value under them", () => {
    const tiers: Tiers = tiersOf(WITH_TYPES);
    const twoLines: Record<string, Array<string>> = under(
      tiers.twoLines,
      WITH_TYPES,
    );

    expect(twoLines["row"]).toEqual([
      "grid-cols-[9.5rem_minmax(0,1fr)_14rem_auto]",
    ]);
    // The key spans the type's column and the free one, as the value does.
    expect(twoLines["key"]).toEqual(["col-span-2"]);
    expect(twoLines["operator"]).toEqual(["col-start-3", "row-start-1"]);
    expect(twoLines["delete"]).toEqual(["col-start-4"]);
    expect(twoLines["type"]).toEqual(["row-start-2"]);
    expect(twoLines["value"]).toEqual([
      "col-start-2",
      "col-span-2",
      "row-start-2",
    ]);
  });

  test("without one, two lines: the key, the operator and Delete, then the value across both", () => {
    const tiers: Tiers = tiersOf(WITHOUT_TYPES);
    const twoLines: Record<string, Array<string>> = under(
      tiers.twoLines,
      WITHOUT_TYPES,
    );

    expect(twoLines["row"]).toEqual(["grid-cols-[minmax(0,1fr)_14rem_auto]"]);
    expect(twoLines["operator"]).toEqual(["col-start-2", "row-start-1"]);
    expect(twoLines["delete"]).toEqual(["col-start-3"]);
    expect(twoLines["value"]).toEqual(["col-span-2", "row-start-2"]);
  });

  test.each([
    [
      "with a choice of type",
      WITH_TYPES,
      "grid-cols-[minmax(0,1fr)_14rem_9.5rem_minmax(0,1.5fr)_auto]",
    ],
    [
      "without one",
      WITHOUT_TYPES,
      "grid-cols-[minmax(0,1fr)_14rem_minmax(0,1.25fr)_auto]",
    ],
  ])(
    "%s, one line: every box in a column of its own, the value wider than the key, no line between filters",
    (
      _case: string,
      classNames: DictionaryOperatorRowClassNames,
      columns: string,
    ) => {
      const tiers: Tiers = tiersOf(classNames);
      const oneLine: Record<string, Array<string>> = under(
        tiers.oneLine,
        classNames,
      );

      expect(oneLine["row"]).toEqual([
        columns,
        "gap-y-0",
        "border-t-0",
        "pt-0",
      ]);
      // The key keeps its first column; each other box takes the next one.
      expect(oneLine["key"]).toEqual([]);
      expect(oneLine["operator"]).toEqual(["col-start-auto"]);
      expect(oneLine["value"]).toEqual(["col-start-auto"]);
      expect(oneLine["delete"]).toEqual(["col-start-auto", "row-start-auto"]);
    },
  );

  test("with a choice of type, the type takes the next column on one line", () => {
    const tiers: Tiers = tiersOf(WITH_TYPES);

    expect(under(tiers.oneLine, WITH_TYPES)["type"]).toEqual([
      "col-start-auto",
    ]);
  });
});

describe("the rows, drawn", () => {
  test.each([
    ["with a choice of type", ALL_TYPES, WITH_TYPES],
    ["without one", undefined, WITHOUT_TYPES],
  ])(
    "%s, each field of each row takes its place in the row's grid, in a list that holds its room",
    (
      _case: string,
      valueTypes: Array<ValueType> | undefined,
      classNames: DictionaryOperatorRowClassNames,
    ) => {
      renderFilters({ enableOperators: true, valueTypes: valueTypes });

      const drawn: Array<HTMLElement> = rows();

      expect(drawn).toHaveLength(2);
      expect(drawn[0]!.parentElement).toHaveClass(
        DICTIONARY_OPERATOR_ROWS_CLASS_NAME,
      );
      expect(DICTIONARY_OPERATOR_ROWS_CLASS_NAME).toBe(
        "[container-type:inline-size]",
      );

      for (const row of drawn) {
        const fields: Array<Element> = Array.from(row.children);
        const expected: Array<string> = valueTypes
          ? [
              classNames.key,
              classNames.operator,
              classNames.type,
              classNames.value,
              classNames.delete,
            ]
          : [
              classNames.key,
              classNames.operator,
              classNames.value,
              classNames.delete,
            ];

        expect(row.className).toBe(classNames.row);
        expect(
          fields.map((field: Element): string => {
            return field.className;
          }),
        ).toEqual(expected);
      }
    },
  );

  test("a list without operators keeps its rows on one flex line, outside any container", () => {
    renderFilters({ enableOperators: false });

    const drawn: Array<HTMLElement> = rows();

    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.parentElement).not.toHaveClass(
      DICTIONARY_OPERATOR_ROWS_CLASS_NAME,
    );
    for (const row of drawn) {
      expect(row).toHaveClass("flex", "items-start");
      expect(row).not.toHaveClass("grid");
    }
  });

  test("the key and the value autocompletes are named for screen readers", () => {
    renderFilters({ enableOperators: true });

    expect(screen.getAllByRole("combobox", { name: "Key" })).toHaveLength(2);
    // The Includes row's value is a multi-select: only the Wildcard's is typed.
    expect(screen.getAllByRole("combobox", { name: "Value" })).toHaveLength(1);
  });
});

describe("the operator and the type are never cleared, and always shown whole", () => {
  function drawnWith(ariaLabel: string): Array<Record<string, unknown>> {
    return mockDrawnDropdowns.filter(
      (props: Record<string, unknown>): boolean => {
        return props["ariaLabel"] === ariaLabel;
      },
    );
  }

  test("each operator box: not clearable, wraps its pick, named Operator", () => {
    renderFilters({ enableOperators: true, valueTypes: ALL_TYPES });

    const operators: Array<Record<string, unknown>> = drawnWith("Operator");

    expect(operators.length).toBeGreaterThanOrEqual(2);
    for (const props of operators) {
      expect(props["isClearable"]).toBe(false);
      expect(props["wrapsPickedValue"]).toBe(true);
      expect(props["dataTestId"]).toBe("dictionary-operator");
    }
  });

  test("each type box: not clearable, wraps its pick (German's 'Boolescher Wert', never 'Booles...')", () => {
    renderFilters({ enableOperators: true, valueTypes: ALL_TYPES });

    const types: Array<Record<string, unknown>> = drawnWith("Type");

    expect(types.length).toBeGreaterThanOrEqual(2);
    for (const props of types) {
      expect(props["isClearable"]).toBe(false);
      expect(props["wrapsPickedValue"]).toBe(true);
    }
  });

  test("a list value can still be cleared: only the operator and the type cannot", () => {
    renderFilters({ enableOperators: true, valueTypes: ALL_TYPES });

    const listValues: Array<Record<string, unknown>> =
      mockDrawnDropdowns.filter((props: Record<string, unknown>): boolean => {
        return props["isMultiSelect"] === true;
      });

    expect(listValues.length).toBeGreaterThanOrEqual(1);
    for (const props of listValues) {
      expect(props["isClearable"]).not.toBe(false);
    }
  });
});
