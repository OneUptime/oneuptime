import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import Model from "../../../Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import ObjectID from "../../../Types/ObjectID";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * OnCallDutyPolicyTimeLogService scopes the team/schedule "context" columns of
 * both its dedup read (startTimeLogForUser) and its close write
 * (endTimeLogForUser) EXPLICITLY. When a context column is absent the query
 * must constrain it to IS NULL rather than omit it.
 *
 * The old `...(x && { x })` OMITTED an absent column, so the column matched ANY
 * value. Two bugs followed:
 *   - audit M3: ending a direct-user assignment (no teamId/scheduleId) matched
 *     and closed that user's still-open SCHEDULE and TEAM logs too.
 *   - audit L4: a direct-user start deduped against an already-open
 *     schedule/team log and never created the direct log.
 *
 * These tests mock the inherited DatabaseService persistence helpers
 * (findOneBy / create / updateBy) so no Postgres is needed, and CAPTURE the
 * query object each method is called with to assert the exact IS-NULL vs
 * ObjectID scoping of the teamId and onCallDutyPolicyScheduleId columns.
 */

/*
 * The serialized shape of QueryHelper.isNull() — a TypeORM `Raw` FindOperator.
 * It is stable across calls (the SQL closure is dropped by JSON.stringify), so
 * structural equality identifies an IS-NULL constraint on a column.
 */
const IS_NULL_JSON: string = JSON.stringify(QueryHelper.isNull());

// A distinct value that is NOT an IS-NULL operator, for negative assertions.
function isIsNull(value: unknown): boolean {
  return JSON.stringify(value) === IS_NULL_JSON;
}

// Minimal stand-in for a persisted OnCallDutyPolicyTimeLog row.
function fakeRow(id: ObjectID): Model {
  return { id } as unknown as Model;
}

// Base args shared by every startTimeLogForUser call in these tests.
function startArgsBase(): {
  projectId: ObjectID;
  onCallDutyPolicyId: ObjectID;
  onCallDutyPolicyEscalationRuleId: ObjectID;
  userId: ObjectID;
  startsAt: Date;
} {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    onCallDutyPolicyId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    onCallDutyPolicyEscalationRuleId: new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    ),
    userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    startsAt: new Date("2026-07-09T00:00:00.000Z"),
  };
}

// Capture the `query` object handed to findOneBy on the next call.
function spyFindOneBy(resolve: Model | null): jest.SpyInstance {
  return jest
    .spyOn(OnCallDutyPolicyTimeLogService, "findOneBy")
    .mockResolvedValue(resolve as never);
}

// Stub create so startTimeLogForUser can complete when no existing log is found.
function spyCreate(): jest.SpyInstance {
  return jest
    .spyOn(OnCallDutyPolicyTimeLogService, "create")
    .mockResolvedValue(
      fakeRow(new ObjectID("99999999-9999-4999-8999-999999999999")) as never,
    );
}

// Stub updateBy (returns a row count) for the endTimeLogForUser tests.
function spyUpdateBy(): jest.SpyInstance {
  return jest
    .spyOn(OnCallDutyPolicyTimeLogService, "updateBy")
    .mockResolvedValue(1 as never);
}

function queryOf(spy: jest.SpyInstance): Record<string, unknown> {
  return (spy.mock.calls[0]![0] as { query: Record<string, unknown> }).query;
}

