import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement, useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The conditions builder every rule page shares, with the two dropdowns
 * stubbed so each row's controls can be read and driven directly: the stub
 * records the props it was handed and draws one button per option.
 */

interface DropdownStubOption {
  label: string;
  value: string | number | boolean;
}

interface DropdownStubOptionGroup {
  label: string;
  options: Array<DropdownStubOption>;
}

interface DropdownStubProps {
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  isMultiSelect?: boolean | undefined;
  isClearable?: boolean | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
  onChange?:
    | ((value: string | number | boolean | Array<string> | null) => void)
    | undefined;
  options: Array<DropdownStubOption | DropdownStubOptionGroup>;
  value?: unknown;
}

const capturedDropdowns: Record<string, DropdownStubProps> = {};
const capturedEntityDropdowns: Record<string, DropdownStubProps> = {};

function flattenStubOptions(
  options: Array<DropdownStubOption | DropdownStubOptionGroup>,
): Array<DropdownStubOption> {
  return options.flatMap(
    (
      option: DropdownStubOption | DropdownStubOptionGroup,
    ): Array<DropdownStubOption> => {
      return "options" in option ? option.options : [option];
    },
  );
}

function renderStub(
  props: DropdownStubProps,
  testId: string,
  prefix: string,
): ReactElement {
  return (
    <div data-testid={`${prefix}${testId}`}>
      {flattenStubOptions(props.options).map(
        (option: DropdownStubOption): ReactElement => {
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-label={`${props.ariaLabel || testId}: ${option.label}`}
              onClick={(): void => {
                props.onChange?.(
                  props.isMultiSelect
                    ? [option.value.toString()]
                    : option.value,
                );
              }}
            >
              {option.label}
            </button>
          );
        },
      )}
      {props.error ? <p role="alert">{props.error}</p> : null}
    </div>
  );
}

jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: DropdownStubProps): ReactElement => {
      const testId: string = props.dataTestId || "dropdown";
      capturedDropdowns[testId] = props;
      return renderStub(props, testId, "stub-");
    },
  };
});

jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: DropdownStubProps): ReactElement => {
      const testId: string = props.dataTestId || "entity-dropdown";
      capturedEntityDropdowns[testId] = {
        ...props,
        options: props.options || [],
      };
      return renderStub(
        { ...props, options: props.options || [] },
        testId,
        "stub-entity-",
      );
    },
  };
});

import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaBuilder, {
  convertLegacyValuesToRuleCriteria,
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaFieldName,
  getRuleCriteriaOperatorsForField,
  RULE_CRITERIA_OPERATOR_LABELS,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";
import { RuleCriteriaCopy } from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";

type TestEntity = Record<string, unknown>;

const LABEL_OPTIONS: Array<DropdownOption> = [
  { label: "Payments", value: "label-payments" },
  { label: "Search", value: "label-search" },
];

const MONITOR_OPTIONS: Array<DropdownOption> = [
  { label: "API", value: "monitor-api" },
  { label: "Website", value: "monitor-website" },
];

const NAME: Field<TestEntity> = {
  field: { namePattern: true },
  title: "Name",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "api-*",
};

const DESCRIPTION: Field<TestEntity> = {
  field: { descriptionPattern: true },
  title: "Description",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "timeout|refused",
};

const LABELS: Field<TestEntity> = {
  field: { labels: true },
  title: "Labels",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
  dropdownOptions: LABEL_OPTIONS,
  placeholder: "Select Labels (optional)",
};

const MONITOR_LABELS: Field<TestEntity> = {
  field: { monitorLabels: true },
  title: "Monitor Labels",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
  dropdownOptions: LABEL_OPTIONS,
  placeholder: "Select Monitor Labels (optional)",
};

const MONITORS: Field<TestEntity> = {
  field: { monitors: true },
  title: "Monitors",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Monitor, labelField: "name", valueField: "_id" },
  dropdownOptions: MONITOR_OPTIONS,
  placeholder: "Select Monitors (optional)",
};

