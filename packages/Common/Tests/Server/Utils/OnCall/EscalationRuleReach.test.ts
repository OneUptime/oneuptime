import EscalationRuleReach, {
  EVERY_PATH,
  HandoffReach,
  LASTING_PATHS,
  MemberRules,
  PersonRulePath,
  PolicyReachOfPerson,
  RuleMembers,
  RuleNewToMember,
  RulePath,
  RulePathKind,
  RuleReach,
  RulesNewToMember,
} from "../../../../Server/Utils/OnCall/EscalationRuleReach";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import ObjectID from "../../../../Types/ObjectID";
import ReachWorld, {
  ANA,
  BO,
  CY,
  IVY,
  OTHER_POLICY_ID,
  OTHER_POLICY_RULE_ID,
  OTHER_RULE_ID,
  PAYMENTS_TEAM,
  PLATFORM,
  POLICY_ID,
  PRIMARY,
  PROJECT_ID,
  RULE_ID,
  SECONDARY,
  WorldMembership,
  WorldTeamRow,
  WorldUserRow,
} from "./EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHO AN ESCALATION RULE PAGES NOW, AND THROUGH WHAT (#10464, #10412).
 *
 * The one place the three responder services ask before they tell someone
 * they were added to a rule or removed from it, and before they keep their
 * on-call time log: every path - named on the rule, in one of its teams, on
 * call in one of its schedules or next in its rotation - for every member of
 * the project, and for nobody else. Someone only invited is paged by
 * nothing until they join.
 */

let world: ReachWorld;

beforeEach(() => {
  world = new ReachWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const RULE: { projectId: ObjectID; ruleId: ObjectID; policyId: ObjectID } = {
  projectId: PROJECT_ID,
  ruleId: RULE_ID,
  policyId: POLICY_ID,
};

function kindsOf(reach: RuleReach, userId: ObjectID): Array<string> {
  return EscalationRuleReach.getPaths(reach, userId)
    .map((path: RulePath): string => {
      return path.teamId
        ? `${path.kind} ${path.teamId.toString()}`
        : path.scheduleId
          ? `${path.kind} ${path.scheduleId.toString()}`
          : path.kind;
    })
    .sort();
}

describe("read: every path that pages each member", () => {
  test("named on the rule, and an accepted member of each of its teams", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(ANA, PAYMENTS_TEAM, true);
    world.addMember(BO, PLATFORM, true);
    world.namePerson(ANA);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM);

    const reach: RuleReach = await EscalationRuleReach.read({
      ...RULE,
      withSchedules: false,
    });

    expect(kindsOf(reach, ANA)).toEqual(
      [
        RulePathKind.Person,
        `${RulePathKind.Team} ${PAYMENTS_TEAM.toString()}`,
        `${RulePathKind.Team} ${PLATFORM.toString()}`,
      ].sort(),
    );
    expect(kindsOf(reach, BO)).toEqual([
      `${RulePathKind.Team} ${PLATFORM.toString()}`,
    ]);
  });

  test("on call in a schedule it pages, and next in the rotation of one it pages that way", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(BO, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(SECONDARY, { pageNextInRotation: true });
    world.onCall.set(PRIMARY.toString(), ANA);
    world.onCall.set(SECONDARY.toString(), CY);
    world.next.set(SECONDARY.toString(), BO);

    const reach: RuleReach = await EscalationRuleReach.read({
      ...RULE,
      withSchedules: true,
    });

    expect(kindsOf(reach, ANA)).toEqual([
      `${RulePathKind.OnCall} ${PRIMARY.toString()}`,
    ]);
    expect(kindsOf(reach, BO)).toEqual([
      `${RulePathKind.NextInRotation} ${SECONDARY.toString()}`,
    ]);
    // Cy is on call in Secondary, which pages its next person only - and is no member.
    expect(kindsOf(reach, CY)).toEqual([]);
  });

  test("its schedules are not worked out unless asked: a person's or a team's add needs none", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    const reach: RuleReach = await EscalationRuleReach.read({
      ...RULE,
      withSchedules: false,
    });

    expect(kindsOf(reach, ANA)).toEqual([]);
  });

  test("someone only invited is paged by nothing: named, in a team, or on call", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.namePerson(IVY);
    world.nameTeam(PLATFORM);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), IVY);

    const reach: RuleReach = await EscalationRuleReach.read({
      ...RULE,
      withSchedules: true,
    });

    expect(kindsOf(reach, IVY)).toEqual([]);
    expect(reach.size).toBe(0);
  });

  test("a team's pending members are not read as its people: accepted rows only", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(IVY, PLATFORM, false);
    world.nameTeam(PLATFORM);

    await EscalationRuleReach.read({ ...RULE, withSchedules: false });

    expect(
      (
        jest.mocked(TeamMemberService.findBy).mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query["hasAcceptedInvitation"],
    ).toBe(true);
  });

  test("another rule's rows are its own", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA, OTHER_RULE_ID);

    const reach: RuleReach = await EscalationRuleReach.read({
      ...RULE,
      withSchedules: true,
    });

    expect(kindsOf(reach, ANA)).toEqual([]);
  });

  test("a rule that pages nobody reads no membership", async () => {
    const reach: RuleReach = await EscalationRuleReach.read({
      ...RULE,
      withSchedules: true,
    });

    expect(reach.size).toBe(0);
    expect(ProjectMembership.getMemberUserIds).not.toHaveBeenCalled();
  });

  test("a read that fails is null, for the caller to tell and log as before", async () => {
    world.failReads = true;

    await expect(
      EscalationRuleReach.readOrNull({ ...RULE, withSchedules: true }),
    ).resolves.toBeNull();
  });

  test("each rule is read once, however many rows of it a delete removed", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);

    const reachByRule: Map<string, RuleReach | null> =
      await EscalationRuleReach.readEach({
        rules: [RULE, RULE, { ...RULE, ruleId: OTHER_RULE_ID }],
        withSchedules: false,
      });

    expect(reachByRule.size).toBe(2);
    expect(
      kindsOf(reachByRule.get(EscalationRuleReach.getRuleKey(RULE))!, ANA),
    ).toEqual([RulePathKind.Person]);
  });
});