describe("OnCallDutyPolicyTimeLogService context-column scoping", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * startTimeLogForUser dedup query scoping.
   * ----------------------------------------------------------------------- *
   */

  test("startTimeLogForUser with NO teamId/scheduleId scopes both columns to IS NULL", async () => {
    const findOneBy: jest.SpyInstance = spyFindOneBy(null);
    const create: jest.SpyInstance = spyCreate();

    await OnCallDutyPolicyTimeLogService.startTimeLogForUser(startArgsBase());

    expect(findOneBy).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = queryOf(findOneBy);

    // A direct-user log must only dedup against other direct logs => IS NULL.
    expect(isIsNull(query["teamId"])).toBe(true);
    expect(isIsNull(query["onCallDutyPolicyScheduleId"])).toBe(true);
    // endsAt IS NULL is always part of the open-log scope.
    expect(isIsNull(query["endsAt"])).toBe(true);

    // Nothing existed => a fresh log row is created.
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("startTimeLogForUser WITH teamId only: teamId matches the passed ObjectID, schedule IS NULL", async () => {
    const teamId: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    const findOneBy: jest.SpyInstance = spyFindOneBy(null);
    spyCreate();

    await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
      ...startArgsBase(),
      teamId,
    });

    const query: Record<string, unknown> = queryOf(findOneBy);

    // teamId is the concrete value passed in (not an IS-NULL operator).
    expect(isIsNull(query["teamId"])).toBe(false);
    expect((query["teamId"] as ObjectID).toString()).toBe(teamId.toString());
    // No schedule context => that column is scoped to IS NULL.
    expect(isIsNull(query["onCallDutyPolicyScheduleId"])).toBe(true);
  });

  test("startTimeLogForUser WITH scheduleId only: schedule matches passed ObjectID, teamId IS NULL", async () => {
    const onCallDutyPolicyScheduleId: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );
    const findOneBy: jest.SpyInstance = spyFindOneBy(null);
    spyCreate();

    await OnCallDutyPolicyTimeLogService.startTimeLogForUser({
      ...startArgsBase(),
      onCallDutyPolicyScheduleId,
    });

    const query: Record<string, unknown> = queryOf(findOneBy);

    // Schedule column is the concrete value passed in.
    expect(isIsNull(query["onCallDutyPolicyScheduleId"])).toBe(false);
    expect((query["onCallDutyPolicyScheduleId"] as ObjectID).toString()).toBe(
      onCallDutyPolicyScheduleId.toString(),
    );
    // No team context => that column is scoped to IS NULL.
    expect(isIsNull(query["teamId"])).toBe(true);
  });

  test("startTimeLogForUser is idempotent: an existing open log is returned and create is NOT called", async () => {
    const existingId: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );
    const existing: Model = fakeRow(existingId);
    const findOneBy: jest.SpyInstance = spyFindOneBy(existing);
    const create: jest.SpyInstance = spyCreate();

    const result: Model =
      await OnCallDutyPolicyTimeLogService.startTimeLogForUser(startArgsBase());

    expect(findOneBy).toHaveBeenCalledTimes(1);
    // Returns the already-open log verbatim (audit M1 relies on this).
    expect(result).toBe(existing);
    // No duplicate stint is created.
    expect(create).not.toHaveBeenCalled();
  });

  /*
   * ----------------------------------------------------------------------- *
   * endTimeLogForUser close-query scoping.
   * ----------------------------------------------------------------------- *
   */

  test("endTimeLogForUser with NO teamId/scheduleId scopes both columns to IS NULL", async () => {
    const updateBy: jest.SpyInstance = spyUpdateBy();

    await OnCallDutyPolicyTimeLogService.endTimeLogForUser({
      projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      onCallDutyPolicyId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      onCallDutyPolicyEscalationRuleId: new ObjectID(
        "33333333-3333-4333-8333-333333333333",
      ),
      userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
      endsAt: new Date("2026-07-09T01:00:00.000Z"),
    });

    expect(updateBy).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = queryOf(updateBy);

    // Ending a direct-user stint must NOT close schedule/team logs (audit M3).
    expect(isIsNull(query["teamId"])).toBe(true);
    expect(isIsNull(query["onCallDutyPolicyScheduleId"])).toBe(true);
    expect(isIsNull(query["endsAt"])).toBe(true);
  });

  test("endTimeLogForUser WITH scheduleId scopes onCallDutyPolicyScheduleId to the passed ObjectID", async () => {
    const onCallDutyPolicyScheduleId: ObjectID = new ObjectID(
      "88888888-8888-4888-8888-888888888888",
    );
    const updateBy: jest.SpyInstance = spyUpdateBy();

    await OnCallDutyPolicyTimeLogService.endTimeLogForUser({
      projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      onCallDutyPolicyId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      onCallDutyPolicyEscalationRuleId: new ObjectID(
        "33333333-3333-4333-8333-333333333333",
      ),
      userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
      onCallDutyPolicyScheduleId,
      endsAt: new Date("2026-07-09T01:00:00.000Z"),
    });

    const query: Record<string, unknown> = queryOf(updateBy);

    // Only THIS schedule's open stint is closed.
    expect(isIsNull(query["onCallDutyPolicyScheduleId"])).toBe(false);
    expect((query["onCallDutyPolicyScheduleId"] as ObjectID).toString()).toBe(
      onCallDutyPolicyScheduleId.toString(),
    );
    // No team context supplied => team column stays IS NULL.
    expect(isIsNull(query["teamId"])).toBe(true);
  });
});

// Silence any incidental logger.error noise from the service under test.
jest.spyOn(logger, "error").mockImplementation((): void => {
  return undefined;
});