const SEVERITY: Field<TestEntity> = {
  field: { severity: true },
  title: "Severity",
  fieldType: FormFieldSchemaType.Dropdown,
  dropdownOptions: [
    { label: "Critical", value: "critical" },
    { label: "Warning", value: "warning" },
  ],
};

const FIELDS: Array<Field<TestEntity>> = [NAME, LABELS, SEVERITY];

interface HarnessProps {
  initialValue?: RuleCriteria | undefined;
  legacyValues?: Record<string, unknown> | undefined;
  onChange: ReturnType<typeof jest.fn>;
  fields?: Array<Field<TestEntity>> | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  requiresCondition?: boolean | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const [criteria, setCriteria] = useState<RuleCriteria | undefined>(
    props.initialValue,
  );

  return (
    <RuleCriteriaBuilder
      fields={(props.fields || FIELDS) as Array<Field<unknown>>}
      legacyValues={props.legacyValues}
      value={criteria}
      error={props.error}
      disabled={props.disabled}
      requiresCondition={props.requiresCondition}
      onChange={(value: RuleCriteria): void => {
        props.onChange(value);
        setCriteria(value);
      }}
    />
  );
};

function latestCriteria(onChange: ReturnType<typeof jest.fn>): RuleCriteria {
  const lastCall: Array<unknown> | undefined =
    onChange.mock.calls[onChange.mock.calls.length - 1];

  return lastCall?.[0] as RuleCriteria;
}

