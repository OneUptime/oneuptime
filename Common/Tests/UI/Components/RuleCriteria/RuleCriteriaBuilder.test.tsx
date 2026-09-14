import { cleanup, render, screen } from "@testing-library/react";
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
  onChange?:
    | ((value: string | number | boolean | Array<string> | null) => void)
    | undefined;
  options: Array<DropdownStubOption | DropdownStubOptionGroup>;
  value?: DropdownStubOption | Array<DropdownStubOption> | undefined;
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

jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: DropdownStubProps): ReactElement => {
      const testId: string = props.dataTestId || "dropdown";
      capturedDropdowns[testId] = props;

      return (
        <div data-testid={`stub-${testId}`}>
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
        </div>
      );
    },
  };
});

jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (
      props: DropdownStubProps & {
        options?: Array<DropdownStubOption | DropdownStubOptionGroup>;
      },
    ): ReactElement => {
      const testId: string = props.dataTestId || "entity-dropdown";
      capturedEntityDropdowns[testId] = {
        ...props,
        options: props.options || [],
      };

      return (
        <div data-testid={`stub-entity-${testId}`}>
          {flattenStubOptions(props.options || []).map(
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
        </div>
      );
    },
  };
});

import Label from "../../../../Models/DatabaseModels/Label";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaBuilder, {
  convertLegacyValuesToRuleCriteria,
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaOperatorsForField,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";

type TestEntity = {
  labels?: Array<string>;
  namePattern?: string;
  severity?: string;
};

const LABEL_OPTIONS: Array<DropdownOption> = [
  { label: "Payments", value: "label-payments" },
  { label: "Search", value: "label-search" },
];

const FIELDS: Array<Field<TestEntity>> = [
  {
    field: { namePattern: true },
    title: "Name Pattern",
    fieldType: FormFieldSchemaType.Text,
    placeholder: "api-*",
  },
  {
    field: { labels: true },
    title: "Labels",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Label,
      labelField: "name",
      valueField: "_id",
    },
    dropdownOptions: LABEL_OPTIONS,
  },
  {
    field: { severity: true },
    title: "Severity",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: [
      { label: "Critical", value: "critical" },
      { label: "Warning", value: "warning" },
    ],
  },
];

interface HarnessProps {
  initialValue?: RuleCriteria | undefined;
  legacyValues?: Record<string, unknown> | undefined;
  onChange: ReturnType<typeof jest.fn>;
  fields?: Array<Field<TestEntity>> | undefined;
  error?: string | undefined;
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

function criteriaWith(
  field: string,
  operator: RuleCriteriaOperator,
  value: string | Array<string>,
): RuleCriteria {
  return {
    schemaVersion: 1,
    filterCondition: FilterCondition.All,
    filters: [{ field: field, operator: operator, value: value }],
  };
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

  test("explains an empty rule and adds and removes a condition", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(<Harness onChange={onChange} />);

    expect(latestCriteria(onChange)).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
    });
    expect(screen.getByTestId("rule-criteria-empty").textContent).toContain(
      "No conditions",
    );

    await user.click(screen.getByTestId("rule-criteria-add"));

    expect(latestCriteria(onChange).filters).toEqual([
      {
        field: "namePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "",
      },
    ]);
    expect(screen.getByTestId("rule-criteria-row-0")).not.toBeNull();

    await user.click(screen.getByTestId("rule-criteria-delete-0"));

