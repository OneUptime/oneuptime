import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import Model from "../../../Models/DatabaseModels/UserOnCallLog";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import {
  getRepeatClaimKey,
  MAX_NOTIFICATION_REPEATS,
} from "../../../Types/NotificationRule/NotificationRepeat";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * A push rule that repeats until acknowledged sends up to eleven pushes on one
 * on-call log: its first push and ten repeats. Each is claimed on the log
 * before it is sent (claimNotificationRuleExecution, audit F7), so two worker
 * runs that overlap can never send the same one twice.
 *
 * That only works if every delivery has a claim of its own. The first push is
 * claimed under the rule's id, exactly as every rule was before repeats
 * existed; repeat n under getRepeatClaimKey(ruleId, n). Get the key wrong and
 * one of two things happens, both silently:
 *
 *   - a repeat claimed under the rule's id finds the first push's claim and
 *     is never sent: the responder who slept through the first alarm gets no
 *     second one.
 *   - two repeats sharing a key: the second is never sent, or - with a key
 *     that changes between runs - the same repeat is sent twice.
 *
 * The SQL itself is pinned in UserOnCallLogClaimNotificationRule.test.ts. This
 * file pins which key each delivery is claimed under, and that the claims of
 * one rule's deliveries neither block nor are blocked by one another.
 */

const LOG_ID: ObjectID = new ObjectID("12345678-1234-4234-8234-123456789012");
const RULE_ID: ObjectID = new ObjectID("abcdef01-2345-4678-89ab-cdef01234567");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "fedcba98-7654-4321-8fed-cba987654321",
);

type QueryCall = [string, Array<unknown>];

// Mock this.getRepository().manager.query with the supplied jest mock.
function mockManagerQuery(query: jest.Mock): void {
  jest.spyOn(UserOnCallLogService, "getRepository").mockReturnValue({
    manager: {
      query,
    },
  } as any);
}

/*
 * One on-call log's executedNotificationRules, with the claim's conditional
 * UPDATE played against it the way Postgres runs it: the key is written only
 * when it is not there yet, and a row comes back only when it was written.
 * Nothing in between can interleave, as nothing can inside one statement.
 */
interface LogTable {
  executed: JSONObject;
  query: jest.Mock;
}

function logTable(executed: JSONObject = {}): LogTable {
  const table: LogTable = {
    executed: { ...executed },
    query: jest.fn(),
  };

  table.query.mockImplementation(
    async (
      _sql: string,
      params: Array<unknown>,
    ): Promise<Array<JSONObject>> => {
      const logId: string = params[0] as string;
      const claimKey: string = params[1] as string;

      if (logId !== LOG_ID.toString()) {
        return [];
      }

      if (Object.keys(table.executed).includes(claimKey)) {
        return [];
      }

      table.executed[claimKey] = params[2] as string;

      return [{ _id: logId }];
    },
  );

  mockManagerQuery(table.query);

  return table;
}

async function claim(
  repeatNumber?: number | undefined,
  ruleId: ObjectID = RULE_ID,
): Promise<boolean> {
  return await UserOnCallLogService.claimNotificationRuleExecution({
    userOnCallLogId: LOG_ID,
    userNotificationRuleId: ruleId,
    ...(repeatNumber !== undefined ? { repeatNumber: repeatNumber } : {}),
  });
}

// The key a claim bound as $2 - what it tested for and wrote.
function claimedKey(query: jest.Mock, call: number = 0): string {
  return (query.mock.calls[call] as QueryCall)[1][1] as string;
}