describe("wasPagedBefore: only a row made before this one counts", () => {
  async function pathsOf(userId: ObjectID): Promise<Array<RulePath>> {
    return EscalationRuleReach.getPaths(
      await EscalationRuleReach.read({ ...RULE, withSchedules: true }),
      userId,
    );
  }

  test("named, then added with a team: the team's row is not news to them", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);
    const team: WorldTeamRow = world.nameTeam(PLATFORM);

    expect(
      EscalationRuleReach.wasPagedBefore({
        paths: await pathsOf(ANA),
        rowId: team.id,
        kinds: LASTING_PATHS,
      }),
    ).toBe(true);
  });

  test("in a team, then named: being named is not news to them either", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    const named: WorldUserRow = world.namePerson(ANA);

    expect(
      EscalationRuleReach.wasPagedBefore({
        paths: await pathsOf(ANA),
        rowId: named.id,
        kinds: LASTING_PATHS,
      }),
    ).toBe(true);
  });

  test("two adds at the same moment: the older row tells them, the newer does not", async () => {
    world.addMember(ANA, PLATFORM, true);
    const named: WorldUserRow = world.namePerson(ANA);
    const team: WorldTeamRow = world.nameTeam(PLATFORM);
    const paths: Array<RulePath> = await pathsOf(ANA);

    // Both rows are there when each add asks: only the older one is news.
    expect(
      EscalationRuleReach.wasPagedBefore({
        paths,
        rowId: named.id,
        kinds: LASTING_PATHS,
      }),
    ).toBe(false);
    expect(
      EscalationRuleReach.wasPagedBefore({
        paths,
        rowId: team.id,
        kinds: LASTING_PATHS,
      }),
    ).toBe(true);
  });

  test("two rows made at the same instant are told apart by id, the same way each time", async () => {
    world.addMember(ANA, PLATFORM, true);
    const named: WorldUserRow = world.namePerson(ANA);
    const team: WorldTeamRow = world.nameTeam(PLATFORM);
    team.createdAt = named.createdAt;
    const paths: Array<RulePath> = await pathsOf(ANA);

    const namedFirst: boolean = !EscalationRuleReach.wasPagedBefore({
      paths,
      rowId: named.id,
      kinds: LASTING_PATHS,
    });
    const teamFirst: boolean = !EscalationRuleReach.wasPagedBefore({
      paths,
      rowId: team.id,
      kinds: LASTING_PATHS,
    });

    // Exactly one of the two tells them.
    expect(namedFirst !== teamFirst).toBe(true);
  });

  test("being on call in one of its schedules does not keep being named from being news", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);
    const named: WorldUserRow = world.namePerson(ANA);
    const paths: Array<RulePath> = await pathsOf(ANA);

    expect(
      EscalationRuleReach.wasPagedBefore({
        paths,
        rowId: named.id,
        kinds: LASTING_PATHS,
      }),
    ).toBe(false);
    // Any path at all, as a schedule's add asks: they were paged already.
    expect(
      EscalationRuleReach.wasPagedBefore({
        paths,
        rowId: named.id,
        kinds: EVERY_PATH,
      }),
    ).toBe(true);
  });

  test("a row that pages them no more counts every other path as earlier", () => {
    const path: RulePath = {
      kind: RulePathKind.Team,
      rowId: ObjectID.generate().toString(),
      createdAt: new Date(),
      teamId: PLATFORM,
      scheduleId: null,
    };

    expect(
      EscalationRuleReach.wasPagedBefore({
        paths: [path],
        rowId: ObjectID.generate(),
        kinds: LASTING_PATHS,
      }),
    ).toBe(true);
  });
});

