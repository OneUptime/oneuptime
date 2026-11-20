import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import logger from "../../../Server/Utils/Logger";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ON-CALL POLICIES SOMEONE IS ON DUTY FOR: A FEW READS, SIDE BY SIDE,
 * AND KEPT A MINUTE.
 *
 * The dashboard's header asks on every page which on-call policies the
 * person is on duty for in the project
 * (/on-call-duty-policy/current-on-duty-escalation-policies). It ran five
 * reads one after another - the schedules whose roster they are on, their
 * teams, and the escalation rules that page them, their teams and those
 * schedules - uncached, and it was what showed "unable to fetch on-call
 * policies" when a customer's pool was full.
 *
 * Pinned here, with the five reads stubbed at the services:
 *   - the person's own rules, their teams and their schedules are read
 *     without waiting on each other; a team or schedule list that is empty
 *     reads no rules for it;
 *   - the answer is the one the sequential reads gave (next-in-rotation
 *     schedule rules left out);
 *   - it is kept OnDutyPoliciesCache.TTL_MS per person and project, built
 *     once for the requests that miss together, never kept when it failed,
 *     and built again at once after a change of the project
 *     (OnDutyPoliciesCache.forgetProjects) - one made while it was being
 *     built included.
 * Redis is held in memory for the cache's generations.
 */

const PROJECT: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000001");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "0d000000-0000-4000-8000-000000000002",
);
const PERSON: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000011");
const OTHER_PERSON: ObjectID = new ObjectID(
  "0d000000-0000-4000-8000-000000000012",
);
const TEAM_ID: ObjectID = new ObjectID("0d000000-0000-4000-8000-000000000021");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "0d000000-0000-4000-8000-000000000031",
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

