import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * AN ALERT ON-CALL RULE'S "ALERT OWNER" CONDITION, IN THE CONDITIONS
 * BUILDER, ITS SUMMARY AND WHAT THE FORM SENDS (#9353).
 *
 *   If  [Alert Owner v]  [Is any of v]  (+ Add owner) (Platform) (Jane)
 *                                       Matches the people and teams added
 *                                       as owners. Team membership does not
 *                                       count.
 *
 * The value is people and teams, picked as owners are (the people picker,
 * stubbed here to show what it is handed), held in the rule's criteria as
 * one list of ids. The teams among them are looked up so the picker shows
 * them as teams. "Is any of" / "Is none of" are its only operators. The
 * rule's card counts the picks. No column holds the condition, so the form
 * sends nothing for it outside the criteria.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

interface PickerStubProps {
  kinds: Array<string>;
  value: Record<string, Array<string>>;
  onChange: (value: Record<string, Array<string>>) => void;
  addButtonText?: string | undefined;
  unknownName?: string | undefined;
  ariaDescribedby?: string | undefined;
  dataTestId?: string | undefined;
}

const pickers: Array<PickerStubProps> = [];

jest.mock("../../../../UI/Components/PeoplePicker/LazyPeoplePicker", () => {
  return {
    __esModule: true,
    default: (props: PickerStubProps): ReactElement => {
      pickers.push(props);

      return (
        <div data-testid={props.dataTestId}>
          <span data-testid="picked-users">
            {(props.value["user"] || []).join(",")}
          </span>
          <span data-testid="picked-teams">
            {(props.value["team"] || []).join(",")}
          </span>
          <button
            type="button"
            onClick={(): void => {
              props.onChange({
                user: [...(props.value["user"] || []), OMAR],
                team: [...(props.value["team"] || []), DATABASE_TEAM],
              });
            }}
          >
            {props.addButtonText}
          </button>
        </div>
      );
    },
  };
});

import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import Includes from "../../../../Types/BaseDatabase/Includes";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleCriteriaBuilder from "../../../../UI/Components/RuleCriteria/RuleCriteriaBuilder";
import {
  changeRuleCriteriaFilterField,
  createRuleCriteriaFilter,
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaOperatorLabel,
  getRuleCriteriaOperatorsForField,
  getRuleCriteriaFilterProblem,
  isRuleCriteriaOwnerField,
  RuleCriteriaCopy,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";
import { applyRuleCriteriaLegacySafetyShadow } from "../../../../UI/Components/RuleCriteria/RuleCriteriaLegacyFields";
import {
  getRuleCriteriaOwnerIds,
  getRuleCriteriaOwnerPickerValue,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaOwnersValue";
import { getRuleCriteriaSummaryText } from "../../../../UI/Components/RuleCriteria/RuleCriteriaSummary";
import { PeoplePickerKind } from "../../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import {
  getAlertOwnerConditionField,
  OWNER_CONDITION_HINT,
} from "../../../../../App/FeatureSet/Dashboard/src/Utils/Form/EventRuleForm";

const JANE: string = "93530000-0000-4000-8000-0000000000a1";
const OMAR: string = "93530000-0000-4000-8000-0000000000a2";
const PLATFORM_TEAM: string = "93530000-0000-4000-8000-0000000000b1";
const DATABASE_TEAM: string = "93530000-0000-4000-8000-0000000000b2";

const OWNER_FIELD: Field<AlertOnCallRule> =
  getAlertOwnerConditionField<AlertOnCallRule>();

const MONITOR_LABELS: Field<AlertOnCallRule> = {
  field: { monitorLabels: true },
  title: "Monitor Labels",
  stepId: "match-criteria",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
};

const TITLE: Field<AlertOnCallRule> = {
  field: { alertTitlePattern: true },
  title: "Alert Title",
  stepId: "match-criteria",
  fieldType: FormFieldSchemaType.Text,
};

const FIELDS: Array<Field<AlertOnCallRule>> = [
  MONITOR_LABELS,
  OWNER_FIELD,
  TITLE,
];

function ownerFilter(
  ids: Array<string>,
  operator: RuleCriteriaOperator = RuleCriteriaOperator.HasAnyOf,
): RuleCriteriaFilter {
  return { field: "alertOwners", operator: operator, value: ids };
}

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function ruleWith(value: RuleCriteria): AlertOnCallRule {
  const rule: AlertOnCallRule = new AlertOnCallRule();
  rule.criteria = value;
  return rule;
}

// The project's teams: Platform and Database. Anyone else is a person.
function serveTeams(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    const asked: Array<string> =
      request.query?._id instanceof Includes
        ? (request.query._id.values as Array<string>)
        : [];
    const rows: Array<{ _id: string }> = [PLATFORM_TEAM, DATABASE_TEAM]
      .filter((id: string): boolean => {
        return asked.includes(id);
      })
      .map((id: string): { _id: string } => {
        return { _id: id };
      });

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });
}