describe("keepTimeLogsOpen: each path left keeps a log of its own", () => {
  test("named, a team's and a schedule's - and none for the next in a rotation", () => {
    const at: Date = new Date();
    const paths: Array<RulePath> = [
      {
        kind: RulePathKind.Person,
        rowId: "1",
        createdAt: at,
        teamId: null,
        scheduleId: null,
      },
      {
        kind: RulePathKind.Team,
        rowId: "2",
        createdAt: at,
        teamId: PLATFORM,
        scheduleId: null,
      },
      {
        kind: RulePathKind.OnCall,
        rowId: "3",
        createdAt: at,
        teamId: null,
        scheduleId: PRIMARY,
      },
      {
        kind: RulePathKind.NextInRotation,
        rowId: "4",
        createdAt: at,
        teamId: null,
        scheduleId: SECONDARY,
      },
    ];

    EscalationRuleReach.keepTimeLogsOpen({
      ...RULE,
      policyId: POLICY_ID,
      userId: ANA,
      paths,
    });

    expect(world.logsOf(ANA)).toEqual([
      "start named",
      `start team ${PLATFORM.toString()}`,
      `start schedule ${PRIMARY.toString()}`,
    ]);
  });
});

describe("openTimeLogsOfMember: someone who joined is logged on the rules that page them now", () => {
  test("the rules that name them and the rules that name their teams", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    await EscalationRuleReach.openTimeLogsOfMember({
      projectId: PROJECT_ID,
      userId: ANA,
    });

    expect(world.timeLogs).toEqual([
      {
        action: "start",
        userId: ANA.toString(),
        ruleId: RULE_ID.toString(),
        teamId: null,
        scheduleId: null,
      },
      {
        action: "start",
        userId: ANA.toString(),
        ruleId: OTHER_RULE_ID.toString(),
        teamId: PLATFORM.toString(),
        scheduleId: null,
      },
    ]);
  });

  test("someone whose invitation still waits is logged nowhere", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.namePerson(IVY);
    world.nameTeam(PLATFORM);

    await EscalationRuleReach.openTimeLogsOfMember({
      projectId: PROJECT_ID,
      userId: IVY,
    });

    expect(world.timeLogs).toEqual([]);
  });

  test("a team they were only invited to is not theirs yet", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(ANA, PAYMENTS_TEAM, false);
    world.nameTeam(PAYMENTS_TEAM);

    await EscalationRuleReach.openTimeLogsOfMember({
      projectId: PROJECT_ID,
      userId: ANA,
    });

    expect(world.timeLogs).toEqual([]);
  });
});

describe("readMembers: who a removal may tell", () => {
  test("a member of the project, and not someone only invited", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(IVY, PLATFORM, false);

    const members: RuleMembers = await EscalationRuleReach.readMembers([
      { projectId: PROJECT_ID, userId: ANA },
      { projectId: PROJECT_ID, userId: IVY },
    ]);

    expect(members.isMember(PROJECT_ID, ANA)).toBe(true);
    expect(members.isMember(PROJECT_ID, IVY)).toBe(false);
  });

  test("unread, everyone counts: the message's sender asks again", async () => {
    jest
      .mocked(ProjectMembership.getMemberKeys)
      .mockRejectedValue(new Error("unreachable") as never);

    const members: RuleMembers = await EscalationRuleReach.readMembers([
      { projectId: PROJECT_ID, userId: IVY },
    ]);

    expect(members.isMember(PROJECT_ID, IVY)).toBe(true);
  });
});

