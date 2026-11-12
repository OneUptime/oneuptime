import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import CodeTaskListRows, {
  CODE_TASK_NEWEST_REPLY_SELECT,
  CodeTaskOutcomesRead,
  CodeTaskRepliesRead,
  TRIMMED_CHARACTERS,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskListRows";
import { CodeTaskListStatement } from "../../../../../Server/Utils/AI/CodeTask/CodeTaskListQuery";
import { CODE_TASK_PULL_REQUEST_SELECT } from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT A TASK LIST'S ROWS SAY OF EACH TASK, READ PER TASK (issue #7131).
 *
 * A list row - and a fix's declared code change - says how its task stands
 * from its NEWEST turn. The list read a page of tasks' replies oldest
 * first, cut at 10,000, so a task kept open for months read as it stood
 * long ago. CodeTaskListRows has Postgres count, add up and pick the newest
 * per task, and reads whole only the rows it picked.
 *
 * These run its reads on what Postgres answers - the statements' rows are
 * given here - and check the statements say what they must: every value a
 * parameter, pinned to the project, code-fix runs and live rows. The SQL
 * itself runs on Postgres in CodeTaskLongThreadPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const OTHER_TASK_ID: ObjectID = new ObjectID(
  "0d1e2f3a-4b5c-4d6e-8f7a-8b9c0d1e2f3a",
);
const NEWEST_REPLY_ID: string = "6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c";
const PULL_REQUEST_ID: string = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";

type Rows = Array<Record<string, unknown>>;

let query: SpyInstance<
  (sql: string, parameters: Array<unknown>) => Promise<Rows>
>;

// What Postgres answers each statement, by a word only that statement says.
function answer(rows: {
  replies?: Rows;
  outcomes?: Rows;
  pullRequests?: Rows;
}): void {
  query.mockImplementation(async (sql: string): Promise<Rows> => {
    if (sql.includes('"newestReplyId"')) {
      return rows.replies || [];
    }

    if (sql.includes('"said"')) {
      return rows.outcomes || [];
    }

    if (sql.includes('"pullRequestId"')) {
      return rows.pullRequests || [];
    }

    throw new Error(`A statement the test does not answer: ${sql}`);
  });
}

function reply(id: string, taskId: ObjectID, status: AIRunStatus): AIRun {
  const run: AIRun = new AIRun();
  run._id = id;
  run.codeTaskId = taskId;
  run.status = status;
  return run;
}

beforeEach(() => {
  query = jest.fn(async (): Promise<Rows> => {
    return [];
  }) as unknown as SpyInstance<
    (sql: string, parameters: Array<unknown>) => Promise<Rows>
  >;

  jest.spyOn(AIRunService, "getRepository").mockReturnValue({
    manager: { query },
  } as unknown as ReturnType<typeof AIRunService.getRepository>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a reply that says nothing is", () => {
  /*
   * A reply of only white space says nothing, as a conversation reads it
   * (String.prototype.trim). Postgres's btrim takes off what it is told:
   * exactly the characters trim takes off - every code point checked.
   */
  test("the characters Postgres trims are exactly the ones JavaScript's trim takes off", () => {
    const trimmed: Array<number> = [];

    for (let codePoint: number = 0; codePoint <= 0x10ffff; codePoint++) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
        // A lone surrogate is no character of its own.
        continue;
      }

      if (String.fromCodePoint(codePoint).trim() === "") {
        trimmed.push(codePoint);
      }
    }

    expect(
      Array.from(TRIMMED_CHARACTERS).map((character: string): number => {
        return character.codePointAt(0)!;
      }),
    ).toEqual(trimmed);
  });

  test("negative control: a letter, a zero-width space and a word joiner are not white space", () => {
    for (const character of ["a", "\u200b", "\u2060", "\u180e"]) {
      expect(TRIMMED_CHARACTERS).not.toContain(character);
    }
  });
});

