import ProjectService from "../../../Server/Services/ProjectService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The SMS, call, WhatsApp and Telegram balance's writes, without a
 * database: what the one statement looks like (what it does on a real
 * Postgres, concurrency included, is MessagingBalancePostgres).
 *
 * - creditSmsOrCallBalanceInUSDCents: a recharge's credit, added to the
 *   balance as it is (COALESCE(col, 0) + $n), the owners' three notices
 *   re-armed in the same statement, the new balance answered from
 *   RETURNING. It used to be "balance read before the charge + amount",
 *   written back with a separate update.
 * - deductSmsOrCallBalanceInUSDCents: a message's cost, taken the same way,
 *   with the "channel is off" notice re-armed. It used to be "balance read
 *   before sending - cost".
 * - claimSmsOrCallLowBalanceNotice: the owners' low-balance email, claimed
 *   by one conditional UPDATE. It used to be read with the project and
 *   written back afterwards.
 *
 * None of them bumps `version`: a message must never fight somebody saving
 * the project.
 */

type QueryCall = [string, Array<unknown>];

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000f1",
);

// The Project columns these writes name, as the migration created them.
const COLUMNS: Array<string> = [
  "_id",
  "smsOrCallCurrentBalanceInUSDCents",
  "aiCurrentBalanceInUSDCents",
  "lowCallAndSMSBalanceNotificationSentToOwners",
  "failedCallAndSMSBalanceChargeNotificationSentToOwners",
  "notEnabledSmsOrCallNotificationSentToOwners",
  "updatedAt",
];

function mockRepository(result: unknown): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    metadata: {
      tableName: "Project",
      findColumnWithPropertyName: (
        propertyName: string,
      ): { databaseName: string; propertyName: string } | undefined => {
        return COLUMNS.includes(propertyName)
          ? { databaseName: propertyName, propertyName: propertyName }
          : undefined;
      },
      updateDateColumn: { databaseName: "updatedAt" },
      primaryColumns: [{ databaseName: "_id" }],
      columns: [],
    },
    manager: {
      connection: {
        driver: {
          preparePersistentValue: (value: unknown): unknown => {
            return value;
          },
        },
      },
      query: query,
    },
  } as never);

  return query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectService.creditSmsOrCallBalanceInUSDCents", () => {
  test("adds to the balance as it is, re-arms the owners' notices, in one statement that answers the new balance", async () => {
    const query: jest.Mock = mockRepository([
      { smsOrCallCurrentBalanceInUSDCents: 2493 },
    ]);

    expect(
      await ProjectService.creditSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 2000,
      }),
    ).toBe(2493);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `WITH "updated" AS (UPDATE "Project" SET "smsOrCallCurrentBalanceInUSDCents" = COALESCE("smsOrCallCurrentBalanceInUSDCents", 0) + $1, "lowCallAndSMSBalanceNotificationSentToOwners" = $2, "failedCallAndSMSBalanceChargeNotificationSentToOwners" = $3, "notEnabledSmsOrCallNotificationSentToOwners" = $4, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $5 RETURNING "smsOrCallCurrentBalanceInUSDCents") SELECT "smsOrCallCurrentBalanceInUSDCents" FROM "updated"`,
    );
    // Real booleans: the raw path does not coerce (#4519).
    expect(params).toEqual([2000, false, false, false, PROJECT_ID.toString()]);
    expect(sql).not.toContain("version");
  });

  test("a project that is gone: it says so (a charged card must never pass in silence)", async () => {
    mockRepository([]);

    await expect(
      ProjectService.creditSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 2000,
      }),
    ).rejects.toThrow("Project not found");
  });

  test.each([
    ["a fraction of a cent", 12.5],
    ["a negative amount", -100],
    ["not a number", Number.NaN],
  ])(
    "refuses %s before writing anything",
    async (_case: string, amountInUSDCents: number) => {
      const query: jest.Mock = mockRepository([]);

      await expect(
        ProjectService.creditSmsOrCallBalanceInUSDCents({
          projectId: PROJECT_ID,
          amountInUSDCents,
        }),
      ).rejects.toThrow(BadDataException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  test("a balance that comes back as text (a bigint) is still a number", async () => {
    mockRepository([{ smsOrCallCurrentBalanceInUSDCents: "2000" }]);

    expect(
      await ProjectService.creditSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 2000,
      }),
    ).toBe(2000);
  });
});

