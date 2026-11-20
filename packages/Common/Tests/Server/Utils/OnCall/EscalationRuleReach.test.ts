import EscalationRuleReach, {
  EVERY_PATH,
  LASTING_PATHS,
  RuleMembers,
  RulePath,
  RulePathKind,
  RuleReach,
} from "../../../../Server/Utils/OnCall/EscalationRuleReach";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import ObjectID from "../../../../Types/ObjectID";
import ReachWorld, {
  ANA,
  BO,
  CY,
  IVY,
  OTHER_RULE_ID,
  PAYMENTS_TEAM,
  PLATFORM,
  POLICY_ID,
  PRIMARY,
  PROJECT_ID,
  RULE_ID,
  SECONDARY,
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