// Lets every promise that can settle now settle: the reads that can start, start.
async function flush(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

function team(): Team {
  const row: Team = new Team();
  row.id = TEAM_ID;
  row.name = "Database";
  return row;
}

function schedule(): OnCallDutyPolicySchedule {
  const row: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  row.id = SCHEDULE_ID;
  row.name = "Primary";
  return row;
}

function ruleByUser(): OnCallDutyPolicyEscalationRuleUser {
  const row: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();
  row.id = ObjectID.generate();
  return row;
}

function ruleByTeam(): OnCallDutyPolicyEscalationRuleTeam {
  const row: OnCallDutyPolicyEscalationRuleTeam =
    new OnCallDutyPolicyEscalationRuleTeam();
  row.id = ObjectID.generate();
  return row;
}

function ruleBySchedule(
  pageNextInRotation: boolean,
): OnCallDutyPolicyEscalationRuleSchedule {
  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.pageNextInRotation = pageNextInRotation;
  return row;
}

const redis: Map<string, string> = new Map<string, string>();

let schedulesRead: jest.SpyInstance;
let teamsRead: jest.SpyInstance;
let userRulesRead: jest.SpyInstance;
let teamRulesRead: jest.SpyInstance;
let scheduleRulesRead: jest.SpyInstance;

const userRule: OnCallDutyPolicyEscalationRuleUser = ruleByUser();
const teamRule: OnCallDutyPolicyEscalationRuleTeam = ruleByTeam();
const scheduleRule: OnCallDutyPolicyEscalationRuleSchedule =
  ruleBySchedule(false);
const nextInRotationRule: OnCallDutyPolicyEscalationRuleSchedule =
  ruleBySchedule(true);

function readCount(): number {
  return [
    schedulesRead,
    teamsRead,
    userRulesRead,
    teamRulesRead,
    scheduleRulesRead,
  ].reduce((sum: number, spy: jest.SpyInstance) => {
    return sum + spy.mock.calls.length;
  }, 0);
}

async function onDuty(
  projectId: ObjectID = PROJECT,
  userId: ObjectID = PERSON,
): ReturnType<
  typeof OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDuty
> {
  return await OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDuty({
    projectId,
    userId,
  });
}

beforeEach(() => {
  OnDutyPoliciesCache.clear();
  redis.clear();

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );

  schedulesRead = jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "getOnCallSchedulesWhereUserIsOnCallDuty",
    )
    .mockResolvedValue([schedule()] as never);
  teamsRead = jest
    .spyOn(TeamService, "getTeamsUserIsAPartOf")
    .mockResolvedValue([team()] as never);
  userRulesRead = jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockResolvedValue([userRule] as never);
  teamRulesRead = jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue([teamRule] as never);
  scheduleRulesRead = jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue([scheduleRule, nextInRotationRule] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the reads", () => {
  test("the person's own rules, their teams and their schedules are read side by side", async () => {
    const teams: Deferred<Array<Team>> = deferred<Array<Team>>();
    const schedules: Deferred<Array<OnCallDutyPolicySchedule>> =
      deferred<Array<OnCallDutyPolicySchedule>>();
    const userRules: Deferred<Array<OnCallDutyPolicyEscalationRuleUser>> =
      deferred<Array<OnCallDutyPolicyEscalationRuleUser>>();

    teamsRead.mockReturnValueOnce(teams.promise as never);
    schedulesRead.mockReturnValueOnce(schedules.promise as never);
    userRulesRead.mockReturnValueOnce(userRules.promise as never);

    const answer: ReturnType<typeof onDuty> = onDuty();

    await flush();

    // All three started, none answered.
    expect(teamsRead).toHaveBeenCalledTimes(1);
    expect(schedulesRead).toHaveBeenCalledTimes(1);
    expect(userRulesRead).toHaveBeenCalledTimes(1);
    expect(teamRulesRead).not.toHaveBeenCalled();
    expect(scheduleRulesRead).not.toHaveBeenCalled();

    // Each kind of rule is read as soon as what it needs is.
    teams.resolve([team()]);

    await flush();

    expect(teamRulesRead).toHaveBeenCalledTimes(1);
    expect(scheduleRulesRead).not.toHaveBeenCalled();

    schedules.resolve([schedule()]);
    userRules.resolve([userRule]);

    await expect(answer).resolves.toEqual({
      escalationRulesByUser: [userRule],
      escalationRulesByTeam: [teamRule],
      escalationRulesBySchedule: [scheduleRule],
    });
  });

  test("the rules are read as before: by the person, by their teams' ids, by their schedules' ids, in the project", async () => {
    await onDuty();

    // The project, and no other: a read of one project's is a read across projects of one.
    const inTheProject: (filter: unknown) => void = (filter: unknown): void => {
      expect(JSON.stringify(filter)).toContain(PROJECT.toString());
      expect(JSON.stringify(filter)).not.toContain(OTHER_PROJECT.toString());
    };

    expect(userRulesRead.mock.calls[0]![0].query.userId).toEqual(PERSON);
    expect(Object.keys(userRulesRead.mock.calls[0]![0].query).sort()).toEqual([
      "projectId",
      "userId",
    ]);
    inTheProject(userRulesRead.mock.calls[0]![0].query.projectId);
    expect(teamsRead.mock.calls[0]![0]).toEqual({
      userId: PERSON,
      projectIds: [PROJECT],
    });
    expect(schedulesRead.mock.calls[0]![0]).toEqual({
      userId: PERSON,
      projectIds: [PROJECT],
    });
    inTheProject(teamRulesRead.mock.calls[0]![0].query.projectId);
    expect(
      JSON.stringify(teamRulesRead.mock.calls[0]![0].query.teamId),
    ).toContain(TEAM_ID.toString());
    inTheProject(scheduleRulesRead.mock.calls[0]![0].query.projectId);
    expect(
      JSON.stringify(
        scheduleRulesRead.mock.calls[0]![0].query.onCallDutyPolicyScheduleId,
      ),
    ).toContain(SCHEDULE_ID.toString());
    expect(scheduleRulesRead.mock.calls[0]![0].select.pageNextInRotation).toBe(
      true,
    );
  });

  test("a rule that pages the next person in a schedule's rotation is not one its on-call person is on duty for", async () => {
    const answer: Awaited<ReturnType<typeof onDuty>> = await onDuty();

    expect(answer.escalationRulesBySchedule).toEqual([scheduleRule]);
  });

  test("someone in no team and on no roster: no team or schedule rules are read", async () => {
    teamsRead.mockResolvedValue([] as never);
    schedulesRead.mockResolvedValue([] as never);

    await expect(onDuty()).resolves.toEqual({
      escalationRulesByUser: [userRule],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });

    expect(teamRulesRead).not.toHaveBeenCalled();
    expect(scheduleRulesRead).not.toHaveBeenCalled();
    expect(readCount()).toBe(3);
  });

  test("a read that fails fails the request", async () => {
    teamRulesRead.mockRejectedValue(new Error("pool exhausted"));

    await expect(onDuty()).rejects.toThrow("pool exhausted");
  });
});

