import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import logger from "../../../../Server/Utils/Logger";
import OnCallRuleClaimsInFlight, {
  OnCallRuleClaimInFlight,
  OnCallRuleClaimSettlement,
} from "../../../../Server/Utils/OnCall/OnCallRuleClaimsInFlight";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RULE'S CLAIM WHILE ITS PAGE IS ON ITS WAY, AND HOW THE PERSON'S-LOG
 * WORKER SETTLES ONE THAT NEVER FINISHED (issue #8407).
 *
 * A rule is claimed on the person's log before it is sent, so it is never
 * sent twice. Its send failing before anything reached a sender gives the
 * claim back; one whose give-back failed too, or whose process stopped
 * before the send, is still kept here, in Redis, and settled at the log's
 * next try: given back when nothing of it was sent - so the rule is sent
 * once - and kept when it may have been.
 */

const LOG_ID: ObjectID = new ObjectID("84070000-0000-4000-8000-0000000000a1");
const OTHER_LOG_ID: ObjectID = new ObjectID(
  "84070000-0000-4000-8000-0000000000a2",
);
const RULE_ID: string = "84070000-0000-4000-8000-0000000000b1";

const CLAIMED_AT: Date = new Date("2026-11-15T03:00:00.000Z");
const MINUTE: number = 60 * 1000;

function claim(
  data: Partial<OnCallRuleClaimInFlight> = {},
): OnCallRuleClaimInFlight {
  return {
    claimKey: RULE_ID,
    ruleId: RULE_ID,
    claimedAt: CLAIMED_AT,
    owed: false,
    ...data,
  };
}

function minutesAfterTheClaim(minutes: number): Date {
  return new Date(CLAIMED_AT.getTime() + minutes * MINUTE);
}

// Redis, in memory.
let kept: Map<string, string>;
let isRedisDown: boolean;

// The log, as the database holds it.
let executed: Record<string, unknown>;
// The statements the give-back sent.
let statements: Array<{ sql: string; parameters: Array<unknown> }>;
let rowsSinceTheClaim: number;
let failTheGiveBack: boolean;

function logAsRead(): UserOnCallLog {
  const log: UserOnCallLog = new UserOnCallLog();
  log.id = LOG_ID;
  log.executedNotificationRules = { ...executed } as never;
  return log;
}

beforeEach(() => {
  kept = new Map();
  isRedisDown = false;
  executed = {};
  statements = [];
  rowsSinceTheClaim = 0;
  failTheGiveBack = false;

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {}) as never);
  }

  const down: () => void = () => {
    if (isRedisDown) {
      throw new Error("Cache is not connected");
    }
  };

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    down();
    kept.set(`${namespace}-${key}`, value);
  }) as never);

  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    namespace: string,
    keys: Array<string>,
  ) => {
    down();
    return keys.map((key: string) => {
      return kept.get(`${namespace}-${key}`) || null;
    });
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    down();
    kept.delete(`${namespace}-${key}`);
  }) as never);

  // The give-back's UPDATE, as Postgres answers it.
  jest.spyOn(UserOnCallLogService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, parameters: Array<unknown>) => {
        statements.push({ sql, parameters });

        if (failTheGiveBack) {
          throw Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          });
        }

        const [, key, claimedAt] = parameters as [string, string, string];

        if (executed[key] !== claimedAt) {
          return [];
        }

        delete executed[key];
        return [{ _id: LOG_ID.toString() }];
      },
    },
  } as never);

  jest
    .spyOn(UserOnCallLogTimelineService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(rowsSinceTheClaim);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a claim in flight", () => {
  test("is read back as it was kept, one round trip for a page of logs", async () => {
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim({ owed: true }));

    const read: Map<string, OnCallRuleClaimInFlight> =
      await OnCallRuleClaimsInFlight.read([LOG_ID, null, OTHER_LOG_ID]);

    expect(GlobalCache.getStrings).toHaveBeenCalledTimes(1);
    expect(Array.from(read.keys())).toEqual([LOG_ID.toString()]);
    expect(read.get(LOG_ID.toString())).toEqual(claim({ owed: true }));
  });

  test("is forgotten once its page was handed over", async () => {
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim());
    await OnCallRuleClaimsInFlight.forget(LOG_ID);

    expect((await OnCallRuleClaimsInFlight.read([LOG_ID])).size).toBe(0);
  });

  test("a Redis that is down keeps nothing, reads none, and never throws", async () => {
    isRedisDown = true;

    await expect(
      OnCallRuleClaimsInFlight.keep(LOG_ID, claim()),
    ).resolves.toBeUndefined();
    await expect(
      OnCallRuleClaimsInFlight.forget(LOG_ID),
    ).resolves.toBeUndefined();
    await expect(OnCallRuleClaimsInFlight.read([LOG_ID])).resolves.toEqual(
      new Map(),
    );
  });

  test.each([
    ["nothing", null],
    ["not JSON", "{oops"],
    ["no claim key", JSON.stringify({ ruleId: RULE_ID, claimedAt: 1 })],
    ["no rule", JSON.stringify({ claimKey: RULE_ID, claimedAt: 1 })],
    [
      "a moment that is not one",
      JSON.stringify({ claimKey: RULE_ID, ruleId: RULE_ID, claimedAt: "soon" }),
    ],
  ])("is none for %s", (_name: string, value: string | null) => {
    expect(OnCallRuleClaimsInFlight.fromCacheValue(value)).toBeNull();
  });

  test("is the claim the log holds only while the log holds its moment", () => {
    expect(
      OnCallRuleClaimsInFlight.isClaimTakenAt(
        claim(),
        CLAIMED_AT.toISOString(),
      ),
    ).toBe(true);
    expect(
      OnCallRuleClaimsInFlight.isClaimTakenAt(
        claim(),
        minutesAfterTheClaim(1).toISOString(),
      ),
    ).toBe(false);
    expect(OnCallRuleClaimsInFlight.isClaimTakenAt(claim(), undefined)).toBe(
      false,
    );
  });
});

