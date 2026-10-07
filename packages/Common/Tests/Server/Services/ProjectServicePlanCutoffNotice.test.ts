import ProjectService from "../../../Server/Services/ProjectService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The project row's planCutoffNoticeSentAt: when its owners were last told
 * that its plan stops its API keys or limits its SCIM connections
 * (PlanDowngradeOwnerNotice). Three statements, pinned here without a
 * database - each one statement, every value bound, no hooks, no version
 * or updatedAt bump; what they do on a real Postgres, workers racing
 * included, is PlanCutoffNoticePostgres.test.ts:
 *
 *   - claimPlanCutoffNotice: the one-time notice's claim, won only while
 *     the column is empty, by one caller;
 *   - releasePlanCutoffNotice: gives back exactly the claim made, when its
 *     email could not be sent;
 *   - markPlanCutoffNoticeSent: a plan change told the owners now.
 */

type QueryCall = [string, Array<unknown>];

const mockRepository: (result: unknown) => jest.Mock = (
  result: unknown,
): jest.Mock => {
  const query: jest.Mock = jest.fn().mockImplementation(async () => {
    return result;
  });

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    manager: { query },
  } as never);

  return query;
};

afterEach(() => {
  jest.restoreAllMocks();
});

const projectId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-10-07T15:30:00.000Z");

describe("ProjectService.claimPlanCutoffNotice", () => {
  test("one statement writes the column only while it is empty, on a project that is not deleted", async () => {
    const query: jest.Mock = mockRepository([{ _id: projectId.toString() }]);

    expect(await ProjectService.claimPlanCutoffNotice({ projectId, now })).toBe(
      true,
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `WITH "updated" AS (UPDATE "Project" SET "planCutoffNoticeSentAt" = $1 WHERE "_id" = $2 AND "deletedAt" IS NULL AND "planCutoffNoticeSentAt" IS NULL RETURNING "_id") SELECT "_id" FROM "updated"`,
    );
    expect(params).toEqual([now, projectId.toString()]);
    // A passive write: nothing else is touched.
    expect(sql).not.toContain("version");
    expect(sql).not.toContain("updatedAt");
  });

  test("no row written - told already, or the project is gone - is false", async () => {
    mockRepository([]);

    expect(await ProjectService.claimPlanCutoffNotice({ projectId, now })).toBe(
      false,
    );
  });

  test("an answer that is not a list of rows is false, never a claim", async () => {
    mockRepository(undefined);

    expect(await ProjectService.claimPlanCutoffNotice({ projectId, now })).toBe(
      false,
    );
  });

  test("a database error reaches the caller", async () => {
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: {
        query: jest.fn().mockImplementation(async () => {
          throw new Error("connection lost");
        }),
      },
    } as never);

    await expect(
      ProjectService.claimPlanCutoffNotice({ projectId, now }),
    ).rejects.toThrow("connection lost");
  });
});

describe("ProjectService.releasePlanCutoffNotice", () => {
  test("empties the column only while it still holds the claim that was made", async () => {
    const query: jest.Mock = mockRepository([]);

    await ProjectService.releasePlanCutoffNotice({
      projectId,
      claimedAt: now,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `UPDATE "Project" SET "planCutoffNoticeSentAt" = NULL WHERE "_id" = $1 AND "planCutoffNoticeSentAt" = $2`,
    );
    expect(params).toEqual([projectId.toString(), now]);
  });
});

describe("ProjectService.markPlanCutoffNoticeSent", () => {
  test("writes now, whether or not the owners were told before", async () => {
    const query: jest.Mock = mockRepository([]);

    await ProjectService.markPlanCutoffNoticeSent({ projectId, now });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `UPDATE "Project" SET "planCutoffNoticeSentAt" = $1 WHERE "_id" = $2`,
    );
    expect(params).toEqual([now, projectId.toString()]);
    expect(sql).not.toContain("IS NULL");
  });
});

describe("the column", () => {
  test("is internal: no one reads or writes it through the API", async () => {
    const { default: Project } = await import(
      "../../../Models/DatabaseModels/Project"
    );
    const project: InstanceType<typeof Project> = new Project();

    expect(project.getColumnAccessControlFor("planCutoffNoticeSentAt")).toEqual(
      { create: [], read: [], update: [] },
    );
    expect(
      project.getTableColumnMetadata("planCutoffNoticeSentAt")
        .hideColumnInDocumentation,
    ).toBe(true);
  });
});