/*
 * A POLICY SPEAKS FOR ITSELF, AS A WHOLE (#10556): what each policy pages
 * one person through now - by any of its rules - read for that person.
 */
function policyPathsOf(
  reach: PolicyReachOfPerson,
  policyId: ObjectID,
): Array<string> {
  return (reach.get(policyId.toString().toLowerCase()) || [])
    .map((path: PersonRulePath): string => {
      const through: string = path.teamId
        ? ` ${path.teamId.toString()}`
        : path.scheduleId
          ? ` ${path.scheduleId.toString()}`
          : "";
      return `${path.kind}${through} on ${path.ruleId.toString()}`;
    })
    .sort();
}

describe("readPolicyPathsOfPerson: what each policy pages one person through now", () => {
  test("named on one of its rules: the policy pages them, and its schedules are not worked out", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA, OTHER_RULE_ID);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID],
      });

    expect(policyPathsOf(reach, POLICY_ID)).toEqual([
      `${RulePathKind.Person} on ${OTHER_RULE_ID.toString()}`,
    ]);
    expect(
      OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule,
    ).not.toHaveBeenCalled();
    expect(
      OnCallDutyPolicyEscalationRuleScheduleService.findBy,
    ).not.toHaveBeenCalled();
  });

  test("an accepted member of one of its teams", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID],
      });

    expect(policyPathsOf(reach, POLICY_ID)).toEqual([
      `${RulePathKind.Team} ${PLATFORM.toString()} on ${OTHER_RULE_ID.toString()}`,
    ]);
  });

  test("on call now in another of its schedules", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(SECONDARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), BO);
    world.onCall.set(SECONDARY.toString(), ANA);

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID],
      });

    expect(policyPathsOf(reach, POLICY_ID)).toEqual([
      `${RulePathKind.OnCall} ${SECONDARY.toString()} on ${OTHER_RULE_ID.toString()}`,
    ]);
  });

  test("next in the rotation of a schedule one of its rules pages that way", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY, {
      ruleId: OTHER_RULE_ID,
      pageNextInRotation: true,
    });
    world.onCall.set(PRIMARY.toString(), BO);
    world.next.set(PRIMARY.toString(), ANA);

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID],
      });

    expect(policyPathsOf(reach, POLICY_ID)).toEqual([
      `${RulePathKind.NextInRotation} ${PRIMARY.toString()} on ${OTHER_RULE_ID.toString()}`,
    ]);
  });

  test("nothing on it pages them any more: the policy is not in it", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(BO, PAYMENTS_TEAM, true);
    world.nameTeam(PAYMENTS_TEAM);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID],
      });

    expect(reach.size).toBe(0);
  });

  test("each policy for itself: a rule of another policy that names them pages them for that one only", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA, OTHER_POLICY_RULE_ID);

    const onlyPayments: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID],
      });

    expect(onlyPayments.size).toBe(0);

    const both: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [POLICY_ID, OTHER_POLICY_ID],
      });

    expect([...both.keys()]).toEqual([
      OTHER_POLICY_ID.toString().toLowerCase(),
    ]);
  });

  test("someone only invited is paged by nothing, and nothing more is read for them", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.namePerson(IVY);
    world.nameTeam(PLATFORM);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), IVY);

    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: IVY,
        policyIds: [POLICY_ID],
      });

    expect(reach.size).toBe(0);
    expect(
      OnCallDutyPolicyEscalationRuleUserService.findBy,
    ).not.toHaveBeenCalled();
    expect(
      OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule,
    ).not.toHaveBeenCalled();
  });

  test("a schedule two of its rules page is worked out once, in the policy's overrides", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), BO);

    await EscalationRuleReach.readPolicyPathsOfPerson({
      projectId: PROJECT_ID,
      userId: ANA,
      policyIds: [POLICY_ID, POLICY_ID],
    });

    expect(
      OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule,
    ).toHaveBeenCalledTimes(1);
    expect(
      OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule,
    ).toHaveBeenCalledWith(PRIMARY, { onCallDutyPolicyId: POLICY_ID });
  });

  test("no policy: nothing is read", async () => {
    const reach: PolicyReachOfPerson =
      await EscalationRuleReach.readPolicyPathsOfPerson({
        projectId: PROJECT_ID,
        userId: ANA,
        policyIds: [],
      });

    expect(reach.size).toBe(0);
    expect(ProjectMembership.getMemberUserIds).not.toHaveBeenCalled();
  });
});

