import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import Model from "../../../Models/DatabaseModels/UserOnCallLog";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * UserOnCallLogService.claimNotificationRuleExecution is the atomic guard added
 * for audit finding F7. Overlapping ExecutePendingExecutions runs (a slow tick,
 * a stalled-job re-delivery, or a burst release across worker replicas) could
 * both observe executedNotificationRules WITHOUT a given delayed rule's key,
 * both write it, and both page the responder for a single escalation.
 *
 * The fix collapses the read-modify-write into ONE conditional UPDATE that only
 * sets executedNotificationRules[ruleId] when the key is absent and RETURNs the
 * affected row, so exactly one concurrent run wins (RETURNING a row => claimed)
 * and every loser skips (no row => already executed).
 *
 * These tests mock the TypeORM manager (no Postgres) and the two inherited
 * persistence helpers (findOneById / updateOneById) to lock in:
 *   (a) atomic success (a row returned) => TRUE, and NO read-modify-write;
 *   (b) atomic no-op (no row returned) => FALSE, and NO read-modify-write;
 *   (c) the emitted SQL is a single UPDATE carrying the `NOT (... jsonb ? key)`
 *       existence guard and a RETURNING clause (so the claim is atomic);
 *   (d) FAIL-SAFE: if the atomic statement throws, it degrades to the previous
 *       non-atomic findOneById + updateOneById marking so a page is never
 *       dropped (a rare duplicate page beats a missed page for on-call).
 */

type QueryCall = [string, Array<unknown>];

// Stand-in for a persisted UserOnCallLog row returned by the fallback read.
function fakeLog(
  id: ObjectID,
  executedNotificationRules: JSONObject | undefined,
): Model {
  return {
    id,
    executedNotificationRules,
  } as unknown as Model;
}

// Mock this.getRepository().manager.query with the supplied jest mock.
function mockManagerQuery(query: jest.Mock): void {
  jest.spyOn(UserOnCallLogService, "getRepository").mockReturnValue({
    manager: {
      query,
    },
  } as any);
}

