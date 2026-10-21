import FilterCondition from "../../../Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "../../../Types/Filter/FilterConditionUtil";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { WorkspaceNotificationRuleUtil } from "../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { Service as WorkspaceNotificationSummaryServiceClass } from "../../../Server/Services/WorkspaceNotificationSummaryService";
import { describe, expect, test } from "@jest/globals";

/*
 * Why a workspace notification rule - and a workspace summary - may stop
 * asking All or Any until it has two conditions, without changing what
 * fires.
 *
 * The rule's Conditions step (and the summary's Filters step) now shows
 * All / Any only from the second condition on, and a rule with fewer is
 * saved with the match condition it holds. That is safe only if, for every
 * condition the step lets through, one condition fires on the same events
 * under All as under Any. The matcher (WorkspaceNotificationRuleUtil) does
 * read the two differently for a condition left without an operator - it
 * skips it, and then All matches everything and Any nothing - but the step
 * refuses such a condition. This file proves both halves, for every check
 * every event offers, with every operator it offers, against matching and
 * non-matching values.
 */

type CheckOnValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

function valuesWith(
  checkOn: NotificationRuleConditionCheckOn,
  value: string | Array<string> | undefined,
): CheckOnValues {
  const values: Partial<CheckOnValues> = {};

  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    values[key] = undefined;
  }

  values[checkOn] = value;

  return values as CheckOnValues;
}

function rule(
  filters: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition | undefined,
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition: filterCondition,
    filters: filters,
  } as unknown as IncidentNotificationRule;
}

function matches(
  filters: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition | undefined,
  values: CheckOnValues,
): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule: rule(filters, filterCondition),
    values: values,
  });
}

// Values a condition is written with, and values an event can carry.
const SAMPLE_CONDITION_VALUES: Array<string | Array<string>> = [
  "database",
  "10",
  ["id-1"],
  ["id-1", "id-2"],
];

const SAMPLE_EVENT_VALUES: Array<string | Array<string> | undefined> = [
  "database down",
  "healthy",
  "10",
  "9",
  "",
  ["id-1"],
  ["id-2"],
  ["id-1", "id-2"],
  [],
  undefined,
];

const EVENT_TYPES: Array<NotificationRuleEventType> = Object.values(
  NotificationRuleEventType,
);

interface Case {
  eventType: NotificationRuleEventType;
  checkOn: NotificationRuleConditionCheckOn;
  conditionType: ConditionType;
}

// Every operator every event's every check offers in the Conditions step.
const CASES: Array<Case> = EVENT_TYPES.flatMap(
  (eventType: NotificationRuleEventType): Array<Case> => {
    return NotificationRuleConditionUtil.getCheckOnByEventType(
      eventType,
    ).flatMap((checkOn: NotificationRuleConditionCheckOn): Array<Case> => {
      return NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        checkOn,
      ).map((conditionType: ConditionType): Case => {
        return { eventType, checkOn, conditionType };
      });
    });
  },
);

describe("one condition the Conditions step lets through", () => {
  test("is offered for every event that has conditions", () => {
    expect(CASES.length).toBeGreaterThan(50);

    for (const eventType of EVENT_TYPES) {
      expect(
        CASES.some((entry: Case): boolean => {
          return entry.eventType === eventType;
        }),
      ).toBe(true);
    }
  });

  test.each(CASES)(
    "fires on the same events under All and Any: $eventType, $checkOn $conditionType",
    (entry: Case) => {
      for (const conditionValue of SAMPLE_CONDITION_VALUES) {
        const condition: NotificationRuleCondition = {
          checkOn: entry.checkOn,
          conditionType: entry.conditionType,
          value: conditionValue,
        };

        // The step would let it through: it is complete.
        expect(
          NotificationRuleConditionUtil.getConditionsValidationError({
            notificationRule: rule([condition], FilterCondition.All),
          }),
        ).toBeNull();

        for (const eventValue of SAMPLE_EVENT_VALUES) {
          const values: CheckOnValues = valuesWith(entry.checkOn, eventValue);

          expect({
            condition: condition,
            eventValue: eventValue,
            underAll: matches([condition], FilterCondition.All, values),
          }).toEqual({
            condition: condition,
            eventValue: eventValue,
            underAll: matches([condition], FilterCondition.Any, values),
          });
        }
      }
    },
  );

  test("is the only kind a rule can be saved with: the step asks All or Any from two", () => {
    const one: Array<NotificationRuleCondition> = [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
        value: "database",
      },
    ];

    expect(isFilterConditionNeeded([])).toBe(false);
    expect(isFilterConditionNeeded(one)).toBe(false);
    expect(isFilterConditionNeeded([...one, ...one])).toBe(true);
  });
});

