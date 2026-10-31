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
import { RuleCriteriaSubject } from "../../../../Types/Rules/RuleCriteriaSubject";
import RuleCriteriaBuilder, {
  convertLegacyValuesToRuleCriteria,
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaFieldName,
  getRuleCriteriaOperatorsForField,
  RULE_CRITERIA_OPERATOR_LABELS,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";
import { RuleCriteriaCopy } from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";
import {
  RULE_CRITERIA_ANY_SUBJECT_COPY,
  RULE_CRITERIA_SUBJECT_COPY,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";

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
  placeholder: "Select Labels",
};

const MONITOR_LABELS: Field<TestEntity> = {
  field: { monitorLabels: true },
  title: "Monitor Labels",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
  dropdownOptions: LABEL_OPTIONS,
  placeholder: "Select Monitor Labels",
};

const MONITORS: Field<TestEntity> = {
  field: { monitors: true },
  title: "Monitors",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Monitor, labelField: "name", valueField: "_id" },
  dropdownOptions: MONITOR_OPTIONS,
  placeholder: "Select Monitors",
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
  subject?: RuleCriteriaSubject | undefined;
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
      subject={props.subject}
      onChange={(value: RuleCriteria): void => {
        props.onChange(value);
        setCriteria(value);
      }}
    />
  );
};

const INCIDENTS: { all: string; matching: string } =
  RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.Incidents];

function allAnswer(): HTMLElement {
  return screen.getByTestId("rule-criteria-applies-to-all");
}

function conditionsAnswer(): HTMLElement {
  return screen.getByTestId("rule-criteria-applies-to-matching");
}

