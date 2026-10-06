import ProjectService from "../../../Server/Services/ProjectService";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ProjectService.markAiDailyLimitReached: the one conditional UPDATE that
 * decides "the project's owners are told once a day for each daily AI
 * limit" (ProjectAiDailyLimitOwnerNotice). These pin its shape without a
 * database - one statement, the condition and the write together, every
 * value bound, no hooks, no version or updatedAt bump; what it does on a
 * real Postgres, servers racing included, is in
 * AIDailyLimitNoticeAndCatchUpPostgres.
 */

type QueryCall = [string, Array<unknown>];

function mockRepository(result: unknown): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    manager: { query },
  } as never);

  return query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectService.markAiDailyLimitReached", () => {
  const projectId: ObjectID = ObjectID.generate();
  const now: Date = new Date("2026-10-07T15:30:00.000Z");

  test.each([
    [ProjectAiDailyLimit.Tokens, "aiDailyTokenLimitReachedAt"],
    [ProjectAiDailyLimit.Spend, "aiDailySpendLimitReachedAt"],
  ])(
    "the %s limit: one statement writes its column only when it is empty or from an earlier UTC day",
    async (limit: ProjectAiDailyLimit, column: string) => {
      const query: jest.Mock = mockRepository([{ _id: projectId.toString() }]);

      expect(
        await ProjectService.markAiDailyLimitReached({ projectId, limit, now }),
      ).toBe(true);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as QueryCall;

      expect(sql).toBe(
        `WITH "updated" AS (UPDATE "Project" SET "${column}" = $1 WHERE "_id" = $2 AND "deletedAt" IS NULL AND ("${column}" IS NULL OR "${column}" < $3) RETURNING "_id") SELECT "_id" FROM "updated"`,
      );
      expect(params).toEqual([
        now,
        projectId.toString(),
        new Date("2026-10-07T00:00:00.000Z"),
      ]);
      // A passive write: nothing else is touched.
      expect(sql).not.toContain("version");
      expect(sql).not.toContain("updatedAt");
    },
  );

  test("no row written - another server was first today, or the project is gone - is false", async () => {
    mockRepository([]);

    expect(
      await ProjectService.markAiDailyLimitReached({
        projectId,
        limit: ProjectAiDailyLimit.Tokens,
        now,
      }),
    ).toBe(false);
  });

  test("an answer that is not a list of rows is false, never a claim", async () => {
    mockRepository(undefined);

    expect(
      await ProjectService.markAiDailyLimitReached({
        projectId,
        limit: ProjectAiDailyLimit.Spend,
        now,
      }),
    ).toBe(false);
  });

  test("a database error reaches the caller (the notice logs it and tries again on the next refusal)", async () => {
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: {
        query: jest.fn().mockRejectedValue(new Error("connection lost")),
      },
    } as never);

    await expect(
      ProjectService.markAiDailyLimitReached({
        projectId,
        limit: ProjectAiDailyLimit.Tokens,
        now,
      }),
    ).rejects.toThrow("connection lost");
  });
});
