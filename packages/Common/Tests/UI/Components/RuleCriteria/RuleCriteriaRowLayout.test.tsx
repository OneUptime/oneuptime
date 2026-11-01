import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME,
  RULE_CRITERIA_FIELD_CELL_CLASS_NAME,
  RULE_CRITERIA_LAYOUT_WIDTHS_IN_REM,
  RULE_CRITERIA_LIST_CLASS_NAME,
  RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME,
  RULE_CRITERIA_REMOVE_CELL_CLASS_NAME,
  RULE_CRITERIA_ROW_CLASS_NAME,
  RULE_CRITERIA_VALUE_CELL_CLASS_NAME,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaRowLayout";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Field from "../../../../UI/Components/Forms/Types/Field";
import RuleCriteriaBuilder from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";

/*
 * A CONDITION'S ROW IS LAID OUT BY THE ROOM THE CONDITIONS HAVE.
 *
 * The rule builder's rows went onto one line at the window's lg breakpoint,
 * so in a dialog (about 478px of conditions beside a form's steps, at any
 * window) a scheduled maintenance reminder rule's Match step squeezed its
 * field and operator pickers to "Lab..." and "H..." (#5282). The list of
 * conditions is now a container and each row reads its width
 * (RuleCriteriaRowLayout): under 24rem the word and the remove button get a
 * line of their own over full-width pickers; to 37rem one picker a line;
 * to 56rem field and operator side by side over the value; then one line.
 *
 * jsdom applies no styles, so the class names are read here the way the
 * browser reads them - which rules apply at a width, and where each puts
 * its cell - and the builder is checked to draw them. Chromium's half is
 * the SharedUi offline suite ("a rule's conditions at every width").
 */

jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: { dataTestId?: string }): ReactElement => {
      return <div data-testid={props.dataTestId || "dropdown"} />;
    },
  };
});

jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: { dataTestId?: string }): ReactElement => {
      return <div data-testid={props.dataTestId || "entity-dropdown"} />;
    },
  };
});

afterEach(() => {
  cleanup();
});

const REM: number = 16;

// One class token, read as the browser reads it.
interface ClassRule {
  token: string;
  // The container widths, in px, it applies at: [min, max], max Infinity.
  minWidth: number;
  maxWidth: number;
  isContainerRule: boolean;
  property: string;
  value: string;
}

const CONTAINER_VARIANT: RegExp =
  /^\[@container\(min-width:([\d.]+)rem\)(?:_and_\(max-width:([\d.]+)rem\))?\]:(.+)$/;

// The brackets around an arbitrary value: "[3.5rem_auto]".
const ARBITRARY_BRACKETS: RegExp = /^\[|\]$/g;

// A class that goes by the window's width rather than the conditions'.
const WINDOW_BREAKPOINT_VARIANT: RegExp = /^(?:max-)?(?:sm|md|lg|xl|2xl):/;

// The grid properties a row's classes set, and how each utility names it.
function readUtility(utility: string): { property: string; value: string } {
  if (utility.startsWith("grid-cols-")) {
    return {
      property: "grid-template-columns",
      value: utility.slice("grid-cols-".length),
    };
  }

  if (utility.startsWith("col-")) {
    return { property: "grid-column", value: utility.slice("col-".length) };
  }

  if (utility.startsWith("row-")) {
    return { property: "grid-row", value: utility.slice("row-".length) };
  }

  return { property: utility, value: "" };
}

function readClasses(className: string): Array<ClassRule> {
  return className
    .split(" ")
    .filter((token: string): boolean => {
      return token.length > 0;
    })
    .map((token: string): ClassRule => {
      const match: RegExpMatchArray | null = token.match(CONTAINER_VARIANT);

      if (!match) {
        return {
          token: token,
          minWidth: 0,
          maxWidth: Infinity,
          isContainerRule: false,
          ...readUtility(token),
        };
      }

      return {
        token: token,
        minWidth: Number(match[1]) * REM,
        maxWidth: match[2] ? Number(match[2]) * REM : Infinity,
        isContainerRule: true,
        ...readUtility(match[3] as string),
      };
    });
}

/*
 * What a cell's classes set at a container width: each property's value
 * from the one container rule that applies, else from its base class.
 * Fails if two container rules set one property at that width - which of
 * them won would depend on their order in the stylesheet.
 */
