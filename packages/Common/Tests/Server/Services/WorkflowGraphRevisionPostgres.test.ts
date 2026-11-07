import Entities from "../../../Models/DatabaseModels/Index";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import WorkflowVersionService from "../../../Server/Services/WorkflowVersionService";
import logger from "../../../Server/Utils/Logger";
import ConflictException from "../../../Types/Exception/ConflictException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { WORKFLOW_GRAPH_REVISION_KEY } from "../../../Types/Workflow/WorkflowGraphRevision";
import API from "../../../Utils/API";
import {
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
} from "../../Utils/Workflow/WorkflowGraphFixtures";
import {
  UpdateWorkflowTool,
  getWorkflowComponent,
} from "../../../Server/Utils/AI/Toolbox/WorkflowBuilderTools";
import {
  PreparedMutation,
  ToolContext,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import WriteSource from "../../../Types/BaseDatabase/WriteSource";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  WorkflowDraft,
  WorkflowDraftStep,
  buildGraphFromDraft,
  getDraftFromGraph,
} from "../../../Types/Workflow/WorkflowDraft";
import { DataSource } from "typeorm";

/*
 * A SAVE MADE TO AN OLDER GRAPH, AGAINST A REAL POSTGRES (issue #6257):
 * every save of a workflow's graph through WorkflowService - its hooks, the
 * row the update holds, the version the UPDATE asks again, the revision the
 * database counts in the write itself - and two saves of one workflow at the
 * same moment.
 *
 * The unit suite (WorkflowServiceGraphRevision) stands in for the database,
 * so only a real driver shows these. Opt in with
 * RUN_POSTGRES_WORKFLOW_GRAPH_REVISION_TESTS=true against a Postgres migrated
 * to the current head - the Postgres Schema Drift workflow's database right
 * after its drift check. The Workflow and WorkflowVersion tables' STRUCTURE
 * is cloned into a schema of its own, first on the search path and dropped
 * afterwards, as WorkflowVersionPostgres does. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * WORKFLOW_GRAPH_REVISION_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * WORKFLOW_GRAPH_REVISION_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WORKFLOW_GRAPH_REVISION_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres(
  "saves of a workflow's graph made to a revision, in Postgres",
  () => {
    const schema: string = `workflow_graph_revision_${ObjectID.generate()
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

    const graphWith: (value: string) => JSONObject = (
      value: string,
    ): JSONObject => {
      return graphOf(
        [MANUAL, { ...LOG, args: { value } }],
        [{ from: MANUAL.key, to: LOG.key }],
      ) as unknown as JSONObject;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKFLOW_GRAPH_REVISION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["WORKFLOW_GRAPH_REVISION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKFLOW_GRAPH_REVISION_TEST_DATABASE_NAME"] ||
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
      WHERE table_schema = $1 AND table_name = 'Workflow' AND is_nullable = 'NO' AND column_name <> '_id' AND column_name <> 'graphRevision'`,
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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      // The workflow service is told of every save; nothing listens here.
      jest.spyOn(API, "post").mockResolvedValue({} as never);

      await database.query(`DELETE FROM "${schema}"."WorkflowVersion"`);
      await database.query(`DELETE FROM "${schema}"."Workflow"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // A workflow saved before revisions were counted: the column's default.
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

    interface StoredWorkflow {
      graphRevision: number;
      version: number;
      graph: JSONObject;
      isEnabled: boolean;
    }

    const stored: (workflowId: ObjectID) => Promise<StoredWorkflow> = async (
      workflowId: ObjectID,
    ): Promise<StoredWorkflow> => {
      const rows: Array<StoredWorkflow> = await database.query(
        `SELECT "graphRevision", "version", "graph", "isEnabled" FROM "${schema}"."Workflow" WHERE "_id" = $1`,
        [workflowId.toString()],
      );

      return rows[0] as StoredWorkflow;
    };

    const valueOf: (graph: JSONObject) => string = (
      graph: JSONObject,
    ): string => {
      const log: JSONObject | undefined = (
        (graph["nodes"] as Array<JSONObject>) || []
      ).find((node: JSONObject): boolean => {
        return (node["data"] as JSONObject)["id"] === "log-1";
      });

      return (
        (((log?.["data"] as JSONObject)?.["arguments"] as JSONObject)?.[
          "value"
        ] as string) || ""
      );
    };

    const versionCount: (workflowId: ObjectID) => Promise<number> = async (
      workflowId: ObjectID,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS count FROM "${schema}"."WorkflowVersion" WHERE "workflowId" = $1`,
        [workflowId.toString()],
      );

      return Number(rows[0]?.count || 0);
    };

    // A save of the graph through WorkflowService, as the builder makes it: made to `basedOn`.
    const saveGraph: (data: {
      workflowId: ObjectID;
      graph: JSONObject;
      basedOn?: number | undefined;
      userId?: ObjectID | undefined;
    }) => Promise<number> = async (data: {
      workflowId: ObjectID;
      graph: JSONObject;
      basedOn?: number | undefined;
      userId?: ObjectID | undefined;
    }): Promise<number> => {
      return await WorkflowService.updateOneById({
        id: data.workflowId,
        data: { graph: data.graph } as never,
        miscDataProps:
          data.basedOn === undefined
            ? undefined
            : { [WORKFLOW_GRAPH_REVISION_KEY]: data.basedOn },
        props: { isRoot: true, userId: data.userId },
      });
    };

    const refusalOf: (save: Promise<unknown>) => Promise<unknown> = async (
      save: Promise<unknown>,
    ): Promise<unknown> => {
      try {
        await save;
      } catch (error) {
        return error;
      }

      return null;
    };

    test("every save of the graph counts one - with a revision or without - and nothing else does", async () => {
      const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

      expect((await stored(workflowId)).graphRevision).toBe(0);

      await saveGraph({
        workflowId,
        graph: graphWith("a"),
        basedOn: 0,
        userId: ALICE,
      });
      expect((await stored(workflowId)).graphRevision).toBe(1);

      // Ask AI and the API name no revision: made over whatever is there, and counted.
      await saveGraph({ workflowId, graph: graphWith("b") });
      expect((await stored(workflowId)).graphRevision).toBe(2);

      // The same graph saved again counts too: a save, whatever it holds.
      await saveGraph({
        workflowId,
        graph: graphWith("b"),
        basedOn: 2,
        userId: ALICE,
      });
      expect((await stored(workflowId)).graphRevision).toBe(3);

      // Turned on, renamed: the row's version moves, its graph's revision does not.
      const before: StoredWorkflow = await stored(workflowId);

      await WorkflowService.updateOneById({
        id: workflowId,
        data: { isEnabled: true, name: "Renamed" } as never,
        props: { isRoot: true },
      });

      const after: StoredWorkflow = await stored(workflowId);

      expect(after.graphRevision).toBe(3);
      expect(after.version).toBeGreaterThan(before.version);
      expect(after.isEnabled).toBe(true);
    });

    test("a save made to the revision the workflow is at lands; one made to an older revision is refused with 409 and changes nothing", async () => {
      const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

      // Alice saves, made to revision 0.
      expect(
        await saveGraph({
          workflowId,
          graph: graphWith("Alice's"),
          basedOn: 0,
          userId: ALICE,
        }),
      ).toBe(1);

      const versionsBefore: number = await versionCount(workflowId);
      const before: StoredWorkflow = await stored(workflowId);

      // Bob's builder still shows revision 0.
      const refusal: unknown = await refusalOf(
        saveGraph({
          workflowId,
          graph: graphWith("Bob's"),
          basedOn: 0,
          userId: BOB,
        }),
      );

      expect(refusal).toBeInstanceOf(ConflictException);
      expect((refusal as ConflictException).code).toBe(409);
      expect((refusal as ConflictException).message).toBe(
        WorkflowServiceClass.getStaleGraphRevisionProblem({
          basedOnRevision: 0,
          currentRevision: 1,
        }),
      );

      const after: StoredWorkflow = await stored(workflowId);

      expect(valueOf(after.graph)).toBe("Alice's");
      expect(after.graphRevision).toBe(1);
      expect(after.version).toBe(before.version);
      expect(await versionCount(workflowId)).toBe(versionsBefore);

      // Bob reads it again, and saves made to revision 1: Keep mine.
      expect(
        await saveGraph({
          workflowId,
          graph: graphWith("Bob's"),
          basedOn: 1,
          userId: BOB,
        }),
      ).toBe(1);
      expect(valueOf((await stored(workflowId)).graph)).toBe("Bob's");
      expect((await stored(workflowId)).graphRevision).toBe(2);
      // Alice's change stays in the version history, as a version of its own.
      expect(await versionCount(workflowId)).toBe(versionsBefore + 1);
    });

    test("two saves made to the same revision at the same moment: exactly one lands, the other is refused - every time", async () => {
      const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

      for (let round: number = 0; round < 20; round++) {
        const revision: number = (await stored(workflowId)).graphRevision;

        const outcomes: Array<unknown> = await Promise.all([
          refusalOf(
            saveGraph({
              workflowId,
              graph: graphWith(`Alice ${round}`),
              basedOn: revision,
              userId: ALICE,
            }),
          ),
          refusalOf(
            saveGraph({
              workflowId,
              graph: graphWith(`Bob ${round}`),
              basedOn: revision,
              userId: BOB,
            }),
          ),
        ]);

        const refusals: Array<unknown> = outcomes.filter((outcome: unknown) => {
          return outcome !== null;
        });

        expect({ round, refusals: refusals.length }).toEqual({
          round,
          refusals: 1,
        });
        expect(refusals[0]).toBeInstanceOf(ConflictException);

        const after: StoredWorkflow = await stored(workflowId);
        const landed: string = outcomes[0] === null ? "Alice" : "Bob";

        expect(after.graphRevision).toBe(revision + 1);
        expect(valueOf(after.graph)).toBe(`${landed} ${round}`);
      }
    });

    test("a save made to a revision never lands over a save that named none, made at the same moment", async () => {
      const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);

      for (let round: number = 0; round < 20; round++) {
        const revision: number = (await stored(workflowId)).graphRevision;

        const [made, over] = await Promise.all([
          refusalOf(
            saveGraph({
              workflowId,
              graph: graphWith(`builder ${round}`),
              basedOn: revision,
              userId: ALICE,
            }),
          ),
          // Ask AI, or the API.
          refusalOf(
            saveGraph({ workflowId, graph: graphWith(`elsewhere ${round}`) }),
          ),
        ]);

        // The save that named none is always made.
        expect(over).toBeNull();

        const after: StoredWorkflow = await stored(workflowId);

        if (made === null) {
          // Both were made, the builder's first: it replaced the graph it was made to.
          expect(after.graphRevision).toBe(revision + 2);
          expect(valueOf(after.graph)).toBe(`elsewhere ${round}`);
        } else {
          expect(made).toBeInstanceOf(ConflictException);
          expect(after.graphRevision).toBe(revision + 1);
          expect(valueOf(after.graph)).toBe(`elsewhere ${round}`);
        }
      }
    });

    test("a write between the check and the save - the workflow turned on - makes the save reach no row: refused, saying to save again, and saved when it is", async () => {
      const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);
      const record: (data: { workflowId: ObjectID }) => Promise<void> =
        WorkflowVersionService.recordEarlierVersionIfNone.bind(
          WorkflowVersionService,
        ) as never;
      let isTurnedOnMeanwhile: boolean = true;

      // Runs once the save is checked, and before it is written.
      jest
        .spyOn(WorkflowVersionService, "recordEarlierVersionIfNone")
        .mockImplementation((async (data: never): Promise<void> => {
          if (isTurnedOnMeanwhile) {
            isTurnedOnMeanwhile = false;
            await WorkflowService.updateOneById({
              id: workflowId,
              data: { isEnabled: true } as never,
              props: { isRoot: true },
            });
          }

          await record(data);
        }) as never);

      const refusal: unknown = await refusalOf(
        saveGraph({
          workflowId,
          graph: graphWith("mine"),
          basedOn: 0,
          userId: ALICE,
        }),
      );

      expect(refusal).toEqual(
        new ConflictException(
          WorkflowServiceClass.GRAPH_CHANGED_WHILE_SAVING_PROBLEM,
        ),
      );

      const after: StoredWorkflow = await stored(workflowId);

      // The graph is as it was before the save; the workflow was turned on.
      expect(after.graphRevision).toBe(0);
      expect(after.isEnabled).toBe(true);
      expect(valueOf(after.graph)).toBe(valueOf(GRAPH_BEFORE));
      expect(valueOf(after.graph)).not.toBe("mine");

      // Sent again, as the builder does when only the row moved.
      await saveGraph({
        workflowId,
        graph: graphWith("mine"),
        basedOn: 0,
        userId: ALICE,
      });
      expect(valueOf((await stored(workflowId)).graph)).toBe("mine");
      expect((await stored(workflowId)).graphRevision).toBe(1);
    });

    test("a save of the graph between the check and the write is refused as made to an older graph", async () => {
      const workflowId: ObjectID = await insertWorkflow(GRAPH_BEFORE);
      const record: (data: never) => Promise<void> =
        WorkflowVersionService.recordEarlierVersionIfNone.bind(
          WorkflowVersionService,
        ) as never;
      let isSavedMeanwhile: boolean = true;

      jest
        .spyOn(WorkflowVersionService, "recordEarlierVersionIfNone")
        .mockImplementation((async (data: never): Promise<void> => {
          if (isSavedMeanwhile) {
            isSavedMeanwhile = false;
            await saveGraph({
              workflowId,
              graph: graphWith("Bob's"),
              userId: BOB,
            });
          }

          await record(data);
        }) as never);

      const refusal: unknown = await refusalOf(
        saveGraph({
          workflowId,
          graph: graphWith("Alice's"),
          basedOn: 0,
          userId: ALICE,
        }),
      );

      expect(refusal).toEqual(
        new ConflictException(
          WorkflowServiceClass.getStaleGraphRevisionProblem({
            basedOnRevision: 0,
            currentRevision: 1,
          }),
        ),
      );
      expect(valueOf((await stored(workflowId)).graph)).toBe("Bob's");
      expect((await stored(workflowId)).graphRevision).toBe(1);
    });

    test("a workflow is created at revision 0, whatever its creator sends", async () => {
      const workflow: Workflow = new Workflow();
      workflow.projectId = PROJECT_ID;
      workflow.name = "Created with a graph";
      workflow.graph = GRAPH_BEFORE;
      workflow.webhookSecretKey = "set";
      workflow.graphRevision = 41;

      const created: Workflow = await WorkflowService.create({
        data: workflow,
        props: { isRoot: true, userId: ALICE },
      });

      expect((await stored(created.id as ObjectID)).graphRevision).toBe(0);
    });

    test("a stale save of an imported graph with an email step is refused like any other", async () => {
      const workflowId: ObjectID = await insertWorkflow(
        graphOf([MANUAL, LOG, EMAIL]) as unknown as JSONObject,
      );

      await saveGraph({
        workflowId,
        graph: GRAPH_BEFORE,
        basedOn: 0,
        userId: ALICE,
      });

      const refusal: unknown = await refusalOf(
        saveGraph({
          workflowId,
          graph: graphOf([MANUAL]) as unknown as JSONObject,
          basedOn: 0,
          userId: BOB,
        }),
      );

      expect(refusal).toBeInstanceOf(ConflictException);
    });

    /*
     * ISSUE #6274: Ask AI's change, approved after a teammate saved the
     * workflow. The real tool, prepared as the chat prepares it and run as
     * an approval runs it, through WorkflowService and its hooks.
     */
    describe("Ask AI's change, approved after someone saved the workflow", () => {
      const ASK_AI: ToolContext = {
        projectId: PROJECT_ID,
        props: { isRoot: true, userId: ALICE, tenantId: PROJECT_ID },
      };

      // Ask AI's change: an email after the Log, as the model writes it from what it read.
      const addEmail: (graph: JSONObject) => JSONObject = (
        graph: JSONObject,
      ): JSONObject => {
        const draft: WorkflowDraft = getDraftFromGraph({
          graph: graph,
          getComponent: getWorkflowComponent,
        });

        return {
          steps: [
            ...draft.steps,
            {
              id: "send-email-2",
              componentId: ComponentID.SendEmail,
              arguments: { to: "oncall@example.com", subject: "Ask AI" },
            },
          ],
          connections: [
            ...draft.connections,
            { from: "log-1", to: "send-email-2" },
          ],
        } as unknown as JSONObject;
      };

      const propose: (
        workflowId: ObjectID,
        args: JSONObject,
      ) => Promise<PreparedMutation> = async (
        workflowId: ObjectID,
        args: JSONObject,
      ): Promise<PreparedMutation> => {
        return await UpdateWorkflowTool.prepareMutation!(
          { workflowId: workflowId.toString(), ...args },
          ASK_AI,
        );
      };

      const approve: (prepared: PreparedMutation) => Promise<unknown> = async (
        prepared: PreparedMutation,
      ): Promise<unknown> => {
        return await UpdateWorkflowTool.execute(prepared.arguments, ASK_AI);
      };

      const stepIdsOf: (graph: JSONObject) => Array<string> = (
        graph: JSONObject,
      ): Array<string> => {
        return ((graph["nodes"] as Array<JSONObject>) || [])
          .map((node: JSONObject): string => {
            return (node["data"] as JSONObject)["id"] as string;
          })
          .sort();
      };

      const build: (
        draft: WorkflowDraft,
        existingGraph?: JSONObject | undefined,
      ) => JSONObject = (
        draft: WorkflowDraft,
        existingGraph?: JSONObject | undefined,
      ): JSONObject => {
        return buildGraphFromDraft({
          draft: draft,
          getComponent: getWorkflowComponent,
          generateId: (): string => {
            return ObjectID.generate().toString();
          },
          existingGraph: existingGraph,
        });
      };

      // The workflow as the Builder saves it: a manual trigger, then a Log.
      const BASE_DRAFT: WorkflowDraft = {
        steps: [
          { id: "manual-1", componentId: ComponentID.Manual },
          {
            id: "log-1",
            componentId: ComponentID.Log,
            arguments: { value: "a" },
          },
        ],
        connections: [{ from: "manual-1", to: "log-1" }],
      };

      let ASK_AI_BASE: JSONObject = {};
      // Bob, in the Builder, adds an If / Else after the trigger: other steps than Ask AI's.
      let GRAPH_WITH_BOBS_STEP: JSONObject = {};
      // Bob changes the Log that Ask AI's email leaves from.
      let GRAPH_WITH_BOBS_VALUE: JSONObject = {};

      beforeAll(() => {
        ASK_AI_BASE = build(BASE_DRAFT);
        GRAPH_WITH_BOBS_STEP = build(
          {
            steps: [
              ...BASE_DRAFT.steps,
              { id: "if-else-1", componentId: ComponentID.IfElse },
            ],
            connections: [
              ...BASE_DRAFT.connections,
              { from: "manual-1", to: "if-else-1" },
            ],
          },
          ASK_AI_BASE,
        );
        GRAPH_WITH_BOBS_VALUE = build(
          {
            ...BASE_DRAFT,
            steps: BASE_DRAFT.steps.map((step: WorkflowDraftStep) => {
              return step.id === "log-1"
                ? { ...step, arguments: { value: "Bob's" } }
                : step;
            }),
          },
          ASK_AI_BASE,
        );
      });

      interface StoredVersion {
        versionNumber: number;
        createdByUserId: string | null;
        savedThrough: string | null;
        changes: Array<string>;
        graph: JSONObject;
      }

      const versionsOf: (
        workflowId: ObjectID,
      ) => Promise<Array<StoredVersion>> = async (
        workflowId: ObjectID,
      ): Promise<Array<StoredVersion>> => {
        return await database.query(
          `SELECT "versionNumber", "createdByUserId", "savedThrough", "changes", "graph" FROM "${schema}"."WorkflowVersion" WHERE "workflowId" = $1 ORDER BY "versionNumber"`,
          [workflowId.toString()],
        );
      };

      test("a teammate's step saved in between is kept, Ask AI's change is made on top in one write, and each is a version of its own", async () => {
        const workflowId: ObjectID = await insertWorkflow(ASK_AI_BASE);
        const prepared: PreparedMutation = await propose(
          workflowId,
          addEmail(ASK_AI_BASE),
        );

        // Bob saves before Alice approves.
        await saveGraph({
          workflowId,
          graph: GRAPH_WITH_BOBS_STEP,
          basedOn: 0,
          userId: BOB,
        });

        await approve(prepared);

        const after: StoredWorkflow = await stored(workflowId);

        expect(stepIdsOf(after.graph)).toEqual([
          "if-else-1",
          "log-1",
          "manual-1",
          "send-email-2",
        ]);
        // Bob's save, then Ask AI's: one write each.
        expect(after.graphRevision).toBe(2);

        const versions: Array<StoredVersion> = await versionsOf(workflowId);
        const askAis: StoredVersion = versions[versions.length - 1]!;
        const bobs: StoredVersion = versions[versions.length - 2]!;

        expect(askAis.savedThrough).toBe(WriteSource.AskAi);
        expect(askAis.createdByUserId).toBe(ALICE.toString());
        expect(bobs.createdByUserId).toBe(BOB.toString());
        // Ask AI's version says what Ask AI did, and nothing of Bob's.
        expect(askAis.changes.join("\n")).toContain(
          'Added "Send Email" (send-email-2)',
        );
        expect(askAis.changes.join("\n")).not.toContain("if-else-1");
        // The version before it - what restoring it brings back - is Bob's, whole.
        expect(stepIdsOf(bobs.graph)).toEqual([
          "if-else-1",
          "log-1",
          "manual-1",
        ]);
      });

      test("a teammate's change to a step Ask AI's change touches: refused, the teammate's graph stays, and no version is added", async () => {
        const workflowId: ObjectID = await insertWorkflow(ASK_AI_BASE);
        const prepared: PreparedMutation = await propose(
          workflowId,
          addEmail(ASK_AI_BASE),
        );

        await saveGraph({
          workflowId,
          graph: GRAPH_WITH_BOBS_VALUE,
          basedOn: 0,
          userId: BOB,
        });

        const versionsBefore: number = await versionCount(workflowId);
        const refusal: unknown = await refusalOf(approve(prepared));

        expect(refusal).toBeInstanceOf(ConflictException);
        expect((refusal as ConflictException).message).toContain(
          '"Log" (log-1)',
        );

        const after: StoredWorkflow = await stored(workflowId);

        expect(valueOf(after.graph)).toBe("Bob's");
        expect(stepIdsOf(after.graph)).toEqual(["log-1", "manual-1"]);
        expect(after.graphRevision).toBe(1);
        expect(await versionCount(workflowId)).toBe(versionsBefore);
      });

      test("nobody saving in between: one write, held to the revision it was proposed on", async () => {
        const workflowId: ObjectID = await insertWorkflow(ASK_AI_BASE);

        await approve(await propose(workflowId, addEmail(ASK_AI_BASE)));

        const after: StoredWorkflow = await stored(workflowId);

        expect(after.graphRevision).toBe(1);
        expect(stepIdsOf(after.graph)).toEqual([
          "log-1",
          "manual-1",
          "send-email-2",
        ]);
      });

      test("a teammate's save landing between Ask AI's check and its write: the database refuses Ask AI's, which is made again on top, and lands", async () => {
        const workflowId: ObjectID = await insertWorkflow(ASK_AI_BASE);
        const prepared: PreparedMutation = await propose(
          workflowId,
          addEmail(ASK_AI_BASE),
        );
        const record: (data: never) => Promise<void> =
          WorkflowVersionService.recordEarlierVersionIfNone.bind(
            WorkflowVersionService,
          ) as never;
        let isSavedMeanwhile: boolean = true;

        // Runs once a save is checked, and before it is written.
        jest
          .spyOn(WorkflowVersionService, "recordEarlierVersionIfNone")
          .mockImplementation((async (data: never): Promise<void> => {
            if (isSavedMeanwhile) {
              isSavedMeanwhile = false;
              await saveGraph({
                workflowId,
                graph: GRAPH_WITH_BOBS_STEP,
                userId: BOB,
              });
            }

            await record(data);
          }) as never);

        await approve(prepared);

        const after: StoredWorkflow = await stored(workflowId);

        expect(stepIdsOf(after.graph)).toEqual([
          "if-else-1",
          "log-1",
          "manual-1",
          "send-email-2",
        ]);
        expect(after.graphRevision).toBe(2);
      });

      test("approvals racing teammates' saves at the same moment: nothing a teammate saved is lost, and Ask AI's change is whole or absent - every time", async () => {
        for (let round: number = 0; round < 20; round++) {
          const workflowId: ObjectID = await insertWorkflow(ASK_AI_BASE);
          const prepared: PreparedMutation = await propose(
            workflowId,
            addEmail(ASK_AI_BASE),
          );

          // Bob saves his step, made to the revision his builder shows, as Alice approves.
          const [approval, bobs] = await Promise.all([
            refusalOf(approve(prepared)),
            refusalOf(
              saveGraph({
                workflowId,
                graph: GRAPH_WITH_BOBS_STEP,
                basedOn: 0,
                userId: BOB,
              }),
            ),
          ]);

          const after: StoredWorkflow = await stored(workflowId);
          const steps: Array<string> = stepIdsOf(after.graph);

          // Ask AI's change touches other steps than Bob's: it is always made.
          expect({ round, approval }).toEqual({ round, approval: null });
          expect({ round, askAis: steps.includes("send-email-2") }).toEqual({
            round,
            askAis: true,
          });

          if (bobs === null) {
            // Bob's landed first: Ask AI's was made on top of it, and kept it.
            expect({ round, steps }).toEqual({
              round,
              steps: ["if-else-1", "log-1", "manual-1", "send-email-2"],
            });
            expect(after.graphRevision).toBe(2);
          } else {
            // Ask AI's landed first: Bob's, made to the graph before, was refused - his builder asks him.
            expect(bobs).toBeInstanceOf(ConflictException);
            expect({ round, steps }).toEqual({
              round,
              steps: ["log-1", "manual-1", "send-email-2"],
            });
            expect(after.graphRevision).toBe(1);
          }
        }
      });
    });
  },
);
