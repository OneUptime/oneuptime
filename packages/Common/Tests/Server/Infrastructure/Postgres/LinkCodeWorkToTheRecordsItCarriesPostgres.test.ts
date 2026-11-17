import { LinkCodeWorkToTheRecordsItCarries1809182710000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182710000-LinkCodeWorkToTheRecordsItCarries";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * THE CODE WORK THAT ALREADY CARRIES AN INCIDENT OR AN ALERT, LINKED TO IT
 * ON A REAL POSTGRES (#9186): LinkCodeWorkToTheRecordsItCarries, run on
 * copies of the migrated tables holding every kind of Code work there is:
 *
 *   - a turn carries what its request's context names, of each kind, and
 *     nothing it names that is no id, nor what a run that is no Code task
 *     holds;
 *   - a postmortem action item's task carries the item's incident;
 *   - a task carries what its replies carry;
 *   - a pull request opened from an incident's or alert's AI conversation
 *     carries that record when exactly one such conversation's call
 *     matches it - in the project, by the person, with the title the
 *     record keeps (cut as the record cuts it), within minutes of it - and
 *     nothing otherwise: one from Ask AI, one two conversations' calls
 *     match, one too far in time, one by someone else, one a run opened;
 *   - what a row carried already is kept, each id once;
 *   - run again, the migration changes nothing.
 *
 * Opt in with RUN_POSTGRES_LINK_CODE_WORK_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_LINK_CODE_WORK_TESTS=true \
 *   LINK_CODE_WORK_TEST_DATABASE_HOST=127.0.0.1 \
 *   LINK_CODE_WORK_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/LinkCodeWorkToTheRecordsItCarriesPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables are
 * cloned from public (LIKE ... INCLUDING ALL) into a uniquely named schema
 * that is dropped afterwards; the connection's search path is that schema,
 * then public, so the migration's unqualified names reach the copies.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LINK_CODE_WORK_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.setTimeout(300_000);

const TABLES: Array<string> = [
  "AIRun",
  "AIAgentTaskPullRequest",
  "IncidentPostmortemActionItem",
  "AIRunEvent",
  "AIConversation",
];

interface RequiredColumn {
  name: string;
  type: string;
  maxLength: number | null;
}

type SqlRow = Record<string, unknown>;

function newId(): string {
  return ObjectID.generate().toString();
}

describePostgres(
  "Code work that carries an incident or an alert, linked to it on Postgres",
  () => {
    const schema: string = `link_code_work_${newId().replace(/-/g, "")}`;
    const projectId: string = newId();
    const otherProjectId: string = newId();
    const personId: string = newId();
    const otherPersonId: string = newId();

    let database: DataSource;
    const required: Record<string, Array<RequiredColumn>> = {};

    // As TypeORM runs it: in a transaction.
    async function runMigration(): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await queryRunner.startTransaction();
        await new LinkCodeWorkToTheRecordsItCarries1809182710000().up(
          queryRunner,
        );
        await queryRunner.commitTransaction();
      } finally {
        await queryRunner.release();
      }
    }

    function filler(table: string, column: RequiredColumn): unknown {
      switch (column.type) {
        case "uuid":
          return newId();
        case "character varying":
        case "text": {
          const text: string = newId().replace(/-/g, "");
          return column.maxLength === null
            ? text
            : text.slice(0, column.maxLength);
        }
        case "integer":
        case "smallint":
        case "bigint":
        case "numeric":
        case "double precision":
        case "real":
          return 1;
        case "boolean":
          return false;
        case "timestamp with time zone":
        case "timestamp without time zone":
        case "date":
          return new Date();
        case "jsonb":
        case "json":
          return "{}";
        default:
          throw new Error(
            `${table}.${column.name} must be given a value: this suite has no filler for a ${column.type}.`,
          );
      }
    }

    async function insert(table: string, values: SqlRow): Promise<string> {
      const row: SqlRow = { _id: newId(), projectId: projectId };

      for (const column of required[table] || []) {
        if (!(column.name in values) && !(column.name in row)) {
          row[column.name] = filler(table, column);
        }
      }

      Object.assign(row, values);

      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          return row[column];
        }),
      );

      return row["_id"] as string;
    }

    // What a row of `table` carries now, by kind: its lists as stored.
    async function carried(
      table: string,
      id: string,
    ): Promise<{ incidentIds: unknown; alertIds: unknown }> {
      const rows: Array<{ incidentIds: unknown; alertIds: unknown }> =
        await database.query(
          `SELECT "carriedIncidentIds" AS "incidentIds", "carriedAlertIds" AS "alertIds" FROM "${table}" WHERE "_id" = $1`,
          [id],
        );

      return {
        incidentIds: rows[0]!.incidentIds,
        alertIds: rows[0]!.alertIds,
      };
    }

    function sortedOrNull(value: unknown): unknown {
      return Array.isArray(value) ? [...value].sort() : value;
    }

    // A Code task's turn, asked with this context.
    async function turn(values: {
      context?: Array<unknown> | undefined;
      taskId?: string | undefined;
      runType?: AIRunType | undefined;
      extra?: SqlRow | undefined;
    }): Promise<string> {
      return await insert("AIRun", {
        runType: values.runType || AIRunType.CodeFix,
        codeFixTaskType:
          (values.runType || AIRunType.CodeFix) === AIRunType.CodeFix
            ? CodeFixTaskType.CodeRequest
            : null,
        codeTaskId: values.taskId || null,
        taskContext: JSON.stringify(
          values.context
            ? { request: { message: "Fix it", context: values.context } }
            : {},
        ),
        carriedIncidentIds: null,
        carriedAlertIds: null,
        deletedAt: null,
        ...(values.extra || {}),
      });
    }

    function contextItem(type: string, recordId: string): SqlRow {
      return { type, label: `${type} ${recordId}`, recordId };
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["LINK_CODE_WORK_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["LINK_CODE_WORK_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LINK_CODE_WORK_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      const notNull: Array<{
        table: string;
        name: string;
        type: string;
        maxLength: number | null;
      }> = await database.query(
        `SELECT table_name AS "table", column_name AS "name", data_type AS "type",
                character_maximum_length AS "maxLength"
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1)
            AND is_nullable = 'NO'
            AND column_default IS NULL`,
        [TABLES],
      );

      for (const column of notNull) {
        (required[column.table] = required[column.table] || []).push({
          name: column.name,
          type: column.type,
          maxLength:
            column.maxLength === null ? null : Number(column.maxLength),
        });
      }

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    });

    beforeEach(async () => {
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe("a Code task's turns", () => {
      test("each turn carries the incidents and alerts its request's context names, and a task what its replies carry", async () => {
        const incidentA: string = newId();
        const incidentB: string = newId();
        const alertX: string = newId();

        const task: string = await turn({
          context: [
            contextItem("Incident", incidentA),
            contextItem("Alert", alertX),
            { type: "File", label: "src/app.ts", path: "src/app.ts" },
            contextItem("Exception", newId()),
            contextItem("Monitor", newId()),
            // The same incident twice, in another case: once.
            contextItem("Incident", incidentA.toUpperCase()),
          ],
        });
        const reply: string = await turn({
          taskId: task,
          context: [contextItem("Incident", incidentB)],
        });
        const quietReply: string = await turn({
          taskId: task,
          context: [{ type: "Note", label: "note", text: "Use backoff." }],
        });

        await runMigration();

        expect(await carried("AIRun", reply)).toEqual({
          incidentIds: [incidentB],
          alertIds: null,
        });
        expect(await carried("AIRun", quietReply)).toEqual({
          incidentIds: null,
          alertIds: null,
        });

        const ofTask: { incidentIds: unknown; alertIds: unknown } =
          await carried("AIRun", task);

        expect(sortedOrNull(ofTask.incidentIds)).toEqual(
          [incidentA, incidentB].sort(),
        );
        expect(ofTask.alertIds).toEqual([alertX]);
      });

      test("nothing that is no id, nothing of a context that is no list, and nothing of a run that is no Code task", async () => {
        const notAnId: string = await turn({
          context: [
            contextItem("Incident", "not-an-id"),
            { type: "Alert", label: "no id" },
            "Incident",
            null,
          ],
        });
        const noList: string = await insert("AIRun", {
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.CodeRequest,
          taskContext: JSON.stringify({
            request: { message: "Fix it", context: { type: "Incident" } },
          }),
          deletedAt: null,
        });
        const noContext: string = await turn({});
        const chat: string = await turn({
          runType: AIRunType.Chat,
          context: [contextItem("Incident", newId())],
        });

        await runMigration();

        for (const run of [notAnId, noList, noContext, chat]) {
          expect(await carried("AIRun", run)).toEqual({
            incidentIds: null,
            alertIds: null,
          });
        }
      });

      test("what a turn carried already is kept, each id once", async () => {
        const kept: string = newId();
        const added: string = newId();

        const task: string = await turn({
          context: [
            contextItem("Incident", added),
            contextItem("Incident", kept),
          ],
          extra: { carriedIncidentIds: JSON.stringify([kept]) },
        });

        await runMigration();

        expect(
          sortedOrNull((await carried("AIRun", task)).incidentIds),
        ).toEqual([added, kept].sort());
      });
    });

    describe("a postmortem action item's task", () => {
      test("carries the action item's incident, whatever its context holds and whatever state the item is in", async () => {
        const incident: string = newId();
        const otherIncident: string = newId();

        const task: string = await turn({
          context: [
            { type: "Note", label: "postmortem", text: "## Root cause" },
          ],
        });
        const taskOfADeletedItem: string = await turn({ context: [] });
        const plainTask: string = await turn({ context: [] });

        await insert("IncidentPostmortemActionItem", {
          incidentId: incident,
          codeTaskId: task,
          deletedAt: null,
        });
        await insert("IncidentPostmortemActionItem", {
          incidentId: otherIncident,
          codeTaskId: taskOfADeletedItem,
          deletedAt: new Date(),
        });
        await insert("IncidentPostmortemActionItem", {
          incidentId: newId(),
          codeTaskId: null,
          deletedAt: null,
        });

        await runMigration();

        expect(await carried("AIRun", task)).toEqual({
          incidentIds: [incident],
          alertIds: null,
        });
        expect(await carried("AIRun", taskOfADeletedItem)).toEqual({
          incidentIds: [otherIncident],
          alertIds: null,
        });
        expect(await carried("AIRun", plainTask)).toEqual({
          incidentIds: null,
          alertIds: null,
        });
      });
    });

    describe("a pull request OneUptime AI opened from a chat", () => {
      const openedAt: Date = new Date("2026-11-01T10:00:00.000Z");

      function minutesAfter(minutes: number): Date {
        return new Date(openedAt.getTime() + minutes * 60 * 1000);
      }

      async function conversation(values: SqlRow): Promise<string> {
        return await insert("AIConversation", {
          incidentId: null,
          alertId: null,
          deletedAt: null,
          ...values,
        });
      }

      async function chatRun(conversationId: string): Promise<string> {
        return await turn({
          runType: AIRunType.Chat,
          extra: { conversationId, userId: personId },
        });
      }

      // The step of the chat that opened a pull request with this title.
      async function call(values: {
        runId: string;
        title: string;
        at: Date;
        userId?: string | undefined;
        projectId?: string | undefined;
        toolName?: string | undefined;
        eventType?: AIRunEventType | undefined;
      }): Promise<void> {
        await insert("AIRunEvent", {
          projectId: values.projectId || projectId,
          aiRunId: values.runId,
          userId: values.userId || personId,
          eventType: values.eventType || AIRunEventType.ToolCallCompleted,
          toolName: values.toolName || "open_code_pull_request",
          toolArguments: JSON.stringify({
            title: values.title,
            description: "why",
          }),
          createdAt: values.at,
          deletedAt: null,
        });
      }

      async function pullRequest(values: {
        title: string;
        aiRunId?: string | undefined;
        createdByUserId?: string | undefined;
      }): Promise<string> {
        return await insert("AIAgentTaskPullRequest", {
          aiRunId: values.aiRunId || null,
          title: values.title,
          createdByUserId: values.createdByUserId || personId,
          createdAt: openedAt,
          carriedIncidentIds: null,
          carriedAlertIds: null,
          deletedAt: null,
        });
      }

      test("from an incident's or an alert's AI conversation: it carries that record", async () => {
        const incident: string = newId();
        const alert: string = newId();

        const ofIncidentThread: string = await chatRun(
          await conversation({ incidentId: incident }),
        );
        const ofAlertThread: string = await chatRun(
          await conversation({ alertId: alert }),
        );

        await call({
          runId: ofIncidentThread,
          title: "Retry the charge",
          at: minutesAfter(0.05),
        });
        // A title longer than the record keeps: the record holds its start.
        const longTitle: string = `Handle the timeout ${"x".repeat(150)}`;

        await call({
          runId: ofAlertThread,
          title: `  ${longTitle}  `,
          at: minutesAfter(2),
        });

        const fromIncidentThread: string = await pullRequest({
          title: "Retry the charge",
        });
        const fromAlertThread: string = await pullRequest({
          title: longTitle.substring(0, 100),
        });

        await runMigration();

        expect(
          await carried("AIAgentTaskPullRequest", fromIncidentThread),
        ).toEqual({ incidentIds: [incident], alertIds: null });
        expect(
          await carried("AIAgentTaskPullRequest", fromAlertThread),
        ).toEqual({
          incidentIds: null,
          alertIds: [alert],
        });
      });

      test("two calls in the same conversation are one conversation: it is linked", async () => {
        const incident: string = newId();
        const run: string = await chatRun(
          await conversation({ incidentId: incident }),
        );

        await call({
          runId: run,
          title: "Retry the charge",
          at: minutesAfter(0),
        });
        await call({
          runId: run,
          title: "Retry the charge",
          at: minutesAfter(1),
        });

        const opened: string = await pullRequest({ title: "Retry the charge" });

        await runMigration();

        expect(
          (await carried("AIAgentTaskPullRequest", opened)).incidentIds,
        ).toEqual([incident]);
      });

      test("nothing it can't be told for certain: Ask AI, two conversations, too late, someone else, another project, another title, another step", async () => {
        const incident: string = newId();
        const thread: string = await conversation({ incidentId: incident });
        const otherThread: string = await conversation({ incidentId: newId() });
        const askAi: string = await conversation({
          pageContext: JSON.stringify({ type: "Incident", entityId: incident }),
        });

        const runInThread: string = await chatRun(thread);

        // From Ask AI: a conversation keeps only its latest subject.
        await call({
          runId: await chatRun(askAi),
          title: "From Ask AI",
          at: minutesAfter(0),
        });
        // Two conversations' calls match it.
        await call({
          runId: runInThread,
          title: "Ambiguous",
          at: minutesAfter(0),
        });
        await call({
          runId: await chatRun(otherThread),
          title: "Ambiguous",
          at: minutesAfter(1),
        });
        // Too long after it.
        await call({
          runId: runInThread,
          title: "Too late",
          at: minutesAfter(30),
        });
        // By someone else.
        await call({
          runId: runInThread,
          title: "Someone else",
          at: minutesAfter(0),
          userId: otherPersonId,
        });
        // In another project.
        await call({
          runId: runInThread,
          title: "Another project",
          at: minutesAfter(0),
          projectId: otherProjectId,
        });
        // Another step of the chat: an action executed, a failed call.
        await call({
          runId: runInThread,
          title: "Another step",
          at: minutesAfter(0),
          eventType: AIRunEventType.ActionExecuted,
        });
        await call({
          runId: runInThread,
          title: "Another tool",
          at: minutesAfter(0),
          toolName: "commit_code_to_branch",
        });

        const unlinked: Array<string> = [
          await pullRequest({ title: "From Ask AI" }),
          await pullRequest({ title: "Ambiguous" }),
          await pullRequest({ title: "Too late" }),
          await pullRequest({ title: "Someone else" }),
          await pullRequest({ title: "Another project" }),
          await pullRequest({ title: "Another step" }),
          await pullRequest({ title: "Another tool" }),
          await pullRequest({ title: "No call matches this title" }),
        ];

        await runMigration();

        for (const id of unlinked) {
          expect({
            id,
            carried: await carried("AIAgentTaskPullRequest", id),
          }).toEqual({
            id,
            carried: { incidentIds: null, alertIds: null },
          });
        }
      });

      test("a pull request a run opened is read through its run, and left as it is", async () => {
        const incident: string = newId();
        const run: string = await chatRun(
          await conversation({ incidentId: incident }),
        );

        await call({
          runId: run,
          title: "Opened by a run",
          at: minutesAfter(0),
        });

        const opened: string = await pullRequest({
          title: "Opened by a run",
          aiRunId: await turn({ context: [] }),
        });

        await runMigration();

        expect(await carried("AIAgentTaskPullRequest", opened)).toEqual({
          incidentIds: null,
          alertIds: null,
        });
      });
    });

    test("run again, it changes nothing", async () => {
      const incident: string = newId();
      const task: string = await turn({
        context: [contextItem("Incident", incident)],
      });
      const reply: string = await turn({
        taskId: task,
        context: [contextItem("Incident", incident)],
      });

      await insert("IncidentPostmortemActionItem", {
        incidentId: incident,
        codeTaskId: task,
        deletedAt: null,
      });

      await runMigration();
      const first: unknown = [
        await carried("AIRun", task),
        await carried("AIRun", reply),
      ];

      await runMigration();

      expect([
        await carried("AIRun", task),
        await carried("AIRun", reply),
      ]).toEqual(first);
      expect((await carried("AIRun", task)).incidentIds).toEqual([incident]);
    });
  },
);