function placementAt(
  className: string,
  widthInPx: number,
): Record<string, string> {
  const rules: Array<ClassRule> = readClasses(className);
  const placed: Record<string, string> = {};
  const fromContainer: Record<string, Array<string>> = {};

  for (const rule of rules) {
    if (!rule.isContainerRule) {
      placed[rule.property] = rule.value;
      continue;
    }

    if (widthInPx >= rule.minWidth && widthInPx <= rule.maxWidth) {
      fromContainer[rule.property] = [
        ...(fromContainer[rule.property] || []),
        rule.token,
      ];
      placed[rule.property] = rule.value;
    }
  }

  for (const [property, tokens] of Object.entries(fromContainer)) {
    expect({ widthInPx, property, tokens: tokens.length }).toEqual({
      widthInPx,
      property,
      tokens: 1,
    });
  }

  return placed;
}

interface RowPlacement {
  columns: string;
  connector: string;
  field: string;
  operator: string;
  value: string;
  remove: string;
}

// Where each cell sits at a width: "column/row".
function rowAt(widthInPx: number): RowPlacement {
  const cell: (className: string) => string = (className: string): string => {
    const placed: Record<string, string> = placementAt(className, widthInPx);
    return `${placed["grid-column"]} @ ${placed["grid-row"]}`;
  };

  return {
    columns: placementAt(RULE_CRITERIA_ROW_CLASS_NAME, widthInPx)[
      "grid-template-columns"
    ] as string,
    connector: cell(RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME),
    field: cell(RULE_CRITERIA_FIELD_CELL_CLASS_NAME),
    operator: cell(RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME),
    value: cell(RULE_CRITERIA_VALUE_CELL_CLASS_NAME),
    remove: cell(RULE_CRITERIA_REMOVE_CELL_CLASS_NAME),
  };
}

const PHONE: RowPlacement = {
  columns: "[minmax(0,1fr)_auto]",
  connector: "[1] @ [1]",
  remove: "[2] @ [1]",
  field: "[1/-1] @ [2]",
  operator: "[1/-1] @ [3]",
  value: "[1/-1] @ [4]",
};

const ONE_A_LINE: RowPlacement = {
  columns: "[3.5rem_minmax(0,1fr)_auto]",
  connector: "[1] @ [1]",
  field: "[2] @ [1]",
  remove: "[3] @ [1]",
  operator: "[2] @ [2]",
  value: "[2] @ [3]",
};

const TWO_LINES: RowPlacement = {
  columns: "[3.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]",
  connector: "[1] @ [1]",
  field: "[2] @ [1]",
  operator: "[3] @ [1]",
  remove: "[4] @ [1]",
  value: "[2/4] @ [2]",
};

const ONE_LINE: RowPlacement = {
  columns: "[3.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]",
  connector: "[1] @ [1]",
  field: "[2] @ [1]",
  operator: "[3] @ [1]",
  value: "[4] @ [1]",
  remove: "[5] @ [1]",
};

describe("where a condition's cells sit, by the width of the conditions", () => {
  test("the widths it changes at: 24rem, 37rem and 56rem", () => {
    expect(RULE_CRITERIA_LAYOUT_WIDTHS_IN_REM).toEqual([24, 37, 56]);
  });

  test("the list of conditions is the container the rows measure, 16px between conditions", () => {
    expect(RULE_CRITERIA_LIST_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["[container-type:inline-size]", "space-y-4"]),
    );
  });

  const CASES: Array<[string, number, RowPlacement]> = [
    ["a narrow phone (280px)", 280, PHONE],
    ["a phone's dialog (314px, 390px wide)", 314, PHONE],
    ["just under 24rem (383px)", 383, PHONE],
    ["at 24rem (384px)", 384, ONE_A_LINE],
    [
      "a dialog beside its steps (478px, the reminder rule's Match step)",
      478,
      ONE_A_LINE,
    ],
    ["just under 37rem (591px)", 591, ONE_A_LINE],
    ["at 37rem (592px)", 592, TWO_LINES],
    ["a dialog with no steps (710px)", 710, TWO_LINES],
    ["just under 56rem (895px)", 895, TWO_LINES],
    ["at 56rem (896px)", 896, ONE_LINE],
    ["a page (1110px)", 1110, ONE_LINE],
  ];

  test.each(CASES)(
    "%s",
    (_label: string, widthInPx: number, expected: RowPlacement) => {
      expect(rowAt(widthInPx)).toEqual(expected);
    },
  );

  test("no two of the widths' rules ever set one cell's place at once, at any width", () => {
    for (let width: number = 200; width <= 1400; width += 1) {
      // placementAt fails on two container rules for one property.
      rowAt(width);
    }
  });

  test("the remove button is at the end of the first line, and the word at its start, at every width", () => {
    for (const width of [300, 400, 600, 900]) {
      const placed: RowPlacement = rowAt(width);
      const columnCount: number = placed.columns
        .replace(ARBITRARY_BRACKETS, "")
        .split("_").length;

      expect(placed.connector).toBe("[1] @ [1]");
      expect(placed.remove).toBe(`[${columnCount}] @ [1]`);
    }
  });

  test("nothing in a row goes by the window's width (no sm:, md:, lg: or max-lg:)", () => {
    for (const className of [
      RULE_CRITERIA_ROW_CLASS_NAME,
      RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME,
      RULE_CRITERIA_FIELD_CELL_CLASS_NAME,
      RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME,
      RULE_CRITERIA_VALUE_CELL_CLASS_NAME,
      RULE_CRITERIA_REMOVE_CELL_CLASS_NAME,
    ]) {
      for (const token of className.split(" ")) {
        expect([token, WINDOW_BREAKPOINT_VARIANT.test(token)]).toEqual([
          token,
          false,
        ]);
      }
    }
  });
});