beforeEach(() => {
  pickers.length = 0;
  getListMock.mockReset();
  serveTeams();
});

afterEach(() => {
  cleanup();
});

describe("the Alert Owner field of an alert on-call rule", () => {
  test("names the criteria's key, no column, and is a people picker with its hint", () => {
    expect(OWNER_FIELD.overrideFieldKey).toBe("alertOwners");
    expect(OWNER_FIELD.field).toBeUndefined();
    expect(OWNER_FIELD.title).toBe("Alert Owner");
    expect(OWNER_FIELD.stepId).toBe("match-criteria");
    expect(OWNER_FIELD.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(OWNER_FIELD.description).toBe(OWNER_CONDITION_HINT);
    expect(isRuleCriteriaOwnerField(OWNER_FIELD)).toBe(true);
    expect(isRuleCriteriaOwnerField(MONITOR_LABELS)).toBe(false);
  });

  test("compares with Is any of or Is none of, starting on Is any of", () => {
    expect(getRuleCriteriaOperatorsForField(OWNER_FIELD)).toEqual([
      RuleCriteriaOperator.HasAnyOf,
      RuleCriteriaOperator.HasNoneOf,
    ]);
    expect(getDefaultRuleCriteriaOperator(OWNER_FIELD)).toBe(
      RuleCriteriaOperator.HasAnyOf,
    );
    expect(
      getRuleCriteriaOperatorLabel(OWNER_FIELD, RuleCriteriaOperator.HasAnyOf),
    ).toBe("Is any of");
    expect(
      getRuleCriteriaOperatorLabel(OWNER_FIELD, RuleCriteriaOperator.HasNoneOf),
    ).toBe("Is none of");
    // A list of labels still "has" its values.
    expect(
      getRuleCriteriaOperatorLabel(
        MONITOR_LABELS,
        RuleCriteriaOperator.HasAnyOf,
      ),
    ).toBe("Has any of");
  });

  test("a new condition picks nobody yet, and asks for someone before it is saved", () => {
    const filter: RuleCriteriaFilter | null =
      createRuleCriteriaFilter(OWNER_FIELD);

    expect(filter).toEqual(ownerFilter([]));
    expect(getRuleCriteriaFilterProblem(filter!, OWNER_FIELD)?.text).toBe(
      RuleCriteriaCopy.chooseAtLeastOneValueProblem,
    );
    expect(
      getRuleCriteriaFilterProblem(ownerFilter([JANE]), OWNER_FIELD),
    ).toBeNull();
  });

  test("labels picked for another field are not kept as owners", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [PLATFORM_TEAM],
        },
        fromField: MONITOR_LABELS,
        toField: OWNER_FIELD,
      }),
    ).toEqual(ownerFilter([]));
  });

  test("the picker's people and teams are one list of ids, people first", () => {
    const value: Record<
      string,
      Array<string>
    > = getRuleCriteriaOwnerPickerValue({
      ids: [PLATFORM_TEAM, JANE],
      teamIds: new Set([PLATFORM_TEAM]),
    }) as Record<string, Array<string>>;

    expect(value).toEqual({
      [PeoplePickerKind.User]: [JANE],
      [PeoplePickerKind.Team]: [PLATFORM_TEAM],
    });
    expect(getRuleCriteriaOwnerIds(value)).toEqual([JANE, PLATFORM_TEAM]);
  });
});

