import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { WorkspaceNotificationRuleUtil } from "../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { describe, expect, it } from "@jest/globals";

/*
 * WorkspaceNotificationRuleUtil.isRuleMatching decides whether an incident /
 * alert / monitor event should fire a workspace notification rule. Getting the
 * comparison semantics wrong here means a rule silently over- or under-fires
 * (a channel that never gets created, or one that gets created for every
 * event), so every condition operator and both filter-combining modes are
 * pinned down below.
 */

type CheckOnValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

// A rule with a single filter is the simplest way to exercise one operator.
function ruleWithFilters(
  filters: Array<{
    checkOn: NotificationRuleConditionCheckOn;
    conditionType: ConditionType | undefined;
    value: string | Array<string> | undefined;
  }>,
  filterCondition: FilterCondition = FilterCondition.All,
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition,
    filters,
    shouldCreateNewChannel: false,
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    inviteTeamsToNewChannel: [],
    inviteUsersToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    newChannelTemplateName: "",
    archiveChannelAutomatically: false,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
  } as IncidentNotificationRule;
}

/*
 * Only the checkOn keys referenced by a test need real values; fill the rest
 * with undefined so the typed record stays complete.
 */
function valuesFor(partial: Partial<CheckOnValues>): CheckOnValues {
  const base: Partial<CheckOnValues> = {};
  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    base[key] = undefined;
  }
  return { ...base, ...partial } as CheckOnValues;
}

function isMatching(
  filters: Array<{
    checkOn: NotificationRuleConditionCheckOn;
    conditionType: ConditionType | undefined;
    value: string | Array<string> | undefined;
  }>,
  values: Partial<CheckOnValues>,
  filterCondition: FilterCondition = FilterCondition.All,
): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule: ruleWithFilters(filters, filterCondition),
    values: valuesFor(values),
  });
}

