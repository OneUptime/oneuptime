import Entities from "../../../Models/DatabaseModels/Index";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import WorkflowService from "../../../Server/Services/WorkflowService";
import { ExecuteWorkflowType } from "../../../Server/Types/Workflow/TriggerCode";
import IncomingEmailWorkflowTrigger from "../../../Server/Types/Workflow/Components/IncomingEmail";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { IncomingEmailTriggerDeliveryStatus } from "../../../Types/Workflow/IncomingEmailTrigger";
import { DataSource } from "typeorm";

/*
 * A workflow's incoming email secret key against a real Postgres: what its
 * Incoming Email trigger's address is built from, and the only thing that
 * says which workflow an email is for.
 *
 *   - WorkflowService.ensureIncomingEmailSecretKey is a single-statement
 *     compare-and-set on "no key yet" (IS NOT DISTINCT FROM NULL on a uuid
 *     column): it writes once, never replaces a key, and of two racing saves
 *     exactly one wins.
 *   - The column is unique, so no workflow can take another's address - in
 *     its own project or another one.
 *   - The trigger finds the workflow by the key through the real ObjectID
 *     transformer, and starts the run of that workflow only.
 *
 * The unit suites fake the database, so only a real driver shows these.
 *
 * Opt in with RUN_POSTGRES_WORKFLOW_EMAIL_KEY_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The Workflow table's STRUCTURE
 * (unique constraint included) is cloned into a unique schema that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from WORKFLOW_EMAIL_KEY_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from WORKFLOW_EMAIL_KEY_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WORKFLOW_EMAIL_KEY_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("a workflow's incoming email secret key, in Postgres", () => {
  const schema: string = `workflow_email_key_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["WORKFLOW_EMAIL_KEY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["WORKFLOW_EMAIL_KEY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["WORKFLOW_EMAIL_KEY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Workflow" (LIKE public."Workflow" INCLUDING ALL)`,
    );
    // A fixture names only what the statements touch; the key stays NOT NULL.
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'Workflow' AND is_nullable = 'NO' AND column_name <> '_id'`,
      [schema],
    );
    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."Workflow" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
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
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    await database.query(`DELETE FROM "${schema}"."Workflow"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertWorkflow(data: {
    projectId: ObjectID;
    key?: ObjectID | null;
    triggerId?: string;
    isEnabled?: boolean;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Workflow" ("_id", "projectId", "name", "slug", "version", "incomingEmailSecretKey", "triggerId", "isEnabled") VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [
        id.toString(),
        data.projectId.toString(),
        `Workflow ${id.toString()}`,
        `workflow-${id.toString()}`,
        data.key ? data.key.toString() : null,
        data.triggerId || ComponentID.IncomingEmail,
        data.isEnabled !== false,
      ],
    );
    return id;
  }

  async function keyOf(id: ObjectID): Promise<string | null> {
    const rows: Array<{ incomingEmailSecretKey: string | null }> =
      await database.query(
        `SELECT "incomingEmailSecretKey" FROM "${schema}"."Workflow" WHERE "_id" = $1`,
        [id.toString()],
      );
    return rows[0]?.incomingEmailSecretKey || null;
  }

  test("a workflow without a key gets one, and says so", async () => {
    const id: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: null,
    });

    await expect(
      WorkflowService.ensureIncomingEmailSecretKey(id),
    ).resolves.toBe(true);

    const key: string | null = await keyOf(id);

    expect(key).not.toBeNull();
    expect(ObjectID.isValidUUID(key!)).toBe(true);
  });

  test("a workflow that has a key keeps it, and nothing is written", async () => {
    const existing: ObjectID = ObjectID.generate();
    const id: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: existing,
    });

    await expect(
      WorkflowService.ensureIncomingEmailSecretKey(id),
    ).resolves.toBe(false);
    expect(await keyOf(id)).toBe(existing.toString());
  });

  test("of saves racing to give a workflow its first key, exactly one wins", async () => {
    const id: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: null,
    });

    const results: Array<boolean> = await Promise.all(
      Array.from({ length: 5 }, () => {
        return WorkflowService.ensureIncomingEmailSecretKey(id);
      }),
    );

    expect(
      results.filter((wrote: boolean) => {
        return wrote;
      }),
    ).toHaveLength(1);
    expect(await keyOf(id)).not.toBeNull();
  });

  test("no workflow can take another's key, in any project", async () => {
    const key: ObjectID = ObjectID.generate();
    await insertWorkflow({ projectId: ObjectID.generate(), key: key });
    const other: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: null,
    });

    await expect(
      WorkflowService.updateColumnsByIdWithoutHooks({
        id: other,
        data: { incomingEmailSecretKey: key } as never,
      }),
    ).rejects.toThrow();
    expect(await keyOf(other)).toBeNull();
  });

  test("many workflows can have no key at once", async () => {
    await insertWorkflow({ projectId: ObjectID.generate(), key: null });
    await expect(
      insertWorkflow({ projectId: ObjectID.generate(), key: null }),
    ).resolves.toBeInstanceOf(ObjectID);
  });

  test("an email starts the run of the workflow that owns the key, in its own project, and no other", async () => {
    const keyA: ObjectID = ObjectID.generate();
    const keyB: ObjectID = ObjectID.generate();
    const workflowA: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: keyA,
    });
    const workflowB: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: keyB,
    });

    const runs: Array<ExecuteWorkflowType> = [];
    const trigger: IncomingEmailWorkflowTrigger =
      new IncomingEmailWorkflowTrigger();

    const status: IncomingEmailTriggerDeliveryStatus =
      await trigger.deliverEmail({
        secretKey: keyB.toString().toUpperCase(),
        email: {
          from: "alerts@vendor.example",
          to: [`workflow-${keyA.toString()}@inbound.example`],
          cc: [],
          subject: "Disk space low",
          body: "Only 4% left.",
          receivedAt: "2026-10-01T08:30:00.000Z",
        },
        executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
          runs.push(run);
        },
      });

    expect(status).toBe(IncomingEmailTriggerDeliveryStatus.Scheduled);
    expect(
      runs.map((run: ExecuteWorkflowType) => {
        return run.workflowId.toString();
      }),
    ).toEqual([workflowB.toString()]);
    expect(workflowA.toString()).not.toBe(workflowB.toString());
  });

  test("a workflow that is off, or no longer uses the trigger, starts nothing", async () => {
    const off: ObjectID = ObjectID.generate();
    const webhook: ObjectID = ObjectID.generate();
    await insertWorkflow({
      projectId: ObjectID.generate(),
      key: off,
      isEnabled: false,
    });
    await insertWorkflow({
      projectId: ObjectID.generate(),
      key: webhook,
      triggerId: ComponentID.Webhook,
    });

    const runs: Array<ExecuteWorkflowType> = [];
    const trigger: IncomingEmailWorkflowTrigger =
      new IncomingEmailWorkflowTrigger();
    const deliver: (
      key: ObjectID,
    ) => Promise<IncomingEmailTriggerDeliveryStatus> = async (
      key: ObjectID,
    ): Promise<IncomingEmailTriggerDeliveryStatus> => {
      return await trigger.deliverEmail({
        secretKey: key.toString(),
        email: {
          from: "alerts@vendor.example",
          to: [],
          cc: [],
          subject: "",
          body: "",
          receivedAt: "2026-10-01T08:30:00.000Z",
        },
        executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
          runs.push(run);
        },
      });
    };

    expect(await deliver(off)).toBe(
      IncomingEmailTriggerDeliveryStatus.WorkflowDisabled,
    );
    expect(await deliver(webhook)).toBe(
      IncomingEmailTriggerDeliveryStatus.NotIncomingEmailTrigger,
    );
    expect(await deliver(ObjectID.generate())).toBe(
      IncomingEmailTriggerDeliveryStatus.NoWorkflow,
    );
    expect(runs).toEqual([]);
  });

  test("the key reads back through the model as an ObjectID", async () => {
    const key: ObjectID = ObjectID.generate();
    const id: ObjectID = await insertWorkflow({
      projectId: ObjectID.generate(),
      key: key,
    });

    const workflow: Workflow | null = await WorkflowService.findOneById({
      id: id,
      select: { incomingEmailSecretKey: true },
      props: { isRoot: true },
    });

    expect(workflow?.incomingEmailSecretKey?.toString()).toBe(key.toString());
  });
});
