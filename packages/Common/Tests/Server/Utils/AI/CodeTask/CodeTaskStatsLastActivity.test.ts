import AIRunService from "../../../../../Server/Services/AIRunService";
import AIRunOutputReadFilter from "../../../../../Server/Utils/AI/AIRunOutputReadFilter";
import CodeTaskStats from "../../../../../Server/Utils/AI/CodeTask/CodeTaskStats";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { CodeFixTaskTypeHelper } from "../../../../../Types/AI/CodeFixTaskType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHEN ANYTHING LAST HAPPENED IN EACH OF MANY REPOSITORIES (#10764).
 *
 * Code's Repositories page orders a list by it - the most recently active
 * first - over every repository the reader may read, not one page of them:
 * so it is one grouped read for all of them, the ids one array, worked out
 * exactly as each row's own stats say it (getRepositoryStats), and held to
 * what the reader may read (a task about a private incident they do not
 * see moves nothing).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

let statements: Array<{ sql: string; parameters: Array<unknown> }>;
let answer: Array<Record<string, unknown>>;

beforeEach(() => {
  statements = [];
  answer = [];

  jest.spyOn(AIRunService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql, parameters });
        return answer;
      },
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeTaskStats.getLastActivity", () => {
  test("one grouped read for every repository, the ids one array, the moment getRepositoryStats says", async () => {
    const ids: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];

    await CodeTaskStats.getLastActivity({
      projectId: PROJECT_ID,
      repositoryIds: ids,
      reader: { isRoot: true },
    });

    expect(statements).toHaveLength(1);

    const sql: string = statements[0]!.sql.replace(/\s+/g, " ");

    expect(sql).toContain(
      `MAX(GREATEST("createdAt", COALESCE("completedAt", "createdAt"))) AS "lastActivityAt"`,
    );
    expect(sql).toContain(`"codeRepositoryId" = ANY($2::uuid[])`);
    expect(sql).toContain(`GROUP BY "codeRepositoryId"`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    // A production review is OneUptime's own, not activity in the repository.
    expect(sql).toContain(`"codeFixTaskType" <> ALL($4::text[])`);
    expect(statements[0]!.parameters).toEqual([
      PROJECT_ID.toString(),
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
      AIRunType.CodeFix,
      CodeFixTaskTypeHelper.getServerRunTaskTypes(),
    ]);
  });

  test("held to what the reader may read", async () => {
    jest
      .spyOn(AIRunOutputReadFilter, "getRunAboutSql")
      .mockImplementation(
        (data: { parameters: Array<unknown> }): string | null => {
          data.parameters.push("private-incident");
          return `"AIRun"."incidentId" IS DISTINCT FROM $${data.parameters.length}`;
        },
      );

    await CodeTaskStats.getLastActivity({
      projectId: PROJECT_ID,
      repositoryIds: [ObjectID.generate()],
      reader: READER,
    });

    expect(statements[0]!.sql).toContain(
      `AND "AIRun"."incidentId" IS DISTINCT FROM $5`,
    );
    expect(statements[0]!.parameters[4]).toBe("private-incident");
    expect(AIRunOutputReadFilter.getRunAboutSql).toHaveBeenCalledWith(
      expect.objectContaining({ alias: "AIRun", props: READER }),
    );
  });

  test("answers each repository's moment by its lower-cased id; one nothing happened in is left out", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    answer = [
      {
        codeRepositoryId: first.toString().toUpperCase(),
        lastActivityAt: "2026-11-24T10:00:00.000Z",
      },
      { codeRepositoryId: second.toString(), lastActivityAt: null },
      { codeRepositoryId: null, lastActivityAt: "2026-11-24T11:00:00.000Z" },
      {
        codeRepositoryId: ObjectID.generate().toString(),
        lastActivityAt: "not a time",
      },
    ];

    const lastActivity: Map<string, Date> = await CodeTaskStats.getLastActivity(
      {
        projectId: PROJECT_ID,
        repositoryIds: [first, second],
        reader: { isRoot: true },
      },
    );

    expect(Array.from(lastActivity.entries())).toEqual([
      [first.toString().toLowerCase(), new Date("2026-11-24T10:00:00.000Z")],
    ]);
  });

  test("no repositories: no read", async () => {
    expect(
      (
        await CodeTaskStats.getLastActivity({
          projectId: PROJECT_ID,
          repositoryIds: [],
          reader: READER,
        })
      ).size,
    ).toBe(0);
    expect(statements).toHaveLength(0);
  });
});