describe("a task's replies, read per task", () => {
  test("no tasks: nothing is asked of Postgres", async () => {
    expect(
      await CodeTaskListRows.readReplies({
        projectId: PROJECT_ID,
        taskIds: [],
      }),
    ).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  test("how many each task has, when one last moved, and its newest - read whole, by its id", async () => {
    const newest: AIRun = reply(NEWEST_REPLY_ID, TASK_ID, AIRunStatus.Running);
    const findRuns: SpyInstance<typeof AIRunService.findBy> = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([newest]);

    answer({
      replies: [
        {
          taskId: TASK_ID.toString(),
          newestReplyId: NEWEST_REPLY_ID,
          // Postgres sends a count as a number, a sum may come as text.
          replyCount: 11999,
          lastActivityAt: new Date("2026-11-12T07:00:00.000Z"),
        },
      ],
    });

    const read: Map<string, CodeTaskRepliesRead> =
      await CodeTaskListRows.readReplies({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID, OTHER_TASK_ID],
      });

    expect(read.get(CodeTaskListRows.key(TASK_ID))).toEqual({
      count: 11999,
      lastActivityAt: new Date("2026-11-12T07:00:00.000Z"),
      newest,
    });
    // A task nobody replied to has no row.
    expect(read.has(CodeTaskListRows.key(OTHER_TASK_ID))).toBe(false);

    const asked: FindBy<AIRun> = findRuns.mock.calls[0]![0] as FindBy<AIRun>;
    const askedQuery: Record<string, unknown> = asked.query as Record<
      string,
      unknown
    >;

    expect(asked.select).toEqual(CODE_TASK_NEWEST_REPLY_SELECT);
    expect(askedQuery["projectId"]).toEqual(PROJECT_ID);
    expect(askedQuery["runType"]).toBe(AIRunType.CodeFix);
    expect(asked.limit).toBe(1);
    expect(asked.props).toEqual({ isRoot: true });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("ids are keyed the same whatever their case, and a row without a task, or a newest reply gone since, says what it can", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);

    answer({
      replies: [
        {
          taskId: TASK_ID.toString().toUpperCase(),
          newestReplyId: NEWEST_REPLY_ID.toUpperCase(),
          replyCount: "3",
          lastActivityAt: "2026-11-12T07:00:00.000Z",
        },
        { taskId: null, newestReplyId: NEWEST_REPLY_ID, replyCount: 9 },
      ],
    });

    const read: Map<string, CodeTaskRepliesRead> =
      await CodeTaskListRows.readReplies({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID],
      });

    expect(Array.from(read.keys())).toEqual([TASK_ID.toString()]);
    // The newest was deleted between the two reads: the task stands as before.
    expect(read.get(TASK_ID.toString())).toEqual({
      count: 3,
      lastActivityAt: new Date("2026-11-12T07:00:00.000Z"),
    });
  });

  test("a reply the ids read back that is not a task's newest is never taken for it", async () => {
    const stray: AIRun = reply(
      "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
      TASK_ID,
      AIRunStatus.Error,
    );
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([stray]);

    answer({
      replies: [
        {
          taskId: TASK_ID.toString(),
          newestReplyId: NEWEST_REPLY_ID,
          replyCount: 2,
          lastActivityAt: null,
        },
      ],
    });

    const read: Map<string, CodeTaskRepliesRead> =
      await CodeTaskListRows.readReplies({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID],
      });

    expect(read.get(TASK_ID.toString())).toEqual({ count: 2 });
  });

  test("its statement: every value a parameter, pinned to the project, code-fix runs and live rows; the newest as a conversation orders them", () => {
    const statement: CodeTaskListStatement =
      CodeTaskListRows.getRepliesStatement({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID, OTHER_TASK_ID],
      });

    expect(statement.parameters).toEqual([
      PROJECT_ID.toString(),
      AIRunType.CodeFix,
      [TASK_ID.toString(), OTHER_TASK_ID.toString()],
    ]);
    expect(statement.sql).toContain(
      'WHERE "projectId" = $1 AND "runType" = $2 AND "deletedAt" IS NULL',
    );
    expect(statement.sql).toContain('"codeTaskId" = ANY($3::uuid[])');
    // Newest first, a tie by id: the order getTurns reads a task's turns in.
    expect(statement.sql).toContain(
      'ORDER BY "codeTaskId", "createdAt" DESC, "_id" ASC',
    );
    expect(statement.sql).not.toContain(PROJECT_ID.toString());
    expect(statement.sql).not.toContain(TASK_ID.toString());
    // No cap: every reply of the page's tasks is counted.
    expect(statement.sql).not.toMatch(/\bLIMIT\b/);
  });
});

