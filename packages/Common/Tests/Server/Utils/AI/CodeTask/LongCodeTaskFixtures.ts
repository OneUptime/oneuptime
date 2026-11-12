import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CountBy from "../../../../../Server/Types/Database/CountBy";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../../../Server/Types/Database/FindOneBy";
import FindOneByID from "../../../../../Server/Types/Database/FindOneByID";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { CodeTaskFileStatus } from "../../../../../Types/AI/CodeTask";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A LONG CODE TASK, HELD IN MEMORY.
 *
 * A task is its first run and one reply per turn after it (Types/AI/
 * CodeTask). These fixtures hold a task of any number of turns - turn 1 is
 * the task, turn n a reply - with the pull requests its turns opened, and
 * answer AIRunService's and AIAgentTaskPullRequestService's reads the way
 * Postgres would: each query's pins and comparisons (QueryHelper's
 * less-than, at-most, in and not-in are read from the SQL they write), its
 * order, its limit, and only the columns it selects. So a test of a task
 * of 205 turns runs the code that reads a task - its sort, its limit, its
 * count - not a stand-in for its answer. Every read is kept, in order, for
 * a test to say what was read.
 *
 * One statement of SQL is answered too: how many of the task's replies
 * come before one of them (CodeTaskThread.getRepliesBeforeStatement) - the
 * place of a turn a link names. Its SQL runs on Postgres in
 * CodeTaskLongThreadPostgres.test.ts; any other statement fails the test.
 *
 * Turn n was asked n - 1 minutes after the first; AI started it 10 seconds
 * later and worked one minute on it; its reply changed src/turn-<n>.ts.
 */

export const LONG_TASK_PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);

export const LONG_TASK_REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);

export const LONG_TASK_USER_ID: ObjectID = new ObjectID(
  "8b4c7e6d-0f1a-4b2c-9d3e-5f6a7b8c9d0e",
);

const FIRST_ASKED_AT: number = Date.UTC(2026, 9, 1, 9, 0, 0);
const MINUTE_MS: number = 60 * 1000;
export const LONG_TASK_WORK_MS_PER_TURN: number = MINUTE_MS;

// Turn n's run id: a real uuid, the same for the same n.
export function turnId(n: number): ObjectID {
  return new ObjectID(
    `5e1f4b3a-7c8d-4e9f-8a0b-${n.toString(16).padStart(12, "0")}`,
  );
}

// The turn a run id is: turnId's inverse, for a test's words and its failures.
export function turnNumber(id: ObjectID | string | null | undefined): number {
  return parseInt((id || "").toString().slice(-12), 16);
}

export function turnMessage(n: number): string {
  return `Turn ${n}: keep going with the users API`;
}

export function turnReply(n: number): string {
  return `AI's reply to turn ${n}`;
}

export function turnFile(n: number): string {
  return `src/turn-${n}.ts`;
}

export function askedAt(n: number): Date {
  return new Date(FIRST_ASKED_AT + (n - 1) * MINUTE_MS);
}

export interface LongTaskRead {
  service: "AIRun" | "AIAgentTaskPullRequest";
  method: "findBy" | "findOneBy" | "countBy" | "findOneById" | "query";
  args: unknown;
}

// A statement of SQL a read ran, as the repository's manager was asked it.
export interface LongTaskStatement {
  sql: string;
  parameters: Array<unknown>;
}

export interface LongCodeTask {
  // Turn 1 (the task) first, then each reply, oldest first.
  runs: Array<AIRun>;
  pullRequests: Array<AIAgentTaskPullRequest>;
  reads: Array<LongTaskRead>;
  // Turn n's run: 1 is the task.
  turn: (n: number) => AIRun;
  // The task's first run.
  task: () => AIRun;
  // A pull request opened by turn n.
  openPullRequest: (data: {
    turn: number;
    number: number;
    state?: PullRequestState | undefined;
    openedAt?: Date | undefined;
  }) => AIAgentTaskPullRequest;
  // The reads of one service's method, in order.
  readsOf: (
    service: LongTaskRead["service"],
    method: LongTaskRead["method"],
  ) => Array<LongTaskRead>;
}