describe("UserOnCallLogService.claimNotificationRuleExecution - the key each delivery is claimed under", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the first push is claimed under the rule's own id, as every rule was before repeats existed", async () => {
    /*
     * Logs written before this change hold rule ids. A first push claimed
     * under anything else would read every one of them as not yet sent.
     */
    const table: LogTable = logTable();

    await claim();

    expect(claimedKey(table.query)).toBe(RULE_ID.toString());
  });

  test("repeat number 0 is the first push", async () => {
    const table: LogTable = logTable();

    await claim(0);

    expect(claimedKey(table.query)).toBe(RULE_ID.toString());
  });

  test.each([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10]])(
    "repeat %s is claimed under a key of its own",
    async (repeatNumber: number) => {
      const table: LogTable = logTable();

      await claim(repeatNumber);

      expect(claimedKey(table.query)).toBe(
        `${RULE_ID.toString()}:repeat:${repeatNumber}`,
      );
      expect(claimedKey(table.query)).toBe(
        getRepeatClaimKey(RULE_ID.toString(), repeatNumber),
      );
    },
  );

  test.each([
    ["a negative number", -1],
    ["NaN", NaN],
  ])(
    "%s is read as the first push, so nothing outside the scheme is written to the log",
    async (_label: string, repeatNumber: number) => {
      const table: LogTable = logTable();

      await claim(repeatNumber);

      expect(claimedKey(table.query)).toBe(RULE_ID.toString());
    },
  );

  test("a repeat is claimed with the very statement the first push is, on the same log", async () => {
    /*
     * The atomicity is the statement's - one conditional UPDATE with a
     * RETURNING clause. A repeat claimed some other way would be the one
     * delivery two workers could both send.
     */
    const table: LogTable = logTable();

    await claim();
    await claim(4);

    const [firstPushSql, firstPushParams] = table.query.mock
      .calls[0] as QueryCall;
    const [repeatSql, repeatParams] = table.query.mock.calls[1] as QueryCall;

    expect(repeatSql).toBe(firstPushSql);
    expect(repeatParams[0]).toBe(LOG_ID.toString());
    expect(firstPushParams[0]).toBe(LOG_ID.toString());
    expect(repeatParams).toHaveLength(3);
  });

  test("the repeat's key is bound as a parameter, never written into the SQL", async () => {
    const table: LogTable = logTable();

    await claim(7);

    const [sql] = table.query.mock.calls[0] as QueryCall;

    expect(sql).not.toContain(RULE_ID.toString());
    expect(sql).not.toContain(":repeat:");
  });
});

describe("UserOnCallLogService.claimNotificationRuleExecution - one rule's deliveries are claimed independently", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the first push's claim does not block the first repeat", async () => {
    logTable();

    expect(await claim()).toBe(true);
    expect(await claim(1)).toBe(true);
  });

  test("a repeat's claim does not block the first push - the two are never confused", async () => {
    /*
     * Never the order the worker sends them in, which is the point: were the
     * keys shared, this is the order in which the first push would be lost.
     */
    logTable();

    expect(await claim(1)).toBe(true);
    expect(await claim()).toBe(true);
  });

  test("a first push already claimed is not sent again, while its repeat still is", async () => {
    logTable({ [RULE_ID.toString()]: "2026-10-13T09:00:00.000Z" });

    expect(await claim()).toBe(false);
    expect(await claim(1)).toBe(true);
  });

  test("a repeat already claimed is not sent again, while the next one still is", async () => {
    logTable({
      [RULE_ID.toString()]: "2026-10-13T09:00:00.000Z",
      [getRepeatClaimKey(RULE_ID.toString(), 1)]: "2026-10-13T09:05:00.000Z",
    });

    expect(await claim(1)).toBe(false);
    expect(await claim(2)).toBe(true);
  });

  test("two workers claiming the same repeat at once: exactly one of them sends it", async () => {
    logTable({ [RULE_ID.toString()]: "2026-10-13T09:00:00.000Z" });

    const results: Array<boolean> = await Promise.all([claim(3), claim(3)]);

    expect(
      results.filter((claimed: boolean): boolean => {
        return claimed;
      }),
    ).toHaveLength(1);
  });

  test("a whole page - the first push and all ten repeats - is eleven claims, each won once", async () => {
    const table: LogTable = logTable();

    const firstPass: Array<boolean> = [];
    const secondPass: Array<boolean> = [];

    for (
      let repeatNumber: number = 0;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      firstPass.push(await claim(repeatNumber));
    }

    for (
      let repeatNumber: number = 0;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      secondPass.push(await claim(repeatNumber));
    }

    expect(firstPass).toEqual(
      new Array<boolean>(MAX_NOTIFICATION_REPEATS + 1).fill(true),
    );
    expect(secondPass).toEqual(
      new Array<boolean>(MAX_NOTIFICATION_REPEATS + 1).fill(false),
    );

    const expectedKeys: Array<string> = [RULE_ID.toString()];

    for (
      let repeatNumber: number = 1;
      repeatNumber <= MAX_NOTIFICATION_REPEATS;
      repeatNumber++
    ) {
      expectedKeys.push(getRepeatClaimKey(RULE_ID.toString(), repeatNumber));
    }

    expect(Object.keys(table.executed).sort()).toEqual(expectedKeys.sort());
  });

  test("another rule's repeat on the same log is a different claim", async () => {
    logTable({
      [RULE_ID.toString()]: "2026-10-13T09:00:00.000Z",
      [getRepeatClaimKey(RULE_ID.toString(), 1)]: "2026-10-13T09:05:00.000Z",
    });

    expect(await claim(1, OTHER_RULE_ID)).toBe(true);
    expect(await claim(1, RULE_ID)).toBe(false);
  });
});