// "Only ... that match conditions": the conditions open with one to fill in.
async function chooseConditions(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(conditionsAnswer());
}

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

  /*
   * "We have customers who think they need to add at least one condition,
   * but the idea is that if they don't add any condition, it matches all the
   * incidents. ... We'd probably show two options: all incidents or
   * conditions, and when we click on conditions, we show the conditions
   * panel."
   */
  describe("what the rule applies to: all of its records, or those its conditions match", () => {
    test("a new rule starts on 'All', with no condition on screen and nothing to fix", () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      render(
        <Harness onChange={onChange} subject={RuleCriteriaSubject.Incidents} />,
      );

      // Stored as before: no conditions, combined with All.
      expect(latestCriteria(onChange)).toEqual(criteriaOf([]));

      expect(allAnswer()).toBeChecked();
      expect(conditionsAnswer()).not.toBeChecked();
      expect(screen.getByRole("radio", { name: INCIDENTS.all })).toBe(
        allAnswer(),
      );
      expect(screen.getByRole("radio", { name: INCIDENTS.matching })).toBe(
        conditionsAnswer(),
      );

      // No condition waits to be filled in, so nothing can be red.
      expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
      expect(screen.queryByTestId("rule-criteria-add")).toBeNull();
      expect(screen.queryByTestId("rule-criteria-conditions")).toBeNull();
      expect(screen.queryByTestId("rule-criteria-empty")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        screen.queryByText(RuleCriteriaCopy.chooseAtLeastOneValueProblem),
      ).toBeNull();
    });

    test("REGRESSION: the step does not open on an empty condition to be marked 'Choose at least one value.'", () => {
      /*
       * The maintainer's screenshot: Match Criteria showed an "If
       * [Monitors] [Has any of] [Select one or more]" row, red with
       * "Choose at least one value.", on a rule that needs no condition at
       * all. A new rule shows no condition, so there is none to be wrong
       * about; the form-level twin (IncidentRuleConditions) walks past the
       * step with Next.
       */
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      render(
        <Harness
          onChange={onChange}
          subject={RuleCriteriaSubject.Incidents}
          fields={[MONITORS, LABELS]}
        />,
      );

      expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
      expect(capturedEntityDropdowns["rule-criteria-value-0"]).toBeUndefined();
      expect(allAnswer()).toBeChecked();
      // What it holds is a rule the form accepts: no conditions at all.
      expect(latestCriteria(onChange).filters).toEqual([]);
    });

    test("the choice is one radio group named 'Applies to', and never '(Optional)'", () => {
      render(<Harness onChange={jest.fn()} />);

      const group: HTMLElement = screen.getByRole("radiogroup", {
        name: RuleCriteriaCopy.appliesToTitle,
      });
      expect(within(group).getAllByRole("radio")).toEqual([
        allAnswer(),
        conditionsAnswer(),
      ]);
      expect(allAnswer().getAttribute("name")).toBeTruthy();
      expect(allAnswer().getAttribute("name")).toBe(
        conditionsAnswer().getAttribute("name"),
      );
      expect(
        screen.getByTestId("rule-criteria-applies-to"),
      ).not.toHaveTextContent("(Optional)");
    });

    test("names the records of the rule's kind, or says 'Everything' without one", () => {
      const { unmount } = render(
        <Harness onChange={jest.fn()} subject={RuleCriteriaSubject.Hosts} />,
      );

      expect(screen.getByTestId("rule-criteria-applies-to")).toHaveTextContent(
        "All hosts",
      );
      expect(screen.getByTestId("rule-criteria-applies-to")).toHaveTextContent(
        "Only hosts that match conditions",
      );
      unmount();

      render(<Harness onChange={jest.fn()} />);
      expect(
        screen.getByRole("radio", { name: RULE_CRITERIA_ANY_SUBJECT_COPY.all }),
      ).toBeChecked();
      expect(
        screen.getByRole("radio", {
          name: RULE_CRITERIA_ANY_SUBJECT_COPY.matching,
        }),
      ).not.toBeChecked();
    });

    test("'Only ... that match conditions' opens the conditions with one ready to fill in", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          subject={RuleCriteriaSubject.Incidents}
          fields={[MONITORS, NAME, LABELS]}
        />,
      );

      await chooseConditions(user);

      expect(conditionsAnswer()).toBeChecked();
      expect(allAnswer()).not.toBeChecked();
      // The first field the page offers, on its first operator.
      expect(latestCriteria(onChange)).toEqual(
        criteriaOf([filterOf("monitors", RuleCriteriaOperator.HasAnyOf, [])]),
      );
      const panel: HTMLElement = screen.getByTestId(
        "rule-criteria-applies-to-conditions",
      );
      expect(
        within(panel).getByTestId("rule-criteria-row-0"),
      ).toHaveTextContent(RuleCriteriaCopy.ifConnector);
      expect(within(panel).getByTestId("rule-criteria-add")).toBeEnabled();
      // Not pointed out until the form asks for the conditions.
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("a rule saved with conditions opens on 'Only ...', its conditions shown", () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      render(
        <Harness
          onChange={onChange}
          subject={RuleCriteriaSubject.Incidents}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "db"),
          ])}
        />,
      );

      expect(conditionsAnswer()).toBeChecked();
      expect(screen.getByTestId("rule-criteria-row-0")).toBeInTheDocument();
      // Opening it changes nothing.
      expect(onChange).not.toHaveBeenCalled();
    });

    test("a rule saved with no conditions opens on 'All'", () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf([], FilterCondition.Any)}
        />,
      );

      expect(allAnswer()).toBeChecked();
      expect(onChange).not.toHaveBeenCalled();
    });

    test("a rule saved before conditions existed opens on 'Only ...' with its old columns", () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      render(
        <Harness onChange={onChange} legacyValues={{ namePattern: "^api-" }} />,
      );

      expect(conditionsAnswer()).toBeChecked();
      expect(latestCriteria(onChange).filters).toEqual([
        filterOf("namePattern", RuleCriteriaOperator.MatchesPattern, "^api-"),
      ]);
    });

    test("going back to 'All' takes the conditions out of the rule", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf(
            [
              filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
              filterOf("labels", RuleCriteriaOperator.HasAnyOf, [
                "label-search",
              ]),
            ],
            FilterCondition.Any,
          )}
        />,
      );

      await user.click(allAnswer());

      expect(allAnswer()).toBeChecked();
      expect(latestCriteria(onChange).filters).toEqual([]);
      // How they were combined is kept, as removing them by hand keeps it.
      expect(latestCriteria(onChange).filterCondition).toBe(
        FilterCondition.Any,
      );
      expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
      expect(screen.queryByTestId("rule-criteria-combine")).toBeNull();
    });

    test("and 'Only ...' again puts them back as they were: a slip loses nothing", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const conditions: Array<RuleCriteriaFilter> = [
        filterOf("namePattern", RuleCriteriaOperator.EndsWith, "-prod"),
        filterOf("labels", RuleCriteriaOperator.HasNoneOf, ["label-search"]),
      ];
      render(
        <Harness
          onChange={onChange}
          initialValue={criteriaOf(conditions, FilterCondition.Any)}
        />,
      );

      await user.click(allAnswer());
      await chooseConditions(user);

      expect(conditionsAnswer()).toBeChecked();
      expect(latestCriteria(onChange)).toEqual(
        criteriaOf(conditions, FilterCondition.Any),
      );
      expect(screen.getByTestId("rule-criteria-row-1")).toBeInTheDocument();

      // Once back, they are no longer set aside: "All" and "Only" again.
      await user.click(allAnswer());
      await chooseConditions(user);
      expect(latestCriteria(onChange).filters).toEqual(conditions);
    });

    test("removing the last condition is going back to 'All'", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(<Harness onChange={onChange} />);

      await chooseConditions(user);
      await user.type(screen.getByTestId("rule-criteria-value-0"), "gateway");
      await user.click(
        screen.getByRole("button", { name: "Remove condition 1" }),
      );

      expect(allAnswer()).toBeChecked();
      expect(latestCriteria(onChange).filters).toEqual([]);
      /*
       * The remove button went with the conditions, and the focus with it:
       * it is on the answer now picked, not lost to the page.
       */
      expect(allAnswer()).toHaveFocus();

      // A condition removed on purpose is not brought back.
      await chooseConditions(user);
      expect(latestCriteria(onChange).filters).toEqual([
        filterOf("namePattern", RuleCriteriaOperator.Contains, ""),
      ]);
    });

    test("picking the answer already picked changes nothing", async () => {
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

      await chooseConditions(user);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getAllByTestId(/^rule-criteria-row-/)).toHaveLength(1);
    });

    test("with nothing the conditions could be about, 'Only ...' cannot be picked", () => {
      render(<Harness onChange={jest.fn()} fields={[]} />);

      expect(conditionsAnswer()).toBeDisabled();
      expect(allAnswer()).toBeEnabled();
      expect(allAnswer()).toBeChecked();
    });

    test("a disabled builder disables both answers", () => {
      render(<Harness onChange={jest.fn()} disabled={true} />);

      expect(allAnswer()).toBeDisabled();
      expect(conditionsAnswer()).toBeDisabled();
    });

    test("two builders on one page are two radio groups", () => {
      render(
        <div>
          <Harness onChange={jest.fn()} />
          <Harness onChange={jest.fn()} />
        </div>,
      );

      const names: Array<string | null> = screen
        .getAllByTestId("rule-criteria-applies-to-all")
        .map((input: HTMLElement): string | null => {
          return input.getAttribute("name");
        });

      expect(names[0]).not.toBe(names[1]);
    });
  });

  describe("a rule kind that needs a condition", () => {
    test("has no 'All' to offer: the conditions alone, asking for one", () => {
      render(
        <Harness
          onChange={jest.fn()}
          requiresCondition={true}
          subject={RuleCriteriaSubject.Monitors}
        />,
      );

      expect(screen.queryByTestId("rule-criteria-applies-to")).toBeNull();
      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(screen.queryByText("All monitors")).toBeNull();

      const empty: HTMLElement = screen.getByTestId("rule-criteria-empty");
      expect(empty).toHaveTextContent(RuleCriteriaCopy.emptyTitle);
      expect(
        screen.getByTestId("rule-criteria-empty-description"),
      ).toHaveTextContent(RuleCriteriaCopy.emptyNeedsCondition);
      expect(
        within(empty).getByRole("button", { name: "Add condition" }),
      ).toBeEnabled();
    });

    test("cannot add a condition when the page offers no field", () => {
      render(
        <Harness onChange={jest.fn()} fields={[]} requiresCondition={true} />,
      );

      expect(screen.getByTestId("rule-criteria-add")).toBeDisabled();
    });

    test("shows its conditions as every rule does once it has some", () => {
      render(
        <Harness
          onChange={jest.fn()}
          requiresCondition={true}
          initialValue={criteriaOf([
            filterOf("namePattern", RuleCriteriaOperator.Contains, "api"),
          ])}
        />,
      );

      expect(screen.getByTestId("rule-criteria-conditions")).toBeVisible();
      expect(screen.getByTestId("rule-criteria-row-0")).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });
  });

  describe("adding and removing conditions", () => {
    test("the first condition starts on the first field, text on Contains", async () => {
      const onChange: ReturnType<typeof jest.fn> = jest.fn();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      render(<Harness onChange={onChange} />);

      await chooseConditions(user);

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

      await chooseConditions(user);
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
      // No conditions left: the rule applies to all of its records again.
      expect(allAnswer()).toBeChecked();
      expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
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
        screen.getByRole("button", {
          name: "Criteria for condition 1: Labels",
        }),
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
      expect(input).toHaveAttribute(
        "placeholder",
        RuleCriteriaCopy.enterANumber,
      );

      await user.clear(input);
      await user.type(input, "443");
      expect(latestCriteria(onChange).filters[0]?.value).toBe(443);
    });
  });

  describe("value placeholders", () => {
    test("a list asks to select one or more, not the page's own prompt", () => {
      // The page asks "Select Labels" where its form draws the field itself.
      expect(LABELS.placeholder).toBe("Select Labels");

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
      expect(capturedEntityDropdowns["rule-criteria-value-1"]?.error).toBe(
        "Choose at least one value.",
      );
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
            filterOf(
              "namePattern",
              RuleCriteriaOperator.MatchesPattern,
              "api-(01",
            ),
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
      expect(capturedDropdowns["rule-criteria-field-0"]?.value).toBeUndefined();
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
    expect(allAnswer()).toBeDisabled();
    expect(conditionsAnswer()).toBeDisabled();
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
      filterOf(
        "namePattern",
        RuleCriteriaOperator.DoesNotMatchPattern,
        "staging-*",
      ),
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
    await chooseConditions(user);

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
