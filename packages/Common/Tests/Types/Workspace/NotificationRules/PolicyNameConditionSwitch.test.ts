import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { doesConditionMatch } from "../../../../Types/Workspace/NotificationRules/NotificationRuleConditionMatch";
import PolicyNameConditionSwitch, {
  PolicyNameConditionMatch,
} from "../../../../Types/Workspace/NotificationRules/PolicyNameConditionSwitch";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * SWITCH AN ON-CALL POLICY NAME CONDITION TO THE POLICIES IT NAMES (#7806).
 *
 * "On-Call Policy Name contains Primary" stops matching a policy that is
 * renamed. The Conditions step offers to turn it into an On-Call Policy
 * condition - which stores the policies themselves - holding exactly the
 * policies the words match today, by the comparison the server matches
 * rules with: contains, equals, starts with and ends with become is any of
 * their matches; does not contain and does not equal become is none of the
 * policies the words name. Archived policies are left out, as a new pick
 * leaves them out, and words that name no policy offer nothing.
 */

function policy(
  id: string,
  name: string,
  isArchived?: boolean,
): OnCallDutyPolicy {
  const row: OnCallDutyPolicy = new OnCallDutyPolicy();
  row._id = id;
  row.name = name;

  if (isArchived !== undefined) {
    row.isArchived = isArchived;
  }

  return row;
}

const PRIMARY: OnCallDutyPolicy = policy(
  "78060000-0000-4000-8000-000000000001",
  "Primary on-call",
);
const PRIMARY_EU: OnCallDutyPolicy = policy(
  "78060000-0000-4000-8000-000000000002",
  "Primary on-call (EU)",
);
const DATABASE: OnCallDutyPolicy = policy(
  "78060000-0000-4000-8000-000000000003",
  "Database escalation",
);
const OLD_PRIMARY: OnCallDutyPolicy = policy(
  "78060000-0000-4000-8000-000000000004",
  "Primary rota (old)",
  true,
);
const NUMBERED: OnCallDutyPolicy = policy(
  "78060000-0000-4000-8000-000000000005",
  "007",
);

const POLICIES: Array<OnCallDutyPolicy> = [
  PRIMARY,
  PRIMARY_EU,
  DATABASE,
  OLD_PRIMARY,
  NUMBERED,
];

function nameCondition(
  conditionType: ConditionType | undefined,
  value: string | Array<string> | undefined,
): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
    conditionType: conditionType,
    value: value,
  };
}

function namesOf(match: PolicyNameConditionMatch | null): Array<string> {
  return (match?.policies || []).map((row: OnCallDutyPolicy): string => {
    return row.name || "";
  });
}

// Whether the server's rule matching matches a policy's name to a condition.
function serverMatches(
  condition: NotificationRuleCondition,
  name: string,
): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule: {
      filterCondition: FilterCondition.All,
      filters: [condition],
    } as unknown as IncidentNotificationRule,
    values: NotificationRuleConditionUtil.getValues({
      [condition.checkOn]: name,
    }),
  });
}