describe("giving a claim back", () => {
  test("removes the key only while it still holds the moment it was claimed at", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString(), other: "x" };

    await expect(
      UserOnCallLogService.releaseNotificationRuleClaim({
        userOnCallLogId: LOG_ID,
        claimKey: RULE_ID,
        claimedAt: CLAIMED_AT,
      }),
    ).resolves.toBe(true);

    expect(executed).toEqual({ other: "x" });
    expect(statements[0]!.parameters).toEqual([
      LOG_ID.toString(),
      RULE_ID,
      CLAIMED_AT.toISOString(),
    ]);

    // One UPDATE, conditional on the claim's own value: atomic, like the claim.
    const sql: string = statements[0]!.sql.replace(/\s+/g, " ");
    expect(sql).toContain(
      `SET "executedNotificationRules" = ( COALESCE("executedNotificationRules", '{}')::jsonb - $2::text )::json`,
    );
    expect(sql).toContain(
      `AND (COALESCE("executedNotificationRules", '{}')::jsonb ->> $2::text) = $3::text`,
    );
  });

  test("a claim taken again since, at another moment, is not given back", async () => {
    executed = { [RULE_ID]: minutesAfterTheClaim(2).toISOString() };

    await expect(
      UserOnCallLogService.releaseNotificationRuleClaim({
        userOnCallLogId: LOG_ID,
        claimKey: RULE_ID,
        claimedAt: CLAIMED_AT,
      }),
    ).resolves.toBe(false);

    expect(Object.keys(executed)).toEqual([RULE_ID]);
  });
});