describe("WorkspaceNotificationRuleUtil.isRuleMatching", () => {
  describe("empty / degenerate filter sets", () => {
    it("matches by default when there are no filters", () => {
      expect(isMatching([], {})).toBe(true);
    });

    it("skips a filter with no conditionType and matches (All) when it is the only filter", () => {
      /*
       * With no condition the filter is skipped; under All the loop then falls
       * through to the trailing 'return true'.
       */
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: undefined,
              value: "anything",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "anything" },
        ),
      ).toBe(true);
    });

    it("does not match (Any) when the only filter has no conditionType", () => {
      // Skipped filter never sets isMatched true, so Any falls through to false.
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: undefined,
              value: "anything",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "anything" },
          FilterCondition.Any,
        ),
      ).toBe(false);
    });
  });

  describe("undefined value or filter value never matches", () => {
    it("returns false when the event value is undefined", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EqualTo,
              value: "prod-down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: undefined },
        ),
      ).toBe(false);
    });

    it("returns false when the filter value is undefined", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EqualTo,
              value: undefined,
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(false);
    });
  });

  describe("EqualTo", () => {
    it("matches identical strings", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EqualTo,
              value: "prod-down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(true);
    });

    it("compares numerically when both sides are numeric strings", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EqualTo,
              value: "1.0",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "1" },
        ),
      ).toBe(true);
    });

    it("does not match different strings", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EqualTo,
              value: "prod-down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "staging-down" },
        ),
      ).toBe(false);
    });
  });

  describe("NotEqualTo", () => {
    it("matches when the strings differ", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.NotEqualTo,
              value: "prod-down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "staging-down" },
        ),
      ).toBe(true);
    });

    it("does not match when the strings are equal", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.NotEqualTo,
              value: "prod-down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(false);
    });

    it("matches an array event value that is not fully contained in the filter set", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
              conditionType: ConditionType.NotEqualTo,
              value: ["a", "b", "c"],
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentLabels]: ["a", "z"] },
        ),
      ).toBe(true);
    });
  });

  describe("numeric comparisons", () => {
    it("GreaterThan matches when value is larger", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.GreaterThan,
              value: "5",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "10" },
        ),
      ).toBe(true);
    });

    it("LessThan does not match when value is larger", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.LessThan,
              value: "5",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "10" },
        ),
      ).toBe(false);
    });

    it("GreaterThanOrEqualTo matches on equality", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.GreaterThanOrEqualTo,
              value: "5",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "5" },
        ),
      ).toBe(true);
    });

    it("LessThanOrEqualTo matches on equality", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.LessThanOrEqualTo,
              value: "5",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "5" },
        ),
      ).toBe(true);
    });
  });

  describe("string containment", () => {
    it("Contains matches a substring", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.Contains,
              value: "down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(true);
    });

    it("ContainsAny matches when any filter value is present", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
              conditionType: ConditionType.ContainsAny,
              value: ["urgent", "prod"],
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentLabels]: ["prod"] },
        ),
      ).toBe(true);
    });

    it("NotContains matches when the substring is absent", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.NotContains,
              value: "staging",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(true);
    });

    it("NotContains does not match when the substring is present", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.NotContains,
              value: "down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(false);
    });

    it("StartsWith matches a prefix", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.StartsWith,
              value: "prod",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(true);
    });

    it("EndsWith matches a suffix", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EndsWith,
              value: "down",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(true);
    });

    it("ContainsAll matches only when every filter value is present in some event value", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
              conditionType: ConditionType.ContainsAll,
              value: ["prod", "urgent"],
            },
          ],
          {
            [NotificationRuleConditionCheckOn.IncidentLabels]: [
              "prod",
              "urgent",
              "extra",
            ],
          },
        ),
      ).toBe(true);
    });

    it("ContainsAll does not match when one filter value is missing", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
              conditionType: ConditionType.ContainsAll,
              value: ["prod", "urgent"],
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentLabels]: ["prod"] },
        ),
      ).toBe(false);
    });
  });

  describe("emptiness and boolean conditions", () => {
    it("IsEmpty matches an empty array", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
              conditionType: ConditionType.IsEmpty,
              value: "unused",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentLabels]: [] },
        ),
      ).toBe(true);
    });

    it("IsNotEmpty matches a non-empty string", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.IsNotEmpty,
              value: "unused",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down" },
        ),
      ).toBe(true);
    });

    it("True matches the literal string 'true'", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.True,
              value: "unused",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "true" },
        ),
      ).toBe(true);
    });

    it("False matches the literal string 'false'", () => {
      expect(
        isMatching(
          [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.False,
              value: "unused",
            },
          ],
          { [NotificationRuleConditionCheckOn.IncidentTitle]: "false" },
        ),
      ).toBe(true);
    });
  });

  describe("filter combining (All vs Any)", () => {
    const twoFilters: Array<{
      checkOn: NotificationRuleConditionCheckOn;
      conditionType: ConditionType | undefined;
      value: string | Array<string> | undefined;
    }> = [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
        value: "down",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
        conditionType: ConditionType.EqualTo,
        value: "critical",
      },
    ];

    it("All requires every filter to match", () => {
      expect(
        isMatching(
          twoFilters,
          {
            [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down",
            [NotificationRuleConditionCheckOn.IncidentSeverity]: "critical",
          },
          FilterCondition.All,
        ),
      ).toBe(true);
    });

    it("All fails if any single filter does not match", () => {
      expect(
        isMatching(
          twoFilters,
          {
            [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down",
            [NotificationRuleConditionCheckOn.IncidentSeverity]: "low",
          },
          FilterCondition.All,
        ),
      ).toBe(false);
    });

    it("Any matches if a single filter matches", () => {
      expect(
        isMatching(
          twoFilters,
          {
            [NotificationRuleConditionCheckOn.IncidentTitle]: "prod-down",
            [NotificationRuleConditionCheckOn.IncidentSeverity]: "low",
          },
          FilterCondition.Any,
        ),
      ).toBe(true);
    });

    it("Any fails only when no filter matches", () => {
      expect(
        isMatching(
          twoFilters,
          {
            [NotificationRuleConditionCheckOn.IncidentTitle]: "healthy",
            [NotificationRuleConditionCheckOn.IncidentSeverity]: "low",
          },
          FilterCondition.Any,
        ),
      ).toBe(false);
    });
  });
});