describe("readHandoff: who a schedule's hand-off tells and logs, for each policy as a whole", () => {
  test("whoever's shift ended is still paged by a policy that names them, and not by one that does not", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.addMember(BO, PLATFORM, true);
    world.namePerson(ANA, OTHER_RULE_ID);

    const handoff: HandoffReach = await EscalationRuleReach.readHandoff({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID, OTHER_POLICY_ID],
      endedUserId: ANA,
      userIds: [ANA, BO, null],
    });

    expect(handoff.isStillPagedBy(POLICY_ID)).toBe(true);
    expect(handoff.isStillPagedBy(OTHER_POLICY_ID)).toBe(false);
    expect(handoff.isMember(ANA)).toBe(true);
    expect(handoff.isMember(BO)).toBe(true);
  });

  test("someone only invited is no member: not told nor logged, and no policy is read for them", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.addMember(BO, PLATFORM, true);
    world.namePerson(IVY);

    const handoff: HandoffReach = await EscalationRuleReach.readHandoff({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID],
      endedUserId: IVY,
      userIds: [IVY, BO, IVY],
    });

    expect(handoff.isMember(IVY)).toBe(false);
    expect(handoff.isMember(BO)).toBe(true);
    expect(handoff.isStillPagedBy(POLICY_ID)).toBe(false);
    expect(
      OnCallDutyPolicyEscalationRuleUserService.findBy,
    ).not.toHaveBeenCalled();
  });

  test("everyone it names is asked about in one read", async () => {
    world.addMember(ANA, PLATFORM, true);

    await EscalationRuleReach.readHandoff({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID],
      endedUserId: null,
      userIds: [ANA, BO, ANA, null],
    });

    expect(ProjectMembership.getMemberUserIds).toHaveBeenCalledTimes(1);
    expect(ProjectMembership.getMemberUserIds).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userIds: [ANA, BO],
    });
  });

  test("nobody's shift ended - the same person stays on call: no policy is read", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);

    const handoff: HandoffReach = await EscalationRuleReach.readHandoff({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID],
      endedUserId: null,
      userIds: [ANA, ANA, BO],
    });

    expect(handoff.isStillPagedBy(POLICY_ID)).toBe(false);
    expect(
      OnCallDutyPolicyEscalationRuleUserService.findBy,
    ).not.toHaveBeenCalled();
  });

  test("who is a member could not be read: everyone is told and logged as before", async () => {
    jest
      .mocked(ProjectMembership.getMemberUserIds)
      .mockRejectedValue(new Error("unreachable") as never);

    const handoff: HandoffReach = await EscalationRuleReach.readHandoff({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID],
      endedUserId: IVY,
      userIds: [IVY, BO, null],
    });

    expect(handoff.isMember(IVY)).toBe(true);
    expect(handoff.isMember(BO)).toBe(true);
    // And what pages them could not be read either: they are told as before.
    expect(handoff.isStillPagedBy(POLICY_ID)).toBe(false);
  });

  test("what still pages them could not be read: they are told as before", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);
    world.failReads = true;

    const handoff: HandoffReach = await EscalationRuleReach.readHandoff({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID],
      endedUserId: ANA,
      userIds: [ANA, BO, null],
    });

    expect(handoff.isMember(ANA)).toBe(true);
    expect(handoff.isStillPagedBy(POLICY_ID)).toBe(false);
  });
});

/*
 * SOMEONE WHO JOINED (#10557): every rule that pages them now, and which of
 * those started paging them when they joined.
 */
function rulePathsOf(rules: MemberRules): Array<string> {
  return rules.paths.map((path: PersonRulePath): string => {
    const through: string = path.teamId
      ? ` ${path.teamId.toString()}`
      : path.scheduleId
        ? ` ${path.scheduleId.toString()}`
        : "";
    return `${path.kind}${through} on ${path.ruleId.toString()} of ${path.policyId.toString()}`;
  });
}