describe("the worker settling a claim whose page never finished", () => {
  test("leaves a claim alone while its page may still be on its way", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString() };
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim());

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim(),
        now: minutesAfterTheClaim(1),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.NotYet);

    expect(statements).toEqual([]);
    expect(Object.keys(executed)).toEqual([RULE_ID]);
    expect((await OnCallRuleClaimsInFlight.read([LOG_ID])).size).toBe(1);
  });

  test("REGRESSION: gives back a claim whose page wrote nothing, and takes it off the log, so this try sends the rule", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString() };
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim());
    const log: UserOnCallLog = logAsRead();

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: log,
        claim: claim(),
        now: minutesAfterTheClaim(3),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.GivenBack);

    expect(executed).toEqual({});
    expect(log.executedNotificationRules).toEqual({});
    expect((await OnCallRuleClaimsInFlight.read([LOG_ID])).size).toBe(0);
  });

  test("keeps a claim whose page wrote a notification: it may have been sent", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString() };
    rowsSinceTheClaim = 1;
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim());

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim(),
        now: minutesAfterTheClaim(3),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.Settled);

    expect(statements).toEqual([]);
    expect(Object.keys(executed)).toEqual([RULE_ID]);
    // Settled: not looked at again.
    expect((await OnCallRuleClaimsInFlight.read([LOG_ID])).size).toBe(0);
  });

  test("looks for the rule's notifications since a little before the claim", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString() };

    await UserOnCallLogService.settleRuleClaimInFlight({
      log: logAsRead(),
      claim: claim(),
      now: minutesAfterTheClaim(3),
    });

    const query: Record<string, unknown> = (
      (UserOnCallLogTimelineService.countBy as jest.Mock).mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(String(query["userNotificationLogId"])).toBe(LOG_ID.toString());
    expect(String(query["userNotificationRuleId"])).toBe(RULE_ID);
    expect(query["createdAt"]).toBeDefined();
  });

  test("gives back one owed back at once, without looking for its notifications", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString() };
    // A row written before the send failed, with nothing handed to a sender.
    rowsSinceTheClaim = 1;

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim({ owed: true }),
        now: minutesAfterTheClaim(0),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.GivenBack);

    expect(UserOnCallLogTimelineService.countBy).not.toHaveBeenCalled();
    expect(executed).toEqual({});
  });

  test("forgets one the log no longer holds - given back, or never taken - and gives nothing back", async () => {
    executed = { [RULE_ID]: minutesAfterTheClaim(5).toISOString() };
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim());

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim(),
        now: minutesAfterTheClaim(10),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.Settled);

    expect(statements).toEqual([]);
    expect(Object.keys(executed)).toEqual([RULE_ID]);
    expect((await OnCallRuleClaimsInFlight.read([LOG_ID])).size).toBe(0);
  });

  test("a give-back the database fails throws, and the claim stays in flight for the next try", async () => {
    executed = { [RULE_ID]: CLAIMED_AT.toISOString() };
    failTheGiveBack = true;
    await OnCallRuleClaimsInFlight.keep(LOG_ID, claim({ owed: true }));

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim({ owed: true }),
        now: minutesAfterTheClaim(1),
      }),
    ).rejects.toThrow("Connection terminated unexpectedly");

    expect(Object.keys(executed)).toEqual([RULE_ID]);
    expect((await OnCallRuleClaimsInFlight.read([LOG_ID])).size).toBe(1);
  });

  test("a repeat's claim is settled under its own key, and its rule's notifications are looked for", async () => {
    const repeatKey: string = UserOnCallLogService.getNotificationRuleClaimKey({
      userNotificationRuleId: new ObjectID(RULE_ID),
      repeatNumber: 2,
    });
    executed = {
      [RULE_ID]: minutesAfterTheClaim(-10).toISOString(),
      [repeatKey]: CLAIMED_AT.toISOString(),
    };

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim({ claimKey: repeatKey }),
        now: minutesAfterTheClaim(3),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.GivenBack);

    expect(Object.keys(executed)).toEqual([RULE_ID]);
  });
});

/*
 * The fallback to a person's verified methods claims the log under a key of
 * its own, and pages through rules it never saves (issue #8469): its claim
 * has no rule, and any notification of the log since the claim is its own.
 */
describe("the fallback's claim in flight", () => {
  const FALLBACK: string = "__fallback__";

  test("is kept and read back with no rule", async () => {
    await OnCallRuleClaimsInFlight.keep(
      LOG_ID,
      claim({ claimKey: FALLBACK, ruleId: "" }),
    );

    expect(
      (await OnCallRuleClaimsInFlight.read([LOG_ID])).get(LOG_ID.toString()),
    ).toEqual(claim({ claimKey: FALLBACK, ruleId: "" }));
  });

  test("is settled by looking for any notification of the log since it was taken", async () => {
    executed = { [FALLBACK]: CLAIMED_AT.toISOString() };

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim({ claimKey: FALLBACK, ruleId: "" }),
        now: minutesAfterTheClaim(3),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.GivenBack);

    const query: Record<string, unknown> = (
      (UserOnCallLogTimelineService.countBy as jest.Mock).mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(String(query["userNotificationLogId"])).toBe(LOG_ID.toString());
    expect(query["userNotificationRuleId"]).toBeUndefined();
    expect(executed).toEqual({});
  });

  test("one whose fallback wrote a notification keeps its claim", async () => {
    executed = { [FALLBACK]: CLAIMED_AT.toISOString() };
    rowsSinceTheClaim = 1;

    await expect(
      UserOnCallLogService.settleRuleClaimInFlight({
        log: logAsRead(),
        claim: claim({ claimKey: FALLBACK, ruleId: "" }),
        now: minutesAfterTheClaim(3),
      }),
    ).resolves.toBe(OnCallRuleClaimSettlement.Settled);

    expect(Object.keys(executed)).toEqual([FALLBACK]);
  });
});
