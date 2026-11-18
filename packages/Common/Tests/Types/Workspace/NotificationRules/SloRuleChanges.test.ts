import FilterCondition from "../../../../Types/Filter/FilterCondition";
import SloErrorBudgetPolicyChange from "../../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import SloStatusChange from "../../../../Types/ServiceLevelObjective/SloStatusChange";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import SloRuleChanges, {
  SloRuleChangeKind,
} from "../../../../Types/Workspace/NotificationRules/SloRuleChanges";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH CHANGES OF AN SLO A RULE POSTS (#6596): a rule with no change
 * condition posts the error budget policy's changes, as every SLO rule
 * always has, and never status changes nobody chose; an SLO Status Change
 * condition picks status changes; and each change condition is about its
 * own kind of change only.
 */

type Values = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

const SLO_ID: string = "4b1f3c84-2f1f-4d55-9f0a-0b1d7b8f3e11";

function values(data: {
  policyChanges?: Array<SloErrorBudgetPolicyChange>;
  statusChange?: SloStatusChange;
}): Values {
  const all: Partial<Values> = {};

  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    all[key] = undefined;
  }

  all[NotificationRuleConditionCheckOn.SloName] = "Checkout availability";
  all[NotificationRuleConditionCheckOn.Slos] = [SLO_ID];
  all[NotificationRuleConditionCheckOn.SloLabels] = [];
  all[NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange] =
    data.policyChanges || [];
  all[NotificationRuleConditionCheckOn.SloStatusChange] = data.statusChange
    ? [data.statusChange]
    : [];

  return all as Values;
}