describe("which policies a name condition's words name now", () => {
  test("contains: every policy whose name has the words, in the project's order", () => {
    const match: PolicyNameConditionMatch | null =
      PolicyNameConditionSwitch.getMatch({
        condition: nameCondition(ConditionType.Contains, "Primary"),
        policies: POLICIES,
      });

    expect(match?.isLeavingOut).toBe(false);
    expect(namesOf(match)).toEqual(["Primary on-call", "Primary on-call (EU)"]);
  });

  test("equals, starts with and ends with, as the server compares them", () => {
    expect(
      namesOf(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.EqualTo, "Primary on-call"),
          policies: POLICIES,
        }),
      ),
    ).toEqual(["Primary on-call"]);
    expect(
      namesOf(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.StartsWith, "Data"),
          policies: POLICIES,
        }),
      ),
    ).toEqual(["Database escalation"]);
    expect(
      namesOf(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.EndsWith, "(EU)"),
          policies: POLICIES,
        }),
      ),
    ).toEqual(["Primary on-call (EU)"]);
  });

  test("letter case counts, as it does on the server", () => {
    expect(
      namesOf(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.Contains, "primary"),
          policies: POLICIES,
        }),
      ),
    ).toEqual([]);
  });

  test("a number equals a number written another way, as on the server", () => {
    expect(
      namesOf(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.EqualTo, "7"),
          policies: POLICIES,
        }),
      ),
    ).toEqual(["007"]);
  });

  test("does not contain and does not equal name the policies they leave out", () => {
    const notContains: PolicyNameConditionMatch | null =
      PolicyNameConditionSwitch.getMatch({
        condition: nameCondition(ConditionType.NotContains, "Primary"),
        policies: POLICIES,
      });

    expect(notContains?.isLeavingOut).toBe(true);
    expect(namesOf(notContains)).toEqual([
      "Primary on-call",
      "Primary on-call (EU)",
    ]);

    const notEqual: PolicyNameConditionMatch | null =
      PolicyNameConditionSwitch.getMatch({
        condition: nameCondition(
          ConditionType.NotEqualTo,
          "Database escalation",
        ),
        policies: POLICIES,
      });

    expect(notEqual?.isLeavingOut).toBe(true);
    expect(namesOf(notEqual)).toEqual(["Database escalation"]);
  });

  test("an archived policy the words name is left out, as a new pick leaves it out", () => {
    for (const conditionType of [
      ConditionType.Contains,
      ConditionType.NotContains,
    ]) {
      expect(
        namesOf(
          PolicyNameConditionSwitch.getMatch({
            condition: nameCondition(conditionType, "Primary"),
            policies: POLICIES,
          }),
        ),
      ).not.toContain("Primary rota (old)");
    }
  });

  test("words that name no policy name none", () => {
    const match: PolicyNameConditionMatch | null =
      PolicyNameConditionSwitch.getMatch({
        condition: nameCondition(ConditionType.Contains, "Payments"),
        policies: POLICIES,
      });

    expect(match).toEqual({ isLeavingOut: false, policies: [] });
    expect(PolicyNameConditionSwitch.toPolicyCondition(match!)).toBeNull();
  });

  test("a policy listed twice is named once", () => {
    expect(
      namesOf(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.Contains, "Database"),
          policies: [DATABASE, DATABASE],
        }),
      ),
    ).toEqual(["Database escalation"]);
  });

  test("nothing to say: no words yet, another field, a way of comparing with no picker, or no policies read", () => {
    for (const condition of [
      nameCondition(ConditionType.Contains, ""),
      nameCondition(ConditionType.Contains, "   "),
      nameCondition(ConditionType.Contains, undefined),
      nameCondition(ConditionType.Contains, ["Primary"]),
      nameCondition(undefined, "Primary"),
      nameCondition(ConditionType.IsEmpty, "Primary"),
      nameCondition(ConditionType.IsNotEmpty, "Primary"),
      {
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
        conditionType: ConditionType.Contains,
        value: "Primary",
      },
    ]) {
      expect(
        PolicyNameConditionSwitch.getMatch({
          condition: condition,
          policies: POLICIES,
        }),
      ).toBeNull();
    }

    expect(
      PolicyNameConditionSwitch.getMatch({
        condition: nameCondition(ConditionType.Contains, "Primary"),
        policies: undefined,
      }),
    ).toBeNull();
    expect(
      PolicyNameConditionSwitch.getMatch({
        condition: undefined,
        policies: POLICIES,
      }),
    ).toBeNull();
  });
});

describe("the On-Call Policy condition a name condition becomes", () => {
  test("contains becomes is any of the policies it matches, by their ids", () => {
    expect(
      PolicyNameConditionSwitch.toPolicyCondition(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.Contains, "Primary"),
          policies: POLICIES,
        })!,
      ),
    ).toEqual({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: ConditionType.ContainsAny,
      value: [PRIMARY._id, PRIMARY_EU._id],
    });
  });

  test("does not contain becomes is none of the policies it leaves out", () => {
    expect(
      PolicyNameConditionSwitch.toPolicyCondition(
        PolicyNameConditionSwitch.getMatch({
          condition: nameCondition(ConditionType.NotContains, "Primary"),
          policies: POLICIES,
        })!,
      ),
    ).toEqual({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: ConditionType.NotContains,
      value: [PRIMARY._id, PRIMARY_EU._id],
    });
  });

  test("REGRESSION: the server matches exactly the live policies the name condition matched", () => {
    for (const [conditionType, words] of [
      [ConditionType.Contains, "Primary"],
      [ConditionType.NotContains, "Primary"],
      [ConditionType.EqualTo, "Database escalation"],
      [ConditionType.NotEqualTo, "Database escalation"],
      [ConditionType.StartsWith, "Primary on"],
      [ConditionType.EndsWith, "call"],
      [ConditionType.EqualTo, "7"],
    ] as Array<[ConditionType, string]>) {
      const before: NotificationRuleCondition = nameCondition(
        conditionType,
        words,
      );
      const after: NotificationRuleCondition | null =
        PolicyNameConditionSwitch.toPolicyCondition(
          PolicyNameConditionSwitch.getMatch({
            condition: before,
            policies: POLICIES,
          })!,
        );

      expect(after).not.toBeNull();

      for (const row of POLICIES.filter((candidate: OnCallDutyPolicy) => {
        return !candidate.isArchived;
      })) {
        const policyMatchedBefore: boolean = serverMatches(
          before,
          row.name || "",
        );
        const policyMatchedAfter: boolean =
          WorkspaceNotificationRuleUtil.isRuleMatching({
            notificationRule: {
              filterCondition: FilterCondition.All,
              filters: [after!],
            } as unknown as IncidentNotificationRule,
            values: NotificationRuleConditionUtil.getValues({
              [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: [
                row._id!.toString(),
              ],
            }),
          });

        expect({
          conditionType,
          words,
          policy: row.name,
          matches: policyMatchedAfter,
        }).toEqual({
          conditionType,
          words,
          policy: row.name,
          matches: policyMatchedBefore,
        });
      }
    }
  });
});