function makeRun(n: number): AIRun {
  const run: AIRun = new AIRun();
  const asked: Date = askedAt(n);

  run._id = turnId(n).toString();
  run.projectId = LONG_TASK_PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = CodeFixTaskType.CodeRequest;
  run.codeRepositoryId = LONG_TASK_REPOSITORY_ID;
  run.status = AIRunStatus.Completed;
  run.userId = LONG_TASK_USER_ID;
  run.needsUserInput = false;
  run.createdAt = asked;
  run.startedAt = new Date(asked.getTime() + 10 * 1000);
  run.completedAt = new Date(
    asked.getTime() + 10 * 1000 + LONG_TASK_WORK_MS_PER_TURN,
  );
  run.taskContext = {
    request: { message: turnMessage(n), context: [] },
  };
  run.taskOutcome = {
    summary: turnReply(n),
    filesChanged: [
      {
        path: turnFile(n),
        status: CodeTaskFileStatus.Modified,
        additions: n,
        deletions: 1,
      },
    ],
  };

  if (n === 1) {
    run.title = "Add retries to the users API";
    run.taskNumber = 42;
  } else {
    run.codeTaskId = turnId(1);
  }

  return run;
}

// The value a Raw condition QueryHelper wrote compares with, and how.
function readRawCondition(condition: FindOperator<unknown>): {
  sql: string;
  value: unknown;
} {
  const getSql: unknown = condition.getSql;

  if (typeof getSql !== "function") {
    throw new Error("A condition the fake cannot read.");
  }

  const parameters: Record<string, unknown> =
    (condition.objectLiteralParameters as Record<string, unknown>) || {};

  return {
    sql: (getSql as (alias: string) => string)("column"),
    value: Object.values(parameters)[0],
  };
}

function timeOf(value: unknown): number {
  return new Date(value as string | Date).getTime();
}

// Whether a row's value meets a query's condition on its column.
export function meetsCondition(value: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator && condition.type === "raw") {
    const raw: { sql: string; value: unknown } = readRawCondition(
      condition as FindOperator<unknown>,
    );

    if (raw.sql === "TRUE = TRUE") {
      return true;
    }

    if (raw.sql === "TRUE = FALSE") {
      return false;
    }

    if (raw.sql.includes(" IS NOT NULL")) {
      return value !== null && value !== undefined;
    }

    if (raw.sql.includes(" IS NULL")) {
      return value === null || value === undefined;
    }

    const values: Array<string> = Array.isArray(raw.value)
      ? (raw.value as Array<unknown>).map((each: unknown): string => {
          return String(each);
        })
      : [];

    if (raw.sql.includes(" NOT IN ")) {
      return !values.includes(String(value));
    }

    if (raw.sql.includes(" IN ")) {
      return values.includes(String(value));
    }

    if (raw.sql.includes(" <= ")) {
      return timeOf(value) <= timeOf(raw.value);
    }

    if (raw.sql.includes(" < ")) {
      return timeOf(value) < timeOf(raw.value);
    }

    throw new Error(`A condition the fake does not read: ${raw.sql}`);
  }

  if (condition === null || condition === undefined) {
    return value === condition;
  }

  if (value === null || value === undefined) {
    return false;
  }

  return String(value) === String(condition);
}

// A row the task holds: a run, or a pull request one opened.
type HeldRow = AIRun | AIAgentTaskPullRequest;

function meetsQuery(row: HeldRow, query: Record<string, unknown>): boolean {
  return Object.keys(query).every((column: string): boolean => {
    return meetsCondition(
      (row as unknown as Record<string, unknown>)[column],
      query[column],
    );
  });
}

// A copy of a row with only the columns a read selects, as Postgres answers it.
function selected<T extends AIRun | AIAgentTaskPullRequest>(
  row: T,
  select: Record<string, unknown> | undefined,
  make: () => T,
): T {
  if (!select) {
    return row;
  }

  const copy: T = make();

  for (const column of Object.keys(select)) {
    if (select[column]) {
      (copy as unknown as Record<string, unknown>)[column] = (
        row as unknown as Record<string, unknown>
      )[column];
    }
  }

  return copy;
}