describe("ProjectService.deductSmsOrCallBalanceInUSDCents", () => {
  test("takes the cost from the balance as it is, re-arms the 'channel is off' notice, and answers the new balance", async () => {
    const query: jest.Mock = mockRepository([
      { smsOrCallCurrentBalanceInUSDCents: 993 },
    ]);

    expect(
      await ProjectService.deductSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 7,
      }),
    ).toBe(993);

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `WITH "updated" AS (UPDATE "Project" SET "smsOrCallCurrentBalanceInUSDCents" = COALESCE("smsOrCallCurrentBalanceInUSDCents", 0) + $1, "notEnabledSmsOrCallNotificationSentToOwners" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $3 RETURNING "smsOrCallCurrentBalanceInUSDCents") SELECT "smsOrCallCurrentBalanceInUSDCents" FROM "updated"`,
    );
    expect(params).toEqual([-7, false, PROJECT_ID.toString()]);
    // The low-balance notice is re-armed by a recharge, not by a send.
    expect(sql).not.toContain("lowCallAndSMSBalanceNotificationSentToOwners");
    expect(sql).not.toContain("version");
  });

  test("the balance may go below zero: the cost is owed, never clamped away", async () => {
    const query: jest.Mock = mockRepository([
      { smsOrCallCurrentBalanceInUSDCents: -5 },
    ]);

    expect(
      await ProjectService.deductSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 10,
      }),
    ).toBe(-5);

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).not.toMatch(/GREATEST|LEAST|CASE/);
  });

  test("a message that cost nothing still re-arms the 'channel is off' notice, as it always has", async () => {
    const query: jest.Mock = mockRepository([
      { smsOrCallCurrentBalanceInUSDCents: 100 },
    ]);

    await ProjectService.deductSmsOrCallBalanceInUSDCents({
      projectId: PROJECT_ID,
      amountInUSDCents: 0,
    });

    expect((query.mock.calls[0] as QueryCall)[1]).toEqual([
      0,
      false,
      PROJECT_ID.toString(),
    ]);
  });

  test("a project that is gone answers null", async () => {
    mockRepository([]);

    expect(
      await ProjectService.deductSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 7,
      }),
    ).toBeNull();
  });

  test("refuses a fraction of a cent before writing anything", async () => {
    const query: jest.Mock = mockRepository([]);

    await expect(
      ProjectService.deductSmsOrCallBalanceInUSDCents({
        projectId: PROJECT_ID,
        amountInUSDCents: 7.000000000000001,
      }),
    ).rejects.toThrow(BadDataException);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("ProjectService.claimSmsOrCallLowBalanceNotice", () => {
  test("one conditional UPDATE: only a project not told yet, and not deleted, is claimed", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockResolvedValue([{ _id: PROJECT_ID.toString() }]);
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    expect(
      await ProjectService.claimSmsOrCallLowBalanceNotice(PROJECT_ID),
    ).toBe(true);

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `WITH "updated" AS (UPDATE "Project" SET "lowCallAndSMSBalanceNotificationSentToOwners" = true WHERE "_id" = $1 AND "deletedAt" IS NULL AND "lowCallAndSMSBalanceNotificationSentToOwners" = false RETURNING "_id") SELECT "_id" FROM "updated"`,
    );
    expect(params).toEqual([PROJECT_ID.toString()]);
    // A passive write: no version or updatedAt.
    expect(sql).not.toContain("version");
    expect(sql).not.toContain("updatedAt");
  });

  test("another message was first (or the project is gone): false", async () => {
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: { query: jest.fn().mockResolvedValue([]) },
    } as never);

    expect(
      await ProjectService.claimSmsOrCallLowBalanceNotice(PROJECT_ID),
    ).toBe(false);
  });

  test("the AI credits' notice is claimed the same way, on its own flag", async () => {
    const query: jest.Mock = jest.fn().mockResolvedValue([]);
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    await ProjectService.claimAiCreditsUsedUpNotice(PROJECT_ID);

    expect((query.mock.calls[0] as QueryCall)[0]).toBe(
      `WITH "updated" AS (UPDATE "Project" SET "lowAiBalanceNotificationSentToOwners" = true WHERE "_id" = $1 AND "deletedAt" IS NULL AND "lowAiBalanceNotificationSentToOwners" = false RETURNING "_id") SELECT "_id" FROM "updated"`,
    );
  });
});
