import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import EscalationRuleRespondersWorld, {
  ADDED,
  ANA,
  BO,
  CY,
  IVY,
  MEMBERSHIPS,
  NAMES,
  PAYMENTS,
  PLATFORM,
  POLICY_ID,
  PRIMARY,
  PROJECT_ID,
  REMOVED,
  RULE_ID,
  id,
} from "../TestingUtils/EscalationRuleRespondersWorld";
import { InMemoryTable, StoredRow } from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A TEAM, A PERSON OR A SCHEDULE ADDED TO AN ESCALATION RULE, AND TAKEN OFF
 * IT, WITH ITS ROW READ BACK AS IT IS STORED (#10970).
 *
 * The hooks of an escalation rule's person, team and schedule rows read the
 * policy's and the rule's ids - and the person's - off the relation objects
 * their read joined. Postgres joins them, so production never failed; but a
 * row read back without them - here, from tables kept in memory, which join
 * nothing - threw "Cannot read properties of undefined (reading 'id')" after
 * the team's row was saved, and a new policy's first level stopped there.
 * The hooks read the row's own ID columns now.
 *
 * Here the rows are added as every client adds them - addTeam, addUser and
 * addOnCallSchedules, which make a new rule's responders (the Dashboard's
 * Add Escalation Rule, a new policy's first level, the guided setup, Ask
 * AI's set_up_paging, an import) - and taken off with the service's delete,
 * as the Dashboard, the API, Terraform and MCP do: through the real
 * services, their hooks and EscalationRuleReach, into tables in memory,
 * the on-call time logs too (EscalationRuleRespondersWorld). The rule can
 * page Platform - Ana and Bo, and Ivy, who is only invited - and Payments,
 * Ana and Cy:
 *
 *   - each member hears "added" once for the rule, whichever path is first;
 *   - "removed" only when nothing on the rule pages them any more;
 *   - an invitee is told nothing and logged nowhere until they join;
 *   - a time log starts and ends with each path.
 *
 * EscalationRuleRespondersOverHttp sends the Dashboard's and the API's
 * requests for the same through the server's own routes.
 */

let world: EscalationRuleRespondersWorld;
let caller: DatabaseCommonInteractionProps;

beforeEach(() => {
  world = new EscalationRuleRespondersWorld();
  world.install();

  // A member of the project who may change its on-call policies.
  caller = {
    ...customDomainCaller({
      permissions: [Permission.OnCallMember],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function addTeam(teamId: string): Promise<void> {
  await EscalationRuleService.addTeam(
    PROJECT_ID,
    new ObjectID(RULE_ID),
    new ObjectID(POLICY_ID),
    new ObjectID(teamId),
    caller,
  );
  await world.settle();
}

async function addUser(userId: string): Promise<void> {
  await EscalationRuleService.addUser(
    PROJECT_ID,
    new ObjectID(RULE_ID),
    new ObjectID(POLICY_ID),
    new ObjectID(userId),
    caller,
  );
  await world.settle();
}

async function addSchedule(scheduleId: string): Promise<void> {
  await EscalationRuleService.addOnCallSchedules(
    PROJECT_ID,
    new ObjectID(RULE_ID),
    new ObjectID(POLICY_ID),
    new ObjectID(scheduleId),
    caller,
  );
  await world.settle();
}

// The rule's row naming `value` in `column`: there, or the test fails.
function rowOf(table: InMemoryTable, column: string, value: string): ObjectID {
  const rowId: string | null = world.rowOf(table, column, value);
  expect(rowId).not.toBeNull();
  return new ObjectID(rowId!);
}

async function takeOffTeam(teamId: string): Promise<void> {
  await EscalationRuleTeamService.deleteOneById({
    id: rowOf(world.ruleTeams, "teamId", teamId),
    props: caller,
  });
  await world.settle();
}

async function takeOffUser(userId: string): Promise<void> {
  await EscalationRuleUserService.deleteOneById({
    id: rowOf(world.ruleUsers, "userId", userId),
    props: caller,
  });
  await world.settle();
}

async function takeOffSchedule(scheduleId: string): Promise<void> {
  await EscalationRuleScheduleService.deleteOneById({
    id: rowOf(world.ruleSchedules, "onCallDutyPolicyScheduleId", scheduleId),
    props: caller,
  });
  await world.settle();
}

describe("addTeam, a team with accepted members and an invitee", () => {
  test("is saved with its ids, and nothing is logged as an error", async () => {
    await addTeam(PLATFORM);

    expect(world.errors).toEqual([]);
    expect(world.ruleTeams.inserts).toHaveLength(1);

    const row: StoredRow = world.ruleTeams.inserts[0]!;
    expect(id(row["teamId"])).toBe(id(PLATFORM));
    expect(id(row["onCallDutyPolicyEscalationRuleId"])).toBe(id(RULE_ID));
    expect(id(row["onCallDutyPolicyId"])).toBe(id(POLICY_ID));
    expect(id(row["createdByUserId"])).toBe(id(caller.userId));
  });

  test("its accepted members hear 'added' once and are logged on the team; the invitee is told nothing and logged nowhere", async () => {
    await addTeam(PLATFORM);

    expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("the policy's feed hears the team was added, on the policy the row's column names", async () => {
    await addTeam(PLATFORM);

    expect(world.feed).toEqual([
      {
        policyId: id(POLICY_ID),
        markdown: expect.stringContaining("Added team"),
      },
    ]);
  });
});

describe("a member in two of the rule's teams", () => {
  test("the second team tells only its other people; she is logged on both", async () => {
    await addTeam(PLATFORM);
    world.forgetTold();

    await addTeam(PAYMENTS);

    expect(world.toldThat(ADDED)).toEqual(["Cy"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Payments",
      "Ana: team Platform",
      "Bo: team Platform",
      "Cy: team Payments",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("one team taken off: its other people hear 'removed', she does not; her log of the other team stays open", async () => {
    await addTeam(PLATFORM);
    await addTeam(PAYMENTS);
    world.forgetTold();

    await takeOffTeam(PLATFORM);

    expect(world.toldThat(REMOVED)).toEqual(["Bo"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Payments",
      "Cy: team Payments",
    ]);
    expect(world.endedLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("the other team taken off after: she hears 'removed' then, once", async () => {
    await addTeam(PLATFORM);
    await addTeam(PAYMENTS);
    await takeOffTeam(PLATFORM);
    world.forgetTold();

    await takeOffTeam(PAYMENTS);

    expect(world.toldThat(REMOVED)).toEqual(["Ana", "Cy"]);
    expect(world.openLogs()).toEqual([]);
    expect(world.errors).toEqual([]);
  });

  test("both teams taken off in one delete: she hears 'removed' once", async () => {
    await addTeam(PLATFORM);
    await addTeam(PAYMENTS);
    world.forgetTold();

    await EscalationRuleTeamService.deleteBy({
      query: { onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_ID) },
      limit: 10,
      skip: 0,
      props: caller,
    });
    await world.settle();

    expect(world.toldThat(REMOVED)).toEqual(["Ana", "Bo", "Cy"]);
    expect(world.openLogs()).toEqual([]);
    expect(world.ruleTeams.rows).toHaveLength(0);
    expect(world.errors).toEqual([]);
  });
});

describe("addUser", () => {
  test("someone named after their team: no news to them; logged by name too", async () => {
    await addTeam(PLATFORM);
    world.forgetTold();

    await addUser(ANA);

    expect(world.told).toEqual([]);
    expect(world.openLogs()).toEqual([
      "Ana: named",
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    // Every row is a change to the policy: its feed hears of this one too.
    expect(world.feed.pop()).toEqual({
      policyId: id(POLICY_ID),
      markdown: expect.stringContaining("Added **Ana**"),
    });
    expect(world.errors).toEqual([]);
  });

  test("their 'added' and 'removed' name the policy and the rule by the row's columns", async () => {
    await addUser(BO);
    await takeOffUser(BO);

    expect(world.told).toEqual([
      {
        userId: id(BO),
        eventType: ADDED,
        policyId: id(POLICY_ID),
        ruleId: id(RULE_ID),
      },
      {
        userId: id(BO),
        eventType: REMOVED,
        policyId: id(POLICY_ID),
        ruleId: id(RULE_ID),
      },
    ]);
    expect(world.errors).toEqual([]);
  });

  test("someone named first: told 'added' by name, and not again by their team", async () => {
    await addUser(ANA);

    expect(world.toldThat(ADDED)).toEqual(["Ana"]);

    await addTeam(PLATFORM);

    expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo"]);
    expect(world.errors).toEqual([]);
  });

  test("an invitee named: the row is saved, they are told nothing and logged nowhere", async () => {
    await addUser(IVY);

    expect(world.ruleUsers.inserts).toHaveLength(1);
    expect(id(world.ruleUsers.inserts[0]!["userId"])).toBe(id(IVY));
    expect(world.told).toEqual([]);
    expect(world.timeLogs.rows).toEqual([]);
    expect(world.errors).toEqual([]);
  });

  test("their name taken off while a team still pages them: not told; the named log ends, the team's stays open", async () => {
    await addTeam(PLATFORM);
    await addUser(ANA);
    world.forgetTold();

    await takeOffUser(ANA);

    expect(world.told).toEqual([]);
    expect(world.openLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.endedLogs()).toEqual(["Ana: named"]);
    expect(world.feed.pop()).toEqual({
      policyId: id(POLICY_ID),
      markdown: expect.stringContaining("Removed **Ana**"),
    });
    expect(world.errors).toEqual([]);
  });

  test("their name taken off when nothing else pages them: told 'removed' once, the log ends", async () => {
    await addUser(BO);
    world.forgetTold();

    await takeOffUser(BO);

    expect(world.toldThat(REMOVED)).toEqual(["Bo"]);
    expect(world.openLogs()).toEqual([]);
    expect(world.endedLogs()).toEqual(["Bo: named"]);
    expect(world.errors).toEqual([]);
  });

  test("an invitee's name taken off: told nothing", async () => {
    await addUser(IVY);

    await takeOffUser(IVY);

    expect(world.told).toEqual([]);
    expect(world.timeLogs.rows).toEqual([]);
    expect(world.errors).toEqual([]);
  });
});

describe("addOnCallSchedules", () => {
  test("whoever is on call, paged by nothing else on the rule: told 'added' once, logged on the schedule", async () => {
    world.onCall = BO;

    await addSchedule(PRIMARY);

    expect(world.toldThat(ADDED)).toEqual(["Bo"]);
    expect(world.openLogs()).toEqual(["Bo: on call in Primary"]);
    expect(world.feed).toEqual([
      {
        policyId: id(POLICY_ID),
        markdown: expect.stringContaining("Added on-call schedule"),
      },
    ]);
    expect(world.errors).toEqual([]);
  });

  test("whoever is on call, in one of its teams already: not told, logged on the schedule too", async () => {
    await addTeam(PAYMENTS);
    world.forgetTold();
    world.onCall = CY;

    await addSchedule(PRIMARY);

    expect(world.told).toEqual([]);
    expect(world.openLogs()).toEqual([
      "Ana: team Payments",
      "Cy: on call in Primary",
      "Cy: team Payments",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("taken off while a team still pages them: not told; the schedule's log ends", async () => {
    await addTeam(PAYMENTS);
    world.onCall = CY;
    await addSchedule(PRIMARY);
    world.forgetTold();

    await takeOffSchedule(PRIMARY);

    expect(world.told).toEqual([]);
    expect(world.endedLogs()).toEqual(["Cy: on call in Primary"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Payments",
      "Cy: team Payments",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("taken off when nothing else pages them: told 'removed' once", async () => {
    world.onCall = BO;
    await addSchedule(PRIMARY);
    world.forgetTold();

    await takeOffSchedule(PRIMARY);

    expect(world.toldThat(REMOVED)).toEqual(["Bo"]);
    expect(world.openLogs()).toEqual([]);
    expect(world.errors).toEqual([]);
  });

  test("an invitee on call: told nothing, logged nowhere, either way", async () => {
    world.onCall = IVY;

    await addSchedule(PRIMARY);
    await takeOffSchedule(PRIMARY);

    expect(world.told).toEqual([]);
    expect(world.timeLogs.rows).toEqual([]);
    expect(world.errors).toEqual([]);
  });
});

/*
 * Whatever order the rows come and go in: each member hears "added" once,
 * when the first path to them is added, and "removed" once, when the last
 * one goes; Ivy, only invited, nothing; and their open time logs are their
 * paths, one each. The orders are drawn from the shared seeded generator.
 */
describe("in any order", () => {
  interface Row {
    kind: "team" | "user";
    responderId: string;
  }

  const ROWS: Array<Row> = [
    { kind: "team", responderId: PLATFORM },
    { kind: "team", responderId: PAYMENTS },
    { kind: "user", responderId: ANA },
    { kind: "user", responderId: BO },
    { kind: "user", responderId: IVY },
  ];

  // Each member's paths while `rows` are on the rule, as the logs read.
  function pathsWhile(rows: Array<Row>): Array<string> {
    const paths: Array<string> = [];

    for (const row of rows) {
      if (row.kind === "user") {
        // Someone only invited is paged by nothing.
        if (row.responderId !== IVY) {
          paths.push(`${NAMES[row.responderId]}: named`);
        }

        continue;
      }

      for (const membership of MEMBERSHIPS) {
        if (membership.teamId === row.responderId && membership.accepted) {
          paths.push(
            `${NAMES[membership.userId]}: team ${NAMES[row.responderId]}`,
          );
        }
      }
    }

    return paths.sort();
  }

  // Whom `rows` page, by name.
  function pagedWhile(rows: Array<Row>): Set<string> {
    return new Set<string>(
      pathsWhile(rows).map((path: string): string => {
        return path.split(":")[0]!;
      }),
    );
  }

  test.each([1, 2, 3, 5, 8, 13, 21, 34])(
    "seed %d: 'added' and 'removed' once each, the invitee nothing, a log per path",
    async (seed: number) => {
      const random: SeededRandom = seededRandom(seed);
      const added: Array<Row> = [];

      for (const row of shuffled(ROWS, random)) {
        await (row.kind === "team"
          ? addTeam(row.responderId)
          : addUser(row.responderId));
        added.push(row);

        expect(world.openLogs()).toEqual(pathsWhile(added));
      }

      expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo", "Cy"]);
      expect(world.toldThat(REMOVED)).toEqual([]);

      const left: Array<Row> = [...added];

      for (const row of shuffled(added, random)) {
        const pagedBefore: Set<string> = pagedWhile(left);
        left.splice(left.indexOf(row), 1);
        const pagedAfter: Set<string> = pagedWhile(left);
        world.forgetTold();

        await (row.kind === "team"
          ? takeOffTeam(row.responderId)
          : takeOffUser(row.responderId));

        // Told exactly when the last path to them went.
        expect(world.toldThat(REMOVED)).toEqual(
          [...pagedBefore]
            .filter((name: string): boolean => {
              return !pagedAfter.has(name);
            })
            .sort(),
        );
        expect(world.openLogs()).toEqual(pathsWhile(left));
      }

      expect(world.openLogs()).toEqual([]);
      expect(world.errors).toEqual([]);
    },
  );
});

describe("a new policy's first level", () => {
  test("paging both teams, the member of both by name, an invitee and the schedule: saved whole, nothing logged as an error, each member told once, a log per path", async () => {
    world.onCall = CY;

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.name = "Checkout on-call";

    await OnCallDutyPolicyService.create({
      data: policy,
      props: caller,
      miscDataProps: {
        users: [ANA, IVY],
        teams: [PLATFORM, PAYMENTS],
        onCallSchedules: [PRIMARY],
      },
    });
    await world.settle();

    // Nothing failed on the way, and the level was finished.
    expect(world.errors).toEqual([]);
    expect(world.policies.inserts).toHaveLength(1);
    expect(world.rules.inserts).toHaveLength(1);
    expect(world.rules.inserts[0]!["name"]).toBe("Level 1");
    expect(
      world.ruleUsers.inserts
        .map((row: StoredRow): string => {
          return NAMES[id(row["userId"])]!;
        })
        .sort(),
    ).toEqual(["Ana", "Ivy"]);
    expect(
      world.ruleTeams.inserts
        .map((row: StoredRow): string => {
          return NAMES[id(row["teamId"])]!;
        })
        .sort(),
    ).toEqual(["Payments", "Platform"]);
    expect(world.ruleSchedules.inserts).toHaveLength(1);

    // Each member hears it once; Ivy, only invited, nothing.
    expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo", "Cy"]);

    // A log per path that pages a member, on the new policy's level.
    expect(
      world.openLogs({
        policyId: id(world.policies.inserts[0]!["_id"]),
        ruleId: id(world.rules.inserts[0]!["_id"]),
      }),
    ).toEqual([
      "Ana: named",
      "Ana: team Payments",
      "Ana: team Platform",
      "Bo: team Platform",
      "Cy: on call in Primary",
      "Cy: team Payments",
    ]);
  });
});
