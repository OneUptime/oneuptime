import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The other half of #3459. Once the editor can build an On-Call Duty Policy
 * condition, the rule has to actually scope the notification - otherwise the
 * dropdown is fixed and the rule still fires for every policy.
 *
 * getMatchingNotificationRules is the seam every on-call workspace
 * notification goes through: it loads the project's rules, resolves the
 * policy behind notificationFor.onCallDutyPolicyId into the check-on values,
 * and keeps the rules whose filters match. Both DB reads are stubbed here so
 * the value resolution and the matching are what is under test.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const POLICY_ID: ObjectID = ObjectID.generate();
const PAYMENTS_LABEL_ID: ObjectID = ObjectID.generate();
const SEARCH_LABEL_ID: ObjectID = ObjectID.generate();

function label(id: ObjectID, name: string): Label {
  const model: Label = new Label();
  model._id = id.toString();
  model.name = name;
  return model;
}

function policy(data: {
  name: string;
  description: string;
  labels: Array<Label>;
}): OnCallDutyPolicy {
  const model: OnCallDutyPolicy = new OnCallDutyPolicy();
  model._id = POLICY_ID.toString();
  model.name = data.name;
  model.description = data.description;
  model.labels = data.labels;
  return model;
}

function ruleWithFilters(data: {
  name: string;
  filters: Array<NotificationRuleCondition>;
  filterCondition?: FilterCondition | undefined;
}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = ObjectID.generate();
  rule.projectId = PROJECT_ID;
  rule.name = data.name;
  rule.workspaceType = WorkspaceType.MicrosoftTeams;
  rule.eventType = NotificationRuleEventType.OnCallDutyPolicy;
  rule.notificationRule = {
    _type: "NotificationRule",
    filterCondition: data.filterCondition || FilterCondition.All,
    filters: data.filters,
    shouldCreateNewChannel: true,
    newChannelTemplateName: "oneuptime-on-call-duty-policy-",
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
  } as unknown as BaseNotificationRule;

  return rule;
}

async function matchingRuleNames(): Promise<Array<string>> {
  const notificationFor: NotificationFor = {
    onCallDutyPolicyId: POLICY_ID,
  };

  const matched: Array<WorkspaceNotificationRule> =
    await WorkspaceNotificationRuleService.getMatchingNotificationRules({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRuleEventType: NotificationRuleEventType.OnCallDutyPolicy,
      notificationFor: notificationFor,
    });

  return matched.map((rule: WorkspaceNotificationRule) => {
    return rule.name || "";
  });
}

describe("On-Call Duty Policy workspace notification rules (#3459)", () => {
  let findBySpy: ReturnType<typeof jest.spyOn>;
  let findPolicySpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    findPolicySpy = jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(
        policy({
          name: "Payments Escalation",
          description: "Pages the payments team after 5 minutes.",
          labels: [label(PAYMENTS_LABEL_ID, "Payments")],
        }) as never,
      ) as ReturnType<typeof jest.spyOn>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function givenProjectRules(rules: Array<WorkspaceNotificationRule>): void {
    findBySpy = jest
      .spyOn(WorkspaceNotificationRuleService, "findBy")
      .mockResolvedValue(rules as never) as ReturnType<typeof jest.spyOn>;
  }

  test("keeps only the rule whose policy-name filter matches", async () => {
    givenProjectRules([
      ruleWithFilters({
        name: "Payments rule",
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
            conditionType: ConditionType.Contains,
            value: "Payments",
          },
        ],
      }),
      ruleWithFilters({
        name: "Search rule",
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
            conditionType: ConditionType.Contains,
            value: "Search",
          },
        ],
      }),
    ]);

    expect(await matchingRuleNames()).toEqual(["Payments rule"]);
    expect(findPolicySpy).toHaveBeenCalled();
    expect(findBySpy).toHaveBeenCalled();
  });

  test("keeps a rule filtered on the policy's labels", async () => {
    givenProjectRules([
      ruleWithFilters({
        name: "Payments label rule",
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
            conditionType: ConditionType.ContainsAny,
            value: [PAYMENTS_LABEL_ID.toString()],
          },
        ],
      }),
      ruleWithFilters({
        name: "Search label rule",
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
            conditionType: ConditionType.ContainsAny,
            value: [SEARCH_LABEL_ID.toString()],
          },
        ],
      }),
    ]);

    expect(await matchingRuleNames()).toEqual(["Payments label rule"]);
  });

  test("keeps a rule filtered on the policy's description", async () => {
    givenProjectRules([
      ruleWithFilters({
        name: "Description rule",
        filters: [
          {
            checkOn:
              NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
            conditionType: ConditionType.Contains,
            value: "payments team",
          },
        ],
      }),
    ]);

    expect(await matchingRuleNames()).toEqual(["Description rule"]);
  });

  test("requires every filter under the All condition", async () => {
    givenProjectRules([
      ruleWithFilters({
        name: "Name and label",
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
            conditionType: ConditionType.StartsWith,
            value: "Payments",
          },
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
            conditionType: ConditionType.ContainsAny,
            value: [SEARCH_LABEL_ID.toString()],
          },
        ],
      }),
    ]);

    expect(await matchingRuleNames()).toEqual([]);
  });

  test("needs only one filter under the Any condition", async () => {
    givenProjectRules([
      ruleWithFilters({
        name: "Name or label",
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
            conditionType: ConditionType.EqualTo,
            value: "Something Else",
          },
          {
            checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
            conditionType: ConditionType.ContainsAny,
            value: [PAYMENTS_LABEL_ID.toString()],
          },
        ],
      }),
    ]);

    expect(await matchingRuleNames()).toEqual(["Name or label"]);
  });

  test("an unfiltered rule still fires for every policy", async () => {
    givenProjectRules([ruleWithFilters({ name: "Catch all", filters: [] })]);

    expect(await matchingRuleNames()).toEqual(["Catch all"]);
  });

  test("resolves a value for every check-on the on-call editor offers", async () => {
    /*
     * The editor's Filter Type list and the values the server resolves have to
     * agree: a check-on the form offers but the server leaves undefined builds
     * a rule that can never match. Each one is asserted through a filter that
     * must match the stubbed policy.
     */
    const filtersPerCheckOn: {
      [key: string]: NotificationRuleCondition;
    } = {
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: {
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        conditionType: ConditionType.EqualTo,
        value: "Payments Escalation",
      },
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]: {
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
        conditionType: ConditionType.EqualTo,
        value: "Pages the payments team after 5 minutes.",
      },
      [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: {
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
        conditionType: ConditionType.ContainsAll,
        value: [PAYMENTS_LABEL_ID.toString()],
      },
    };

    const checkOns: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.OnCallDutyPolicy,
      );

    // Guard the loop: an empty list is the #3459 bug, not a passing test.
    expect(checkOns.length).toBeGreaterThan(0);

    for (const checkOn of checkOns) {
      const filter: NotificationRuleCondition | undefined =
        filtersPerCheckOn[checkOn];

      expect(filter).toBeDefined();

      givenProjectRules([
        ruleWithFilters({ name: checkOn, filters: [filter!] }),
      ]);

      expect(await matchingRuleNames()).toEqual([checkOn]);
    }
  });
});