function newRuleIds(news: RulesNewToMember): Array<string> {
  return news.rules
    .map((rule: RuleNewToMember): string => {
      return rule.ruleId.toString();
    })
    .sort();
}

describe("readRulesOfMember: every rule that pages a member now", () => {
  test("named, through their teams and on the roster of a schedule they are on call in - named first, then teams, then schedules", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);
    world.nameSchedule(PRIMARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), ANA);

    const rules: MemberRules | null =
      await EscalationRuleReach.readRulesOfMember({
        projectId: PROJECT_ID,
        userId: ANA,
      });

    expect(rulePathsOf(rules!)).toEqual([
      `${RulePathKind.Person} on ${RULE_ID.toString()} of ${POLICY_ID.toString()}`,
      `${RulePathKind.Team} ${PLATFORM.toString()} on ${OTHER_POLICY_RULE_ID.toString()} of ${OTHER_POLICY_ID.toString()}`,
      `${RulePathKind.OnCall} ${PRIMARY.toString()} on ${OTHER_RULE_ID.toString()} of ${POLICY_ID.toString()}`,
    ]);
    expect(rules!.teams).toEqual([
      {
        teamId: PLATFORM,
        membershipId: platform.id.toString(),
        createdAt: platform.createdAt,
      },
    ]);
  });

  test("the roster as its hand-offs stored it, not the moment's on-call person", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);
    world.roster.set(PRIMARY.toString(), ANA);

    const rules: MemberRules | null =
      await EscalationRuleReach.readRulesOfMember({
        projectId: PROJECT_ID,
        userId: ANA,
      });

    expect(rulePathsOf(rules!)).toEqual([
      `${RulePathKind.OnCall} ${PRIMARY.toString()} on ${RULE_ID.toString()} of ${POLICY_ID.toString()}`,
    ]);
  });

  test("a rule that pages the next in a schedule's rotation does not page whoever is on call in it", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY, { pageNextInRotation: true });
    world.onCall.set(PRIMARY.toString(), ANA);

    const rules: MemberRules | null =
      await EscalationRuleReach.readRulesOfMember({
        projectId: PROJECT_ID,
        userId: ANA,
      });

    expect(rulePathsOf(rules!)).toEqual([]);
  });

  test("a team they are only invited to is not theirs, and someone only invited is no member: null", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.namePerson(IVY);

    await expect(
      EscalationRuleReach.readRulesOfMember({
        projectId: PROJECT_ID,
        userId: IVY,
      }),
    ).resolves.toBeNull();
  });
});

