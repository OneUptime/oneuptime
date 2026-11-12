import Entities from "../../../Models/DatabaseModels/Index";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import User from "../../../Models/DatabaseModels/User";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import UserService from "../../../Server/Services/UserService";
import CodeTaskAgentBrief from "../../../Server/Utils/AI/CodeTask/CodeTaskAgentBrief";
import CodeTaskPresenter, {
  TURN_NOT_SHOWN_SELECT,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import CodeTaskThread, {
  CodeTaskTurnsRead,
  MAX_TURNS_PER_TASK,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import {
  CodeTaskAgentDetails,
  CodeTaskAgentTurn,
  CodeTaskConversationJSON,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
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
 *    top.
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
          data.state || "open",
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
  },
);