describe("what a task's turns ended with, read per task", () => {
  test("no tasks: nothing is asked of Postgres", async () => {
    expect(
      await CodeTaskListRows.readOutcomes({
        projectId: PROJECT_ID,
        taskIds: [],
      }),
    ).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  test("the files changed, the lines added and taken out, and what AI last said - whole", async () => {
    answer({
      outcomes: [
        {
          taskId: TASK_ID.toString(),
          files: 10205,
          // Sums of numeric come as text.
          additions: "52076115",
          deletions: "10205",
          reply: "  Logged each retry.\n",
        },
      ],
    });

    const read: Map<string, CodeTaskOutcomesRead> =
      await CodeTaskListRows.readOutcomes({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID],
      });

    expect(read.get(TASK_ID.toString())).toEqual({
      changes: { files: 10205, additions: 52076115, deletions: 10205 },
      // Cut and trimmed where a row is made (CodeTaskPresenter.toSummary).
      lastReply: "  Logged each retry.\n",
    });
  });

  test("a task that changed no file has no changes; a reply of nothing is no reply; nonsense counts as nothing", () => {
    const read: Map<string, CodeTaskOutcomesRead> = CodeTaskListRows.toOutcomes(
      [
        { taskId: TASK_ID.toString(), files: null, reply: "Explained it." },
        {
          taskId: OTHER_TASK_ID.toString(),
          files: 2,
          additions: "not a number",
          deletions: -4,
          reply: " \n\t ",
        },
        { taskId: "", files: 7 },
      ],
    );

    expect(read.get(TASK_ID.toString())).toEqual({
      changes: null,
      lastReply: "Explained it.",
    });
    expect(read.get(OTHER_TASK_ID.toString())).toEqual({
      changes: { files: 2, additions: 0, deletions: 0 },
    });
    expect(read.size).toBe(2);
  });

  test("its statement: the task's first run and every reply, pinned and bound; what trim takes off passed as a parameter", () => {
    const statement: CodeTaskListStatement =
      CodeTaskListRows.getOutcomesStatement({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID],
      });

    expect(statement.parameters).toEqual([
      PROJECT_ID.toString(),
      AIRunType.CodeFix,
      [TASK_ID.toString()],
      TRIMMED_CHARACTERS,
    ]);
    expect(statement.sql).toContain(
      '(("codeTaskId" IS NULL AND "_id" = ANY($3::uuid[])) OR "codeTaskId" = ANY($3::uuid[]))',
    );
    expect(statement.sql).toContain('"deletedAt" IS NULL');
    expect(statement.sql).toContain('btrim("reply", $4)');
    // Each file once, however many turns changed it.
    expect(statement.sql).toContain(`COUNT(DISTINCT "entry" ->> 'path')`);
    // What AI last said: a reply's before the first turn's, the newest first.
    expect(statement.sql).toContain(
      'ORDER BY "taskId", "isFirst" ASC, "createdAt" DESC, "_id" ASC',
    );
    expect(statement.sql).not.toMatch(/\bLIMIT\b/);
  });
});