    expect(latestCriteria(onChange).filters).toEqual([]);
    expect(screen.getByTestId("rule-criteria-empty")).not.toBeNull();
  });

  test("switches the global connector between match-all and match-any", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(
      <Harness
        onChange={onChange}
        initialValue={criteriaWith(
          "namePattern",
          RuleCriteriaOperator.MatchesPattern,
          "api-*",
        )}
      />,
    );

    await user.click(screen.getByTestId("rule-criteria-match-any"));
    expect(latestCriteria(onChange).filterCondition).toBe(FilterCondition.Any);

    await user.click(screen.getByTestId("rule-criteria-match-all"));
    expect(latestCriteria(onChange).filterCondition).toBe(FilterCondition.All);
  });

  test("offers text operators and stores text edits", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(
      <Harness
        onChange={onChange}
        initialValue={criteriaWith(
          "namePattern",
          RuleCriteriaOperator.MatchesPattern,
          "",
        )}
      />,
    );

    expect(getRuleCriteriaOperatorsForField(FIELDS[0]!)).toContain(
      RuleCriteriaOperator.Contains,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Operator for condition 1: Contains",
      }),
    );
    await user.type(screen.getByTestId("rule-criteria-value-0"), "gateway");

    expect(latestCriteria(onChange).filters[0]).toEqual({
      field: "namePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "gateway",
    });
  });

  test("uses EntityDropdown for relations and stores selected ids", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(
      <Harness
        onChange={onChange}
        initialValue={criteriaWith("labels", RuleCriteriaOperator.HasAnyOf, [])}
      />,
    );

    expect(capturedEntityDropdowns["rule-criteria-value-0"]).toBeDefined();
    expect(capturedDropdowns["rule-criteria-value-0"]).toBeUndefined();

    await user.click(
      screen.getByRole("button", {
        name: "Value for condition 1: Payments",
      }),
    );

    expect(latestCriteria(onChange).filters[0]).toEqual({
      field: "labels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ["label-payments"],
    });
  });

  test("uses a static dropdown for enumerated values", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    render(
      <Harness
        onChange={onChange}
        initialValue={criteriaWith(
          "severity",
          RuleCriteriaOperator.Equals,
          "warning",
        )}
      />,
    );

    expect(capturedDropdowns["rule-criteria-value-0"]).toBeDefined();
    expect(capturedEntityDropdowns["rule-criteria-value-0"]).toBeUndefined();

    await user.click(
      screen.getByRole("button", {
        name: "Value for condition 1: Critical",
      }),
    );

    expect(latestCriteria(onChange).filters[0]?.value).toBe("critical");
  });

  test("converts legacy multi-select and pattern fields with match-all semantics", () => {
    const criteria: RuleCriteria = convertLegacyValuesToRuleCriteria({
      fields: FIELDS,
      values: {
        labels: [
          { value: "label-payments" },
          {
            _id: {
              toString: () => {
                return "label-search";
              },
            },
          },
        ],
        namePattern: "^api-",
      },
    });

    expect(criteria.filterCondition).toBe(FilterCondition.All);
    expect(criteria.filters).toEqual([
      {
        field: "namePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "^api-",
      },
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ["label-payments", "label-search"],
      },
    ]);
  });

  test("hydrates legacy values once but leaves existing criteria untouched", () => {
    const legacyOnChange: ReturnType<typeof jest.fn> = jest.fn();

    const { unmount } = render(
      <Harness
        onChange={legacyOnChange}
        legacyValues={{ labels: ["label-payments"] }}
      />,
    );

    expect(latestCriteria(legacyOnChange)).toEqual(
      criteriaWith("labels", RuleCriteriaOperator.HasAnyOf, ["label-payments"]),
    );

    unmount();

    const stored: RuleCriteria = criteriaWith(
      "namePattern",
      RuleCriteriaOperator.DoesNotMatchPattern,
      "staging-*",
    );
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

  test("limits discovery patterns to their domain-aware pattern operators", () => {
    const ipField: Field<TestEntity> = {
      overrideFieldKey: "ipMatchTarget",
      title: "IP Address or CIDR",
      fieldType: FormFieldSchemaType.Text,
    };

    expect(getRuleCriteriaOperatorsForField(ipField)).toEqual([
      RuleCriteriaOperator.MatchesPattern,
      RuleCriteriaOperator.DoesNotMatchPattern,
    ]);
    expect(getDefaultRuleCriteriaOperator(ipField)).toBe(
      RuleCriteriaOperator.MatchesPattern,
    );
  });

  test("does not offer a conditional field while its showIf is false", async () => {
    const onChange: ReturnType<typeof jest.fn> = jest.fn();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const conditionalFields: Array<Field<TestEntity>> = [
      {
        field: { severity: true },
        title: "Hidden Severity",
        fieldType: FormFieldSchemaType.Dropdown,
        showIf: (): boolean => {
          return false;
        },
      },
      FIELDS[0]!,
    ];

    render(<Harness onChange={onChange} fields={conditionalFields} />);
    await user.click(screen.getByTestId("rule-criteria-add"));

    expect(latestCriteria(onChange).filters[0]?.field).toBe("namePattern");
    expect(capturedDropdowns["rule-criteria-field-0"]?.options).toEqual([
      { label: "Name Pattern", value: "namePattern" },
    ]);
  });

  test("renders form validation errors next to the builder", () => {
    render(
      <Harness
        onChange={jest.fn()}
        error="A condition value cannot be blank."
      />,
    );

    expect(screen.getByTestId("rule-criteria-error").textContent).toContain(
      "cannot be blank",
    );
  });
});