function sortedAndCut<T extends HeldRow>(
  rows: Array<T>,
  findBy: {
    sort?: unknown;
    skip?: PositiveNumber | number | undefined;
    limit?: PositiveNumber | number | undefined;
  },
): Array<T> {
  const sort: Record<string, SortOrder> =
    (findBy.sort as Record<string, SortOrder> | undefined) || {};
  const sorted: Array<T> = [...rows];

  for (const column of Object.keys(sort).reverse()) {
    const direction: number = sort[column] === SortOrder.Descending ? -1 : 1;

    sorted.sort((a: T, b: T): number => {
      const left: number = timeOf(
        (a as unknown as Record<string, unknown>)[column],
      );
      const right: number = timeOf(
        (b as unknown as Record<string, unknown>)[column],
      );

      return (left - right) * direction;
    });
  }

  const skip: number = Number(findBy.skip || 0);
  const limit: number =
    findBy.limit === undefined ? sorted.length : Number(findBy.limit);

  return sorted.slice(skip, skip + limit);
}

/*
 * A task of `turnCount` turns, its reads answered from memory from now
 * until the test's mocks are restored.
 */
export function holdLongCodeTask(data: { turnCount: number }): LongCodeTask {
  const runs: Array<AIRun> = [];

  for (let n: number = 1; n <= data.turnCount; n++) {
    runs.push(makeRun(n));
  }

  const pullRequests: Array<AIAgentTaskPullRequest> = [];
  const reads: Array<LongTaskRead> = [];

  // The runs a read finds: its query, order and limit, its columns only.
  const findRuns: (findBy: FindBy<AIRun>) => Array<AIRun> = (
    findBy: FindBy<AIRun>,
  ): Array<AIRun> => {
    const matching: Array<AIRun> = runs.filter((run: AIRun): boolean => {
      return meetsQuery(run, findBy.query as Record<string, unknown>);
    });

    return sortedAndCut(matching, findBy).map((run: AIRun): AIRun => {
      return selected(
        run,
        findBy.select as Record<string, unknown> | undefined,
        (): AIRun => {
          return new AIRun();
        },
      );
    });
  };

  jest
    .spyOn(AIRunService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<AIRun>): Promise<Array<AIRun>> => {
        reads.push({ service: "AIRun", method: "findBy", args: findBy });

        return findRuns(findBy);
      },
    );

  jest
    .spyOn(AIRunService, "findOneBy")
    .mockImplementation(
      async (findOneBy: FindOneBy<AIRun>): Promise<AIRun | null> => {
        reads.push({ service: "AIRun", method: "findOneBy", args: findOneBy });

        return findRuns({ ...findOneBy, limit: 1, skip: 0 })[0] || null;
      },
    );

  jest
    .spyOn(AIRunService, "countBy")
    .mockImplementation(
      async (countBy: CountBy<AIRun>): Promise<PositiveNumber> => {
        reads.push({ service: "AIRun", method: "countBy", args: countBy });

        return new PositiveNumber(
          runs.filter((run: AIRun): boolean => {
            return meetsQuery(run, countBy.query as Record<string, unknown>);
          }).length,
        );
      },
    );

  jest
    .spyOn(AIRunService, "findOneById")
    .mockImplementation(
      async (findOneById: FindOneByID<AIRun>): Promise<AIRun | null> => {
        reads.push({
          service: "AIRun",
          method: "findOneById",
          args: findOneById,
        });

        const run: AIRun | undefined = runs.find((each: AIRun): boolean => {
          return each.id!.toString() === findOneById.id.toString();
        });

        return run
          ? selected(
              run,
              findOneById.select as Record<string, unknown> | undefined,
              (): AIRun => {
                return new AIRun();
              },
            )
          : null;
      },
    );

  /*
   * How many of the task's replies come before one: asked earlier, or the
   * same moment with the greater id - the order getTurns reads them in
   * (newest first, a tie by id). Postgres orders uuids as their lower-case
   * text does.
   */
  const countRepliesBefore: (parameters: Array<unknown>) => number = (
    parameters: Array<unknown>,
  ): number => {
    const [projectId, runType, taskId, replyId] = parameters.map(
      (value: unknown): string => {
        return String(value).toLowerCase();
      },
    );
    const reply: AIRun | undefined = runs.find((run: AIRun): boolean => {
      return run.id!.toString().toLowerCase() === replyId;
    });

    if (!reply) {
      return 0;
    }

    const asked: number = timeOf(reply.createdAt);
    const replyKey: string = reply.id!.toString().toLowerCase();

    return runs.filter((run: AIRun): boolean => {
      const runKey: string = run.id!.toString().toLowerCase();
      const runAsked: number = timeOf(run.createdAt);

      return (
        String(run.projectId).toLowerCase() === projectId &&
        String(run.runType).toLowerCase() === runType &&
        String(run.codeTaskId || "").toLowerCase() === taskId &&
        (runAsked < asked || (runAsked === asked && runKey > replyKey))
      );
    }).length;
  };

  jest.spyOn(AIRunService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        const statement: LongTaskStatement = { sql, parameters };
        reads.push({ service: "AIRun", method: "query", args: statement });

        if (!sql.includes('AS "before"')) {
          throw new Error(`A statement the fake does not answer: ${sql}`);
        }

        return [{ before: countRepliesBefore(parameters) }];
      },
    },
  } as unknown as ReturnType<typeof AIRunService.getRepository>);

  jest
    .spyOn(AIAgentTaskPullRequestService, "findBy")
    .mockImplementation(
      async (
        findBy: FindBy<AIAgentTaskPullRequest>,
      ): Promise<Array<AIAgentTaskPullRequest>> => {
        reads.push({
          service: "AIAgentTaskPullRequest",
          method: "findBy",
          args: findBy,
        });

        const matching: Array<AIAgentTaskPullRequest> = pullRequests.filter(
          (pullRequest: AIAgentTaskPullRequest): boolean => {
            return meetsQuery(
              pullRequest,
              findBy.query as Record<string, unknown>,
            );
          },
        );

        return sortedAndCut(matching, findBy).map(
          (pullRequest: AIAgentTaskPullRequest): AIAgentTaskPullRequest => {
            return selected(
              pullRequest,
              findBy.select as Record<string, unknown> | undefined,
              (): AIAgentTaskPullRequest => {
                return new AIAgentTaskPullRequest();
              },
            );
          },
        );
      },
    );

  const turn: (n: number) => AIRun = (n: number): AIRun => {
    const run: AIRun | undefined = runs[n - 1];

    if (!run) {
      throw new Error(`The task has no turn ${n}.`);
    }

    return run;
  };

  return {
    runs,
    pullRequests,
    reads,
    turn,
    task: (): AIRun => {
      return turn(1);
    },
    openPullRequest: (opened: {
      turn: number;
      number: number;
      state?: PullRequestState | undefined;
      openedAt?: Date | undefined;
    }): AIAgentTaskPullRequest => {
      const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
      pullRequest._id = new ObjectID(
        `9a8b7c6d-5e4f-4a3b-8c2d-${opened.number.toString(16).padStart(12, "0")}`,
      ).toString();
      pullRequest.projectId = LONG_TASK_PROJECT_ID;
      pullRequest.aiRunId = turnId(opened.turn);
      pullRequest.codeRepositoryId = LONG_TASK_REPOSITORY_ID;
      pullRequest.pullRequestNumber = opened.number;
      pullRequest.pullRequestUrl =
        `https://github.com/acme/users-api/pull/${opened.number}` as never;
      pullRequest.pullRequestState = opened.state || PullRequestState.Open;
      pullRequest.title = `Pull request of turn ${opened.turn}`;
      pullRequest.headRefName = `oneuptime-task-42-turn-${opened.turn}`;
      pullRequest.baseRefName = "main";
      pullRequest.createdAt =
        opened.openedAt || new Date(askedAt(opened.turn).getTime() + 30000);
      pullRequests.push(pullRequest);
      return pullRequest;
    },
    readsOf: (
      service: LongTaskRead["service"],
      method: LongTaskRead["method"],
    ): Array<LongTaskRead> => {
      return reads.filter((read: LongTaskRead): boolean => {
        return read.service === service && read.method === method;
      });
    },
  };
}