describe("a condition left without an operator", () => {
  const withoutOperator: NotificationRuleCondition = {
    checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
    conditionType: undefined,
    value: "database",
  };

  test("is read differently under All and Any by the matcher", () => {
    const values: CheckOnValues = valuesWith(
      NotificationRuleConditionCheckOn.IncidentTitle,
      "database down",
    );

    // Skipped: All then matches everything, Any nothing.
    expect(matches([withoutOperator], FilterCondition.All, values)).toBe(true);
    expect(matches([withoutOperator], FilterCondition.Any, values)).toBe(false);
  });

  test("is refused by the Conditions step, so no saved rule depends on the choice it hides", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: rule([withoutOperator], FilterCondition.All),
      }),
    ).toBe("Filter Condition is required for Incident Title");
  });
});

describe("a rule's stored match condition", () => {
  const condition: NotificationRuleCondition = {
    checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
    conditionType: ConditionType.Contains,
    value: "database",
  };
  const values: CheckOnValues = valuesWith(
    NotificationRuleConditionCheckOn.IncidentTitle,
    "database down",
  );

  test("must be there: a rule with conditions and none never fires", () => {
    /*
     * Why a hidden choice keeps the value the rule holds (All for a new
     * rule) and saves it, rather than leaving it out.
     */
    expect(matches([condition], undefined, values)).toBe(false);
    expect(matches([condition], FilterCondition.All, values)).toBe(true);
    expect(matches([condition], FilterCondition.Any, values)).toBe(true);
  });

  test("does not matter without conditions: such a rule fires for every event", () => {
    for (const filterCondition of [
      FilterCondition.All,
      FilterCondition.Any,
      undefined,
    ]) {
      expect(matches([], filterCondition, values)).toBe(true);
    }
  });
});

describe("a workspace summary's filters", () => {
  type MatchesFilters = (data: {
    filters: Array<NotificationRuleCondition> | undefined;
    filterCondition: FilterCondition | undefined;
    values: CheckOnValues;
  }) => boolean;

  const matchesFilters: MatchesFilters = (
    WorkspaceNotificationSummaryServiceClass as unknown as {
      matchesFilters: MatchesFilters;
    }
  ).matchesFilters;

  const condition: NotificationRuleCondition = {
    checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
    conditionType: ConditionType.Contains,
    value: "database",
  };

  test("with one complete condition include the same items under All and Any", () => {
    for (const eventValue of SAMPLE_EVENT_VALUES) {
      const values: CheckOnValues = valuesWith(
        NotificationRuleConditionCheckOn.IncidentTitle,
        eventValue,
      );

      expect(
        matchesFilters({
          filters: [condition],
          filterCondition: FilterCondition.All,
          values: values,
        }),
      ).toBe(
        matchesFilters({
          filters: [condition],
          filterCondition: FilterCondition.Any,
          values: values,
        }),
      );
    }
  });

  test("saved without a match condition are read as Any, as they always were", () => {
    const twoConditions: Array<NotificationRuleCondition> = [
      condition,
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
        value: "cache",
      },
    ];
    const values: CheckOnValues = valuesWith(
      NotificationRuleConditionCheckOn.IncidentTitle,
      "database down",
    );

    // One of the two matches: Any includes it, All would not.
    expect(
      matchesFilters({
        filters: twoConditions,
        filterCondition: undefined,
        values: values,
      }),
    ).toBe(true);
    expect(
      matchesFilters({
        filters: twoConditions,
        filterCondition: FilterCondition.All,
        values: values,
      }),
    ).toBe(false);
  });
});
