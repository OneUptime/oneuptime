import {
  GetOnCallStatusTool,
  QueryOnCallPagesTool,
  QueryOnCallPoliciesTool,
} from "../../../../Server/Utils/AI/Toolbox/OnCallTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * These three tools close the on-call discovery gap: page_on_call_policy's
 * description tells the model to "find the id with query_on_call_policies",
 * get_on_call_status must answer "who is on call?" precisely (including the
 * honest "no one is on call" case), and query_on_call_pages must show who was
 * actually notified and whether anyone acknowledged. The tests lock in the
 * result envelope each of those flows depends on.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const POLICY_ID: ObjectID = ObjectID.generate();
const RULE_1_ID: ObjectID = ObjectID.generate();
const RULE_2_ID: ObjectID = ObjectID.generate();
const SCHEDULE_ID: ObjectID = ObjectID.generate();

function buildUser(name: string): User {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.name = new Name(name);
  return user;
}

function buildPolicy(data?: {
  id?: ObjectID;
  name?: string;
  description?: string;
}): OnCallDutyPolicy {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy._id = (data?.id ?? POLICY_ID).toString();
  policy.name = data?.name ?? "Payments primary";
  policy.description = data?.description ?? "Pages the payments on-call.";
  return policy;
}

function buildRule(data: {
  id: ObjectID;
  order: number;
  name: string;
  escalateAfterInMinutes?: number;
}): OnCallDutyPolicyEscalationRule {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule._id = data.id.toString();
  rule.order = data.order;
  rule.name = data.name;
  rule.onCallDutyPolicyId = POLICY_ID;
  if (data.escalateAfterInMinutes !== undefined) {
    rule.escalateAfterInMinutes = data.escalateAfterInMinutes;
  }
  return rule;
}

function buildRuleUser(
  ruleId: ObjectID,
  userName: string,
): OnCallDutyPolicyEscalationRuleUser {
  const link: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();
  link._id = ObjectID.generate().toString();
  link.onCallDutyPolicyEscalationRuleId = ruleId;
  link.user = buildUser(userName);
  return link;
}

function buildRuleTeam(
  ruleId: ObjectID,
  teamName: string,
): OnCallDutyPolicyEscalationRuleTeam {
  const link: OnCallDutyPolicyEscalationRuleTeam =
    new OnCallDutyPolicyEscalationRuleTeam();
  link._id = ObjectID.generate().toString();
  link.onCallDutyPolicyEscalationRuleId = ruleId;
  const team: Team = new Team();
  team._id = ObjectID.generate().toString();
  team.name = teamName;
  link.team = team;
  return link;
}

function buildRuleSchedule(
  ruleId: ObjectID,
  scheduleId: ObjectID,
  scheduleName: string,
): OnCallDutyPolicyEscalationRuleSchedule {
  const link: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  link._id = ObjectID.generate().toString();
  link.onCallDutyPolicyEscalationRuleId = ruleId;
  link.onCallDutyPolicyScheduleId = scheduleId;
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = scheduleId.toString();
  schedule.name = scheduleName;
  link.onCallDutyPolicySchedule = schedule;
  return link;
}

function buildSchedule(data?: {
  id?: ObjectID;
  name?: string;
  currentUserName?: string;
  nextUserName?: string;
}): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = (data?.id ?? SCHEDULE_ID).toString();
  schedule.name = data?.name ?? "Primary rotation";
  if (data?.currentUserName) {
    schedule.currentUserOnRoster = buildUser(data.currentUserName);
    schedule.rosterStartAt = new Date("2026-08-11T09:00:00Z");
    schedule.rosterHandoffAt = new Date("2026-08-18T09:00:00Z");
  }
  if (data?.nextUserName) {
    schedule.nextUserOnRoster = buildUser(data.nextUserName);
    schedule.rosterNextStartAt = new Date("2026-08-18T09:00:00Z");
  }
  return schedule;
}

interface EscalationMocks {
  rules?: Array<OnCallDutyPolicyEscalationRule>;
  users?: Array<OnCallDutyPolicyEscalationRuleUser>;
  teams?: Array<OnCallDutyPolicyEscalationRuleTeam>;
  schedules?: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

function mockEscalationData(data: EscalationMocks): void {
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
    .mockResolvedValue((data.rules ?? []) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockResolvedValue((data.users ?? []) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue((data.teams ?? []) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue((data.schedules ?? []) as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_on_call_policies — detail mode", () => {
  test("returns the policy with its full escalation chain and a view citation", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(buildPolicy() as never);
    mockEscalationData({
      rules: [
        buildRule({
          id: RULE_1_ID,
          order: 1,
          name: "Primary",
          escalateAfterInMinutes: 5,
        }),
        buildRule({ id: RULE_2_ID, order: 2, name: "Backup" }),
      ],
      users: [buildRuleUser(RULE_1_ID, "Alice Smith")],
      teams: [buildRuleTeam(RULE_2_ID, "SRE")],
      schedules: [
        buildRuleSchedule(RULE_1_ID, SCHEDULE_ID, "Primary rotation"),
      ],
    });

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Payments primary");
    expect(result.dataForLlm).toContain("Alice Smith");
    expect(result.dataForLlm).toContain("SRE");
    expect(result.dataForLlm).toContain("Primary rotation");
    expect(result.dataForLlm).toContain("escalates after 5m");
    expect(result.citationLabel).toBe("On-call policy 'Payments primary'");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicyView,
      params: { onCallDutyPolicyId: POLICY_ID.toString() },
    });
    expect(result.widget).toBeDefined();
  });

  test("a missing policy is honest: zero rows, no widget", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(null as never);

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });
});