/*
 * MY ON-CALL POLICIES, ACROSS EVERY PROJECT THE PERSON MAY OPEN (#8124).
 *
 * The page asked each project in turn, one request after another: someone
 * in 100 projects waited for 100 requests, each with its five reads. Now
 * one request answers for all of them, with the same five reads whatever
 * the number of projects, and each project's answer is kept as its own
 * request keeps it.
 */
describe("across the person's projects", () => {
  const THIRD_PROJECT: ObjectID = new ObjectID(
    "0d000000-0000-4000-8000-000000000003",
  );
  const OTHER_TEAM_ID: ObjectID = new ObjectID(
    "0d000000-0000-4000-8000-000000000022",
  );
  const OTHER_SCHEDULE_ID: ObjectID = new ObjectID(
    "0d000000-0000-4000-8000-000000000032",
  );

  function inProject<T extends { projectId?: ObjectID | undefined }>(
    row: T,
    projectId: ObjectID,
  ): T {
    row.projectId = projectId;
    return row;
  }

  // Alex is named on a rule of PROJECT, in a team on a rule of OTHER_PROJECT, and on call in a schedule of both.
  const userRuleHere: OnCallDutyPolicyEscalationRuleUser = inProject(
    ruleByUser(),
    PROJECT,
  );
  const teamRuleThere: OnCallDutyPolicyEscalationRuleTeam = inProject(
    ruleByTeam(),
    OTHER_PROJECT,
  );
  const scheduleRuleHere: OnCallDutyPolicyEscalationRuleSchedule = inProject(
    ruleBySchedule(false),
    PROJECT,
  );
  const scheduleRuleThere: OnCallDutyPolicyEscalationRuleSchedule = inProject(
    ruleBySchedule(false),
    OTHER_PROJECT,
  );
  const nextInRotationThere: OnCallDutyPolicyEscalationRuleSchedule = inProject(
    ruleBySchedule(true),
    OTHER_PROJECT,
  );

  async function acrossProjects(
    projectIds: Array<ObjectID>,
    userId: ObjectID = PERSON,
  ): Promise<Map<string, Awaited<ReturnType<typeof onDuty>>>> {
    return await OnCallDutyPolicyService.getOnCallPoliciesWhereUserIsOnCallDutyInProjects(
      { projectIds, userId },
    );
  }

  function keyOf(projectId: ObjectID): string {
    return projectId.toString().toLowerCase();
  }

  // The projects a read asked in, in the order it named them.
  function projectsAskedIn(filter: unknown): Array<string> {
    return [PROJECT, OTHER_PROJECT, THIRD_PROJECT]
      .map((projectId: ObjectID): string => {
        return projectId.toString();
      })
      .filter((projectId: string): boolean => {
        return JSON.stringify(filter).includes(projectId);
      });
  }

  beforeEach(() => {
    const otherTeam: Team = new Team();
    otherTeam.id = OTHER_TEAM_ID;
    otherTeam.name = "Payments";

    const otherSchedule: OnCallDutyPolicySchedule =
      new OnCallDutyPolicySchedule();
    otherSchedule.id = OTHER_SCHEDULE_ID;
    otherSchedule.name = "Payments primary";

    teamsRead.mockResolvedValue([team(), otherTeam] as never);
    schedulesRead.mockResolvedValue([schedule(), otherSchedule] as never);
    userRulesRead.mockResolvedValue([userRuleHere] as never);
    teamRulesRead.mockResolvedValue([teamRuleThere] as never);
    scheduleRulesRead.mockResolvedValue([
      scheduleRuleHere,
      scheduleRuleThere,
      nextInRotationThere,
    ] as never);
  });

  test("three projects take the five reads one project takes, each asking in all three", async () => {
    await acrossProjects([PROJECT, OTHER_PROJECT, THIRD_PROJECT]);

    expect(readCount()).toBe(5);

    const all: Array<string> = [PROJECT, OTHER_PROJECT, THIRD_PROJECT].map(
      (projectId: ObjectID): string => {
        return projectId.toString();
      },
    );

    expect(
      projectsAskedIn(userRulesRead.mock.calls[0]![0].query.projectId),
    ).toEqual(all);
    expect(userRulesRead.mock.calls[0]![0].query.userId).toEqual(PERSON);
    expect(teamsRead.mock.calls[0]![0]).toEqual({
      userId: PERSON,
      projectIds: [PROJECT, OTHER_PROJECT, THIRD_PROJECT],
    });
    expect(schedulesRead.mock.calls[0]![0]).toEqual({
      userId: PERSON,
      projectIds: [PROJECT, OTHER_PROJECT, THIRD_PROJECT],
    });
    expect(
      projectsAskedIn(teamRulesRead.mock.calls[0]![0].query.projectId),
    ).toEqual(all);
    expect(
      projectsAskedIn(scheduleRulesRead.mock.calls[0]![0].query.projectId),
    ).toEqual(all);

    // Every team's and every schedule's rules, in one read each.
    expect(
      JSON.stringify(teamRulesRead.mock.calls[0]![0].query.teamId),
    ).toContain(OTHER_TEAM_ID.toString());
    expect(
      JSON.stringify(
        scheduleRulesRead.mock.calls[0]![0].query.onCallDutyPolicyScheduleId,
      ),
    ).toContain(OTHER_SCHEDULE_ID.toString());
  });

  test("each read says which project each rule is in", async () => {
    await acrossProjects([PROJECT, OTHER_PROJECT]);

    expect(userRulesRead.mock.calls[0]![0].select.projectId).toBe(true);
    expect(teamRulesRead.mock.calls[0]![0].select.projectId).toBe(true);
    expect(scheduleRulesRead.mock.calls[0]![0].select.projectId).toBe(true);
  });

  test("each rule goes to the project it is in, and a project where nothing pages the person answers empty", async () => {
    const answers: Map<
      string,
      Awaited<ReturnType<typeof onDuty>>
    > = await acrossProjects([PROJECT, OTHER_PROJECT, THIRD_PROJECT]);

    expect(Array.from(answers.keys())).toEqual([
      keyOf(PROJECT),
      keyOf(OTHER_PROJECT),
      keyOf(THIRD_PROJECT),
    ]);
    expect(answers.get(keyOf(PROJECT))).toEqual({
      escalationRulesByUser: [userRuleHere],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [scheduleRuleHere],
    });
    // A rule that pages the next person in a rotation is left out here too.
    expect(answers.get(keyOf(OTHER_PROJECT))).toEqual({
      escalationRulesByUser: [],
      escalationRulesByTeam: [teamRuleThere],
      escalationRulesBySchedule: [scheduleRuleThere],
    });
    expect(answers.get(keyOf(THIRD_PROJECT))).toEqual({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
  });

  test("a rule of a project nobody asked about is in no answer", async () => {
    userRulesRead.mockResolvedValue([
      userRuleHere,
      inProject(ruleByUser(), THIRD_PROJECT),
    ] as never);

    const answers: Map<
      string,
      Awaited<ReturnType<typeof onDuty>>
    > = await acrossProjects([PROJECT, OTHER_PROJECT]);

    expect(answers.has(keyOf(THIRD_PROJECT))).toBe(false);
    expect(answers.get(keyOf(PROJECT))!.escalationRulesByUser).toEqual([
      userRuleHere,
    ]);
    expect(answers.get(keyOf(OTHER_PROJECT))!.escalationRulesByUser).toEqual(
      [],
    );
  });

  test("each project's answer is kept: a project's own request after it reads nothing, and answers the same", async () => {
    const answers: Map<
      string,
      Awaited<ReturnType<typeof onDuty>>
    > = await acrossProjects([PROJECT, OTHER_PROJECT]);
    const reads: number = readCount();

    expect(await onDuty(PROJECT)).toBe(answers.get(keyOf(PROJECT)));
    expect(await onDuty(OTHER_PROJECT)).toBe(answers.get(keyOf(OTHER_PROJECT)));
    expect(readCount()).toBe(reads);
  });

  test("the projects already kept are not read again: the rest are read, together", async () => {
    await onDuty(PROJECT);
    expect(readCount()).toBe(5);

    await acrossProjects([PROJECT, OTHER_PROJECT, THIRD_PROJECT]);

    expect(readCount()).toBe(10);
    expect(
      projectsAskedIn(userRulesRead.mock.calls[1]![0].query.projectId),
    ).toEqual([OTHER_PROJECT.toString(), THIRD_PROJECT.toString()]);

    // And all of them kept now.
    await acrossProjects([PROJECT, OTHER_PROJECT, THIRD_PROJECT]);
    expect(readCount()).toBe(10);
  });

  test("a project's own request that misses with a request across projects shares its build", async () => {
    const userRules: Deferred<Array<OnCallDutyPolicyEscalationRuleUser>> =
      deferred<Array<OnCallDutyPolicyEscalationRuleUser>>();
    userRulesRead.mockReturnValueOnce(userRules.promise as never);

    const across: ReturnType<typeof acrossProjects> = acrossProjects([
      PROJECT,
      OTHER_PROJECT,
    ]);

    await flush();

    const own: ReturnType<typeof onDuty> = onDuty(OTHER_PROJECT);

    await flush();

    userRules.resolve([userRuleHere]);

    const [answers, answer] = await Promise.all([across, own]);

    expect(answer).toBe(answers.get(keyOf(OTHER_PROJECT)));
    expect(userRulesRead).toHaveBeenCalledTimes(1);
  });

  test("a change in one project reads that project again, and only it", async () => {
    await acrossProjects([PROJECT, OTHER_PROJECT]);
    expect(readCount()).toBe(5);

    await OnDutyPoliciesCache.forgetProjects([OTHER_PROJECT]);
    await acrossProjects([PROJECT, OTHER_PROJECT]);

    expect(readCount()).toBe(10);
    expect(
      projectsAskedIn(userRulesRead.mock.calls[1]![0].query.projectId),
    ).toEqual([OTHER_PROJECT.toString()]);
  });

  test("a read that fails fails the whole answer, and nothing of it is kept", async () => {
    scheduleRulesRead.mockRejectedValueOnce(new Error("pool exhausted"));

    await expect(acrossProjects([PROJECT, OTHER_PROJECT])).rejects.toThrow(
      "pool exhausted",
    );

    await acrossProjects([PROJECT, OTHER_PROJECT]);

    expect(userRulesRead).toHaveBeenCalledTimes(2);
  });

  test("no project: nothing is read", async () => {
    const answers: Map<
      string,
      Awaited<ReturnType<typeof onDuty>>
    > = await acrossProjects([]);

    expect(answers.size).toBe(0);
    expect(readCount()).toBe(0);
  });

  test("a project named twice, or in capitals, is one project", async () => {
    const answers: Map<
      string,
      Awaited<ReturnType<typeof onDuty>>
    > = await acrossProjects([
      PROJECT,
      new ObjectID(PROJECT.toString().toUpperCase()),
      OTHER_PROJECT,
    ]);

    expect(Array.from(answers.keys())).toEqual([
      keyOf(PROJECT),
      keyOf(OTHER_PROJECT),
    ]);
    expect(teamsRead.mock.calls[0]![0].projectIds).toHaveLength(2);
  });

  test("another person's answers are theirs", async () => {
    await acrossProjects([PROJECT, OTHER_PROJECT]);
    await acrossProjects([PROJECT, OTHER_PROJECT], OTHER_PERSON);

    expect(readCount()).toBe(10);
    expect(userRulesRead.mock.calls[1]![0].query.userId).toEqual(OTHER_PERSON);
  });
});

describe("kept a minute per person and project", () => {
  test("asked again within the minute: nothing is read", async () => {
    const first: Awaited<ReturnType<typeof onDuty>> = await onDuty();
    const reads: number = readCount();

    expect(await onDuty()).toBe(first);
    expect(readCount()).toBe(reads);
  });

  test("another person, or the same person in another project, is read apart", async () => {
    await onDuty();
    const reads: number = readCount();

    await onDuty(PROJECT, OTHER_PERSON);
    await onDuty(OTHER_PROJECT, PERSON);

    expect(readCount()).toBe(reads + 10);
  });

  test("once the minute has run out it is read again", async () => {
    let now: number = Date.UTC(2026, 10, 14, 12, 0, 0);
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });

    await onDuty();
    const reads: number = readCount();

    now += OnDutyPoliciesCache.TTL_MS - 1000;
    await onDuty();
    expect(readCount()).toBe(reads);

    now += 2000;
    await onDuty();
    expect(readCount()).toBe(reads * 2);
  });

  test("requests that ask together share one build", async () => {
    const userRules: Deferred<Array<OnCallDutyPolicyEscalationRuleUser>> =
      deferred<Array<OnCallDutyPolicyEscalationRuleUser>>();
    userRulesRead.mockReturnValueOnce(userRules.promise as never);

    const answers: Array<ReturnType<typeof onDuty>> = [
      onDuty(),
      onDuty(),
      onDuty(),
    ];

    await flush();

    userRules.resolve([userRule]);

    const [first, second, third] = await Promise.all(answers);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(userRulesRead).toHaveBeenCalledTimes(1);
  });

  test("a build that failed is not kept: the next request reads again", async () => {
    userRulesRead.mockRejectedValueOnce(new Error("statement timeout"));

    await expect(onDuty()).rejects.toThrow("statement timeout");
    await expect(onDuty()).resolves.toMatchObject({
      escalationRulesByUser: [userRule],
    });
    expect(userRulesRead).toHaveBeenCalledTimes(2);
  });
});