describe("UserOnCallLogService.claimNotificationRuleExecution", () => {
  beforeEach(() => {
    // Keep the fallback's logger.error noise out of the test output.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * (a) Atomic success: a row was returned => THIS call claimed the rule.
   * -----------------------------------------------------------------------
   */

  test("returns TRUE when the atomic UPDATE returns a row (claim won)", async () => {
    const query: jest.Mock = jest.fn().mockResolvedValue([{ _id: "x" }]);
    mockManagerQuery(query);

    const findOneById: jest.SpyInstance = jest.spyOn(
      UserOnCallLogService,
      "findOneById",
    );
    const updateOneById: jest.SpyInstance = jest.spyOn(
      UserOnCallLogService,
      "updateOneById",
    );

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: ObjectID.generate(),
        userNotificationRuleId: ObjectID.generate(),
      });

    expect(claimed).toBe(true);
    // Exactly one statement, and it truly was atomic: no read-modify-write.
    expect(query).toHaveBeenCalledTimes(1);
    expect(findOneById).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("returns TRUE even when the driver returns multiple RETURNING rows", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockResolvedValue([{ _id: "a" }, { _id: "b" }]);
    mockManagerQuery(query);

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: ObjectID.generate(),
        userNotificationRuleId: ObjectID.generate(),
      });

    expect(claimed).toBe(true);
  });

  /*
   * ----------------------------------------------------------------------- *
   * (b) Atomic no-op: guard suppressed the write => already executed.
   * -----------------------------------------------------------------------
   */

  test("returns FALSE when the atomic UPDATE returns no rows (already executed)", async () => {
    const query: jest.Mock = jest.fn().mockResolvedValue([]);
    mockManagerQuery(query);

    const findOneById: jest.SpyInstance = jest.spyOn(
      UserOnCallLogService,
      "findOneById",
    );
    const updateOneById: jest.SpyInstance = jest.spyOn(
      UserOnCallLogService,
      "updateOneById",
    );

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: ObjectID.generate(),
        userNotificationRuleId: ObjectID.generate(),
      });

    expect(claimed).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    // A suppressed write is a decisive "someone else won" — never fall back.
    expect(findOneById).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a non-array object", {}],
  ])(
    "returns FALSE (no claim) when the driver resolves %s instead of a rows array",
    async (_label: string, resolved: unknown) => {
      const query: jest.Mock = jest.fn().mockResolvedValue(resolved);
      mockManagerQuery(query);

      const updateOneById: jest.SpyInstance = jest.spyOn(
        UserOnCallLogService,
        "updateOneById",
      );

      /*
       * NOTE: current behavior — the Array.isArray guard treats any
       * non-array (or empty) result as "not claimed"; it resolves (does not
       * reject), so the fail-safe fallback is NOT engaged here.
       */
      const claimed: boolean =
        await UserOnCallLogService.claimNotificationRuleExecution({
          userOnCallLogId: ObjectID.generate(),
          userNotificationRuleId: ObjectID.generate(),
        });

      expect(claimed).toBe(false);
      expect(updateOneById).not.toHaveBeenCalled();
    },
  );

  /*
   * ----------------------------------------------------------------------- *
   * (c) The emitted SQL is a single, atomic, guarded UPDATE.
   * -----------------------------------------------------------------------
   */

  test("emits a single conditional UPDATE with jsonb existence guard and RETURNING", async () => {
    const query: jest.Mock = jest.fn().mockResolvedValue([{ _id: "x" }]);
    mockManagerQuery(query);

    const logId: ObjectID = ObjectID.generate();
    const ruleId: ObjectID = ObjectID.generate();

    await UserOnCallLogService.claimNotificationRuleExecution({
      userOnCallLogId: logId,
      userNotificationRuleId: ruleId,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    // Exactly one statement, and it is an UPDATE against the right table.
    expect(sql.trim().startsWith(`UPDATE "UserOnCallLog"`)).toBe(true);
    expect(sql.match(/UPDATE/g)).toHaveLength(1);
    // No separate read — the claim must not be a SELECT-then-UPDATE.
    expect(sql).not.toContain("SELECT");
    expect(sql).not.toContain("INSERT");
    expect(sql).not.toContain("DELETE");

    // The atomicity-critical guard: only write when the key is ABSENT.
    expect(sql).toContain("NOT (");
    // jsonb `?` existence operator against the rule key parameter.
    expect(sql).toMatch(/jsonb\s*\?\s*\$2::text/);
    // jsonb_set writes the key idempotently (create-if-missing).
    expect(sql).toContain("jsonb_set");
    // RETURNING lets the caller detect whether THIS statement claimed the row.
    expect(sql).toContain("RETURNING");
    expect(sql).toContain(`"_id"`);

    // Bound parameters: [logId, ruleKey, nowIso]; no raw interpolation.
    expect(params).toHaveLength(3);
    expect(params[0]).toBe(logId.toString());
    expect(params[1]).toBe(ruleId.toString());
    expect(typeof params[2]).toBe("string");
    // The third parameter is an ISO timestamp string.
    expect(Number.isNaN(Date.parse(params[2] as string))).toBe(false);
    expect(params[2]).toBe(new Date(params[2] as string).toISOString());
  });

  test("the guard parameter ($2) is reused for both jsonb_set path and existence check", async () => {
    const query: jest.Mock = jest.fn().mockResolvedValue([{ _id: "x" }]);
    mockManagerQuery(query);

    await UserOnCallLogService.claimNotificationRuleExecution({
      userOnCallLogId: ObjectID.generate(),
      userNotificationRuleId: ObjectID.generate(),
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    /*
     * The same $2 key drives the write path (ARRAY[$2::text]) and the guard,
     * so what we test for absence is exactly what we write.
     */
    expect(sql).toContain("ARRAY[$2::text]");
    expect(sql).toContain("$2::text)");
    // The log id is matched by uuid-cast primary key.
    expect(sql).toContain(`"_id" = $1::uuid`);
  });

  /*
   * ----------------------------------------------------------------------- *
   * (d) FAIL-SAFE fallback when the atomic statement throws.
   * -----------------------------------------------------------------------
   */

  test("falls back to findOneById + updateOneById and returns TRUE when rule not yet marked (empty object)", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockRejectedValue(new Error("jsonb operator unavailable"));
    mockManagerQuery(query);

    const logId: ObjectID = ObjectID.generate();
    const ruleId: ObjectID = ObjectID.generate();

    const findOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockResolvedValue(fakeLog(logId, {}));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<void> => {
        return Promise.resolve();
      });

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: logId,
        userNotificationRuleId: ruleId,
      });

    expect(claimed).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledTimes(1);

    // Fallback reads the right row and selects the field it needs to inspect.
    const findArg: {
      id: ObjectID;
      select: JSONObject;
      props: { isRoot: boolean };
    } = findOneById.mock.calls[0][0] as {
      id: ObjectID;
      select: JSONObject;
      props: { isRoot: boolean };
    };
    expect(findArg.id.toString()).toBe(logId.toString());
    expect(findArg.select["executedNotificationRules"]).toBe(true);
    expect(findArg.props.isRoot).toBe(true);

    // And it marks exactly this rule as executed.
    expect(updateOneById).toHaveBeenCalledTimes(1);
    const updateArg: {
      id: ObjectID;
      data: { executedNotificationRules: JSONObject };
      props: { isRoot: boolean };
    } = updateOneById.mock.calls[0][0] as {
      id: ObjectID;
      data: { executedNotificationRules: JSONObject };
      props: { isRoot: boolean };
    };
    expect(updateArg.id.toString()).toBe(logId.toString());
    expect(Object.keys(updateArg.data.executedNotificationRules)).toContain(
      ruleId.toString(),
    );
    expect(updateArg.props.isRoot).toBe(true);
  });

  test("fallback also claims (TRUE) when executedNotificationRules is undefined", async () => {
    const query: jest.Mock = jest.fn().mockRejectedValue(new Error("boom"));
    mockManagerQuery(query);

    const logId: ObjectID = ObjectID.generate();
    const ruleId: ObjectID = ObjectID.generate();

    jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockResolvedValue(fakeLog(logId, undefined));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<void> => {
        return Promise.resolve();
      });

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: logId,
        userNotificationRuleId: ruleId,
      });

    expect(claimed).toBe(true);
    expect(updateOneById).toHaveBeenCalledTimes(1);
    const updateArg: { data: { executedNotificationRules: JSONObject } } =
      updateOneById.mock.calls[0][0] as {
        data: { executedNotificationRules: JSONObject };
      };
    expect(Object.keys(updateArg.data.executedNotificationRules)).toEqual([
      ruleId.toString(),
    ]);
  });

  test("fallback preserves other already-executed rule keys while adding the new one", async () => {
    const query: jest.Mock = jest.fn().mockRejectedValue(new Error("boom"));
    mockManagerQuery(query);

    const logId: ObjectID = ObjectID.generate();
    const ruleId: ObjectID = ObjectID.generate();
    const otherRuleKey: string = ObjectID.generate().toString();

    jest.spyOn(UserOnCallLogService, "findOneById").mockResolvedValue(
      fakeLog(logId, {
        [otherRuleKey]: new Date().toISOString(),
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<void> => {
        return Promise.resolve();
      });

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: logId,
        userNotificationRuleId: ruleId,
      });

    expect(claimed).toBe(true);
    const updateArg: { data: { executedNotificationRules: JSONObject } } =
      updateOneById.mock.calls[0][0] as {
        data: { executedNotificationRules: JSONObject };
      };
    const keys: Array<string> = Object.keys(
      updateArg.data.executedNotificationRules,
    );
    expect(keys).toContain(otherRuleKey);
    expect(keys).toContain(ruleId.toString());
    expect(keys).toHaveLength(2);
  });

  test("fallback returns FALSE without updating when the rule is ALREADY in executedNotificationRules", async () => {
    const query: jest.Mock = jest.fn().mockRejectedValue(new Error("boom"));
    mockManagerQuery(query);

    const logId: ObjectID = ObjectID.generate();
    const ruleId: ObjectID = ObjectID.generate();

    const findOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockResolvedValue(
        fakeLog(logId, {
          [ruleId.toString()]: new Date().toISOString(),
        }),
      );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<void> => {
        return Promise.resolve();
      });

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: logId,
        userNotificationRuleId: ruleId,
      });

    expect(claimed).toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
    // Already marked => no duplicate write, no duplicate page.
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("fallback returns FALSE without updating when the log row is missing (findOneById => null)", async () => {
    const query: jest.Mock = jest.fn().mockRejectedValue(new Error("boom"));
    mockManagerQuery(query);

    const findOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<void> => {
        return Promise.resolve();
      });

    const claimed: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: ObjectID.generate(),
        userNotificationRuleId: ObjectID.generate(),
      });

    expect(claimed).toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("fallback engages exactly once (single atomic attempt) and logs the failure", async () => {
    const query: jest.Mock = jest.fn().mockRejectedValue(new Error("boom"));
    mockManagerQuery(query);

    const loggerError: jest.SpyInstance = jest.spyOn(logger, "error");

    jest
      .spyOn(UserOnCallLogService, "findOneById")
      .mockResolvedValue(fakeLog(ObjectID.generate(), {}));
    jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<void> => {
        return Promise.resolve();
      });

    await UserOnCallLogService.claimNotificationRuleExecution({
      userOnCallLogId: ObjectID.generate(),
      userNotificationRuleId: ObjectID.generate(),
    });

    // The atomic path is attempted once, then the fallback takes over.
    expect(query).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalled();
  });

  test("distinct rule ids on the same log are claimed independently in the atomic path", async () => {
    /*
     * Model two concurrent-but-different escalation rules: both should claim
     * because the guard is per-key, not per-log.
     */
    const logId: ObjectID = ObjectID.generate();
    const ruleA: ObjectID = ObjectID.generate();
    const ruleB: ObjectID = ObjectID.generate();

    const query: jest.Mock = jest.fn().mockResolvedValue([{ _id: "x" }]);
    mockManagerQuery(query);

    const claimedA: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: logId,
        userNotificationRuleId: ruleA,
      });
    const claimedB: boolean =
      await UserOnCallLogService.claimNotificationRuleExecution({
        userOnCallLogId: logId,
        userNotificationRuleId: ruleB,
      });

    expect(claimedA).toBe(true);
    expect(claimedB).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    // Each call bound its own rule key.
    expect((query.mock.calls[0] as QueryCall)[1][1]).toBe(ruleA.toString());
    expect((query.mock.calls[1] as QueryCall)[1][1]).toBe(ruleB.toString());
    // Same log id in both.
    expect((query.mock.calls[0] as QueryCall)[1][0]).toBe(logId.toString());
    expect((query.mock.calls[1] as QueryCall)[1][0]).toBe(logId.toString());
  });
});