describe("getRulesNewToMember: the rules that started paging them when they joined", () => {
  async function newsOf(
    userId: ObjectID,
    membershipId: ObjectID | null,
  ): Promise<RulesNewToMember> {
    const rules: MemberRules | null =
      await EscalationRuleReach.readRulesOfMember({
        projectId: PROJECT_ID,
        userId: userId,
      });

    return EscalationRuleReach.getRulesNewToMember({
      rules: rules!,
      join: { membershipId: membershipId },
    });
  }

  test("someone who joined the project: every rule that pages them now, each once", async () => {
    world.addMember(IVY, PLATFORM, false);
    world.namePerson(IVY);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_POLICY_RULE_ID);
    world.nameSchedule(PRIMARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), IVY);
    world.accept(IVY);

    const news: RulesNewToMember = await newsOf(IVY, null);

    expect(news.joinedProject).toBe(true);
    expect(news.teamId).toBeNull();
    expect(newRuleIds(news)).toEqual(
      [
        RULE_ID.toString(),
        OTHER_RULE_ID.toString(),
        OTHER_POLICY_RULE_ID.toString(),
      ].sort(),
    );

    // Named and through the team on the one rule: still one rule, with both paths.
    const first: RuleNewToMember = news.rules.find((rule: RuleNewToMember) => {
      return rule.ruleId.toString() === RULE_ID.toString();
    })!;
    expect(
      first.paths.map((path: PersonRulePath): RulePathKind => {
        return path.kind;
      }),
    ).toEqual([RulePathKind.Person, RulePathKind.Team]);
  });

  test("their first membership, made accepted, with none older: the project joined", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);

    const news: RulesNewToMember = await newsOf(ANA, platform.id);

    expect(news.joinedProject).toBe(true);
    expect(newRuleIds(news)).toEqual([RULE_ID.toString()]);
  });

  test("a member who joined another team: the rules naming it that paged them through nothing lasting before", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);
    world.nameTeam(PAYMENTS_TEAM, OTHER_POLICY_RULE_ID);

    const news: RulesNewToMember = await newsOf(ANA, platform.id);

    expect(news.joinedProject).toBe(false);
    expect(news.teamId?.toString()).toBe(PLATFORM.toString());
    expect(newRuleIds(news)).toEqual(
      [RULE_ID.toString(), OTHER_RULE_ID.toString()].sort(),
    );
  });

  test("a rule that named them already is no news", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    const news: RulesNewToMember = await newsOf(ANA, platform.id);

    expect(newRuleIds(news)).toEqual([OTHER_RULE_ID.toString()]);
  });

  test("a rule that paged them through another team of theirs since before is no news", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PAYMENTS_TEAM);
    world.nameTeam(PLATFORM);

    const news: RulesNewToMember = await newsOf(ANA, platform.id);

    expect(news.joinedProject).toBe(false);
    expect(newRuleIds(news)).toEqual([]);
  });

  test("two teams joined at the same moment, both on a rule: the older membership tells, the newer does not", async () => {
    // Made at one instant: told apart by id, the same way each time.
    const at: Date = new Date("2026-11-20T12:00:00.000Z");
    const first: WorldMembership = world.addMember(ANA, PLATFORM, true);
    const second: WorldMembership = world.addMember(ANA, PAYMENTS_TEAM, true);
    first.createdAt = at;
    second.createdAt = at;
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM);

    const [older, newer]: [WorldMembership, WorldMembership] =
      first.id.toString().toLowerCase() < second.id.toString().toLowerCase()
        ? [first, second]
        : [second, first];

    const olderNews: RulesNewToMember = await newsOf(ANA, older.id);
    const newerNews: RulesNewToMember = await newsOf(ANA, newer.id);

    // The older one is their first: the project joined, the rule new.
    expect(olderNews.joinedProject).toBe(true);
    expect(newRuleIds(olderNews)).toEqual([RULE_ID.toString()]);
    expect(newRuleIds(newerNews)).toEqual([]);
  });

  test("being on call in one of its schedules does not keep the team from being news", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);
    world.nameTeam(PLATFORM);

    const news: RulesNewToMember = await newsOf(ANA, platform.id);

    expect(newRuleIds(news)).toEqual([RULE_ID.toString()]);
  });

  test("a rule that pages them only through a schedule is no news of a team joined", async () => {
    world.addMember(ANA, PAYMENTS_TEAM, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), ANA);

    const news: RulesNewToMember = await newsOf(ANA, platform.id);

    expect(newRuleIds(news)).toEqual([]);
  });

  test("a membership that is not theirs any more started nothing", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.namePerson(ANA);

    const news: RulesNewToMember = await newsOf(ANA, ObjectID.generate());

    expect(news.joinedProject).toBe(false);
    expect(news.rules).toEqual([]);
  });
});

describe("openTimeLogsOfMember: the shift someone joined during", () => {
  test("a schedule whose roster has them on call is logged from when they joined, for each rule paging its on-call person", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.nameSchedule(PRIMARY, { ruleId: OTHER_RULE_ID });
    world.nameSchedule(PRIMARY, {
      ruleId: OTHER_POLICY_RULE_ID,
      pageNextInRotation: true,
    });
    world.onCall.set(PRIMARY.toString(), ANA);

    await EscalationRuleReach.openTimeLogsOfMember({
      projectId: PROJECT_ID,
      userId: ANA,
    });

    expect(world.timeLogs).toEqual([
      {
        action: "start",
        userId: ANA.toString(),
        ruleId: RULE_ID.toString(),
        teamId: null,
        scheduleId: PRIMARY.toString(),
      },
      {
        action: "start",
        userId: ANA.toString(),
        ruleId: OTHER_RULE_ID.toString(),
        teamId: null,
        scheduleId: PRIMARY.toString(),
      },
    ]);
  });

  test("a schedule whose roster has someone else on call logs nothing for them", async () => {
    world.addMember(ANA, PLATFORM, true);
    world.nameSchedule(PRIMARY);
    world.onCall.set(PRIMARY.toString(), BO);

    await EscalationRuleReach.openTimeLogsOfMember({
      projectId: PROJECT_ID,
      userId: ANA,
    });

    expect(world.timeLogs).toEqual([]);
  });
});