describe("the builder draws its rows by that layout", () => {
  type Values = Record<string, unknown>;

  const FIELDS: Array<Field<Values>> = [
    {
      field: { title: true },
      title: "Incident Title",
      fieldType: FormFieldSchemaType.Text,
    },
    {
      field: { labels: true },
      title: "Labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownOptions: [
        { label: "Production", value: "production" },
        { label: "Payments", value: "payments" },
      ],
    },
  ];

  const CRITERIA: RuleCriteria = {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [
      {
        field: "title",
        operator: RuleCriteriaOperator.DoesNotMatchPattern,
        value: "^staging-",
      },
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ["production"],
      },
    ],
  };

  function renderBuilder(): void {
    render(
      <RuleCriteriaBuilder<Values>
        fields={FIELDS}
        value={CRITERIA}
        onChange={(): void => {}}
      />,
    );
  }

  test("the list of conditions is the container, and each row and cell carries its place", () => {
    renderBuilder();

    const list: HTMLElement = screen.getByTestId("rule-criteria-rows");

    expect(list.tagName).toBe("OL");
    expect(list.className).toBe(RULE_CRITERIA_LIST_CLASS_NAME);

    for (const index of [0, 1]) {
      const row: HTMLElement = screen.getByTestId(`rule-criteria-row-${index}`);
      const cells: Array<string> = Array.from(row.children).map(
        (cell: Element): string => {
          return cell.className;
        },
      );

      expect(row.className).toBe(RULE_CRITERIA_ROW_CLASS_NAME);
      expect(cells).toEqual([
        RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME,
        RULE_CRITERIA_FIELD_CELL_CLASS_NAME,
        RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME,
        RULE_CRITERIA_VALUE_CELL_CLASS_NAME,
        RULE_CRITERIA_REMOVE_CELL_CLASS_NAME,
      ]);
    }
  });

  test("each cell holds what its place is for: the word, the field, the operator, the value, the remove button", () => {
    renderBuilder();

    const row: HTMLElement = screen.getByTestId("rule-criteria-row-1");
    const cells: Array<Element> = Array.from(row.children);

    expect(cells[0]).toHaveTextContent("And");
    expect(
      cells[1]!.querySelector("[data-testid='rule-criteria-field-1']"),
    ).not.toBeNull();
    expect(
      cells[2]!.querySelector("[data-testid='rule-criteria-operator-1']"),
    ).not.toBeNull();
    expect(
      cells[3]!.querySelector("[data-testid='rule-criteria-value-1']"),
    ).not.toBeNull();
    expect(
      cells[4]!.querySelector("[data-testid='rule-criteria-delete-1']"),
    ).not.toBeNull();
  });
});

describe("the builder's source", () => {
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "UI",
      "Components",
      "RuleCriteria",
      "RuleCriteriaBuilder.tsx",
    ),
    "utf8",
  );

  test("lays its rows out with RuleCriteriaRowLayout, by the conditions' width - not the window's", () => {
    for (const name of [
      "RULE_CRITERIA_LIST_CLASS_NAME",
      "RULE_CRITERIA_ROW_CLASS_NAME",
      "RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME",
      "RULE_CRITERIA_FIELD_CELL_CLASS_NAME",
      "RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME",
      "RULE_CRITERIA_VALUE_CELL_CLASS_NAME",
      "RULE_CRITERIA_REMOVE_CELL_CLASS_NAME",
    ]) {
      expect([name, source.includes(`className={${name}}`)]).toEqual([
        name,
        true,
      ]);
    }

    // The window's breakpoints that laid the row out before.
    expect(source).not.toContain("lg:grid-cols-");
    expect(source).not.toContain("max-lg:");
  });
});
