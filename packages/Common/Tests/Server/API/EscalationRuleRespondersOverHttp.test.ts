import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import EscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import EscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import EscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import EscalationRuleRespondersWorld, {
  ADDED,
  ANA,
  BO,
  CY,
  IVY,
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
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN ESCALATION RULE'S TEAMS, PEOPLE AND SCHEDULES, THROUGH THE SERVER'S OWN
 * ROUTES OVER HTTP (#10970).
 *
 * The hooks of an escalation rule's rows read their ids off the relations
 * a read joins, and threw after the row was saved when it joined none. Here
 * every way a row is added to a rule or taken off it from outside the
 * server goes through Express's JSON body parser, the user middleware,
 * BaseAPI, the permission layer, the services and their hooks, and the
 * error handler, into tables in memory that join nothing
 * (EscalationRuleRespondersWorld):
 *
 *   - the Dashboard's own requests, sent by its own API client (ModelAPI):
 *     Edit Escalation Rule's join rows, created and deleted as
 *     EscalationRules.syncEditedMembers sends them, and Add Escalation
 *     Rule's new level with its responders as misc data;
 *   - the API's, as Terraform, MCP and a script send them with an API key:
 *     POST and DELETE of each kind of row, and a level created with its
 *     responders.
 *
 * Each answers 200, and the people are told and logged as the hooks say:
 * a member "added" once and "removed" when nothing on the rule pages them
 * any more, an invitee nothing, and a time log per path.
 */

// A member of the project who may change its on-call policies.
const PERSON: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      ...customDomainCaller({
        permissions: [Permission.OnCallMember],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };
  };

// The project's API key: what Terraform, MCP and a script call with.
const API_KEY: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId: PROJECT_ID,
        isApiKey: true,
      }),
      ...ON_HIGHEST_PLAN,
    };
  };

const TEAM_PATH: string = "/api/on-call-duty-policy-escalation-rule-team";
const USER_PATH: string = "/api/on-call-duty-policy-escalation-rule-user";
const SCHEDULE_PATH: string =
  "/api/on-call-duty-policy-escalation-rule-schedule";
const RULE_PATH: string = "/api/on-call-duty-policy-escalation-rule";

let server: DashboardRequestsOverHttp;
let world: EscalationRuleRespondersWorld;
let caller: DatabaseCommonInteractionProps;

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

// What the server answered a refusal with, as the Dashboard reads it.
function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);
  return String(answer["error"] || answer["message"] || "");
}

// Every request's status, and its refusal where it had one, in order.
function answers(): Array<{ status: number; refusal: string }> {
  return server.requests.map(
    (sent: SentRequest): { status: number; refusal: string } => {
      return { status: sent.status, refusal: refusalOf(sent) };
    },
  );
}

function allAnswered(
  count: number,
): Array<{ status: number; refusal: string }> {
  return Array.from({ length: count }, () => {
    return { status: 200, refusal: "" };
  });
}

// The rule's row naming `value` in `column`: there, or the test fails.
function rowOf(table: InMemoryTable, column: string, value: string): string {
  const rowId: string | null = world.rowOf(table, column, value);
  expect(rowId).not.toBeNull();
  return rowId!;
}