function criteriaOf(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

function filterOf(
  field: string,
  operator: RuleCriteriaOperator,
  value: RuleCriteriaFilter["value"],
): RuleCriteriaFilter {
  return { field, operator, value };
}

function optionLabels(testId: string): Array<string> {
  return flattenStubOptions(capturedDropdowns[testId]?.options || []).map(
    (option: DropdownStubOption): string => {
      return option.label;
    },
  );
}

describe("RuleCriteriaBuilder", () => {
  beforeEach(() => {
    for (const key of Object.keys(capturedDropdowns)) {
      delete capturedDropdowns[key];
    }
    for (const key of Object.keys(capturedEntityDropdowns)) {
      delete capturedEntityDropdowns[key];
    }
  });

  afterEach(() => {
    cleanup();
  });

  describe("with no conditions", () => {
    test("says the rule applies to everything and offers to add one", () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      render(<Harness onChange={onChange} />);

      expect(latestCriteria(onChange)).toEqual(criteriaOf([]));

      const empty: HTMLElement = screen.getByTestId("rule-criteria-empty");
      expect(empty).toHaveTextContent(RuleCriteriaCopy.emptyTitle);
      expect(
        screen.getByTestId("rule-criteria-empty-description"),
      ).toHaveTextContent(RuleCriteriaCopy.emptyMatchesEverything);
      expect(
        within(empty).getByRole("button", { name: "Add condition" }),
      ).toBeEnabled();
      expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
      expect(screen.queryByTestId("rule-criteria-combine")).toBeNull();
    });

    test("asks for a condition when the rule matches nothing without one", () => {
      render(<Harness onChange={jest.fn()} requiresCondition={true} />);

      expect(
        screen.getByTestId("rule-criteria-empty-description"),
      ).toHaveTextContent(RuleCriteriaCopy.emptyNeedsCondition);
      expect(
        screen.getByTestId("rule-criteria-empty-description"),
      ).not.toHaveTextContent("applies to everything");
    });

    test("cannot add a condition when the page offers no field", () => {
      render(<Harness onChange={jest.fn()} fields={[]} />);

      expect(screen.getByTestId("rule-criteria-add")).toBeDisabled();
    });
  });

  describe("adding and removing conditions", () => {
    test("the first condition starts on the first field, text on Contains", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(<Harness onChange={onChange} />);

      await user.click(screen.getByTestId("rule-criteria-add"));

      expect(latestCriteria(onChange).filters).toEqual([
        filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
      ]);
      const row: HTMLElement = screen.getByTestId("rule-criteria-row-0");
      expect(row).toHaveTextContent(RuleCriteriaCopy.ifConnector);
      expect(screen.queryByTestId("rule-criteria-empty")).toBeNull();
      // One condition: nothing to combine yet.
      expect(screen.queryByTestId("rule-criteria-combine")).toBeNull();
    });

    test("each next condition starts on a field no condition uses yet", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(<Harness onChange={onChange} />);

      await user.click(screen.getByTestId("rule-criteria-add"));
      await user.click(screen.getByTestId("rule-criteria-add"));
      await user.click(screen.getByTestId("rule-criteria-add"));

      expect(
        latestCriteria(onChange).filters.map(
          (filter: RuleCriteriaFilter): string => {
            return filter.field;
          },
        ),
      ).toEqual(["namePattern", "labels", "severity"]);
      expect(latestCriteria(onChange).filters[1]).toEqual(
        filterOf("labels", RuleCriteriaOperator.HasAnyOf, []),
      );
      expect(latestCriteria(onChange).filters[2]).toEqual(
        filterOf("severity", RuleCriteriaOperator.Equals, ""),
      );

      // Every field in use: the next one starts on the first field again.
      await user.click(screen.getByTestId("rule-criteria-add"));
      expect(latestCriteria(onChange).filters[3]?.field).toBe("namePattern");
    });

    test("removes the condition whose quiet trash button was pressed", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
            filterOf("labels", RuleCriteriaOperator.HasAnyOf, ["label-search"]),
          ])}
        />,
      );

      const remove: HTMLElement = screen.getByRole("button", {
        name: "Remove condition 1",
      });
      expect(remove).toHaveAttribute("data-testid", "rule-criteria-delete-0");
      // An icon, not a red "Delete" button under the row.
      expect(remove).not.toHaveTextContent("Delete");
      expect(remove.className).not.toContain("red");

      await user.click(remove);

      expect(latestCriteria(onChange).filters).toEqual([
        filterOf("labels", RuleCriteriaOperator.HasAnyOf, ["label-search"]),
      ]);
      expect(screen.queryByTestId("rule-criteria-row-1")).toBeNull();

      await user.click(
        screen.getByRole("button", { name: "Remove condition 1" }),
      );
      expect(latestCriteria(onChange).filters).toEqual([]);
      expect(screen.getByTestId("rule-criteria-empty")).toBeInTheDocument();
    });
  });

  describe("combining conditions", () => {
    const TWO_CONDITIONS: RuleCriteria = criteriaOf([
      filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
      filterOf("labels", RuleCriteriaOperator.HasAnyOf, ["label-search"]),
    ]);

    test("Match all / Match any appears once there are two conditions", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
          ])}
        />,
      );

      expect(screen.queryByTestId("rule-criteria-combine")).toBeNull();

      await user.click(screen.getByTestId("rule-criteria-add"));

      const combine: HTMLElement = screen.getByTestId("rule-criteria-combine");
      expect(
        within(combine).getByRole("radio", { name: "Match all" }),
      ).toBeChecked();
      expect(
        within(combine).getByRole("radio", { name: "Match any" }),
      ).not.toBeChecked();
      expect(
        screen.getByTestId("rule-criteria-combine-hint"),
      ).toHaveTextContent(RuleCriteriaCopy.matchAllHint);
    });

    test("every later row starts with the word Match all / Match any picked", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(<Harness onChange={onChange} initialValue={TWO_CONDITIONS} />);

      expect(screen.getByTestId("rule-criteria-row-0")).toHaveTextContent(
        /^If/,
      );
      expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
        RuleCriteriaCopy.andConnector,
      );

      await user.click(screen.getByTestId("rule-criteria-match-any"));

      expect(latestCriteria(onChange).filterCondition).toBe(
        FilterCondition.Any,
      );
      expect(latestCriteria(onChange).filters).toEqual(TWO_CONDITIONS.filters);
      expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
        RuleCriteriaCopy.orConnector,
      );
      expect(
        screen.getByTestId("rule-criteria-combine-hint"),
      ).toHaveTextContent(RuleCriteriaCopy.matchAnyHint);

      await user.click(screen.getByTestId("rule-criteria-match-all"));
      expect(latestCriteria(onChange).filterCondition).toBe(
        FilterCondition.All,
      );
      expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
        RuleCriteriaCopy.andConnector,
      );
    });

    test("a stored Match any is kept while the choice is hidden", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf(TWO_CONDITIONS.filters, FilterCondition.Any)}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Remove condition 2" }),
      );
      expect(screen.queryByTestId("rule-criteria-combine")).toBeNull();
      expect(latestCriteria(onChange).filterCondition).toBe(
        FilterCondition.Any,
      );

      await user.click(screen.getByTestId("rule-criteria-add"));
      expect(
        within(screen.getByTestId("rule-criteria-combine")).getByRole("radio", {
          name: "Match any",
        }),
      ).toBeChecked();
    });

    test("the two choices are one radio group per builder", () => {
      render(
        <div>
          <Harness onChange={jest.fn()} initialValue={TWO_CONDITIONS} />
          <Harness onChange={jest.fn()} initialValue={TWO_CONDITIONS} />
        </div>,
      );

      const names: Array<string | null> = screen
        .getAllByTestId("rule-criteria-match-all")
        .map((input: HTMLElement): string | null => {
          return input.getAttribute("name");
        });

      expect(names[0]).toBeTruthy();
      expect(names[0]).not.toBe(names[1]);
    });
  });

  describe("a condition's criteria, operator and value", () => {
    test("the criteria picker lists each field by its title and cannot be cleared", () => {
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
          ])}
        />,
      );

      expect(optionLabels("rule-criteria-field-0")).toEqual([
        "Name",
        "Labels",
        "Severity",
      ]);
      expect(capturedDropdowns["rule-criteria-field-0"]?.isClearable).toBe(
        false,
      );
      expect(capturedDropdowns["rule-criteria-operator-0"]?.isClearable).toBe(
        false,
      );
      expect(capturedDropdowns["rule-criteria-field-0"]?.ariaLabel).toBe(
        "Criteria for condition 1",
      );
    });

    test("offers the text operators, Contains first, and stores typed text", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
          ])}
        />,
      );

      expect(optionLabels("rule-criteria-operator-0")).toEqual([
        "Contains",
        "Does not contain",
        "Equals",
        "Does not equal",
        "Starts with",
        "Ends with",
        "Matches pattern",
        "Does not match pattern",
      ]);

      await user.type(screen.getByTestId("rule-criteria-value-0"), "gateway");

      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("namePattern", RuleCriteriaOperator.Contains, "gateway"),
      );
    });

    test("keeps typed text when the operator changes", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "api-"),
          ])}
        />,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Operator for condition 1: Starts with",
        }),
      );

      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("namePattern", RuleCriteriaOperator.StartsWith, "api-"),
      );
      expect(screen.getByTestId("rule-criteria-value-0")).toHaveValue("api-");
    });

    test("keeps picked values when a list operator changes", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("labels", RuleCriteriaOperator.HasAnyOf, [
              "label-payments",
            ]),
          ])}
        />,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Operator for condition 1: Has none of",
        }),
      );

      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("labels", RuleCriteriaOperator.HasNoneOf, ["label-payments"]),
      );
    });

    test("choosing the operator a condition already has changes nothing", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
          ])}
        />,
      );
      onChange.mockClear();

      await user.click(
        screen.getByRole("button", {
          name: "Operator for condition 1: Contains",
        }),
      );
      await user.click(
        screen.getByRole("button", { name: "Criteria for condition 1: Name" }),
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    test("keeps the operator and text when moving to another text field", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          fields={[NAME, DESCRIPTION, LABELS]}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.EndsWith, "-prod"),
          ])}
        />,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Criteria for condition 1: Description",
        }),
      );

      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("descriptionPattern", RuleCriteriaOperator.EndsWith, "-prod"),
      );
    });

    test("starts over when moving to a field of another kind", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
          ])}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Criteria for condition 1: Labels" }),
      );

      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("labels", RuleCriteriaOperator.HasAnyOf, []),
      );
    });

    test("keeps picked labels when moving between two label fields", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          fields={[MONITORS, LABELS, MONITOR_LABELS]}
          initialValue={criteriaOf([
            filterOf("labels", RuleCriteriaOperator.HasAllOf, ["label-search"]),
          ])}
        />,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Criteria for condition 1: Monitor Labels",
        }),
      );
      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("monitorLabels", RuleCriteriaOperator.HasAllOf, [
          "label-search",
        ]),
      );

      await user.click(
        screen.getByRole("button", {
          name: "Criteria for condition 1: Monitors",
        }),
      );
      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("monitors", RuleCriteriaOperator.HasAllOf, []),
      );
    });

    test("picks related records from an EntityDropdown and stores their ids", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("labels", RuleCriteriaOperator.HasAnyOf, []),
          ])}
        />,
      );

      expect(capturedEntityDropdowns["rule-criteria-value-0"]).toBeDefined();
      expect(capturedDropdowns["rule-criteria-value-0"]).toBeUndefined();
      expect(
        capturedEntityDropdowns["rule-criteria-value-0"]?.isMultiSelect,
      ).toBe(true);

      await user.click(
        screen.getByRole("button", {
          name: "Value for condition 1: Payments",
        }),
      );

      expect(latestCriteria(onChange).filters[0]).toEqual(
        filterOf("labels", RuleCriteriaOperator.HasAnyOf, ["label-payments"]),
      );
    });

    test("picks an enumerated value from a dropdown", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([
            filterOf("severity", RuleCriteriaOperator.Equals, "warning"),
          ])}
        />,
      );

      expect(capturedDropdowns["rule-criteria-value-0"]).toBeDefined();
      expect(capturedEntityDropdowns["rule-criteria-value-0"]).toBeUndefined();
      expect(optionLabels("rule-criteria-operator-0")).toEqual([
        "Equals",
        "Does not equal",
      ]);

      await user.click(
        screen.getByRole("button", {
          name: "Value for condition 1: Critical",
        }),
      );

      expect(latestCriteria(onChange).filters[0]?.value).toBe("critical");
    });

    test("a switch field is compared with True or False", () => {
      render(
        <Harness
          onChange={jest.fn()}
          fields={[
            {
              field: { isEnabled: true },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          initialValue={criteriaOf([
            filterOf("isEnabled", RuleCriteriaOperator.Equals, true),
          ])}
        />,
      );

      expect(optionLabels("rule-criteria-value-0")).toEqual(["True", "False"]);
      expect(
        (
          capturedDropdowns["rule-criteria-value-0"]?.value as
            | DropdownStubOption
            | undefined
        )?.value,
      ).toBe(true);
    });

    test("a number field takes a number", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          fields={[
            {
              field: { port: true },
              title: "Port",
              fieldType: FormFieldSchemaType.Port,
            },
          ]}
          initialValue={criteriaOf([
            filterOf("port", RuleCriteriaOperator.Equals, 0),
          ])}
        />,
      );

      const input: HTMLElement = screen.getByTestId("rule-criteria-value-0");
      expect(input).toHaveAttribute("type", "number");
      expect(input).toHaveAttribute("placeholder", RuleCriteriaCopy.enterANumber);

      await user.clear(input);
      await user.type(input, "443");
      expect(latestCriteria(onChange).filters[0]?.value).toBe(443);
    });
  });

  describe("value placeholders", () => {
    test("a list asks to select one or more, never (optional)", () => {
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("labels", RuleCriteriaOperator.HasAnyOf, []),
          ])}
        />,
      );

      expect(
        capturedEntityDropdowns["rule-criteria-value-0"]?.placeholder,
      ).toBe(RuleCriteriaCopy.selectOneOrMore);
    });

    test("text asks for text, and a pattern shows the page's example", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
          ])}
        />,
      );

      expect(screen.getByTestId("rule-criteria-value-0")).toHaveAttribute(
        "placeholder",
        RuleCriteriaCopy.enterText,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Operator for condition 1: Matches pattern",
        }),
      );

      expect(screen.getByTestId("rule-criteria-value-0")).toHaveAttribute(
        "placeholder",
        "api-*",
      );
    });

    test("a choice asks to select a value", () => {
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("severity", RuleCriteriaOperator.Equals, ""),
          ])}
        />,
      );

      expect(capturedDropdowns["rule-criteria-value-0"]?.placeholder).toBe(
        RuleCriteriaCopy.selectAValue,
      );
    });
  });

  describe("an address range field", () => {
    test("reads Is in / Is not in and keeps its own example", () => {
      render(
        <Harness
          onChange={jest.fn()}
          fields={[
            {
              field: { subnetCidr: true },
              title: "IP Address",
              fieldType: FormFieldSchemaType.Text,
              placeholder: "10.42.7.0/24",
            },
          ]}
          initialValue={criteriaOf([
            filterOf("subnetCidr", RuleCriteriaOperator.MatchesPattern, ""),
          ])}
        />,
      );

      expect(optionLabels("rule-criteria-operator-0")).toEqual([
        "Is in",
        "Is not in",
      ]);
      expect(screen.getByTestId("rule-criteria-value-0")).toHaveAttribute(
        "placeholder",
        "10.42.7.0/24",
      );
    });
  });

  describe("problems", () => {
    test("are not pointed out before the form asks for the conditions", () => {
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
          ])}
        />,
      );

      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("are said next to the condition they are about", () => {
      render(
        <Harness
          onChange={jest.fn()}
          error="Condition 1: Enter a value."
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
            filterOf("labels", RuleCriteriaOperator.HasAnyOf, []),
            filterOf("severity", RuleCriteriaOperator.Equals, "critical"),
          ])}
        />,
      );

      expect(
        within(screen.getByTestId("rule-criteria-row-0")).getByRole("alert"),
      ).toHaveTextContent("Enter a value.");
      expect(
        capturedEntityDropdowns["rule-criteria-value-1"]?.error,
      ).toBe("Choose at least one value.");
      expect(capturedDropdowns["rule-criteria-value-2"]?.error).toBeUndefined();
      // Said once, at the row: not again under the builder.
      expect(screen.queryByTestId("rule-criteria-error")).toBeNull();
    });

    test("a pattern that compiles to nothing is pointed out at its row", () => {
      render(
        <Harness
          onChange={jest.fn()}
          error="Condition 1: invalid"
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.MatchesPattern, "api-(01"),
          ])}
        />,
      );

      expect(
        within(screen.getByTestId("rule-criteria-row-0")).getByRole("alert"),
      ).toHaveTextContent(RuleCriteriaCopy.invalidPatternProblem);
    });

    test("a problem no row owns is said under the builder", () => {
      render(
        <Harness
          onChange={jest.fn()}
          requiresCondition={true}
          error="Add at least one condition."
        />,
      );

      expect(screen.getByTestId("rule-criteria-error")).toHaveTextContent(
        "Add at least one condition.",
      );
      expect(screen.getByTestId("rule-criteria-error")).toHaveAttribute(
        "role",
        "alert",
      );
    });

    test("a condition on a field the page no longer offers says so", () => {
      render(
        <Harness
          onChange={jest.fn()}
          initialValue={criteriaOf([
            filterOf("retiredField", RuleCriteriaOperator.Contains, "x"),
          ])}
        />,
      );

      expect(
        screen.getByTestId("rule-criteria-unavailable-0"),
      ).toHaveTextContent(RuleCriteriaCopy.fieldUnavailable);
      expect(capturedDropdowns["rule-criteria-operator-0"]?.disabled).toBe(
        true,
      );
      expect(
        capturedDropdowns["rule-criteria-field-0"]?.value,
      ).toBeUndefined();
    });
  });

  test("a disabled builder disables every control", () => {
    render(
      <Harness
        onChange={jest.fn()}
        disabled={true}
        initialValue={criteriaOf([
          filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
          filterOf("labels", RuleCriteriaOperator.HasAnyOf, ["label-search"]),
        ])}
      />,
    );

    expect(capturedDropdowns["rule-criteria-field-0"]?.disabled).toBe(true);
    expect(capturedDropdowns["rule-criteria-operator-0"]?.disabled).toBe(true);
    expect(capturedEntityDropdowns["rule-criteria-value-1"]?.disabled).toBe(
      true,
    );
    expect(screen.getByTestId("rule-criteria-add")).toBeDisabled();
    expect(screen.getByTestId("rule-criteria-delete-0")).toBeDisabled();
    expect(screen.getByTestId("rule-criteria-match-any")).toBeDisabled();
  });

  test("hydrates legacy values once but leaves stored criteria untouched", () => {
    const legacyOnChange: ReturnType<typeof jest.fn> = jest.fn();

    const { unmount } = render(
      <Harness
        onChange={legacyOnChange}
        legacyValues={{ labels: ["label-payments"], namePattern: "^api-" }}
      />,
    );

    // A legacy Pattern column keeps meaning a regex.
    expect(latestCriteria(legacyOnChange)).toEqual(
      criteriaOf([
        filterOf("namePattern", RuleCriteriaOperator.MatchesPattern, "^api-"),
        filterOf("labels", RuleCriteriaOperator.HasAnyOf, ["label-payments"]),
      ]),
    );

    unmount();

    const stored: RuleCriteria = criteriaOf([
      filterOf("namePattern", RuleCriteriaOperator.DoesNotMatchPattern, "staging-*"),
    ]);
    const storedOnChange: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <Harness
        onChange={storedOnChange}
        initialValue={stored}
        legacyValues={{ labels: ["label-payments"] }}
      />,
    );

    expect(storedOnChange).not.toHaveBeenCalled();
    expect(
      (
        capturedDropdowns["rule-criteria-operator-0"]
          ?.value as DropdownStubOption
      ).value,
    ).toBe(RuleCriteriaOperator.DoesNotMatchPattern);
  });

  test("does not offer a field while its showIf is false", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const conditionalFields: Array<Field<TestEntity>> = [
      {
        ...SEVERITY,
        title: "Hidden Severity",
        showIf: (): boolean => {
          return false;
        },
      },
      NAME,
    ];

    render(<Harness onChange={onChange} fields={conditionalFields} />);
    await user.click(screen.getByTestId("rule-criteria-add"));

    expect(latestCriteria(onChange).filters[0]?.field).toBe("namePattern");
    expect(optionLabels("rule-criteria-field-0")).toEqual(["Name"]);
  });

  test("keeps exporting the helpers other modules import from it", () => {
    expect(getRuleCriteriaFieldName(NAME)).toBe("namePattern");
    expect(getDefaultRuleCriteriaOperator(NAME)).toBe(
      RuleCriteriaOperator.Contains,
    );
    expect(getRuleCriteriaOperatorsForField(LABELS)).toContain(
      RuleCriteriaOperator.HasNoneOf,
    );
    expect(RULE_CRITERIA_OPERATOR_LABELS[RuleCriteriaOperator.HasAllOf]).toBe(
      "Has all of",
    );
    expect(
      convertLegacyValuesToRuleCriteria({
        fields: FIELDS,
        values: { severity: "critical" },
      }).filters,
    ).toEqual([filterOf("severity", RuleCriteriaOperator.Equals, "critical")]);
  });
});