const POLICY_POST: Values = values({
  policyChanges: [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
});
const STATUS_POST: Values = values({
  statusChange: SloStatusChange.BecameAtRisk,
});
const HEALTHY_AGAIN_POST: Values = values({
  statusChange: SloStatusChange.HealthyAgain,
});

function condition(
  checkOn: NotificationRuleConditionCheckOn,
  conditionType: ConditionType,
  value: string | Array<string>,
): NotificationRuleCondition {
  return { checkOn, conditionType, value };
}

const PICKS_ENTERED: NotificationRuleCondition = condition(
  NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
  ConditionType.ContainsAny,
  [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
);

const PICKS_AT_RISK: NotificationRuleCondition = condition(
  NotificationRuleConditionCheckOn.SloStatusChange,
  ConditionType.ContainsAny,
  [SloStatusChange.BecameAtRisk],
);

const ON_CHECKOUT: NotificationRuleCondition = condition(
  NotificationRuleConditionCheckOn.SloName,
  ConditionType.Contains,
  "Checkout",
);

function rule(
  filters: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition = FilterCondition.All,
): IncidentNotificationRule {
  return {
    _type: "ServiceLevelObjectiveNotificationRule",
    filterCondition: filterCondition,
    filters: filters,
    shouldPostToExistingChannel: true,
    existingChannelNames: "sre",
  } as unknown as IncidentNotificationRule;
}

// Whether the service posts a change of this kind with these values by the rule.
function posts(
  notificationRule: IncidentNotificationRule,
  kind: SloRuleChangeKind,
  post: Values,
): boolean {
  const ruleForKind: IncidentNotificationRule | null =
    SloRuleChanges.getRuleForKind(notificationRule, kind);

  return Boolean(
    ruleForKind &&
      WorkspaceNotificationRuleUtil.isRuleMatching({
        notificationRule: ruleForKind,
        values: post,
      }),
  );
}

describe("the kinds of change a rule posts", () => {
  test("no change condition: the policy's changes, as every SLO rule always has", () => {
    expect(SloRuleChanges.getKinds([])).toEqual([
      SloRuleChangeKind.ErrorBudgetPolicy,
    ]);
    expect(SloRuleChanges.getKinds([ON_CHECKOUT])).toEqual([
      SloRuleChangeKind.ErrorBudgetPolicy,
    ]);
    expect(SloRuleChanges.getKinds(undefined)).toEqual([
      SloRuleChangeKind.ErrorBudgetPolicy,
    ]);
  });

  test("an SLO Status Change condition: status changes, and the policy's only beside an Error Budget Policy Change condition", () => {
    expect(SloRuleChanges.getKinds([PICKS_AT_RISK])).toEqual([
      SloRuleChangeKind.Status,
    ]);
    expect(SloRuleChanges.getKinds([PICKS_ENTERED, PICKS_AT_RISK])).toEqual([
      SloRuleChangeKind.ErrorBudgetPolicy,
      SloRuleChangeKind.Status,
    ]);
  });

  test("an empty SLO Status Change condition - a row added and never filled - picks nothing", () => {
    expect(
      SloRuleChanges.getKinds([
        condition(
          NotificationRuleConditionCheckOn.SloStatusChange,
          ConditionType.ContainsAny,
          [],
        ),
      ]),
    ).toEqual([SloRuleChangeKind.ErrorBudgetPolicy]);
  });
});

describe("matching an SLO's post", () => {
  test("a rule saved before status changes were posted posts exactly what it did: never a status change", () => {
    for (const saved of [
      rule([]),
      rule([ON_CHECKOUT]),
      rule([PICKS_ENTERED]),
      // "Not Contains" once matched any post without the field it checks.
      rule([
        condition(
          NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
          ConditionType.NotContains,
          [SloErrorBudgetPolicyChange.LeftEveryTier],
        ),
      ]),
    ]) {
      expect(posts(saved, SloRuleChangeKind.Status, STATUS_POST)).toBe(false);
    }

    expect(
      posts(rule([]), SloRuleChangeKind.ErrorBudgetPolicy, POLICY_POST),
    ).toBe(true);
    expect(
      posts(
        rule([PICKS_ENTERED]),
        SloRuleChangeKind.ErrorBudgetPolicy,
        POLICY_POST,
      ),
    ).toBe(true);
  });

  test("a rule that picks status changes posts the ones it picks, and no policy change", () => {
    const statusRule: IncidentNotificationRule = rule([PICKS_AT_RISK]);

    expect(posts(statusRule, SloRuleChangeKind.Status, STATUS_POST)).toBe(true);
    expect(
      posts(statusRule, SloRuleChangeKind.Status, HEALTHY_AGAIN_POST),
    ).toBe(false);
    expect(
      posts(statusRule, SloRuleChangeKind.ErrorBudgetPolicy, POLICY_POST),
    ).toBe(false);
  });

  test("a rule that leaves out a status change with Not Contains posts the other status changes, and no policy change", () => {
    const allButRecoveries: IncidentNotificationRule = rule([
      condition(
        NotificationRuleConditionCheckOn.SloStatusChange,
        ConditionType.NotContains,
        [SloStatusChange.HealthyAgain],
      ),
    ]);

    expect(posts(allButRecoveries, SloRuleChangeKind.Status, STATUS_POST)).toBe(
      true,
    );
    expect(
      posts(allButRecoveries, SloRuleChangeKind.Status, HEALTHY_AGAIN_POST),
    ).toBe(false);
    expect(
      posts(allButRecoveries, SloRuleChangeKind.ErrorBudgetPolicy, POLICY_POST),
    ).toBe(false);
  });

  test("a rule that picks both posts each kind its own condition picks, when all its conditions must match", () => {
    const both: IncidentNotificationRule = rule(
      [PICKS_ENTERED, PICKS_AT_RISK, ON_CHECKOUT],
      FilterCondition.All,
    );

    expect(posts(both, SloRuleChangeKind.ErrorBudgetPolicy, POLICY_POST)).toBe(
      true,
    );
    expect(posts(both, SloRuleChangeKind.Status, STATUS_POST)).toBe(true);
    expect(posts(both, SloRuleChangeKind.Status, HEALTHY_AGAIN_POST)).toBe(
      false,
    );
  });

  test("and when any one may: the other kind's condition never matches a post on its own", () => {
    const anyOne: IncidentNotificationRule = rule(
      [
        condition(
          NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
          ConditionType.NotContains,
          [SloErrorBudgetPolicyChange.LeftEveryTier],
        ),
        PICKS_AT_RISK,
      ],
      FilterCondition.Any,
    );

    // Matched without the policy condition, a recovery is not one it picked.
    expect(posts(anyOne, SloRuleChangeKind.Status, HEALTHY_AGAIN_POST)).toBe(
      false,
    );
    expect(posts(anyOne, SloRuleChangeKind.Status, STATUS_POST)).toBe(true);
  });

  test("hands back a copy, never changing the rule it was given", () => {
    const original: IncidentNotificationRule = rule([
      PICKS_ENTERED,
      PICKS_AT_RISK,
    ]);

    const forStatus: IncidentNotificationRule | null =
      SloRuleChanges.getRuleForKind(original, SloRuleChangeKind.Status);

    expect(forStatus?.filters).toEqual([PICKS_AT_RISK]);
    expect(original.filters).toEqual([PICKS_ENTERED, PICKS_AT_RISK]);
    expect(SloRuleChanges.getRuleForKind(null, SloRuleChangeKind.Status)).toBe(
      null,
    );
  });
});