// The ids of a row on the world's level, as the API takes them.
function onLevel(columns: JSONObject): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    onCallDutyPolicyId: POLICY_ID,
    onCallDutyPolicyEscalationRuleId: RULE_ID,
    ...columns,
  };
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<OnCallDutyEscalationRule, DatabaseService<BaseModel>>(
      OnCallDutyEscalationRule,
      EscalationRuleService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<OnCallDutyPolicyEscalationRuleTeam, DatabaseService<BaseModel>>(
      OnCallDutyPolicyEscalationRuleTeam,
      EscalationRuleTeamService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<OnCallDutyPolicyEscalationRuleUser, DatabaseService<BaseModel>>(
      OnCallDutyPolicyEscalationRuleUser,
      EscalationRuleUserService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<
      OnCallDutyPolicyEscalationRuleSchedule,
      DatabaseService<BaseModel>
    >(
      OnCallDutyPolicyEscalationRuleSchedule,
      EscalationRuleScheduleService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;

  world = new EscalationRuleRespondersWorld();
  world.install();
  everyServerProductIsOn();

  caller = PERSON();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Edit Escalation Rule's join rows, as EscalationRules.syncEditedMembers
 * builds and sends them: a new one for each responder picked, and a delete
 * of each one unpicked.
 */
async function dashboardAdds(
  modelType:
    | typeof OnCallDutyPolicyEscalationRuleTeam
    | typeof OnCallDutyPolicyEscalationRuleUser
    | typeof OnCallDutyPolicyEscalationRuleSchedule,
  column: string,
  responderId: string,
): Promise<void> {
  const model: BaseModel = new modelType();
  model.setColumnValue("projectId", PROJECT_ID);
  model.setColumnValue("onCallDutyPolicyId", new ObjectID(POLICY_ID));
  model.setColumnValue(
    "onCallDutyPolicyEscalationRuleId",
    new ObjectID(RULE_ID),
  );
  model.setColumnValue(column, new ObjectID(responderId));

  await ModelAPI.create({ modelType: modelType as never, model: model });
  await world.settle();
}

async function dashboardTakesOff(
  modelType:
    | typeof OnCallDutyPolicyEscalationRuleTeam
    | typeof OnCallDutyPolicyEscalationRuleUser
    | typeof OnCallDutyPolicyEscalationRuleSchedule,
  rowId: string,
): Promise<void> {
  await ModelAPI.deleteItem({
    modelType: modelType as never,
    id: new ObjectID(rowId),
  });
  await world.settle();
}

// POST and DELETE as any API caller sends them.
async function apiAdds(path: string, columns: JSONObject): Promise<void> {
  await server.request("POST", path, { data: onLevel(columns) });
  await world.settle();
}

async function apiTakesOff(path: string, rowId: string): Promise<void> {
  await server.request("DELETE", `${path}/${rowId}`);
  await world.settle();
}

describe("the Dashboard's Edit Escalation Rule, as its own code sends it", () => {
  test("adds a team: answered, saved, its members told 'added' once and logged; the invitee neither", async () => {
    await dashboardAdds(OnCallDutyPolicyEscalationRuleTeam, "teamId", PLATFORM);

    expect(answers()).toEqual(allAnswered(1));
    expect(world.ruleTeams.inserts).toHaveLength(1);
    expect(id(world.ruleTeams.inserts[0]!["createdByUserId"])).toBe(
      id(caller.userId),
    );
    expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("adds a second team of one of them: only its other people are told", async () => {
    await dashboardAdds(OnCallDutyPolicyEscalationRuleTeam, "teamId", PLATFORM);
    world.forgetTold();

    await dashboardAdds(OnCallDutyPolicyEscalationRuleTeam, "teamId", PAYMENTS);

    expect(answers()).toEqual(allAnswered(2));
    expect(world.toldThat(ADDED)).toEqual(["Cy"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Payments",
      "Ana: team Platform",
      "Bo: team Platform",
      "Cy: team Payments",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("takes a team off: answered; told 'removed' only where nothing else pages them; their logs of it end", async () => {
    await dashboardAdds(OnCallDutyPolicyEscalationRuleTeam, "teamId", PLATFORM);
    await dashboardAdds(OnCallDutyPolicyEscalationRuleTeam, "teamId", PAYMENTS);
    world.forgetTold();

    await dashboardTakesOff(
      OnCallDutyPolicyEscalationRuleTeam,
      rowOf(world.ruleTeams, "teamId", PLATFORM),
    );

    expect(answers()).toEqual(allAnswered(3));
    expect(world.toldThat(REMOVED)).toEqual(["Bo"]);
    expect(world.endedLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.openLogs()).toEqual([
      "Ana: team Payments",
      "Cy: team Payments",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("names a member of its team and takes the name off: no news to her either way; her named log starts and ends", async () => {
    await dashboardAdds(OnCallDutyPolicyEscalationRuleTeam, "teamId", PLATFORM);
    world.forgetTold();

    await dashboardAdds(OnCallDutyPolicyEscalationRuleUser, "userId", ANA);

    expect(world.told).toEqual([]);
    expect(world.openLogs()).toEqual([
      "Ana: named",
      "Ana: team Platform",
      "Bo: team Platform",
    ]);

    await dashboardTakesOff(
      OnCallDutyPolicyEscalationRuleUser,
      rowOf(world.ruleUsers, "userId", ANA),
    );

    expect(answers()).toEqual(allAnswered(3));
    expect(world.told).toEqual([]);
    expect(world.endedLogs()).toEqual(["Ana: named"]);
    expect(world.errors).toEqual([]);
  });

  test("names an invitee and takes the name off: answered both times; told nothing, logged nowhere", async () => {
    await dashboardAdds(OnCallDutyPolicyEscalationRuleUser, "userId", IVY);
    await dashboardTakesOff(
      OnCallDutyPolicyEscalationRuleUser,
      rowOf(world.ruleUsers, "userId", IVY),
    );

    expect(answers()).toEqual(allAnswered(2));
    expect(world.told).toEqual([]);
    expect(world.timeLogs.rows).toEqual([]);
    expect(world.errors).toEqual([]);
  });

  test("adds the schedule and takes it off: whoever is on call is told each once, logged while it pages them", async () => {
    world.onCall = BO;

    await dashboardAdds(
      OnCallDutyPolicyEscalationRuleSchedule,
      "onCallDutyPolicyScheduleId",
      PRIMARY,
    );

    expect(world.toldThat(ADDED)).toEqual(["Bo"]);
    expect(world.openLogs()).toEqual(["Bo: on call in Primary"]);

    await dashboardTakesOff(
      OnCallDutyPolicyEscalationRuleSchedule,
      rowOf(world.ruleSchedules, "onCallDutyPolicyScheduleId", PRIMARY),
    );

    expect(answers()).toEqual(allAnswered(2));
    expect(world.toldThat(REMOVED)).toEqual(["Bo"]);
    expect(world.endedLogs()).toEqual(["Bo: on call in Primary"]);
    expect(world.errors).toEqual([]);
  });
});

/*
 * Add Escalation Rule: the new level, with the Notify picker's responders
 * as misc data (EscalationRuleForm's teams, users and onCallSchedules) -
 * what the rule service turns into join rows (addTeam and its siblings).
 * The API takes the same, from the guided setup and from scripts.
 */
describe("a new level with its responders", () => {
  // The Notify picker's responders, by the keys the rule service reads.
  const RESPONDERS: JSONObject = {
    teams: [PLATFORM, PAYMENTS],
    users: [ANA, IVY],
    onCallSchedules: [PRIMARY],
  };

  // Add Escalation Rule's create, sent by the Dashboard's API client.
  const fromTheDashboard: () => Promise<void> = async (): Promise<void> => {
    const rule: OnCallDutyEscalationRule = new OnCallDutyEscalationRule();
    rule.projectId = PROJECT_ID;
    rule.onCallDutyPolicyId = new ObjectID(POLICY_ID);
    rule.name = "Level 2";
    rule.escalateAfterInMinutes = 15;

    await ModelAPI.create({
      modelType: OnCallDutyEscalationRule,
      model: rule,
      miscDataProps: RESPONDERS,
    });
  };

  // The same create, as JSON from any API caller.
  const fromTheApi: () => Promise<void> = async (): Promise<void> => {
    await server.request("POST", RULE_PATH, {
      data: {
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyId: POLICY_ID,
        name: "Level 2",
        escalateAfterInMinutes: 15,
      },
      miscDataProps: RESPONDERS,
    });
  };

  test.each([
    ["the Dashboard's Add Escalation Rule", PERSON, fromTheDashboard],
    ["the API, with an API key", API_KEY, fromTheApi],
  ] as Array<
    [string, () => DatabaseCommonInteractionProps, () => Promise<void>]
  >)(
    "%s: answered, the level saved whole, each member told once and logged on it, the invitee neither",
    async (
      _who: string,
      props: () => DatabaseCommonInteractionProps,
      send: () => Promise<void>,
    ) => {
      caller = props();
      world.onCall = CY;

      await send();
      await world.settle();

      expect(answers()).toEqual(allAnswered(1));
      expect(world.errors).toEqual([]);

      const level: StoredRow = world.rules.inserts[0]!;
      expect(level["name"]).toBe("Level 2");

      // Every responder is on the new level.
      for (const [table, column, responderIds] of [
        [world.ruleTeams, "teamId", [PLATFORM, PAYMENTS]],
        [world.ruleUsers, "userId", [ANA, IVY]],
        [world.ruleSchedules, "onCallDutyPolicyScheduleId", [PRIMARY]],
      ] as Array<[InMemoryTable, string, Array<string>]>) {
        expect(
          table.inserts
            .map((row: StoredRow): string => {
              expect(id(row["onCallDutyPolicyEscalationRuleId"])).toBe(
                id(level["_id"]),
              );
              return NAMES[id(row[column])]!;
            })
            .sort(),
        ).toEqual(
          responderIds
            .map((responderId: string): string => {
              return NAMES[responderId]!;
            })
            .sort(),
        );
      }

      expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo", "Cy"]);
      expect(
        world.openLogs({ policyId: POLICY_ID, ruleId: id(level["_id"]) }),
      ).toEqual([
        "Ana: named",
        "Ana: team Payments",
        "Ana: team Platform",
        "Bo: team Platform",
        "Cy: on call in Primary",
        "Cy: team Payments",
      ]);
    },
  );
});

describe("the API, as Terraform, MCP and a script send it", () => {
  beforeEach(() => {
    caller = API_KEY();
  });

  test("POST a team: answered, saved, its members told once and logged; the invitee neither", async () => {
    await apiAdds(TEAM_PATH, { teamId: PLATFORM });

    expect(answers()).toEqual(allAnswered(1));
    expect(world.ruleTeams.inserts).toHaveLength(1);
    expect(world.toldThat(ADDED)).toEqual(["Ana", "Bo"]);
    expect(world.openLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("DELETE it: answered; its people told 'removed' unless named on the rule; their logs of it end", async () => {
    await apiAdds(USER_PATH, { userId: BO });
    await apiAdds(TEAM_PATH, { teamId: PLATFORM });
    world.forgetTold();

    await apiTakesOff(TEAM_PATH, rowOf(world.ruleTeams, "teamId", PLATFORM));

    expect(answers()).toEqual(allAnswered(3));
    // Bo is still named on the rule; Ana is paged by nothing else.
    expect(world.toldThat(REMOVED)).toEqual(["Ana"]);
    expect(world.openLogs()).toEqual(["Bo: named"]);
    expect(world.endedLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.errors).toEqual([]);
  });

  test("POST an invitee, then DELETE them: answered both times; told nothing, logged nowhere", async () => {
    await apiAdds(USER_PATH, { userId: IVY });
    await apiTakesOff(USER_PATH, rowOf(world.ruleUsers, "userId", IVY));

    expect(answers()).toEqual(allAnswered(2));
    expect(world.told).toEqual([]);
    expect(world.timeLogs.rows).toEqual([]);
    expect(world.errors).toEqual([]);
  });

  test("POST the schedule, then DELETE it: whoever is on call told 'added' and 'removed' once, logged while it pages them", async () => {
    world.onCall = CY;

    await apiAdds(SCHEDULE_PATH, { onCallDutyPolicyScheduleId: PRIMARY });
    await apiTakesOff(
      SCHEDULE_PATH,
      rowOf(world.ruleSchedules, "onCallDutyPolicyScheduleId", PRIMARY),
    );

    expect(answers()).toEqual(allAnswered(2));
    expect(world.toldThat(ADDED)).toEqual(["Cy"]);
    expect(world.toldThat(REMOVED)).toEqual(["Cy"]);
    expect(world.endedLogs()).toEqual(["Cy: on call in Primary"]);
    expect(world.openLogs()).toEqual([]);
    expect(world.errors).toEqual([]);
  });

  test("POST the same team twice: the second is refused naming it, and nobody is told again", async () => {
    await apiAdds(TEAM_PATH, { teamId: PLATFORM });
    world.forgetTold();

    await apiAdds(TEAM_PATH, { teamId: PLATFORM });

    const second: SentRequest = server.requests[1]!;
    expect(second.status).toBe(400);
    expect(refusalOf(second)).toContain('pages the team "Platform" already');
    expect(world.ruleTeams.rows).toHaveLength(1);
    expect(world.told).toEqual([]);
    expect(world.openLogs()).toEqual([
      "Ana: team Platform",
      "Bo: team Platform",
    ]);
    expect(world.errors).toEqual([]);
  });
});