describe("a change in the project is seen at once", () => {
  test("after forgetProjects, the project's answers are built again; another project's are kept", async () => {
    await onDuty(PROJECT);
    await onDuty(OTHER_PROJECT);
    const reads: number = readCount();

    await OnDutyPoliciesCache.forgetProjects([PROJECT]);

    await onDuty(PROJECT);
    expect(readCount()).toBe(reads + 5);

    await onDuty(OTHER_PROJECT);
    expect(readCount()).toBe(reads + 5);
  });

  test("an answer built while the change was made is not served after it", async () => {
    const userRules: Deferred<Array<OnCallDutyPolicyEscalationRuleUser>> =
      deferred<Array<OnCallDutyPolicyEscalationRuleUser>>();
    userRulesRead.mockReturnValueOnce(userRules.promise as never);

    const stale: ReturnType<typeof onDuty> = onDuty();

    await flush();

    await OnDutyPoliciesCache.forgetProjects([PROJECT]);
    userRules.resolve([]);
    await stale;

    // Read again, with the change.
    await expect(onDuty()).resolves.toMatchObject({
      escalationRulesByUser: [userRule],
    });
    expect(userRulesRead).toHaveBeenCalledTimes(2);
  });

  test("a project named in capitals is the same project", async () => {
    await onDuty(PROJECT);
    const reads: number = readCount();

    await OnDutyPoliciesCache.forgetProjects([
      PROJECT.toString().toUpperCase(),
    ]);
    await onDuty(PROJECT);

    expect(readCount()).toBe(reads + 5);
  });

  test("with Redis out of reach, answers are still kept and a change made here still counts here", async () => {
    (GlobalCache.getString as unknown as jest.Mock).mockRejectedValue(
      new Error("connection refused"),
    );
    (GlobalCache.setString as unknown as jest.Mock).mockRejectedValue(
      new Error("connection refused"),
    );

    await onDuty();
    const reads: number = readCount();

    await onDuty();
    expect(readCount()).toBe(reads);

    await OnDutyPoliciesCache.forgetProjects([PROJECT]);
    await onDuty();
    expect(readCount()).toBe(reads * 2);
  });

  test("nothing to forget: nothing is written", async () => {
    await OnDutyPoliciesCache.forgetProjects([null, undefined]);

    expect(redis.size).toBe(0);
  });
});

