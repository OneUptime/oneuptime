import logger from "../../../../Server/Utils/Logger";
import RunbookApprovalsMove, {
  RunbookApprovalsMoveSummary,
  RunbookApprovalsQuery,
  UPDATE_RUNBOOK_APPROVAL_STEPS_SQL,
} from "../../../../Server/Utils/Runbook/RunbookApprovalsMove";
import ObjectID from "../../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import {
  APPROVAL_AFTER_LAST_STEP_DESCRIPTION,
  APPROVAL_AFTER_LAST_STEP_TITLE,
} from "../../../../Types/Runbook/RunbookStepApproval";
import RunbookStepExecutionStatus from "../../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { DataSource } from "typeorm";

/*
 * EVERY STORED RUNBOOK'S APPROVALS MOVE BEFORE THEIR STEPS, against a real
 * Postgres: the read finds runbooks by the text of their jsonb steps, the
 * write is a compare-and-set of jsonb against the steps read, and TypeORM's
 * Postgres driver answers it as it really does. Runs already started are
 * not touched. A save that lands between the read and the write wins. Run
 * twice, the second run changes nothing.
 *
 * Opt in with RUN_POSTGRES_RUNBOOK_APPROVALS_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables' STRUCTURE is cloned
 * into a unique schema that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * RUNBOOK_APPROVALS_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * RUNBOOK_APPROVALS_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_RUNBOOK_APPROVALS_TESTS"] === "true"
    ? describe
    : describe.skip;

function step(
  id: string,
  type: RunbookStepType,
  order: number,
  overrides: Partial<RunbookStep> = {},
): RunbookStep {
  return {
    id,
    order,
    type,
    title: `Step ${id}`,
    config: {} as RunbookStep["config"],
    ...overrides,
  };
}

describePostgres(
  "moving runbook approvals before their steps, in Postgres",
  () => {
    const schema: string = `runbook_approvals_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;
    let database: DataSource;

    const TABLES: Array<string> = ["Runbook", "RunbookExecution"];

    const PROJECT_ID: string = ObjectID.generate().toString();

    const MIDDLE: string = ObjectID.generate().toString();
    const LAST: string = ObjectID.generate().toString();
    const MANUAL_NEXT: string = ObjectID.generate().toString();
    const FALSE_ONLY: string = ObjectID.generate().toString();
    const NEW_SHAPE: string = ObjectID.generate().toString();
    const MANUAL_FLAG: string = ObjectID.generate().toString();
    const DELETED: string = ObjectID.generate().toString();
    const EXECUTION: string = ObjectID.generate().toString();

    const STORED: Record<string, Array<RunbookStep>> = {
      [MIDDLE]: [
        step("m1", RunbookStepType.Bash, 0),
        step("m2", RunbookStepType.AI, 1, {
          requireApproval: true,
          continueOnFailure: true,
          description: "Read **what** the diagnostics say.",
        }),
        step("m3", RunbookStepType.Kubernetes, 2, {
          requireApproval: false,
          config: {
            kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
            script: "kubectl rollout restart deployment/checkout-api",
            agentId: "",
          },
        }),
      ],
      [LAST]: [
        step("l1", RunbookStepType.Bash, 0),
        step("l2", RunbookStepType.HttpRequest, 1, { requireApproval: true }),
      ],
      [MANUAL_NEXT]: [
        step("n1", RunbookStepType.Bash, 0, { requireApproval: true }),
        step("n2", RunbookStepType.Manual, 1),
        step("n3", RunbookStepType.Bash, 2),
      ],
      [FALSE_ONLY]: [
        step("f1", RunbookStepType.Bash, 0, { requireApproval: false }),
        step("f2", RunbookStepType.Bash, 1, { requireApproval: false }),
      ],
      [NEW_SHAPE]: [
        step("s1", RunbookStepType.Bash, 0),
        step("s2", RunbookStepType.Bash, 1, {
          requireApprovalBeforeRunning: true,
        }),
      ],
      [MANUAL_FLAG]: [
        step("q1", RunbookStepType.Manual, 0, { requireApproval: true }),
        step("q2", RunbookStepType.Bash, 1),
      ],
      [DELETED]: [
        step("d1", RunbookStepType.Bash, 0, { requireApproval: true }),
        step("d2", RunbookStepType.Bash, 1),
      ],
    };

    // A run started before the upgrade, waiting for the old approval after m2.
    const WAITING_RUN: Array<Record<string, unknown>> = [
      {
        step: STORED[MIDDLE]![0],
        status: RunbookStepExecutionStatus.Completed,
      },
      {
        step: STORED[MIDDLE]![1],
        status: RunbookStepExecutionStatus.WaitingForUser,
        output: "PROCEED",
      },
      {
        step: STORED[MIDDLE]![2],
        status: RunbookStepExecutionStatus.Pending,
      },
    ];

    const query: RunbookApprovalsQuery = async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return database.query(sql, parameters);
    };

    async function stepsOf(id: string): Promise<Array<RunbookStep>> {
      return (
        await database.query(`SELECT "steps" FROM "Runbook" WHERE "_id" = $1`, [
          id,
        ])
      )[0].steps;
    }

    async function versionOf(id: string): Promise<number> {
      return (
        await database.query(
          `SELECT "version" FROM "Runbook" WHERE "_id" = $1`,
          [id],
        )
      )[0].version;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["RUNBOOK_APPROVALS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["RUNBOOK_APPROVALS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RUNBOOK_APPROVALS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        // A fixture names only what the statements touch: keys aside.
        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT c.column_name FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
        AND c.column_default IS NULL
        AND c.column_name NOT IN (
          SELECT k.column_name FROM information_schema.table_constraints t
          JOIN information_schema.key_column_usage k
            ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema
          WHERE t.table_schema = $1 AND t.table_name = $2 AND t.constraint_type = 'PRIMARY KEY'
        )`,
          [schema, table],
        );

        for (const column of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });

      await database.query(`DELETE FROM "RunbookExecution"`);
      await database.query(`DELETE FROM "Runbook"`);

      for (const [id, steps] of Object.entries(STORED)) {
        await database.query(
          `INSERT INTO "Runbook" ("_id", "projectId", "name", "slug", "steps", "version", "deletedAt") VALUES ($1, $2, $3, $3, $4::jsonb, 1, $5)`,
          [
            id,
            PROJECT_ID,
            `runbook-${id.slice(0, 8)}`,
            JSON.stringify(steps),
            id === DELETED ? new Date() : null,
          ],
        );
      }

      await database.query(
        `INSERT INTO "RunbookExecution" ("_id", "projectId", "runbookId", "status", "stepExecutions", "version") VALUES ($1, $2, $3, $4, $5::jsonb, 1)`,
        [
          EXECUTION,
          PROJECT_ID,
          MIDDLE,
          RunbookExecutionStatus.WaitingForManualStep,
          JSON.stringify(WAITING_RUN),
        ],
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("moves each approval before the step it held back, and adds the Manual step after a last one", async () => {
      const summary: RunbookApprovalsMoveSummary =
        await RunbookApprovalsMove.moveAll(query);

      expect(summary).toEqual({
        runbooksMoved: 3,
        approvalsMoved: 3,
        approvalStepsAdded: 1,
        runbooksChangedMeanwhile: 0,
        runbooksFailed: 0,
      });

      // An approval after m2 is one before m3; the rest of each step as it was.
      expect(await stepsOf(MIDDLE)).toEqual([
        STORED[MIDDLE]![0],
        {
          ...step("m2", RunbookStepType.AI, 1, {
            continueOnFailure: true,
            description: "Read **what** the diagnostics say.",
          }),
        },
        {
          ...step("m3", RunbookStepType.Kubernetes, 2, {
            config: {
              kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
              script: "kubectl rollout restart deployment/checkout-api",
              agentId: "",
            },
          }),
          requireApprovalBeforeRunning: true,
        },
      ]);

      // An approval after the last step: the Manual step that stops there.
      expect(await stepsOf(LAST)).toEqual([
        STORED[LAST]![0],
        step("l2", RunbookStepType.HttpRequest, 1),
        {
          id: "l2-approval",
          order: 2,
          type: RunbookStepType.Manual,
          title: APPROVAL_AFTER_LAST_STEP_TITLE,
          description: APPROVAL_AFTER_LAST_STEP_DESCRIPTION,
          config: {},
        },
      ]);

      // Before a Manual step: the Manual step's own stop; the old flag goes.
      expect(await stepsOf(MANUAL_NEXT)).toEqual([
        step("n1", RunbookStepType.Bash, 0),
        STORED[MANUAL_NEXT]![1],
        STORED[MANUAL_NEXT]![2],
      ]);

      for (const id of [MIDDLE, LAST, MANUAL_NEXT]) {
        expect(await versionOf(id)).toBe(2);
      }
    });

    test("leaves every runbook with nothing to move exactly as it was, deleted ones included", async () => {
      await RunbookApprovalsMove.moveAll(query);

      for (const id of [FALSE_ONLY, NEW_SHAPE, MANUAL_FLAG, DELETED]) {
        expect({ id, steps: await stepsOf(id) }).toEqual({
          id,
          steps: STORED[id],
        });
        expect(await versionOf(id)).toBe(1);
      }
    });

    test("a run already started keeps its own copy of the steps, old approval and all", async () => {
      await RunbookApprovalsMove.moveAll(query);

      const execution: Array<{
        status: string;
        stepExecutions: Array<Record<string, unknown>>;
        version: number;
      }> = await database.query(
        `SELECT "status", "stepExecutions", "version" FROM "RunbookExecution" WHERE "_id" = $1`,
        [EXECUTION],
      );

      expect(execution[0]).toEqual({
        status: RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions: WAITING_RUN,
        version: 1,
      });
    });

    test("a save between the read and the write wins: the runbook is left as saved", async () => {
      const saved: Array<RunbookStep> = [
        step("l1", RunbookStepType.Bash, 0),
        step("l2", RunbookStepType.HttpRequest, 1),
      ];

      // Someone saves the runbook just before the move writes it.
      const racing: RunbookApprovalsQuery = async (
        sql: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        if (
          sql === UPDATE_RUNBOOK_APPROVAL_STEPS_SQL &&
          parameters?.[1] === LAST
        ) {
          await database.query(
            `UPDATE "Runbook" SET "steps" = $1::jsonb, "version" = "version" + 1 WHERE "_id" = $2`,
            [JSON.stringify(saved), LAST],
          );
        }

        return database.query(sql, parameters);
      };

      const summary: RunbookApprovalsMoveSummary =
        await RunbookApprovalsMove.moveAll(racing);

      expect(summary).toMatchObject({
        runbooksMoved: 2,
        runbooksChangedMeanwhile: 1,
      });
      expect(await stepsOf(LAST)).toEqual(saved);
      expect(await versionOf(LAST)).toBe(2);
    });

    test("run twice, the second run moves nothing and writes nothing", async () => {
      await RunbookApprovalsMove.moveAll(query);

      const after: Record<string, unknown> = {};
      for (const id of Object.keys(STORED)) {
        after[id] = {
          steps: await stepsOf(id),
          version: await versionOf(id),
        };
      }

      const second: RunbookApprovalsMoveSummary =
        await RunbookApprovalsMove.moveAll(query);

      expect(second).toEqual({
        runbooksMoved: 0,
        approvalsMoved: 0,
        approvalStepsAdded: 0,
        runbooksChangedMeanwhile: 0,
        runbooksFailed: 0,
      });

      for (const id of Object.keys(STORED)) {
        expect({
          id,
          now: { steps: await stepsOf(id), version: await versionOf(id) },
        }).toEqual({ id, now: after[id] });
      }
    });
  },
);