describe("UserOnCallLogService.claimNotificationRuleExecution - the fail-safe claims repeats under the same keys", () => {
  /*
   * When the atomic statement fails, the claim falls back to reading the log
   * and writing the key (a duplicate page beats a missed one). The fallback
   * has to agree with the statement about the key, or a repeat that fell back
   * would be claimed under the first push's id and lost.
   */
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    mockManagerQuery(
      jest.fn().mockRejectedValue(new Error("jsonb operator unavailable")),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function storedLog(executed: JSONObject): Model {
    return {
      id: LOG_ID,
      executedNotificationRules: executed,
    } as unknown as Model;
  }

  function writtenKeys(updateOneById: jest.SpyInstance): Array<string> {
    const updateArg: { data: { executedNotificationRules: JSONObject } } =
      updateOneById.mock.calls[0]![0] as {
        data: { executedNotificationRules: JSONObject };
      };

    return Object.keys(updateArg.data.executedNotificationRules).sort();
  }

  test("a repeat is written under its own key, beside the first push's", async () => {
    jest.spyOn(UserOnCallLogService, "findOneById").mockResolvedValue(
      storedLog({
        [RULE_ID.toString()]: "2026-10-13T09:00:00.000Z",
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<number> => {
        return Promise.resolve(1);
      });

    expect(await claim(2)).toBe(true);

    expect(writtenKeys(updateOneById)).toEqual(
      [RULE_ID.toString(), getRepeatClaimKey(RULE_ID.toString(), 2)].sort(),
    );
  });

  test("a repeat already on the log is not claimed again, and nothing is written", async () => {
    jest.spyOn(UserOnCallLogService, "findOneById").mockResolvedValue(
      storedLog({
        [RULE_ID.toString()]: "2026-10-13T09:00:00.000Z",
        [getRepeatClaimKey(RULE_ID.toString(), 2)]: "2026-10-13T09:10:00.000Z",
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<number> => {
        return Promise.resolve(1);
      });

    expect(await claim(2)).toBe(false);
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a repeat on the log does not stand in for the first push", async () => {
    jest.spyOn(UserOnCallLogService, "findOneById").mockResolvedValue(
      storedLog({
        [getRepeatClaimKey(RULE_ID.toString(), 1)]: "2026-10-13T09:05:00.000Z",
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockImplementation((): Promise<number> => {
        return Promise.resolve(1);
      });

    expect(await claim()).toBe(true);
    expect(writtenKeys(updateOneById)).toEqual(
      [RULE_ID.toString(), getRepeatClaimKey(RULE_ID.toString(), 1)].sort(),
    );
  });
});