/*
 * The writes that can change who is on duty for what start a new
 * generation of the project's answers. Each hook is driven for real, with
 * what else it does stubbed or given nothing to do.
 */
describe("the writes that change who is on duty for what", () => {
  type Hooks = {
    onCreateSuccess: (
      onCreate: unknown,
      createdItem: unknown,
    ) => Promise<unknown>;
    onDeleteSuccess: (
      onDelete: unknown,
      itemIds: Array<ObjectID>,
    ) => Promise<unknown>;
    onUpdateSuccess: (
      onUpdate: unknown,
      itemIds: Array<ObjectID>,
    ) => Promise<unknown>;
  };

  let forgotten: Array<string>;
  let forget: jest.SpyInstance;

  function hooksOf(service: unknown): Hooks {
    return service as Hooks;
  }

  beforeEach(() => {
    forgotten = [];
    forget = jest
      .spyOn(OnDutyPoliciesCache, "forgetProjects")
      .mockImplementation(
        async (
          projectIds: Array<ObjectID | string | null | undefined>,
        ): Promise<void> => {
          for (const projectId of projectIds) {
            if (projectId) {
              forgotten.push(projectId.toString());
            }
          }
        },
      );
  });

  test("a person added to an escalation rule", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findOneById")
      .mockResolvedValue(null as never);

    const created: OnCallDutyPolicyEscalationRuleUser = ruleByUser();
    created.projectId = PROJECT;

    await hooksOf(OnCallDutyPolicyEscalationRuleUserService).onCreateSuccess(
      { createBy: { data: created, props: {} }, carryForward: null },
      created,
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("a person taken off an escalation rule", async () => {
    const deleted: OnCallDutyPolicyEscalationRuleUser = ruleByUser();
    deleted.projectId = PROJECT;

    await hooksOf(OnCallDutyPolicyEscalationRuleUserService).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: {} },
        carryForward: { deletedItems: [deleted] },
      },
      [deleted.id!],
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("a team added to an escalation rule", async () => {
    const created: OnCallDutyPolicyEscalationRuleTeam = ruleByTeam();
    created.projectId = PROJECT;

    const stored: OnCallDutyPolicyEscalationRuleTeam = ruleByTeam();
    stored.projectId = PROJECT;
    stored.teamId = TEAM_ID;
    stored.onCallDutyPolicy = new OnCallDutyPolicy();

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findOneById")
      .mockResolvedValue(stored as never);
    jest.spyOn(TeamMemberService, "getUsersInTeam").mockResolvedValue([]);
    // Its accepted members, who the team adds to the rule (#10464).
    jest.spyOn(TeamMemberService, "getUsersInTeams").mockResolvedValue([]);

    await hooksOf(OnCallDutyPolicyEscalationRuleTeamService).onCreateSuccess(
      { createBy: { data: created, props: {} }, carryForward: null },
      created,
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("a team taken off an escalation rule", async () => {
    const deleted: OnCallDutyPolicyEscalationRuleTeam = ruleByTeam();
    deleted.projectId = PROJECT;
    deleted.teamId = TEAM_ID;

    jest.spyOn(TeamMemberService, "getUsersInTeam").mockResolvedValue([]);

    await hooksOf(OnCallDutyPolicyEscalationRuleTeamService).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: {} },
        carryForward: { deletedItems: [deleted] },
      },
      [deleted.id!],
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("a schedule added to an escalation rule: told once the roster the attachment changes is written", async () => {
    const order: Array<string> = [];

    const created: OnCallDutyPolicyEscalationRuleSchedule =
      ruleBySchedule(false);
    created.projectId = PROJECT;

    const stored: OnCallDutyPolicyEscalationRuleSchedule =
      ruleBySchedule(false);
    stored.projectId = PROJECT;
    stored.onCallDutyPolicyScheduleId = SCHEDULE_ID;

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneById")
      .mockResolvedValue(stored as never);

    const internals: {
      refreshScheduleRoster: () => Promise<void>;
      propagateAttachmentChange: () => Promise<void>;
    } = OnCallDutyPolicyEscalationRuleScheduleService as unknown as {
      refreshScheduleRoster: () => Promise<void>;
      propagateAttachmentChange: () => Promise<void>;
    };

    jest
      .spyOn(internals, "refreshScheduleRoster")
      .mockImplementation(async () => {
        order.push("roster written");
      });
    jest
      .spyOn(internals, "propagateAttachmentChange")
      .mockImplementation(async () => {
        order.push("attachment propagated");
      });
    forget.mockImplementation(async () => {
      order.push("forgotten");
    });
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
      .mockResolvedValue(null as never);

    await hooksOf(
      OnCallDutyPolicyEscalationRuleScheduleService,
    ).onCreateSuccess(
      { createBy: { data: created, props: {} }, carryForward: null },
      created,
    );

    expect(order).toEqual([
      "roster written",
      "attachment propagated",
      "forgotten",
    ]);
    expect(forget).toHaveBeenCalledWith([PROJECT]);
  });

  test("a schedule taken off an escalation rule: told once its roster is written again", async () => {
    const order: Array<string> = [];

    const deleted: OnCallDutyPolicyEscalationRuleSchedule =
      ruleBySchedule(true);
    deleted.projectId = PROJECT;
    deleted.onCallDutyPolicyScheduleId = SCHEDULE_ID;

    const internals: {
      refreshScheduleRoster: () => Promise<void>;
      propagateAttachmentChange: () => Promise<void>;
    } = OnCallDutyPolicyEscalationRuleScheduleService as unknown as {
      refreshScheduleRoster: () => Promise<void>;
      propagateAttachmentChange: () => Promise<void>;
    };

    jest
      .spyOn(internals, "refreshScheduleRoster")
      .mockImplementation(async () => {
        order.push("roster written");
      });
    jest
      .spyOn(internals, "propagateAttachmentChange")
      .mockResolvedValue(undefined);
    forget.mockImplementation(async () => {
      order.push("forgotten");
    });

    await hooksOf(
      OnCallDutyPolicyEscalationRuleScheduleService,
    ).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: {} },
        carryForward: { deletedItems: [deleted] },
      },
      [deleted.id!],
    );

    expect(order).toEqual(["roster written", "forgotten"]);
    expect(forget).toHaveBeenCalledWith([PROJECT]);
  });

  test("an escalation rule deleted: its people, teams and schedules go with it", async () => {
    await hooksOf(OnCallDutyPolicyEscalationRuleService).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: { isRoot: true, tenantId: PROJECT } },
        carryForward: null,
      },
      [ObjectID.generate()],
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("an escalation rule renamed or moved", async () => {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.name = "Second line";

    await hooksOf(OnCallDutyPolicyEscalationRuleService).onUpdateSuccess(
      {
        updateBy: { query: {}, data: rule, props: { tenantId: PROJECT } },
        carryForward: null,
      },
      [ObjectID.generate()],
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("a policy deleted: its rules go with it", async () => {
    await hooksOf(OnCallDutyPolicyService).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: {} },
        carryForward: { projectId: PROJECT },
      },
      [ObjectID.generate()],
    );

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("someone's team membership made, accepted or ended", async () => {
    jest
      .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
      .mockResolvedValue(null);

    await TeamMemberService.refreshTokens(PERSON, PROJECT);

    expect(forgotten).toEqual([PROJECT.toString()]);
  });

  test("and the header reads the person's policies again after it", async () => {
    forget.mockRestore();
    jest
      .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
      .mockResolvedValue(null);

    await onDuty();
    const reads: number = readCount();

    // Joined a team that is on a rule: their teams' rules are read again.
    await TeamMemberService.refreshTokens(PERSON, PROJECT);
    await onDuty();

    expect(readCount()).toBe(reads + 5);
  });
});