/*
 * The comparison is the server's: the matcher reads it from the same
 * function, so a name condition is judged one way on both sides.
 */
describe("one comparison for the server and the Dashboard", () => {
  test("text compares as written, letter case included", () => {
    expect(
      doesConditionMatch({
        value: "Primary on-call",
        condition: ConditionType.Contains,
        filterValue: "Primary",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: "Primary on-call",
        condition: ConditionType.Contains,
        filterValue: "primary",
      }),
    ).toBe(false);
  });

  test("equals compares numbers as numbers; does not equal compares text as written", () => {
    expect(
      doesConditionMatch({
        value: "007",
        condition: ConditionType.EqualTo,
        filterValue: "7",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: "007",
        condition: ConditionType.NotEqualTo,
        filterValue: "7",
      }),
    ).toBe(true);
  });

  test("lists: any of, none of and all of", () => {
    expect(
      doesConditionMatch({
        value: ["a", "b"],
        condition: ConditionType.ContainsAny,
        filterValue: ["b", "c"],
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: ["a", "b"],
        condition: ConditionType.NotContains,
        filterValue: ["b"],
      }),
    ).toBe(false);
    expect(
      doesConditionMatch({
        value: ["a", "b"],
        condition: ConditionType.ContainsAll,
        filterValue: ["a", "b"],
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: ["a"],
        condition: ConditionType.ContainsAll,
        filterValue: ["a", "b"],
      }),
    ).toBe(false);
    expect(
      doesConditionMatch({
        value: ["a", "b"],
        condition: ConditionType.NotEqualTo,
        filterValue: ["a", "b"],
      }),
    ).toBe(false);
  });

  test("starts with, ends with, empty and not empty", () => {
    expect(
      doesConditionMatch({
        value: "Primary on-call",
        condition: ConditionType.StartsWith,
        filterValue: "Primary",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: "Primary on-call",
        condition: ConditionType.EndsWith,
        filterValue: "Primary",
      }),
    ).toBe(false);
    expect(
      doesConditionMatch({
        value: "",
        condition: ConditionType.IsEmpty,
        filterValue: "",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: [],
        condition: ConditionType.IsNotEmpty,
        filterValue: "",
      }),
    ).toBe(false);
  });

  test("comparisons of numbers and of text", () => {
    expect(
      doesConditionMatch({
        value: "10",
        condition: ConditionType.GreaterThan,
        filterValue: "9",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: "b",
        condition: ConditionType.LessThan,
        filterValue: "a",
      }),
    ).toBe(false);
    expect(
      doesConditionMatch({
        value: "5",
        condition: ConditionType.GreaterThanOrEqualTo,
        filterValue: "5",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: "5",
        condition: ConditionType.LessThanOrEqualTo,
        filterValue: "4",
      }),
    ).toBe(false);
  });

  test("true and false, and a value that is not there", () => {
    expect(
      doesConditionMatch({
        value: "true",
        condition: ConditionType.True,
        filterValue: "",
      }),
    ).toBe(true);
    expect(
      doesConditionMatch({
        value: "true",
        condition: ConditionType.False,
        filterValue: "",
      }),
    ).toBe(false);
    expect(
      doesConditionMatch({
        value: undefined,
        condition: ConditionType.NotContains,
        filterValue: "x",
      }),
    ).toBe(false);
    expect(
      doesConditionMatch({
        value: "x",
        condition: ConditionType.Contains,
        filterValue: undefined,
      }),
    ).toBe(false);
  });
});
