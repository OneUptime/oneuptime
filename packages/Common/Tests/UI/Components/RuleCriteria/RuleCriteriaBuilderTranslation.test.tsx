import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import React from "react";

/*
 * The builder says every word through the dashboard's translation: its own
 * sentences, the criteria names and operators in the real dropdowns, the
 * value prompts, and the problems it points out. The translation hook here
 * wraps whatever it is handed in «», so a string that skipped it shows up
 * bare; the problems go through i18next itself, as form validation does.
 */

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      const wrap: (value: string | undefined) => string | undefined = (
        value: string | undefined,
      ): string | undefined => {
        return value ? `«${value}»` : value;
      };

      return {
        translateString: wrap,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? wrap(value) : value;
        },
      };
    },
  };
});

import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaBuilder from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";

type Entity = Record<string, unknown>;

const FIELDS: Array<Field<Entity>> = [
  {
    field: { incidentTitlePattern: true },
    title: "Incident Title",
    fieldType: FormFieldSchemaType.Text,
    placeholder: "CPU.*high",
  },
  {
    field: { severity: true },
    title: "Severity",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: [{ label: "Critical", value: "critical" }],
  },
];

function renderBuilder(
  value: RuleCriteria | undefined,
  extra: { error?: string; requiresCondition?: boolean } = {},
): void {
  render(
    <RuleCriteriaBuilder
      fields={FIELDS as Array<Field<unknown>>}
      value={value}
      onChange={jest.fn()}
      error={extra.error}
      requiresCondition={extra.requiresCondition}
    />,
  );
}

const TWO_CONDITIONS: RuleCriteria = {
  schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
  filterCondition: FilterCondition.All,
  filters: [
    {
      field: "incidentTitlePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "",
    },
    {
      field: "severity",
      operator: RuleCriteriaOperator.Equals,
      value: "critical",
    },
  ],
};

beforeAll(async () => {
  await i18next.init({
    lng: "de",
    fallbackLng: false,
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      de: {
        translation: {
          "Enter a value.": "Geben Sie einen Wert ein.",
        },
      },
    },
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("the conditions builder speaks through the translation", () => {
  test("its empty state", () => {
    renderBuilder(undefined);

    const empty: HTMLElement = screen.getByTestId("rule-criteria-empty");
    expect(empty).toHaveTextContent("«No conditions yet»");
    expect(empty).toHaveTextContent(
      "«Without conditions, this rule applies to everything. Add a condition to narrow it down.»",
    );
    expect(within(empty).getByRole("button")).toHaveTextContent(
      "«Add condition»",
    );
  });

  test("the empty state of a rule that needs a condition", () => {
    renderBuilder(undefined, { requiresCondition: true });

    expect(
      screen.getByTestId("rule-criteria-empty-description"),
    ).toHaveTextContent(
      "«Add at least one condition. This rule only applies to what its conditions match.»",
    );
  });

  test("its rows, the combine choice and the real dropdowns", () => {
    renderBuilder(TWO_CONDITIONS);

    const firstRow: HTMLElement = screen.getByTestId("rule-criteria-row-0");
    expect(firstRow).toHaveTextContent("«If»");
    expect(firstRow).toHaveTextContent("«Incident Title»");
    expect(firstRow).toHaveTextContent("«Contains»");
    // Translated once, by the input itself.
    expect(screen.getByTestId("rule-criteria-value-0")).toHaveAttribute(
      "placeholder",
      "«Enter text»",
    );

    expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
      "«And»",
    );
    const combine: HTMLElement = screen.getByTestId("rule-criteria-combine");
    expect(combine).toHaveTextContent("«Match all»");
    expect(combine).toHaveTextContent("«Match any»");
    expect(combine).toHaveTextContent("«Every condition must be true.»");
    expect(
      screen.getByRole("group", { name: "«How conditions are combined»" }),
    ).toBe(combine);
  });

  test("the problems it points out, through i18next", () => {
    renderBuilder(TWO_CONDITIONS, { error: "Condition 1: Enter a value." });

    expect(
      within(screen.getByTestId("rule-criteria-row-0")).getByRole("alert"),
    ).toHaveTextContent("Geben Sie einen Wert ein.");
  });
});
