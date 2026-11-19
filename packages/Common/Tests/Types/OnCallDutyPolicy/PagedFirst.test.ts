import ObjectID from "../../../Types/ObjectID";
import {
  getOnCallPolicyFirstLevel,
  sortOnCallPolicyLevels,
} from "../../../Types/OnCallDutyPolicy/OnCallRunLevel";
import {
  PAGED_FIRST_CHIPS_SHOWN,
  PagedFirst,
  PagedFirstKind,
  PagedFirstResponder,
  PagedFirstResponderKind,
  PagedFirstResponderRow,
  PagedFirstRuleRow,
  PagedFirstScheduleRow,
  getFirstRuleOfEachPolicy,
  getPagedFirstOfPolicies,
  getPagedFirstOfPolicy,
  getShownPagedFirstResponders,
} from "../../../Types/OnCallDutyPolicy/PagedFirst";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO A POLICY PAGES FIRST, ON THE LIST OF POLICIES (#9701).
 *
 * The On-Call Policies list now says who each policy pages first: the
 * schedules, teams and people of its first escalation rule, a schedule with
 * who is on call in it now. These hold what each cell is handed
 * (Types/OnCallDutyPolicy/PagedFirst):
 *
 *   - the first rule is the one a run starts with and the policy's
 *     Escalation Rules page lists first - the lowest place, which need not
 *     be 1, and of two rules at one place the one with the lower id - the
 *     very rule getOnCallPolicyFirstLevel picks for the run's advance;
 *   - its responders are schedules, then teams, then people, each by name,
 *     each once; another rule's are never its;
 *   - a policy with no rules, or whose first rule names nobody, is said as
 *     such, so the list names the break;
 *   - a schedule paged for whoever is on call says who that is now, or that
 *     nobody is; one paged for the next person in its rotation says so;
 *   - a cell shows three chips, then a count of the rest.
 */

const POLICY_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const POLICY_B: string = "aaaaaaaa-0000-4000-8000-000000000002";
const POLICY_C: string = "aaaaaaaa-0000-4000-8000-000000000003";

const RULE_A1: string = "bbbbbbbb-0000-4000-8000-000000000001";
const RULE_A2: string = "bbbbbbbb-0000-4000-8000-000000000002";
const RULE_B_LOW_ID: string = "bbbbbbbb-0000-4000-8000-00000000000a";
const RULE_B_HIGH_ID: string = "bbbbbbbb-0000-4000-8000-00000000000b";

const SCHEDULE_PRIMARY: string = "cccccccc-0000-4000-8000-000000000001";
const SCHEDULE_BACKUP: string = "cccccccc-0000-4000-8000-000000000002";
const TEAM_PLATFORM: string = "dddddddd-0000-4000-8000-000000000001";
const USER_ALICE: string = "eeeeeeee-0000-4000-8000-000000000001";
const USER_BOB: string = "eeeeeeee-0000-4000-8000-000000000002";

function rule(
  id: string,
  policyId: string,
  order: number | null,
  name?: string,
): PagedFirstRuleRow {
  return { id, policyId, order, name: name || `Level for ${id.slice(-2)}` };
}

function user(
  ruleId: string,
  id: string,
  name: string,
): PagedFirstResponderRow {
  return { ruleId, id, name };
}

function schedule(
  ruleId: string,
  id: string,
  name: string,
  isNextInRotation: boolean = false,
): PagedFirstScheduleRow {
  return { ruleId, id, name, isNextInRotation };
}

function pagedFirstOf(data: {
  policyIds?: Array<string>;
  rules: Array<PagedFirstRuleRow>;
  users?: Array<PagedFirstResponderRow>;
  teams?: Array<PagedFirstResponderRow>;
  schedules?: Array<PagedFirstScheduleRow>;
  onCallNow?: Record<string, string | null>;
}): Map<string, PagedFirst> {
  return getPagedFirstOfPolicies({
    policyIds: data.policyIds || [POLICY_A],
    rules: data.rules,
    users: data.users || [],
    teams: data.teams || [],
    schedules: data.schedules || [],
    onCallNow: data.onCallNow || {},
  });
}

function namesOf(pagedFirst: PagedFirst | undefined): Array<string> {
  return (pagedFirst?.responders || []).map(
    (responder: PagedFirstResponder): string => {
      return `${responder.kind}:${responder.name}`;
    },
  );
}

describe("the first rule of each policy", () => {
  test("is the lowest place, which need not be 1", () => {
    const first: Map<string, PagedFirstRuleRow> = getFirstRuleOfEachPolicy([
      rule(RULE_A2, POLICY_A, 7),
      rule(RULE_A1, POLICY_A, 3),
    ]);

    expect(first.get(POLICY_A)?.id).toBe(RULE_A1);
  });

  test("of two rules at one place, the one with the lower id, whichever came first", () => {
    for (const rules of [
      [rule(RULE_B_HIGH_ID, POLICY_B, 1), rule(RULE_B_LOW_ID, POLICY_B, 1)],
      [rule(RULE_B_LOW_ID, POLICY_B, 1), rule(RULE_B_HIGH_ID, POLICY_B, 1)],
    ]) {
      expect(getFirstRuleOfEachPolicy(rules).get(POLICY_B)?.id).toBe(
        RULE_B_LOW_ID,
      );
    }
  });

  test("is the very rule the run's advance starts with (getOnCallPolicyFirstLevel)", () => {
    const rules: Array<PagedFirstRuleRow> = [
      rule(RULE_B_HIGH_ID, POLICY_B, 2),
      rule(RULE_A2, POLICY_B, 5),
      rule(RULE_B_LOW_ID, POLICY_B, 2),
      rule(RULE_A1, POLICY_B, null),
    ];

    const engine: { id: ObjectID; order: number | null } | null =
      getOnCallPolicyFirstLevel(
        rules.map((row: PagedFirstRuleRow) => {
          return { id: new ObjectID(row.id), order: row.order };
        }),
      );

    expect(getFirstRuleOfEachPolicy(rules).get(POLICY_B)?.id).toBe(
      engine?.id.toString(),
    );

    // And the first of the rules as the run reads them, in order.
    expect(
      sortOnCallPolicyLevels(
        rules.map((row: PagedFirstRuleRow) => {
          return { id: new ObjectID(row.id), order: row.order };
        }),
      )[0]?.id.toString(),
    ).toBe(RULE_B_LOW_ID);
  });

  test("a rule without a place is never first, as a run never starts there", () => {
    expect(
      getFirstRuleOfEachPolicy([rule(RULE_A1, POLICY_A, null)]).has(POLICY_A),
    ).toBe(false);
  });

  test("each policy's own, never another's", () => {
    const first: Map<string, PagedFirstRuleRow> = getFirstRuleOfEachPolicy([
      rule(RULE_A1, POLICY_A, 2),
      rule(RULE_B_LOW_ID, POLICY_B, 1),
    ]);

    expect(first.get(POLICY_A)?.id).toBe(RULE_A1);
    expect(first.get(POLICY_B)?.id).toBe(RULE_B_LOW_ID);
    expect(first.has(POLICY_C)).toBe(false);
  });

  test("whatever the case of the ids", () => {
    expect(
      getFirstRuleOfEachPolicy([rule(RULE_A1, POLICY_A.toUpperCase(), 1)]).get(
        POLICY_A,
      )?.id,
    ).toBe(RULE_A1);
  });
});

describe("what a policy's cell holds", () => {
  test("its first rule's responders: schedules, then teams, then people, each by name", () => {
    const pagedFirst: Map<string, PagedFirst> = pagedFirstOf({
      rules: [
        rule(RULE_A1, POLICY_A, 1, "Level 1"),
        rule(RULE_A2, POLICY_A, 2),
      ],
      users: [
        user(RULE_A1, USER_BOB, "Bob"),
        user(RULE_A1, USER_ALICE, "Alice"),
      ],
      teams: [user(RULE_A1, TEAM_PLATFORM, "Platform")],
      schedules: [
        schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary"),
        schedule(RULE_A1, SCHEDULE_BACKUP, "Backup"),
      ],
      onCallNow: {
        [SCHEDULE_PRIMARY]: "Carol",
        [SCHEDULE_BACKUP]: "Dan",
      },
    });

    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirst,
      POLICY_A,
    );

    expect(cell?.kind).toBe(PagedFirstKind.Responders);
    expect(cell?.ruleId).toBe(RULE_A1);
    expect(cell?.ruleName).toBe("Level 1");
    expect(namesOf(cell)).toEqual([
      "Schedule:Backup",
      "Schedule:Primary",
      "Team:Platform",
      "User:Alice",
      "User:Bob",
    ]);
  });

  test("never a later rule's", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        rules: [rule(RULE_A1, POLICY_A, 1), rule(RULE_A2, POLICY_A, 2)],
        users: [
          user(RULE_A1, USER_ALICE, "Alice"),
          user(RULE_A2, USER_BOB, "Bob"),
        ],
      }),
      POLICY_A,
    );

    expect(namesOf(cell)).toEqual(["User:Alice"]);
  });

  test("a schedule says who is on call in it now, or that nobody is", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        rules: [rule(RULE_A1, POLICY_A, 1)],
        schedules: [
          schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary"),
          schedule(RULE_A1, SCHEDULE_BACKUP, "Backup"),
        ],
        onCallNow: { [SCHEDULE_PRIMARY]: "Carol", [SCHEDULE_BACKUP]: null },
      }),
      POLICY_A,
    );

    expect(
      cell?.responders.map((responder: PagedFirstResponder) => {
        return [responder.name, responder.onCallUserName];
      }),
    ).toEqual([
      ["Backup", null],
      ["Primary", "Carol"],
    ]);
  });

  test("a schedule whose on-call person was not read says nothing of it", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        rules: [rule(RULE_A1, POLICY_A, 1)],
        schedules: [schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary")],
      }),
      POLICY_A,
    );

    expect(cell?.responders[0]?.onCallUserName).toBeUndefined();
  });

  test("a schedule paged for the next person in its rotation says so, and no name", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        rules: [rule(RULE_A1, POLICY_A, 1)],
        schedules: [schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary", true)],
        onCallNow: { [SCHEDULE_PRIMARY]: "Carol" },
      }),
      POLICY_A,
    );

    expect(cell?.responders).toEqual([
      {
        kind: PagedFirstResponderKind.Schedule,
        id: SCHEDULE_PRIMARY,
        name: "Primary",
        isNextInRotation: true,
        onCallUserName: undefined,
      },
    ]);
  });

  test("a schedule paged both ways is two chips; one named twice the same way is one", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        rules: [rule(RULE_A1, POLICY_A, 1)],
        schedules: [
          schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary"),
          schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary"),
          schedule(RULE_A1, SCHEDULE_PRIMARY, "Primary", true),
        ],
        users: [
          user(RULE_A1, USER_ALICE, "Alice"),
          user(RULE_A1, USER_ALICE.toUpperCase(), "Alice"),
        ],
      }),
      POLICY_A,
    );

    expect(namesOf(cell)).toEqual([
      "Schedule:Primary",
      "Schedule:Primary",
      "User:Alice",
    ]);
  });

  test("a policy with no escalation rules pages nobody, and says so", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        policyIds: [POLICY_A, POLICY_B],
        rules: [rule(RULE_A1, POLICY_A, 1)],
        users: [user(RULE_A1, USER_ALICE, "Alice")],
      }),
      POLICY_B,
    );

    expect(cell).toEqual({
      kind: PagedFirstKind.NoEscalationRules,
      ruleId: null,
      ruleName: "",
      responders: [],
    });
  });

  test("a first rule that names nobody is said as such, though a later one names somebody", () => {
    const cell: PagedFirst | undefined = getPagedFirstOfPolicy(
      pagedFirstOf({
        rules: [rule(RULE_A1, POLICY_A, 1), rule(RULE_A2, POLICY_A, 2)],
        users: [user(RULE_A2, USER_BOB, "Bob")],
      }),
      POLICY_A,
    );

    expect(cell?.kind).toBe(PagedFirstKind.NoResponders);
    expect(cell?.ruleId).toBe(RULE_A1);
    expect(cell?.responders).toEqual([]);
  });

  test("every policy listed has a cell, and a policy not listed has none", () => {
    const pagedFirst: Map<string, PagedFirst> = pagedFirstOf({
      policyIds: [POLICY_A, POLICY_B],
      rules: [rule(RULE_A1, POLICY_A, 1), rule(RULE_B_LOW_ID, POLICY_C, 1)],
    });

    expect(getPagedFirstOfPolicy(pagedFirst, POLICY_A)).toBeDefined();
    expect(getPagedFirstOfPolicy(pagedFirst, POLICY_B)).toBeDefined();
    expect(getPagedFirstOfPolicy(pagedFirst, POLICY_C)).toBeUndefined();
    expect(getPagedFirstOfPolicy(pagedFirst, null)).toBeUndefined();
    expect(getPagedFirstOfPolicy(pagedFirst, POLICY_A.toUpperCase())).toBe(
      getPagedFirstOfPolicy(pagedFirst, POLICY_A),
    );
  });
});

describe("the chips a cell draws", () => {
  function responders(count: number): Array<PagedFirstResponder> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return {
        kind: PagedFirstResponderKind.User,
        id: `${index}`,
        name: `Person ${index}`,
      };
    });
  }

  test(`up to ${PAGED_FIRST_CHIPS_SHOWN}, then a count of the rest`, () => {
    expect(getShownPagedFirstResponders(responders(3))).toEqual({
      shown: responders(3),
      moreCount: 0,
    });
    expect(getShownPagedFirstResponders(responders(6))).toEqual({
      shown: responders(6).slice(0, PAGED_FIRST_CHIPS_SHOWN),
      moreCount: 3,
    });
  });

  test("never '+1 more': the chip it would stand for fits in its place", () => {
    expect(getShownPagedFirstResponders(responders(4))).toEqual({
      shown: responders(4),
      moreCount: 0,
    });
    expect(getShownPagedFirstResponders(responders(5)).moreCount).toBe(2);
  });

  test("none, for none", () => {
    expect(getShownPagedFirstResponders([])).toEqual({
      shown: [],
      moreCount: 0,
    });
  });
});