describe("query_on_call_policies — list mode", () => {
  test("lists policies with their escalation chains", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([
        buildPolicy(),
        buildPolicy({
          id: ObjectID.generate(),
          name: "Platform secondary",
          description: "Backup escalation path.",
        }),
      ] as never);
    mockEscalationData({
      rules: [buildRule({ id: RULE_1_ID, order: 1, name: "Primary" })],
      users: [buildRuleUser(RULE_1_ID, "Alice Smith")],
    });

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Payments primary");
    expect(result.dataForLlm).toContain("Platform secondary");
    expect(result.dataForLlm).toContain("Alice Smith");
    // The policy with no rules must say so, not silently show nothing.
    expect(result.dataForLlm).toContain("No escalation rules configured");
    expect(result.citationLabel).toBe("On-call policies (2 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicies,
    });
    expect(result.widget).toBeDefined();

    // The query must run under the requesting user's props, never as root+.
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
    expect(callArgs["skip"]).toBe(0);
  });

  test("clamps limit, honors skip, and reports pagination honestly", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(60) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([
        buildPolicy(),
        buildPolicy({ id: ObjectID.generate(), name: "Platform secondary" }),
      ] as never);
    mockEscalationData({});

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      { limit: 999, skip: 20 },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
    expect(callArgs["skip"]).toBe(20);
    expect(result.dataForLlm).toContain(
      "Showing rows 21–22 of 60 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("On-call policies (2 of 60)");
  });

  test("an empty project is honest: zero rows and no widget", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("(no rows found)");
    expect(result.widget).toBeUndefined();
  });
});

describe("get_on_call_status — all schedules", () => {
  test("reports who is on call now and names the uncovered schedule honestly", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([
        buildSchedule({
          currentUserName: "Alice Smith",
          nextUserName: "Bob Jones",
        }),
        buildSchedule({
          id: ObjectID.generate(),
          name: "Weekend rotation",
          nextUserName: "Bob Jones",
        }),
      ] as never);

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Alice Smith");
    expect(result.dataForLlm).toContain("No one is on call");
    expect(result.dataForLlm).toContain("Bob Jones");
    // Handoff time is part of the answer to "who is on call?".
    expect(result.dataForLlm).toContain("2026-08-18");
    expect(result.citationLabel).toBe("On-call now (1 responder)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicies,
    });
    expect(result.widget).toBeDefined();

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(20);
  });

  test("clamps the limit argument", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { limit: 999 },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(50);
  });
});

describe("get_on_call_status — single schedule", () => {
  test("returns the current and next on-roster user for one schedule", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
      .mockResolvedValue(
        buildSchedule({
          currentUserName: "Alice Smith",
          nextUserName: "Bob Jones",
        }) as never,
      );

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { scheduleId: SCHEDULE_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Alice Smith");
    expect(result.dataForLlm).toContain("Bob Jones");
    expect(result.citationLabel).toBe("On-call now: 'Primary rotation'");
    expect(result.widget).toBeDefined();
  });

  test("a missing schedule is honest: zero rows, no widget", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
      .mockResolvedValue(null as never);

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { scheduleId: SCHEDULE_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });
});