describe("the pull request a task's row shows, read per task", () => {
  test("no tasks: nothing is asked", async () => {
    const findPullRequests: SpyInstance<
      typeof AIAgentTaskPullRequestService.findBy
    > = jest.spyOn(AIAgentTaskPullRequestService, "findBy");

    expect(
      await CodeTaskListRows.readPullRequests({
        projectId: PROJECT_ID,
        taskIds: [],
      }),
    ).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
    expect(findPullRequests).not.toHaveBeenCalled();
  });

  test("the one Postgres picked for each task, read whole with what the row shows of it", async () => {
    const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
    pullRequest._id = PULL_REQUEST_ID;
    pullRequest.pullRequestNumber = 77;
    pullRequest.pullRequestState = PullRequestState.Open;

    const findPullRequests: SpyInstance<
      typeof AIAgentTaskPullRequestService.findBy
    > = jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([pullRequest]);

    answer({
      pullRequests: [
        { taskId: TASK_ID.toString(), pullRequestId: PULL_REQUEST_ID },
        // Gone between the two reads: no pull request for that task.
        {
          taskId: OTHER_TASK_ID.toString(),
          pullRequestId: "9a8b7c6d-5e4f-4a3b-8c2d-000000000031",
        },
      ],
    });

    const shown: Map<string, AIAgentTaskPullRequest> =
      await CodeTaskListRows.readPullRequests({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID, OTHER_TASK_ID],
      });

    expect(Array.from(shown.keys())).toEqual([TASK_ID.toString()]);
    expect(shown.get(TASK_ID.toString())?.pullRequestNumber).toBe(77);

    const asked: FindBy<AIAgentTaskPullRequest> = findPullRequests.mock
      .calls[0]![0] as FindBy<AIAgentTaskPullRequest>;

    expect(asked.select).toEqual(CODE_TASK_PULL_REQUEST_SELECT);
    expect((asked.query as Record<string, unknown>)["projectId"]).toEqual(
      PROJECT_ID,
    );
    expect(asked.limit).toBe(2);
    expect(asked.props).toEqual({ isRoot: true });
  });

  test("a task none of whose turns opened one has none, and nothing more is read", async () => {
    const findPullRequests: SpyInstance<
      typeof AIAgentTaskPullRequestService.findBy
    > = jest.spyOn(AIAgentTaskPullRequestService, "findBy");

    answer({ pullRequests: [] });

    expect(
      (
        await CodeTaskListRows.readPullRequests({
          projectId: PROJECT_ID,
          taskIds: [TASK_ID],
        })
      ).size,
    ).toBe(0);
    expect(findPullRequests).not.toHaveBeenCalled();
  });

  test("its statement: the newest open one, one without a state counted open, else the newest - of the task's live turns, in the project", () => {
    const statement: CodeTaskListStatement =
      CodeTaskListRows.getPullRequestStatement({
        projectId: PROJECT_ID,
        taskIds: [TASK_ID],
      });

    expect(statement.parameters).toEqual([
      PROJECT_ID.toString(),
      AIRunType.CodeFix,
      [TASK_ID.toString()],
      PullRequestState.Open,
    ]);
    expect(statement.sql).toContain(
      `COALESCE(NULLIF("pullRequest"."pullRequestState", ''), $4) = $4 AS "isOpen"`,
    );
    expect(statement.sql).toContain(
      'ORDER BY "taskId", "isOpen" DESC, "createdAt" DESC, "pullRequestId" ASC',
    );
    expect(statement.sql).toContain(
      '"pullRequest"."projectId" = $1 AND "pullRequest"."deletedAt" IS NULL',
    );
    expect(statement.sql).toContain(
      '"turn"."projectId" = $1 AND "turn"."runType" = $2 AND "turn"."deletedAt" IS NULL',
    );
    expect(statement.sql).not.toMatch(/\bLIMIT\b/);
  });

  test("toPullRequestIds: each task's id, keyed in lower case; a row missing either is passed by", () => {
    expect(
      CodeTaskListRows.toPullRequestIds([
        {
          taskId: TASK_ID.toString().toUpperCase(),
          pullRequestId: PULL_REQUEST_ID.toUpperCase(),
        },
        { taskId: OTHER_TASK_ID.toString(), pullRequestId: null },
        { taskId: 42, pullRequestId: PULL_REQUEST_ID },
      ]),
    ).toEqual(new Map([[TASK_ID.toString(), PULL_REQUEST_ID]]));
  });
});
