import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";

type RuleValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

// Build a minimal rule object; isRuleMatching only reads filters + filterCondition.
function rule(
  filterCondition: FilterCondition,
  filters: Array<NotificationRuleCondition>,
): IncidentNotificationRule {
  return {
    filterCondition,
    filters,
  } as unknown as IncidentNotificationRule;
}

// Convenience: a single-filter rule that always uses ALL so one filter decides.
function singleFilter(
  checkOn: NotificationRuleConditionCheckOn,
  conditionType: ConditionType | undefined,
  value: string | Array<string> | undefined,
): IncidentNotificationRule {
  return rule(FilterCondition.All, [{ checkOn, conditionType, value }]);
}

function matches(
  notificationRule: IncidentNotificationRule,
  values: Partial<RuleValues>,
): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule,
    values: values as RuleValues,
  });
}

const CHECK: NotificationRuleConditionCheckOn =
  NotificationRuleConditionCheckOn.IncidentTitle;
const SEV: NotificationRuleConditionCheckOn =
  NotificationRuleConditionCheckOn.IncidentSeverity;

describe("WorkspaceNotificationRuleUtil.isRuleMatching", () => {
  describe("filter list semantics", () => {
    test("matches by default when there are no filters", () => {
      expect(matches(rule(FilterCondition.All, []), {})).toBe(true);
      expect(matches(rule(FilterCondition.Any, []), {})).toBe(true);
    });

    test("skips filters that have no condition type", () => {
      // Only filter has no condition -> under ALL it is skipped, rule matches.
      const r: IncidentNotificationRule = singleFilter(
        CHECK,
        undefined,
        "anything",
      );
      expect(matches(r, { [CHECK]: "Down" })).toBe(true);
    });

    test("ALL requires every filter to match", () => {
      const r: IncidentNotificationRule = rule(FilterCondition.All, [
        { checkOn: CHECK, conditionType: ConditionType.EqualTo, value: "Down" },
        {
          checkOn: SEV,
          conditionType: ConditionType.EqualTo,
          value: "Critical",
        },
      ]);
      expect(matches(r, { [CHECK]: "Down", [SEV]: "Critical" })).toBe(true);
      expect(matches(r, { [CHECK]: "Down", [SEV]: "Low" })).toBe(false);
    });

    test("ANY matches when at least one filter matches", () => {
      const r: IncidentNotificationRule = rule(FilterCondition.Any, [
        { checkOn: CHECK, conditionType: ConditionType.EqualTo, value: "Down" },
        {
          checkOn: SEV,
          conditionType: ConditionType.EqualTo,
          value: "Critical",
        },
      ]);
      expect(matches(r, { [CHECK]: "Up", [SEV]: "Critical" })).toBe(true);
      expect(matches(r, { [CHECK]: "Up", [SEV]: "Low" })).toBe(false);
    });

    test("returns false for an unrecognized filter condition", () => {
      const r: IncidentNotificationRule = rule(
        "Nonsense" as unknown as FilterCondition,
        [{ checkOn: CHECK, conditionType: ConditionType.EqualTo, value: "x" }],
      );
      expect(matches(r, { [CHECK]: "x" })).toBe(false);
    });
  });

  describe("undefined handling", () => {
    test("does not match when the observed value is undefined", () => {
      const r: IncidentNotificationRule = singleFilter(
        CHECK,
        ConditionType.EqualTo,
        "Down",
      );
      expect(matches(r, {})).toBe(false);
    });

    test("does not match when the filter value is undefined", () => {
      const r: IncidentNotificationRule = singleFilter(
        CHECK,
        ConditionType.EqualTo,
        undefined,
      );
      expect(matches(r, { [CHECK]: "Down" })).toBe(false);
    });
  });

  describe("EqualTo / NotEqualTo", () => {
    test("compares numeric strings as numbers", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.EqualTo, "5.0"), {
          [CHECK]: "5",
        }),
      ).toBe(true);
    });

    test("compares non-numeric strings literally", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.EqualTo, "Down"), {
          [CHECK]: "Down",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.EqualTo, "Down"), {
          [CHECK]: "up",
        }),
      ).toBe(false);
    });

    test("NotEqualTo is the inverse for scalars", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.NotEqualTo, "Down"), {
          [CHECK]: "Up",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.NotEqualTo, "Down"), {
          [CHECK]: "Down",
        }),
      ).toBe(false);
    });
  });

  describe("numeric comparisons", () => {
    test("GreaterThan / LessThan", () => {
      expect(
        matches(singleFilter(SEV, ConditionType.GreaterThan, "3"), {
          [SEV]: "5",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(SEV, ConditionType.GreaterThan, "5"), {
          [SEV]: "5",
        }),
      ).toBe(false);
      expect(
        matches(singleFilter(SEV, ConditionType.LessThan, "5"), {
          [SEV]: "3",
        }),
      ).toBe(true);
    });

    test("GreaterThanOrEqualTo / LessThanOrEqualTo include equality", () => {
      expect(
        matches(singleFilter(SEV, ConditionType.GreaterThanOrEqualTo, "5"), {
          [SEV]: "5",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(SEV, ConditionType.LessThanOrEqualTo, "5"), {
          [SEV]: "5",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(SEV, ConditionType.LessThanOrEqualTo, "5"), {
          [SEV]: "6",
        }),
      ).toBe(false);
    });
  });

  describe("substring conditions", () => {
    test("Contains / ContainsAny", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.Contains, "base"), {
          [CHECK]: "database is down",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.Contains, "network"), {
          [CHECK]: "database is down",
        }),
      ).toBe(false);
    });

    test("NotContains", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.NotContains, "network"), {
          [CHECK]: "database is down",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.NotContains, "base"), {
          [CHECK]: "database is down",
        }),
      ).toBe(false);
    });

    test("StartsWith / EndsWith", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.StartsWith, "data"), {
          [CHECK]: "database down",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.EndsWith, "down"), {
          [CHECK]: "database down",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.EndsWith, "up"), {
          [CHECK]: "database down",
        }),
      ).toBe(false);
    });

    test("ContainsAll requires every filter value to be present somewhere", () => {
      const labels: NotificationRuleConditionCheckOn =
        NotificationRuleConditionCheckOn.IncidentLabels;
      expect(
        matches(
          singleFilter(labels, ConditionType.ContainsAll, ["prod", "db"]),
          { [labels]: ["prod-cluster", "db-primary"] },
        ),
      ).toBe(true);
      expect(
        matches(
          singleFilter(labels, ConditionType.ContainsAll, ["prod", "cache"]),
          { [labels]: ["prod-cluster", "db-primary"] },
        ),
      ).toBe(false);
    });
  });

  describe("emptiness and boolean conditions", () => {
    test("IsEmpty / IsNotEmpty for strings", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.IsEmpty, "ignored"), {
          [CHECK]: "",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.IsNotEmpty, "ignored"), {
          [CHECK]: "something",
        }),
      ).toBe(true);
    });

    test("IsEmpty / IsNotEmpty for arrays", () => {
      const labels: NotificationRuleConditionCheckOn =
        NotificationRuleConditionCheckOn.IncidentLabels;
      expect(
        matches(singleFilter(labels, ConditionType.IsEmpty, "ignored"), {
          [labels]: [],
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(labels, ConditionType.IsNotEmpty, "ignored"), {
          [labels]: ["prod"],
        }),
      ).toBe(true);
    });

    test("True / False match the literal string value", () => {
      expect(
        matches(singleFilter(CHECK, ConditionType.True, "ignored"), {
          [CHECK]: "true",
        }),
      ).toBe(true);
      expect(
        matches(singleFilter(CHECK, ConditionType.True, "ignored"), {
          [CHECK]: "false",
        }),
      ).toBe(false);
      expect(
        matches(singleFilter(CHECK, ConditionType.False, "ignored"), {
          [CHECK]: "false",
        }),
      ).toBe(true);
    });
  });
});