describe("an Alert Owner condition in the conditions builder", () => {
  const Harness: (props: {
    initial: RuleCriteria;
    onChange: (criteria: RuleCriteria) => void;
  }) => ReactElement = (props: {
    initial: RuleCriteria;
    onChange: (criteria: RuleCriteria) => void;
  }): ReactElement => {
    const [value, setValue] = useState<RuleCriteria>(props.initial);

    return (
      <RuleCriteriaBuilder<AlertOnCallRule>
        fields={FIELDS}
        value={value}
        subject={undefined}
        onChange={(next: RuleCriteria): void => {
          setValue(next);
          props.onChange(next);
        }}
      />
    );
  };

  test("shows the teams it names as teams and everyone else as people, with the owners' words", async () => {
    render(
      <Harness
        initial={criteria([ownerFilter([JANE, PLATFORM_TEAM])])}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("picked-teams")).toHaveTextContent(
        PLATFORM_TEAM,
      );
    });
    expect(screen.getByTestId("picked-users")).toHaveTextContent(JANE);

    // Only the ids the condition names are looked up, as teams.
    const request: any = getListMock.mock.calls[0]![0];
    expect(request.modelType.name).toBe("Team");
    expect((request.query._id as Includes).values).toEqual([
      JANE,
      PLATFORM_TEAM,
    ]);

    const picker: PickerStubProps = pickers[pickers.length - 1]!;
    expect(picker.kinds).toEqual([
      PeoplePickerKind.User,
      PeoplePickerKind.Team,
    ]);
    expect(picker.addButtonText).toBe("Add owner");
    // A person who left or a team since deleted, as a rule's card says it.
    expect(picker.unknownName).toBe(RuleCriteriaCopy.valueNotFound);
  });

  test("says under the picker who counts as an owner, and the picker is described by it", async () => {
    render(
      <Harness
        initial={criteria([ownerFilter([JANE])])}
        onChange={(): void => {}}
      />,
    );

    const hint: HTMLElement = await screen.findByTestId(
      "rule-criteria-value-hint-0",
    );

    expect(hint).toHaveTextContent(OWNER_CONDITION_HINT);
    await waitFor(() => {
      expect(pickers[pickers.length - 1]?.ariaDescribedby).toBe(hint.id);
    });
  });

  test("a pick is saved as the ids of the people, then the teams", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Harness
        initial={criteria([ownerFilter([JANE, PLATFORM_TEAM])])}
        onChange={(next: RuleCriteria): void => {
          onChange(next);
        }}
      />,
    );

    const add: HTMLElement = await screen.findByRole("button", {
      name: "Add owner",
    });

    await waitFor(() => {
      expect(screen.getByTestId("picked-teams")).toHaveTextContent(
        PLATFORM_TEAM,
      );
    });

    await act(async () => {
      add.click();
    });

    const last: RuleCriteria = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as RuleCriteria;

    expect(last.filters).toEqual([
      ownerFilter([JANE, OMAR, PLATFORM_TEAM, DATABASE_TEAM]),
    ]);
    // A team picked here is known as a team without asking again.
    expect(screen.getByTestId("picked-teams")).toHaveTextContent(
      `${PLATFORM_TEAM},${DATABASE_TEAM}`,
    );
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("teams that cannot be looked up still show every pick, as people", async () => {
    getListMock.mockImplementation(async (): Promise<never> => {
      throw new Error("The server could not be reached.");
    });

    render(
      <Harness
        initial={criteria([ownerFilter([JANE, PLATFORM_TEAM])])}
        onChange={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("picked-users")).toHaveTextContent(
        `${JANE},${PLATFORM_TEAM}`,
      );
    });
  });
});

describe("an Alert Owner condition on the rule's card", () => {
  test("counts the people and teams picked, in English", () => {
    expect(
      getRuleCriteriaSummaryText({
        fields: FIELDS,
        item: ruleWith(criteria([ownerFilter([JANE, PLATFORM_TEAM])])),
      }),
    ).toBe("Alert Owner is any of 2 selected people or teams");

    expect(
      getRuleCriteriaSummaryText({
        fields: FIELDS,
        item: ruleWith(
          criteria([ownerFilter([JANE], RuleCriteriaOperator.HasNoneOf)]),
        ),
      }),
    ).toBe("Alert Owner is none of 1 selected person or team");
  });

  test("combined with another condition", () => {
    expect(
      getRuleCriteriaSummaryText({
        fields: FIELDS,
        item: ruleWith(
          criteria([
            ownerFilter([PLATFORM_TEAM]),
            {
              field: "alertTitlePattern",
              operator: RuleCriteriaOperator.Contains,
              value: "database",
            },
          ]),
        ),
      }),
    ).toBe(
      "Match all: Alert Owner is any of 1 selected person or team; Alert Title contains “database”",
    );
  });

  test("reads in the reader's language", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const text: string = withoutIsolateMarks(
      getRuleCriteriaSummaryText(
        {
          fields: FIELDS,
          item: ruleWith(criteria([ownerFilter([JANE, PLATFORM_TEAM])])),
        },
        dashboardTranslator("de"),
      ),
    );

    expect(text).toBe(
      words["{{field}} is any of {{count}} selected people or teams"]!.replace(
        "{{field}}",
        words["Alert Owner"]!,
      ).replace("{{count}}", "2"),
    );
    expect(text).not.toContain("selected");
  });
});

describe("what the form sends for an Alert Owner condition", () => {
  test("the condition goes in the criteria alone: nothing is sent under its key", () => {
    const values: Record<string, unknown> = {
      criteria: criteria([ownerFilter([JANE])]),
      alertOwners: [JANE],
    };

    applyRuleCriteriaLegacySafetyShadow({
      model: new AlertOnCallRule(),
      fields: FIELDS,
      values: values,
    });

    expect(values).not.toHaveProperty("alertOwners");
    expect((values["criteria"] as RuleCriteria).filters).toEqual([
      ownerFilter([JANE]),
    ]);
    // The rule's own columns still carry what an older server reads.
    expect(values["monitorLabels"]).toEqual([]);
    expect(values["alertTitlePattern"]).toBe("(?!)");
  });
});