describe("get_on_call_status — by policy", () => {
  test("walks the escalation rules: direct users, teams and schedule rosters", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(buildPolicy() as never);
    mockEscalationData({
      rules: [
        buildRule({ id: RULE_1_ID, order: 1, name: "Primary" }),
        buildRule({ id: RULE_2_ID, order: 2, name: "Backup" }),
      ],
      users: [buildRuleUser(RULE_1_ID, "Alice Smith")],
      teams: [buildRuleTeam(RULE_2_ID, "SRE")],
      schedules: [
        buildRuleSchedule(RULE_1_ID, SCHEDULE_ID, "Primary rotation"),
      ],
    });
    const scheduleFindBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([
        buildSchedule({ currentUserName: "Carol Chen" }),
      ] as never);

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    // Rule 1 direct user + rule 1 schedule roster + rule 2 team.
    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("Alice Smith");
    expect(result.dataForLlm).toContain("Carol Chen");
    expect(result.dataForLlm).toContain("All members of 'SRE'");
    expect(result.citationLabel).toBe(
      "On-call now for 'Payments primary' (3 responders)",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicyView,
      params: { onCallDutyPolicyId: POLICY_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    const callArgs: JSONObject = scheduleFindBySpy.mock
      .calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("an unknown policy id is honest: zero rows and a clear label", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(null as never);

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.citationLabel).toBe("On-call now (policy not found)");
    expect(result.widget).toBeUndefined();
  });
});

function buildExecutionLog(data?: {
  id?: ObjectID;
  status?: OnCallDutyPolicyStatus;
  acknowledgedByUserName?: string;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log._id = (data?.id ?? ObjectID.generate()).toString();
  log.createdAt = new Date("2026-08-14T01:00:00Z");
  log.status = data?.status ?? OnCallDutyPolicyStatus.Completed;
  log.onCallDutyPolicy = buildPolicy();
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.title = "Checkout down";
  incident.incidentNumber = 42;
  log.triggeredByIncident = incident;
  log.lastExecutedEscalationRuleOrder = 1;
  if (data?.acknowledgedByUserName) {
    log.acknowledgedByUser = buildUser(data.acknowledgedByUserName);
    log.acknowledgedAt = new Date("2026-08-14T01:04:00Z");
  }
  return log;
}

function buildUserLog(data: {
  executionLogId: ObjectID;
  userName: string;
  status: UserNotificationExecutionStatus;
  acknowledged?: boolean;
}): UserOnCallLog {
  const userLog: UserOnCallLog = new UserOnCallLog();
  userLog._id = ObjectID.generate().toString();
  userLog.onCallDutyPolicyExecutionLogId = data.executionLogId;
  userLog.user = buildUser(data.userName);
  userLog.status = data.status;
  if (data.acknowledged) {
    userLog.acknowledgedAt = new Date("2026-08-14T01:04:00Z");
  }
  return userLog;
}

describe("query_on_call_pages", () => {
  test("returns recent executions with trigger, ack and per-user outcomes", async () => {
    const EXECUTION_ID: ObjectID = ObjectID.generate();
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockResolvedValue([
        buildExecutionLog({
          id: EXECUTION_ID,
          acknowledgedByUserName: "Alice Smith",
        }),
      ] as never);
    jest.spyOn(UserOnCallLogService, "findBy").mockResolvedValue([
      buildUserLog({
        executionLogId: EXECUTION_ID,
        userName: "Alice Smith",
        status: UserNotificationExecutionStatus.Completed,
        acknowledged: true,
      }),
      buildUserLog({
        executionLogId: EXECUTION_ID,
        userName: "Bob Jones",
        status: UserNotificationExecutionStatus.Error,
      }),
    ] as never);

    const result: ToolExecutionResult = await QueryOnCallPagesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Incident #42: Checkout down");
    expect(result.dataForLlm).toContain("Payments primary");
    expect(result.dataForLlm).toContain(
      "Alice Smith: Completed (acknowledged)",
    );
    expect(result.dataForLlm).toContain("Bob Jones: Error");
    expect(result.citationLabel).toBe("On-call pages, last 24h (1 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicies,
    });
    expect(result.widget).toBeDefined();

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
  });

  test("policy and incident filters reach the service query", async () => {
    const INCIDENT_ID: ObjectID = ObjectID.generate();
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryOnCallPagesTool.execute(
      {
        onCallPolicyId: POLICY_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
      },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect(String(query["onCallDutyPolicyId"])).toBe(POLICY_ID.toString());
    expect(String(query["triggeredByIncidentId"])).toBe(INCIDENT_ID.toString());
    // Filtering by a policy makes the citation deep-link to that policy.
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicyView,
      params: { onCallDutyPolicyId: POLICY_ID.toString() },
    });
  });

  test("honors skip and reports pagination honestly", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "countBy")
      .mockResolvedValue(new PositiveNumber(40) as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockResolvedValue([buildExecutionLog(), buildExecutionLog()] as never);
    jest.spyOn(UserOnCallLogService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryOnCallPagesTool.execute(
      { skip: 10 },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(10);
    expect(result.dataForLlm).toContain(
      "Showing rows 11–12 of 40 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("On-call pages, last 24h (2 of 40)");
  });

  test("rejects an unparseable startTime instead of silently changing the window", async () => {
    await expect(
      QueryOnCallPagesTool.execute({ startTime: "not-a-date" }, ctx),
    ).rejects.toThrow(BadDataException);
  });

  test("an empty window is honest and skips the per-user fetch", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
      .mockResolvedValue([] as never);
    const userLogSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryOnCallPagesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(userLogSpy).not.toHaveBeenCalled();
  });
});

describe("on-call tools — permissions", () => {
  test("required permissions derive from the model read ACLs", () => {
    expect(QueryOnCallPoliciesTool.requiredPermissions.length).toBeGreaterThan(
      0,
    );
    expect(GetOnCallStatusTool.requiredPermissions.length).toBeGreaterThan(0);
    expect(QueryOnCallPagesTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
