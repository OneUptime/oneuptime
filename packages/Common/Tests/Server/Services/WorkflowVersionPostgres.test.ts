import Entities from "../../../Models/DatabaseModels/Index";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import WorkflowService from "../../../Server/Services/WorkflowService";
import WorkflowVersionService, {
  Service as WorkflowVersionServiceClass,
} from "../../../Server/Services/WorkflowVersionService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  WORKFLOW_VERSIONS_KEPT,
  WorkflowVersionType,
} from "../../../Types/Workflow/WorkflowVersion";
import API from "../../../Utils/API";
import WriteSource from "../../../Types/BaseDatabase/WriteSource";
import {
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
} from "../../Utils/Workflow/WorkflowGraphFixtures";
import { DataSource } from "typeorm";

/*
 * A workflow's version history against a real Postgres (issue #6188): every
 * save of its graph through WorkflowService - its hooks, the rows the update
 * holds, the version rows, the unique (workflow, number) index, jsonb read
 * back in an order of its own - and what each save leaves in the history.
 *
 * The unit suites stand in for the database, so only a real driver shows
 * these. Opt in with RUN_POSTGRES_WORKFLOW_VERSION_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The Workflow and
 * WorkflowVersion tables' STRUCTURE (indexes included, keys to other tables
 * not) is cloned into a schema of its own, first on the search path and
 * dropped afterwards; every other table is read from the migrated public
 * schema, where it is empty. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from WORKFLOW_VERSION_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from WORKFLOW_VERSION_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WORKFLOW_VERSION_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("a workflow's version history, in Postgres", () => {
  const schema: string = `workflow_versions_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const PROJECT_ID: ObjectID = ObjectID.generate();
  const ALICE: ObjectID = ObjectID.generate();
  const BOB: ObjectID = ObjectID.generate();
  let database: DataSource;

  const GRAPH_BEFORE: JSONObject = graphOf(
    [MANUAL, LOG],
    [{ from: MANUAL.key, to: LOG.key }],
  ) as unknown as JSONObject;
  const GRAPH_WITH_EMAIL: JSONObject = graphOf(
    [MANUAL, LOG, EMAIL],
    [
      { from: MANUAL.key, to: LOG.key },
      { from: LOG.key, to: EMAIL.key },
    ],
  ) as unknown as JSONObject;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["WORKFLOW_VERSION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["WORKFLOW_VERSION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["WORKFLOW_VERSION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema},public`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["Workflow", "WorkflowVersion"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what the statements touch.
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
    // The workflow service is told of every save; nothing listens here.
    jest.spyOn(API, "post").mockResolvedValue({} as never);

    await database.query(`DELETE FROM "${schema}"."WorkflowVersion"`);
    await database.query(`DELETE FROM "${schema}"."Workflow"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const insertWorkflow: (
    graph: JSONObject | null,
  ) => Promise<ObjectID> = async (
    graph: JSONObject | null,
  ): Promise<ObjectID> => {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Workflow" ("_id", "projectId", "name", "slug", "graph", "isEnabled", "isArchived", "version", "createdAt", "updatedAt")
      VALUES ($1, $2, 'Notify on-call', 'notify-on-call', $3, false, false, 1, now(), now())`,
      [
        id.toString(),
        PROJECT_ID.toString(),
        graph ? JSON.stringify(graph) : null,
      ],
    );
    return id;
  };

  interface VersionRow {
    versionNumber: number;
    versionType: string;
    changes: Array<string> | null;
    changeCount: number;
    restoredFromVersionNumber: number | null;
    createdByUserId: string | null;
    savedThrough: string | null;
    graphFingerprint: string;
    graph: JSONObject;
  }

  const versionsOf: (
    workflowId: ObjectID,
  ) => Promise<Array<VersionRow>> = async (
    workflowId: ObjectID,
  ): Promise<Array<VersionRow>> => {
    return await database.query(
      `SELECT "versionNumber", "versionType", "changes", "changeCount", "restoredFromVersionNumber", "createdByUserId", "savedThrough", "graphFingerprint", "graph"
        FROM "${schema}"."WorkflowVersion" WHERE "workflowId" = $1 ORDER BY "versionNumber" ASC`,
      [workflowId.toString()],
    );
  };

  /*
   * A save of the graph through WorkflowService, by `userId`, as the builder
   * makes it - or as Ask AI makes it for them (`writeSource`).
   */
  const saveGraph: (data: {
    workflowId: ObjectID;
    graph: JSONObject;
    userId?: ObjectID | undefined;
    writeSource?: WriteSource | undefined;
  }) => Promise<void> = async (data: {
    workflowId: ObjectID;
    graph: JSONObject;
    userId?: ObjectID | undefined;
    writeSource?: WriteSource | undefined;
  }): Promise<void> => {
    await WorkflowService.updateOneById({
      id: data.workflowId,
      data: { graph: data.graph } as never,
      props: {
        isRoot: true,
        userId: data.userId,
        ...(data.writeSource ? { writeSource: data.writeSource } : {}),
      },
    });
  };

  test("the first save of a workflow saved before version history began keeps its graph as it was, then the change", async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    await saveGraph({ workflowId, graph: GRAPH_WITH_EMAIL, userId: ALICE });

    const versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(
      versions.map((version: VersionRow) => {
        return {
          versionNumber: version.versionNumber,
          versionType: version.versionType,
          changes: version.changes,
          createdByUserId: version.createdByUserId,
        };
      }),
    ).toEqual([
      {
        versionNumber: 1,
        versionType: WorkflowVersionType.Earlier,
        changes: [],
        createdByUserId: null,
      },
      {
        versionNumber: 2,
        versionType: WorkflowVersionType.Changed,
        changes: [
          'Added "Send Email" (send-email-1)',
          'Connected "Log" (log-1) to "Send Email" (send-email-1)',
        ],
        createdByUserId: ALICE.toString(),
      },
    ]);

    // Each version's graph is the graph as it was saved, read back from jsonb.
    expect(versions[0]?.graphFingerprint).toBe(
      WorkflowVersionServiceClass.getGraphFingerprint(GRAPH_BEFORE),
    );
    expect(
      WorkflowVersionServiceClass.getGraphFingerprint(versions[1]?.graph),
    ).toBe(versions[1]?.graphFingerprint);
  });

  test("one person's saves in a burst are one version; another person's are their own", async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    await saveGraph({ workflowId, graph: GRAPH_WITH_EMAIL, userId: ALICE });
    await saveGraph({
      workflowId,
      graph: graphOf(
        [MANUAL, LOG, EMAIL],
        [{ from: MANUAL.key, to: LOG.key }],
      ) as unknown as JSONObject,
      userId: ALICE,
    });

    let versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(versions).toHaveLength(2);
    // Counted from version 1: the connection Alice made and took back is no change.
    expect(versions[1]?.changes).toEqual(['Added "Send Email" (send-email-1)']);

    await saveGraph({ workflowId, graph: GRAPH_WITH_EMAIL, userId: BOB });

    versions = await versionsOf(workflowId);

    expect(versions).toHaveLength(3);
    expect(versions[2]).toMatchObject({
      versionNumber: 3,
      versionType: WorkflowVersionType.Changed,
      createdByUserId: BOB.toString(),
      changes: ['Connected "Log" (log-1) to "Send Email" (send-email-1)'],
    });
  });

  test("saving an earlier version's graph is a Restored version naming it; saving it again is nothing", async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    await saveGraph({ workflowId, graph: GRAPH_WITH_EMAIL, userId: ALICE });
    await saveGraph({ workflowId, graph: GRAPH_BEFORE, userId: ALICE });

    let versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(versions[2]).toMatchObject({
      versionNumber: 3,
      versionType: WorkflowVersionType.Restored,
      restoredFromVersionNumber: 1,
      createdByUserId: ALICE.toString(),
      changes: ['Removed "Send Email" (send-email-1)'],
    });

    // The same graph again, and the same graph with a card selected: nothing.
    await saveGraph({ workflowId, graph: GRAPH_BEFORE, userId: ALICE });
    await saveGraph({
      workflowId,
      graph: graphOf(
        [
          { ...MANUAL, withCanvasState: true, selected: true },
          { ...LOG, withCanvasState: true },
        ],
        [{ from: MANUAL.key, to: LOG.key, styled: true }],
      ) as unknown as JSONObject,
      userId: BOB,
    });

    versions = await versionsOf(workflowId);

    expect(versions).toHaveLength(3);
  });

  test("a workflow created with a graph starts with it as version 1, by whoever created it", async () => {
    const workflow: Workflow = new Workflow();
    workflow.projectId = PROJECT_ID;
    workflow.name = "Created with a graph";
    workflow.graph = GRAPH_BEFORE;
    workflow.webhookSecretKey = "set";

    const created: Workflow = await WorkflowService.create({
      data: workflow,
      props: { isRoot: true, userId: ALICE },
    });

    // The version is written by the create; the label and owner rules are not asked for here.
    const versions: Array<VersionRow> = await versionsOf(
      created.id as ObjectID,
    );

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      versionNumber: 1,
      versionType: WorkflowVersionType.Created,
      createdByUserId: ALICE.toString(),
      changes: [
        'Added "Log" (log-1)',
        'Added "Manual" (manual-1)',
        'Connected "Manual" (manual-1) to "Log" (log-1)',
      ],
    });
  });

  test(`only the newest ${WORKFLOW_VERSIONS_KEPT} versions are kept`, async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    // Saves through the API, by nobody: each a version of its own.
    for (let save: number = 1; save <= WORKFLOW_VERSIONS_KEPT + 5; save++) {
      await WorkflowVersionService.recordGraphSave({
        workflowId,
        projectId: PROJECT_ID,
        graph: graphOf([
          MANUAL,
          { ...LOG, args: { value: `save ${save}` } },
        ]) as unknown as JSONObject,
        userId: undefined,
      });
    }

    const versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(versions).toHaveLength(WORKFLOW_VERSIONS_KEPT);
    expect(versions[0]?.versionNumber).toBe(6);
    expect(versions[versions.length - 1]?.versionNumber).toBe(
      WORKFLOW_VERSIONS_KEPT + 5,
    );
  });

  test("two saves of one workflow at the same moment are both kept, each under a number of its own", async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    await WorkflowVersionService.recordEarlierVersionIfNone({
      workflowId,
      projectId: PROJECT_ID,
      readGraph: async (): Promise<unknown> => {
        return GRAPH_BEFORE;
      },
    });

    await Promise.all([
      WorkflowVersionService.recordGraphSave({
        workflowId,
        projectId: PROJECT_ID,
        graph: GRAPH_WITH_EMAIL,
        userId: ALICE,
      }),
      WorkflowVersionService.recordGraphSave({
        workflowId,
        projectId: PROJECT_ID,
        graph: graphOf([MANUAL]) as unknown as JSONObject,
        userId: BOB,
      }),
    ]);

    const versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(
      versions.map((version: VersionRow): number => {
        return version.versionNumber;
      }),
    ).toEqual([1, 2, 3]);
    expect(
      new Set(
        versions.slice(1).map((version: VersionRow): string | null => {
          return version.createdByUserId;
        }),
      ),
    ).toEqual(new Set([ALICE.toString(), BOB.toString()]));
  });
  /*
   * Issue #6258: Ask AI saves as the person who asked, so by person alone
   * its change was folded into the person's own version within ten
   * minutes, and nothing could take back just Ask AI's change.
   */
  const GRAPH_ASK_AI_CHANGED: JSONObject = graphOf(
    [
      MANUAL,
      LOG,
      EMAIL,
      { ...LOG, key: "card-log-2", stepId: "log-2", y: 704 },
    ],
    [
      { from: MANUAL.key, to: LOG.key },
      { from: LOG.key, to: EMAIL.key },
    ],
  ) as unknown as JSONObject;

  test("the person edits, then Ask AI changes the workflow within 10 minutes: two versions, and restoring the first undoes exactly Ask AI's change", async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    await saveGraph({ workflowId, graph: GRAPH_WITH_EMAIL, userId: ALICE });
    // A moment later, Ask AI changes it for Alice.
    await saveGraph({
      workflowId,
      graph: GRAPH_ASK_AI_CHANGED,
      userId: ALICE,
      writeSource: WriteSource.AskAi,
    });

    let versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(
      versions.map((version: VersionRow) => {
        return {
          versionNumber: version.versionNumber,
          versionType: version.versionType,
          createdByUserId: version.createdByUserId,
          savedThrough: version.savedThrough,
          changes: version.changes,
        };
      }),
    ).toEqual([
      {
        versionNumber: 1,
        versionType: WorkflowVersionType.Earlier,
        createdByUserId: null,
        savedThrough: null,
        changes: [],
      },
      // Alice's own change.
      {
        versionNumber: 2,
        versionType: WorkflowVersionType.Changed,
        createdByUserId: ALICE.toString(),
        savedThrough: null,
        changes: [
          'Added "Send Email" (send-email-1)',
          'Connected "Log" (log-1) to "Send Email" (send-email-1)',
        ],
      },
      // Ask AI's, for Alice: a version of its own.
      {
        versionNumber: 3,
        versionType: WorkflowVersionType.Changed,
        createdByUserId: ALICE.toString(),
        savedThrough: WriteSource.AskAi,
        changes: ['Added "Log" (log-2)'],
      },
    ]);

    // Restore the version before Ask AI's change.
    await saveGraph({
      workflowId,
      graph: versions[1]?.graph as JSONObject,
      userId: ALICE,
    });

    versions = await versionsOf(workflowId);

    expect(versions[3]).toMatchObject({
      versionNumber: 4,
      versionType: WorkflowVersionType.Restored,
      restoredFromVersionNumber: 2,
      createdByUserId: ALICE.toString(),
      savedThrough: null,
      // Exactly Ask AI's change, taken back.
      changes: ['Removed "Log" (log-2)'],
    });
    expect(versions[3]?.graphFingerprint).toBe(versions[1]?.graphFingerprint);
  });

  test("the person's next edit after Ask AI's change is a version of its own, and their burst after that is one version again", async () => {
    const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

    await saveGraph({
      workflowId,
      graph: GRAPH_ASK_AI_CHANGED,
      userId: ALICE,
      writeSource: WriteSource.AskAi,
    });
    await saveGraph({ workflowId, graph: GRAPH_WITH_EMAIL, userId: ALICE });
    await saveGraph({
      workflowId,
      graph: graphOf(
        [MANUAL, LOG, EMAIL],
        [{ from: MANUAL.key, to: LOG.key }],
      ) as unknown as JSONObject,
      userId: ALICE,
    });

    const versions: Array<VersionRow> = await versionsOf(workflowId);

    expect(
      versions.map((version: VersionRow) => {
        return [version.versionNumber, version.savedThrough];
      }),
    ).toEqual([
      [1, null],
      [2, WriteSource.AskAi],
      [3, null],
    ]);
  });

  test("a workflow Ask AI creates is version 1, by the person who asked, saying Ask AI made it", async () => {
    const workflow: Workflow = new Workflow();
    workflow.projectId = PROJECT_ID;
    workflow.name = "Made by Ask AI";
    workflow.graph = GRAPH_BEFORE;
    workflow.webhookSecretKey = "set";

    const created: Workflow = await WorkflowService.create({
      data: workflow,
      props: { isRoot: true, userId: ALICE, writeSource: WriteSource.AskAi },
    });

    const versions: Array<VersionRow> = await versionsOf(
      created.id as ObjectID,
    );

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      versionNumber: 1,
      versionType: WorkflowVersionType.Created,
      createdByUserId: ALICE.toString(),
      savedThrough: WriteSource.AskAi,
    });
  });
});
