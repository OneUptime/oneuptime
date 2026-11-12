import Entities from "../../../Models/DatabaseModels/Index";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import User from "../../../Models/DatabaseModels/User";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import UserService from "../../../Server/Services/UserService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import CodeTaskAgentBrief from "../../../Server/Utils/AI/CodeTask/CodeTaskAgentBrief";
import CodeTaskListRows, {
  CodeTaskOutcomesRead,
  CodeTaskRepliesRead,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskListRows";
import CodeTaskPresenter, {
  TURN_NOT_SHOWN_SELECT,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import CodeTaskThread, {
  CodeTaskNumberedTurn,
  CodeTaskTurnsRead,
  MAX_TURNS_PER_TASK,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import {
  CodeTaskAgentDetails,
  CodeTaskAgentTurn,
  CodeTaskChangeStats,
  CodeTaskConversationJSON,
  CodeTaskOutcome,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { DataSource } from "typeorm";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";

/*
 * A CODE TASK OF MORE THAN 200 TURNS, READ BY A REAL, MIGRATED POSTGRES
 * (issue #6529).
 *
 * The unit tests run CodeTaskThread's reads against a task held in memory
 * that reads QueryHelper's SQL text (LongCodeTaskFixtures); this runs the
 * same reads - through AIRunService and AIAgentTaskPullRequestService, as
 * the Code API and the Runner's brief make them - on structure-only copies
 * of the migrated AIRun and AIAgentTaskPullRequest tables:
 *
 *  - a conversation is its first turn and its newest 199 replies, and the
 *    count says how many replies between them it leaves out - never a
 *    deleted reply, another project's run or another task's;
 *  - the replies left out are read once each: none read twice, none lost,
 *    two turns asked the same moment included;
 *  - the pull request a reply pushes to is found whichever turn opened it,
 *    the 203rd too;
 *  - the Runner's brief for turn 205 holds turns 7 to 204, and the task's
 *    page the first turn and the newest 199 with every turn's files at its
 *    top;
 *  - a task list's rows, and a fix's declared code changes, read each task
 *    as its NEWEST turn stands - its state, its turns, its last moment, its
 *    pull request, what it changed and what AI last said - for a task of
 *    10,205 turns too, whose replies an oldest-first read of 10,000 never
 *    reached (issue #7131);
 *  - a link to a turn the page does not show comes back with its place in
 *    the task, as the conversation orders its turns, ties included - and
 *    never a run of another task (issue #7130).
 *
 * Opt in with RUN_POSTGRES_CODE_TASK_TESTS=true against a database the
 * registered migrations have been applied to:
 *
 *   RUN_POSTGRES_CODE_TASK_TESTS=true \
 *   CODE_TASK_TEST_DATABASE_HOST=127.0.0.1 \
 *   CODE_TASK_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/CodeTaskLongThreadPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, with
 * CodeTaskPostgres.test.ts, after every registered migration is applied.
 * The tables are cloned (LIKE ... INCLUDING ALL) into a uniquely named
 * schema, first on the search_path, and dropped afterwards; every row is
 * synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CODE_TASK_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["AIRun", "AIAgentTaskPullRequest"];

const SCHEMA_NAME_DASHES: RegExp = /-/g;

const PROJECT_ID: string = "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d";
const OTHER_PROJECT_ID: string = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REPOSITORY_ID: string = "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const USER_ID: string = "8b4c7e6d-0f1a-4b2c-9d3e-5f6a7b8c9d0e";

const FIRST_ASKED_AT: number = Date.UTC(2026, 9, 1, 9, 0, 0);
const MINUTE_MS: number = 60 * 1000;

// A task kept open as a working thread for months: more replies than one read of 10,000.
const HUGE_TURNS: number = LIMIT_PER_PROJECT + 205;

function askedAt(n: number): Date {
  return new Date(FIRST_ASKED_AT + (n - 1) * MINUTE_MS);
}

function range(from: number, to: number): Array<number> {
  const numbers: Array<number> = [];

  for (let n: number = from; n <= to; n++) {
    numbers.push(n);
  }

  return numbers;
}

describePostgres(
  "a code task of more than 200 turns, on a migrated Postgres",
  () => {
    const schema: string = `code_task_long_${ObjectID.generate()
      .toString()
      .replace(SCHEMA_NAME_DASHES, "")}`;

    let database: DataSource;

    // Each task's run ids, by turn: turn 1 is the task.
    const tasks: Map<string, Map<number, string>> = new Map<
      string,
      Map<number, string>
    >();

    // Turn n of a task seeded by seedTask.
    const runOf: (task: string, n: number) => string = (
      task: string,
      n: number,
    ): string => {
      return tasks.get(task)!.get(n)!;
    };

    const numberOf: (task: string, runId: string) => number = (
      task: string,
      runId: string,
    ): number => {
      for (const [n, id] of tasks.get(task)!.entries()) {
        if (id === runId.toString()) {
          return n;
        }
      }

      return -1;
    };

    /*
     * A task of `turnCount` turns, as Code writes one: its first run, then a
     * reply per turn naming it; each asked a minute after the one before,
     * worked on for a minute, its reply changing a file of its own.
     */
    const seedTask: (data: {
      name: string;
      turnCount: number;
      // Turns asked the same moment as the turn after them.
      askedWithNext?: Array<number> | undefined;
    }) => Promise<void> = async (data: {
      name: string;
      turnCount: number;
      askedWithNext?: Array<number> | undefined;
    }): Promise<void> => {
      const ids: Map<number, string> = new Map<number, string>();
      tasks.set(data.name, ids);

      for (let n: number = 1; n <= data.turnCount; n++) {
        ids.set(n, ObjectID.generate().toString());
      }

      const rows: Array<string> = [];
      const parameters: Array<unknown> = [];

      for (let n: number = 1; n <= data.turnCount; n++) {
        const asked: Date = (data.askedWithNext || []).includes(n)
          ? askedAt(n + 1)
          : askedAt(n);
        const values: Array<unknown> = [
          ids.get(n),
          PROJECT_ID,
          "CodeFix",
          "CodeRequest",
          "Completed",
          REPOSITORY_ID,
          n === 1 ? null : ids.get(1),
          USER_ID,
          n === 1 ? `${data.name}: keep the users API fast` : null,
          n === 1 ? 42 : null,
          JSON.stringify({
            request: { message: `Turn ${n}: keep going`, context: [] },
          }),
          JSON.stringify({
            summary: `Reply to turn ${n}`,
            filesChanged: [
              {
                path: `src/turn-${n}.ts`,
                status: "Modified",
                additions: n,
                deletions: 1,
              },
            ],
          }),
          asked,
          new Date(asked.getTime() + 10 * 1000),
          new Date(asked.getTime() + 10 * 1000 + MINUTE_MS),
        ];
        const base: number = parameters.length;

        rows.push(
          `(${values
            .map((_value: unknown, index: number): string => {
              return `$${base + index + 1}`;
            })
            .join(", ")}, 1, false)`,
        );
        parameters.push(...values);
      }

      await database.query(
        `INSERT INTO "AIRun" ("_id", "projectId", "runType", "codeFixTaskType", "status", "codeRepositoryId", "codeTaskId", "userId", "title", "taskNumber", "taskContext", "taskOutcome", "createdAt", "startedAt", "completedAt", "version", "needsUserInput") VALUES ${rows.join(", ")}`,
        parameters,
      );
    };

    /*
     * Replies `from` to `to` of a task seeded by seedTask, as seedTask
     * writes them, in one statement: a task of ten thousand turns does not
     * fit in one statement's parameters. Their ids are read back by when
     * each was asked.
     */
    const seedReplies: (data: {
      name: string;
      from: number;
      to: number;
    }) => Promise<void> = async (data: {
      name: string;
      from: number;
      to: number;
    }): Promise<void> => {
      await database.query(
        `INSERT INTO "AIRun" ("_id", "projectId", "runType", "codeFixTaskType", "status", "codeRepositoryId", "codeTaskId", "userId", "taskContext", "taskOutcome", "createdAt", "startedAt", "completedAt", "version", "needsUserInput")
SELECT gen_random_uuid(), $1, 'CodeFix', 'CodeRequest', 'Completed', $2, $3, $4,
  jsonb_build_object('request', jsonb_build_object('message', 'Turn ' || n || ': keep going', 'context', '[]'::jsonb)),
  jsonb_build_object('summary', 'Reply to turn ' || n, 'filesChanged', jsonb_build_array(jsonb_build_object('path', 'src/turn-' || n || '.ts', 'status', 'Modified', 'additions', n, 'deletions', 1))),
  $5::timestamptz + make_interval(mins => n - 1),
  $5::timestamptz + make_interval(mins => n - 1, secs => 10),
  $5::timestamptz + make_interval(mins => n, secs => 10),
  1, false
FROM generate_series($6::int, $7::int) AS n`,
        [
          PROJECT_ID,
          REPOSITORY_ID,
          runOf(data.name, 1),
          USER_ID,
          new Date(FIRST_ASKED_AT),
          data.from,
          data.to,
        ],
      );

      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "AIRun" WHERE "codeTaskId" = $1 AND "createdAt" >= $2 ORDER BY "createdAt" ASC`,
        [runOf(data.name, 1), askedAt(data.from)],
      );

      expect(rows).toHaveLength(data.to - data.from + 1);

      rows.forEach((row: { _id: string }, index: number): void => {
        tasks.get(data.name)!.set(data.from + index, row._id);
      });
    };

    // A turn's outcome, written as AI wrote it: what it said and the files.
    const setOutcome: (
      task: string,
      n: number,
      outcome: unknown,
    ) => Promise<void> = async (
      task: string,
      n: number,
      outcome: unknown,
    ): Promise<void> => {
      await database.query(
        `UPDATE "AIRun" SET "taskOutcome" = $2 WHERE "_id" = $1`,
        [runOf(task, n), outcome === null ? null : JSON.stringify(outcome)],
      );
    };

    // A turn still being worked on: no end, nothing said yet.
    const setWorking: (task: string, n: number) => Promise<void> = async (
      task: string,
      n: number,
    ): Promise<void> => {
      await database.query(
        `UPDATE "AIRun" SET "status" = 'Running', "completedAt" = NULL, "taskOutcome" = NULL WHERE "_id" = $1`,
        [runOf(task, n)],
      );
    };

    const openPullRequest: (data: {
      task: string;
      turn: number;
      number: number;
      state?: string;
    }) => Promise<void> = async (data: {
      task: string;
      turn: number;
      number: number;
      state?: string;
    }): Promise<void> => {
      await database.query(
        `INSERT INTO "AIAgentTaskPullRequest" ("_id", "version", "projectId", "aiRunId", "codeRepositoryId", "title", "pullRequestState", "pullRequestNumber", "pullRequestUrl", "headRefName", "baseRefName", "createdAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, 'main', $10)`,
        [
          ObjectID.generate().toString(),
          PROJECT_ID,
          runOf(data.task, data.turn),
          REPOSITORY_ID,
          `Pull request of turn ${data.turn}`,
          // None given: open. One recorded without a state is written as such.
          data.state === undefined ? "open" : data.state,
          data.number,
          `https://github.com/acme/users-api/pull/${data.number}`,
          `oneuptime-task-42-turn-${data.turn}`,
          new Date(askedAt(data.turn).getTime() + 30 * 1000),
        ],
      );
    };

    // The task's first run, read as the Code API reads it.
    const taskOf: (name: string) => Promise<AIRun> = async (
      name: string,
    ): Promise<AIRun> => {
      const task: AIRun | null = await CodeTaskThread.findTask({
        projectId: new ObjectID(PROJECT_ID),
        taskId: new ObjectID(runOf(name, 1)),
      });

      expect(task).not.toBeNull();

      return task!;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["CODE_TASK_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["CODE_TASK_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CODE_TASK_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema},public`,
          max: 10,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      // A task of 205 turns, one of 200, one of 12, and turn 6 of another asked with turn 7.
      await seedTask({ name: "long", turnCount: 205 });
      await seedTask({ name: "two hundred", turnCount: 200 });
      await seedTask({ name: "short", turnCount: 12 });
      await seedTask({ name: "ties", turnCount: 205, askedWithNext: [6] });

      // Never one of the long task's: a deleted reply, another project's run.
      await database.query(
        `INSERT INTO "AIRun" ("_id", "projectId", "runType", "codeFixTaskType", "status", "codeTaskId", "createdAt", "deletedAt", "version", "needsUserInput") VALUES ($1, $2, 'CodeFix', 'CodeRequest', 'Completed', $3, $4, now(), 1, false), ($5, $6, 'CodeFix', 'CodeRequest', 'Completed', $3, $4, null, 1, false)`,
        [
          ObjectID.generate().toString(),
          PROJECT_ID,
          runOf("long", 1),
          askedAt(3),
          ObjectID.generate().toString(),
          OTHER_PROJECT_ID,
        ],
      );

      await openPullRequest({ task: "long", turn: 203, number: 77 });
      await openPullRequest({
        task: "long",
        turn: 3,
        number: 31,
        state: "merged",
      });

      /*
       * Issue #7131: a task of 10,205 turns, its newest still working; its
       * open pull request opened by turn 10,204, a merged one by turn 3.
       */
      await seedTask({ name: "huge", turnCount: 1 });
      await seedReplies({ name: "huge", from: 2, to: HUGE_TURNS });
      await setWorking("huge", HUGE_TURNS);
      await openPullRequest({
        task: "huge",
        turn: HUGE_TURNS - 1,
        number: 900,
      });
      await openPullRequest({
        task: "huge",
        turn: 3,
        number: 903,
        state: "merged",
      });

      /*
       * A task whose turns changed one file again and again, wrote counts
       * that are not whole numbers - or not numbers - and whose newest turn
       * that ended said nothing: its row adds up as the conversation does.
       */
      await seedTask({ name: "repeat", turnCount: 4 });
      await setOutcome("repeat", 1, {
        summary: "Reply to turn 1",
        filesChanged: [
          { path: "src/a.ts", status: "Modified", additions: 2, deletions: 1 },
          { path: "src/b.ts", status: "Added", additions: 2.7, deletions: -3 },
        ],
      });
      await setOutcome("repeat", 2, {
        summary: "Reply to turn 2",
        filesChanged: [
          {
            path: "src/a.ts",
            status: "Modified",
            additions: 3,
            deletions: "4",
          },
          { status: "Modified", additions: 5, deletions: 5 },
          "src/c.ts",
        ],
      });
      await setOutcome("repeat", 3, { summary: " \n\t ", filesChanged: [] });
      await setWorking("repeat", 4);
      // A pull request recorded without a state is open: it is the one shown.
      await openPullRequest({ task: "repeat", turn: 1, number: 11, state: "" });
      await openPullRequest({
        task: "repeat",
        turn: 2,
        number: 12,
        state: "merged",
      });
    }, 300000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await dropSchemaOneTableAtATime(database, schema);
        await database.destroy();
      }
    });

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      const jane: User = new User();
      jane._id = USER_ID;
      jane.name = new Name("Jane Doe");
      jest.spyOn(UserService, "findBy").mockResolvedValue([jane]);
      jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("205 turns: the first, then the newest 199 replies oldest first, and the 5 between counted", async () => {
      const read: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task: await taskOf("long"),
      });

      expect(read.turns).toHaveLength(MAX_TURNS_PER_TASK);
      expect(
        read.turns.map((turn: AIRun): number => {
          return numberOf("long", turn.id!.toString());
        }),
      ).toEqual([1, ...range(7, 205)]);
      // The deleted reply and the other project's run are not the task's.
      expect(read.olderTurnsLeftOut).toBe(5);

      const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
        projectId: new ObjectID(PROJECT_ID),
        task: read.turns[0]!,
        read,
        select: TURN_NOT_SHOWN_SELECT,
      });

      expect(
        leftOut.map((turn: AIRun): number => {
          return numberOf("long", turn.id!.toString());
        }),
      ).toEqual([2, 3, 4, 5, 6]);
      expect(leftOut[0]!.taskOutcome?.summary).toBe("Reply to turn 2");
    });

    test("exactly 200 turns: every one, none left out; 12 turns: every one", async () => {
      const twoHundred: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task: await taskOf("two hundred"),
      });

      expect(twoHundred.turns).toHaveLength(200);
      expect(twoHundred.olderTurnsLeftOut).toBe(0);

      const short: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task: await taskOf("short"),
      });

      expect(
        short.turns.map((turn: AIRun): number => {
          return numberOf("short", turn.id!.toString());
        }),
      ).toEqual(range(1, 12));
      expect(short.olderTurnsLeftOut).toBe(0);
    });

    test("the conversation as it stood before a turn was asked", async () => {
      const read: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task: await taskOf("long"),
        createdBefore: askedAt(205),
      });

      expect(
        read.turns.map((turn: AIRun): number => {
          return numberOf("long", turn.id!.toString());
        }),
      ).toEqual([1, ...range(6, 204)]);
      expect(read.olderTurnsLeftOut).toBe(4);
    });

    test("two turns asked the same moment: each read once, shown or left out - none lost", async () => {
      const read: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task: await taskOf("ties"),
      });
      const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
        projectId: new ObjectID(PROJECT_ID),
        task: read.turns[0]!,
        read,
        select: TURN_NOT_SHOWN_SELECT,
      });

      expect(read.olderTurnsLeftOut).toBe(5);
      expect(leftOut).toHaveLength(5);
      expect(
        [...read.turns, ...leftOut]
          .map((turn: AIRun): number => {
            return numberOf("ties", turn.id!.toString());
          })
          .sort((a: number, b: number) => {
            return a - b;
          }),
      ).toEqual(range(1, 205));
    });

    test("the pull request turn 203 opened is the one a reply pushes to", async () => {
      const working: AIAgentTaskPullRequest | null =
        await CodeTaskThread.findWorkingPullRequest({
          projectId: new ObjectID(PROJECT_ID),
          task: await taskOf("long"),
        });

      expect(working?.pullRequestNumber).toBe(77);
      expect(working?.headRefName).toBe("oneuptime-task-42-turn-203");

      const runIds: Array<ObjectID> = await CodeTaskThread.getRunIds({
        projectId: new ObjectID(PROJECT_ID),
        task: await taskOf("long"),
      });

      expect(runIds).toHaveLength(205);
      expect(runIds[0]!.toString()).toBe(runOf("long", 1));
      expect(runIds[1]!.toString()).toBe(runOf("long", 205));
    });

    test("turn 205 is briefed from turns 7 to 204, and pushes to the pull request turn 203 opened", async () => {
      const run: AIRun | null = await CodeTaskThread.findTask({
        projectId: new ObjectID(PROJECT_ID),
        taskId: new ObjectID(runOf("long", 1)),
      });
      expect(run).not.toBeNull();

      const turn205: AIRun = new AIRun();
      turn205._id = runOf("long", 205);
      turn205.projectId = new ObjectID(PROJECT_ID);
      turn205.codeTaskId = new ObjectID(runOf("long", 1));
      turn205.userId = new ObjectID(USER_ID);
      turn205.taskContext = {
        request: { message: "Turn 205: keep going", context: [] },
      };

      const repository: CodeRepository = new CodeRepository();
      repository._id = REPOSITORY_ID;
      repository.projectId = new ObjectID(PROJECT_ID);
      repository.name = "users-api";
      repository.mainBranchName = "main";

      const details: CodeTaskAgentDetails = await CodeTaskAgentBrief.build({
        run: turn205,
        repository,
      });

      expect(
        details.conversation
          .filter((entry: CodeTaskAgentTurn): boolean => {
            return entry.role === "person";
          })
          .map((entry: CodeTaskAgentTurn): string => {
            return entry.text;
          }),
      ).toEqual(
        [1, ...range(7, 204)].map((n: number): string => {
          return `Turn ${n}: keep going`;
        }),
      );
      expect(details.omittedTurns).toBe(10);
      expect(details.workingBranch).toBe("oneuptime-task-42-turn-203");
      expect(details.pullRequest?.number).toBe(77);
    });

    test("the task's page: the first turn and the newest 199, the 5 between counted, every turn's files at the top", async () => {
      const conversation: CodeTaskConversationJSON =
        await CodeTaskPresenter.getConversation({
          projectId: new ObjectID(PROJECT_ID),
          task: await taskOf("long"),
          canSeeChanges: true,
          props: { isRoot: true },
        });

      expect(
        conversation.turns.map((turn: CodeTaskTurnJSON): number => {
          return numberOf("long", turn.runId);
        }),
      ).toEqual([1, ...range(7, 205)]);
      expect(conversation.turnsNotShown).toEqual({
        count: 5,
        workMilliseconds: 5 * MINUTE_MS,
      });
      expect(conversation.task.turnCount).toBe(205);
      expect(conversation.task.changes).toEqual({
        files: 205,
        additions: (205 * 206) / 2,
        deletions: 205,
      });
      // The open one, of turn 203; turn 3's was merged.
      expect(conversation.task.pullRequest?.number).toBe(77);
    });

    /*
     * ISSUE #7131: A TASK LIST'S ROWS, AND A FIX'S DECLARED CODE CHANGES.
     *
     * A row said how its task stood from a read of the page's tasks'
     * replies, oldest first, cut at 10,000: a task of 10,205 turns read as
     * it stood at about its 10,000th - its newest turn, its count, its last
     * moment and its open pull request never read. Each is read per task in
     * Postgres now.
     */
    const summarizePage: (
      names: Array<string>,
    ) => Promise<Map<string, CodeTaskSummaryJSON>> = async (
      names: Array<string>,
    ): Promise<Map<string, CodeTaskSummaryJSON>> => {
      const tasksOfPage: Array<AIRun> = [];

      for (const name of names) {
        tasksOfPage.push(await taskOf(name));
      }

      const rows: Array<CodeTaskSummaryJSON> =
        await CodeTaskPresenter.summarize({
          projectId: new ObjectID(PROJECT_ID),
          tasks: tasksOfPage,
          props: { isRoot: true },
        });

      return new Map<string, CodeTaskSummaryJSON>(
        names.map(
          (name: string, index: number): [string, CodeTaskSummaryJSON] => {
            return [name, rows[index]!];
          },
        ),
      );
    };

    test("a page of tasks, one of 10,205 turns: each row stands as its task's newest turn - its state, its turns, its last moment, its pull request, its changes and what AI last said", async () => {
      const rows: Map<string, CodeTaskSummaryJSON> = await summarizePage([
        "huge",
        "long",
        "short",
        "repeat",
      ]);

      const huge: CodeTaskSummaryJSON = rows.get("huge")!;

      expect(huge.id).toBe(runOf("huge", 1));
      expect(huge.turnCount).toBe(HUGE_TURNS);
      // Turn 10,205 is still being worked on.
      expect(huge.state).toBe(CodeTaskState.Working);
      expect(huge).not.toHaveProperty("completedAt");
      // The last moment: turn 10,204 ended ten seconds after 10,205 was asked.
      expect(huge.lastActivityAt).toBe(
        new Date(askedAt(HUGE_TURNS).getTime() + 10 * 1000).toISOString(),
      );
      // The open one, of turn 10,204 - not turn 3's merged one.
      expect(huge.pullRequest?.number).toBe(900);
      expect(huge.changes).toEqual({
        files: HUGE_TURNS - 1,
        // Turn n added n lines: 1 + 2 + ... + 10,204.
        additions: ((HUGE_TURNS - 1) * HUGE_TURNS) / 2,
        deletions: HUGE_TURNS - 1,
      });
      // The turn still working said nothing yet: the one before it is what AI said.
      expect(huge.latestReply).toBe(`Reply to turn ${HUGE_TURNS - 1}`);

      const long: CodeTaskSummaryJSON = rows.get("long")!;

      // The deleted reply and the other project's run are not the task's.
      expect(long.turnCount).toBe(205);
      expect(long.state).toBe(CodeTaskState.Done);
      expect(long.pullRequest?.number).toBe(77);
      expect(long.changes).toEqual({
        files: 205,
        additions: (205 * 206) / 2,
        deletions: 205,
      });
      expect(long.latestReply).toBe("Reply to turn 205");
      expect(long.lastActivityAt).toBe(
        new Date(askedAt(205).getTime() + 10 * 1000 + MINUTE_MS).toISOString(),
      );

      const short: CodeTaskSummaryJSON = rows.get("short")!;

      expect(short.turnCount).toBe(12);
      expect(short).not.toHaveProperty("pullRequest");
      expect(short.changes?.files).toBe(12);
    });

    test("negative control: the read the list made - a page's replies oldest first, cut at 10,000 - never reaches the 10,205-turn task's newest", async () => {
      const taskIds: Array<ObjectID> = ["huge", "long", "short", "repeat"].map(
        (name: string): ObjectID => {
          return new ObjectID(runOf(name, 1));
        },
      );

      const oldRead: Array<AIRun> = await AIRunService.findBy({
        query: {
          projectId: new ObjectID(PROJECT_ID),
          runType: AIRunType.CodeFix,
          codeTaskId: QueryHelper.any(taskIds),
        },
        select: { _id: true, codeTaskId: true, status: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

      const hugeReplies: Array<AIRun> = oldRead.filter(
        (reply: AIRun): boolean => {
          return reply.codeTaskId?.toString() === runOf("huge", 1);
        },
      );

      expect(oldRead).toHaveLength(LIMIT_PER_PROJECT);
      // It stopped short of the task's newest turns: its row read Done.
      expect(hugeReplies.length).toBeLessThan(HUGE_TURNS - 1);
      expect(hugeReplies[hugeReplies.length - 1]!.status).toBe(
        AIRunStatus.Completed,
      );
      expect(
        hugeReplies.some((reply: AIRun): boolean => {
          return reply.id!.toString() === runOf("huge", HUGE_TURNS);
        }),
      ).toBe(false);
    });

    test("what a row adds up is what the conversation adds up: each file once, whole lines only, a reply that says nothing passed by", async () => {
      const outcomes: Array<CodeTaskOutcome | undefined> = [];

      for (let n: number = 1; n <= 4; n++) {
        const run: AIRun | null = await AIRunService.findOneBy({
          query: { _id: runOf("repeat", n) },
          select: { _id: true, taskOutcome: true },
          props: { isRoot: true },
        });

        outcomes.push(run?.taskOutcome);
      }

      const read: Map<string, CodeTaskOutcomesRead> =
        await CodeTaskListRows.readOutcomes({
          projectId: new ObjectID(PROJECT_ID),
          taskIds: [new ObjectID(runOf("repeat", 1))],
        });

      // src/a.ts and src/b.ts; 2 + 2 (of 2.7) + 3 added; 1 taken out.
      expect(read.get(runOf("repeat", 1))).toEqual({
        changes: { files: 2, additions: 7, deletions: 1 },
        // Turn 3 said nothing, turn 4 is still working.
        lastReply: "Reply to turn 2",
      });
      // The same as the conversation adds them up, from the same outcomes.
      expect(read.get(runOf("repeat", 1))?.changes).toEqual(
        CodeTaskChangeStats.fromOutcomes(outcomes),
      );

      const row: CodeTaskSummaryJSON = (await summarizePage(["repeat"])).get(
        "repeat",
      )!;

      expect(row.state).toBe(CodeTaskState.Working);
      expect(row.latestReply).toBe("Reply to turn 2");
      // Recorded without a state, it is open: shown over the newer merged one.
      expect(row.pullRequest?.number).toBe(11);
    });

    test("a fix's declared code change reads each task's newest turn and pull request the same way, per task", async () => {
      const taskIds: Array<ObjectID> = ["huge", "short"].map(
        (name: string): ObjectID => {
          return new ObjectID(runOf(name, 1));
        },
      );

      const [replies, pullRequests]: [
        Map<string, CodeTaskRepliesRead>,
        Map<string, AIAgentTaskPullRequest>,
      ] = await Promise.all([
        CodeTaskListRows.readReplies({
          projectId: new ObjectID(PROJECT_ID),
          taskIds,
        }),
        CodeTaskListRows.readPullRequests({
          projectId: new ObjectID(PROJECT_ID),
          taskIds,
        }),
      ]);

      const huge: CodeTaskRepliesRead = replies.get(runOf("huge", 1))!;

      expect(huge.count).toBe(HUGE_TURNS - 1);
      expect(huge.newest?.id?.toString()).toBe(runOf("huge", HUGE_TURNS));
      expect(huge.newest?.status).toBe(AIRunStatus.Running);
      expect(pullRequests.get(runOf("huge", 1))?.pullRequestNumber).toBe(900);

      expect(replies.get(runOf("short", 1))?.count).toBe(11);
      expect(replies.get(runOf("short", 1))?.newest?.id?.toString()).toBe(
        runOf("short", 12),
      );
      expect(pullRequests.has(runOf("short", 1))).toBe(false);

      // Another project reads none of it.
      expect(
        (
          await CodeTaskListRows.readReplies({
            projectId: new ObjectID(OTHER_PROJECT_ID),
            taskIds,
          })
        ).size,
      ).toBe(0);
    });

    test("the turns not shown of a task of 10,205: the 10,000 nearest the newest are read, the oldest counted - and the log says so", async () => {
      const warn: SpyInstance<typeof logger.warn> = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {});
      const task: AIRun = await taskOf("huge");
      const read: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task,
      });

      expect(read.olderTurnsLeftOut).toBe(HUGE_TURNS - MAX_TURNS_PER_TASK);

      const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
        projectId: new ObjectID(PROJECT_ID),
        task: read.turns[0]!,
        read,
        select: TURN_NOT_SHOWN_SELECT,
      });

      const numbers: Array<number> = leftOut.map((turn: AIRun): number => {
        return numberOf("huge", turn.id!.toString());
      });

      expect(numbers).toHaveLength(LIMIT_PER_PROJECT);
      expect(numbers[0]).toBe(
        HUGE_TURNS - MAX_TURNS_PER_TASK - LIMIT_PER_PROJECT + 2,
      );
      expect(numbers[numbers.length - 1]).toBe(
        HUGE_TURNS - MAX_TURNS_PER_TASK + 1,
      );
      expect(warn).toHaveBeenCalledWith(
        `Code task ${runOf("huge", 1)}: read the newest ${LIMIT_PER_PROJECT} turns its conversation does not show; the older ones were not read.`,
        { projectId: PROJECT_ID, codeTaskId: runOf("huge", 1) },
      );
    });

    /*
     * ISSUE #7130: A LINK TO A TURN THE PAGE DOES NOT SHOW.
     *
     * Its place is counted by Postgres as the conversation orders the
     * task's turns: by when they were asked, a tie by id.
     */
    test("each turn of a task whose turns 6 and 7 were asked the same moment is numbered where its conversation places it", async () => {
      const task: AIRun = await taskOf("ties");
      const read: CodeTaskTurnsRead = await CodeTaskThread.getTurns({
        projectId: new ObjectID(PROJECT_ID),
        task,
      });
      const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
        projectId: new ObjectID(PROJECT_ID),
        task: read.turns[0]!,
        read,
        select: TURN_NOT_SHOWN_SELECT,
      });

      // The conversation's order: the first turn, the ones not shown, the ones shown.
      const order: Array<string> = [
        read.turns[0]!,
        ...leftOut,
        ...read.turns.slice(1),
      ].map((turn: AIRun): string => {
        return turn.id!.toString();
      });

      expect(order).toHaveLength(205);

      for (let index: number = 1; index < order.length; index++) {
        const found: CodeTaskNumberedTurn | null =
          await CodeTaskThread.findReply({
            projectId: new ObjectID(PROJECT_ID),
            task,
            runId: new ObjectID(order[index]!),
          });

        expect({ turn: order[index], number: found?.number }).toEqual({
          turn: order[index],
          number: index + 1,
        });
      }
    });

    test("turns of a task of 10,205 are numbered by their place, however far back", async () => {
      const task: AIRun = await taskOf("huge");

      for (const n of [2, 4, 5000, 10006, 10007, HUGE_TURNS]) {
        const found: CodeTaskNumberedTurn | null =
          await CodeTaskThread.findReply({
            projectId: new ObjectID(PROJECT_ID),
            task,
            runId: new ObjectID(runOf("huge", n)),
          });

        expect(found?.number).toBe(n);
      }
    });

    test("a link to turn 3 of 205 comes back with its place, its request, its reply and the pull request it opened", async () => {
      const conversation: CodeTaskConversationJSON =
        await CodeTaskPresenter.getConversation({
          projectId: new ObjectID(PROJECT_ID),
          task: await taskOf("long"),
          canSeeChanges: true,
          props: { isRoot: true },
          linkedTurnId: new ObjectID(runOf("long", 3)),
        });

      expect(conversation.linkedTurn?.number).toBe(3);
      expect(conversation.linkedTurn?.turn.runId).toBe(runOf("long", 3));
      expect(conversation.linkedTurn?.turn.request?.message).toBe(
        "Turn 3: keep going",
      );
      expect(conversation.linkedTurn?.turn.outcome?.summary).toBe(
        "Reply to turn 3",
      );
      expect(
        conversation.linkedTurn?.turn.pullRequests.map(
          (each: { number?: number | undefined }) => {
            return each.number;
          },
        ),
      ).toEqual([31]);
      // The turns shown are as without the link.
      expect(
        conversation.turns.map((turn: CodeTaskTurnJSON): number => {
          return numberOf("long", turn.runId);
        }),
      ).toEqual([1, ...range(7, 205)]);
    });

    test("a link to another task's turn, a deleted reply or another project's run comes back with nothing", async () => {
      const deleted: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "AIRun" WHERE "codeTaskId" = $1 AND "deletedAt" IS NOT NULL`,
        [runOf("long", 1)],
      );
      const otherProject: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "AIRun" WHERE "codeTaskId" = $1 AND "projectId" = $2`,
        [runOf("long", 1), OTHER_PROJECT_ID],
      );

      expect(deleted).toHaveLength(1);
      expect(otherProject).toHaveLength(1);

      for (const linkedTurnId of [
        runOf("short", 4),
        deleted[0]!._id,
        otherProject[0]!._id,
      ]) {
        const conversation: CodeTaskConversationJSON =
          await CodeTaskPresenter.getConversation({
            projectId: new ObjectID(PROJECT_ID),
            task: await taskOf("long"),
            canSeeChanges: true,
            props: { isRoot: true },
            linkedTurnId: new ObjectID(linkedTurnId),
          });

        expect(conversation).not.toHaveProperty("linkedTurn");
      }
    });
  },
);
