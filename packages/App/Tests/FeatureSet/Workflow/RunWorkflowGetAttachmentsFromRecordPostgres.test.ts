/*
 * GET ATTACHMENTS FROM RECORD, END TO END, AGAINST A MIGRATED POSTGRES
 * (#11477).
 *
 * A workflow as the builder saves it - a Manual trigger, Get Attachments
 * From Record, and the steps behind its outputs - run by the real runner,
 * with the real step from the registry reading real incidents, notes, their
 * attachments, their file custom fields and files as the workflow
 * (WorkflowPrincipal), and the run's log as it is written. Only the
 * workflow's own row and its log row are not read from Postgres.
 *
 * What a run must do:
 *
 *   - hand the next step every file the record holds - a note's
 *     attachments, an incident's postmortem attachments and the files of its
 *     File and Multiple files custom fields - whole, documents as well as
 *     pictures, ready for an email;
 *   - leave out an SVG, a page stored as a PDF, a file of another project,
 *     with the reason; read no Text custom field, and nothing the record
 *     does not hold;
 *   - keep the files' data out of the run's log - its own entry, and the
 *     next step's that is handed them (#11476);
 *   - read nothing a Find One step of the workflow could not: a private
 *     incident, another project's record, a table its Run As role may not
 *     read - the step takes Error, with the reason, and hands out nothing;
 *   - take Error for a Record ID nothing filled in, and stop the run for a
 *     Record Type that is no kind of record that holds files.
 *
 * Opt in with RUN_POSTGRES_WORKFLOW_ATTACHMENTS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_WORKFLOW_ATTACHMENTS_TESTS=true \
 *   WORKFLOW_ATTACHMENTS_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKFLOW_ATTACHMENTS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/FeatureSet/Workflow/RunWorkflowGetAttachmentsFromRecordPostgres.test.ts
 *
 * The tables it writes are cloned, structure only, into a uniquely named
 * schema that search_path puts first, and dropped afterwards.
 */

import Entities from "Common/Models/DatabaseModels/Index";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ProjectService from "Common/Server/Services/ProjectService";
import Services from "Common/Server/Services/Index";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import {
  RunOptions,
  RunReturnType,
} from "Common/Server/Types/Workflow/ComponentCode";
import Components from "Common/Server/Types/Workflow/Components/Index";
import GetAttachmentsFromRecord from "Common/Server/Types/Workflow/Components/RecordAttachments/GetAttachmentsFromRecord";
import RecordAttachments from "Common/Server/Utils/File/RecordAttachments";
import logger from "Common/Server/Utils/Logger";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import Dictionary from "Common/Types/Dictionary";
import Exception from "Common/Types/Exception/Exception";
import MimeType from "Common/Types/File/MimeType";
import {
  AttachmentFile,
  AttachmentLeftOut,
  AttachmentLeftOutReason,
} from "Common/Types/File/RecordAttachments";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import { WorkflowRunAs } from "Common/Types/Workflow/WorkflowRunAs";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import RunWorkflow, {
  WORKFLOW_LOG_REDACTED_VALUE,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
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
import { DataSource } from "Common/node_modules/typeorm";

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WORKFLOW_ATTACHMENTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "File",
  "Incident",
  "IncidentCustomField",
  "IncidentInternalNote",
  "IncidentInternalNoteFile",
  "IncidentPostmortemAttachmentFile",
];

const WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface StoredFile {
  id: ObjectID;
  name: string;
  fileType: string;
  bytes: Buffer;
}

interface GraphNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  args?: JSONObject;
}

interface GraphEdgeSpec {
  from: string;
  port: string;
  to: string;
}

interface RunResult {
  persisted: JSONObject;
  trace: WorkflowStepTrace;
  logs: string;
  /*
   * What JSON to Text built from what it was handed, as it returned it: the
   * run's log and trace hide the files' data (#11476), what the step ran
   * with does not.
   */
  builtText: string | null;
}

const pdf: (text: string) => Buffer = (text: string): Buffer => {
  return Buffer.from(`%PDF-1.7\n% ${text}\n1 0 obj\n<<>>\nendobj\n`);
};

const png: (fill: number) => Buffer = (fill: number): Buffer => {
  const bytes: Buffer = Buffer.alloc(64, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  return bytes;
};

// A graph as the builder saves it: nodes without metadata, edges by output.
const savedGraph: (
  nodes: Array<GraphNodeSpec>,
  edges: Array<GraphEdgeSpec>,
) => JSONObject = (
  nodes: Array<GraphNodeSpec>,
  edges: Array<GraphEdgeSpec>,
): JSONObject => {
  return JSON.parse(
    JSON.stringify({
      nodes: nodes.map((spec: GraphNodeSpec): JSONObject => {
        return {
          id: `canvas-${spec.componentId}`,
          type: "node",
          position: { x: 0, y: 0 },
          data: {
            id: spec.componentId,
            internalId: `runner-${spec.componentId}`,
            nodeType: NodeType.Node,
            componentType: spec.componentType,
            metadataId: spec.metadataId,
            arguments: spec.args || {},
            returnValues: {},
          },
        };
      }),
      edges: edges.map((spec: GraphEdgeSpec): JSONObject => {
        return {
          id: `${spec.from}-${spec.port}-${spec.to}`,
          source: `canvas-${spec.from}`,
          sourceHandle: spec.port,
          target: `canvas-${spec.to}`,
          targetHandle: "in",
        };
      }),
    }),
  ) as JSONObject;
};

const FILES: string =
  "{{local.components.get-attachments-1.returnValues.files}}";
const COUNT: string =
  "{{local.components.get-attachments-1.returnValues.count}}";

// Manual -> Get Attachments From Record -> the email's attachments, or the error.
const emailGraph: (stepArgs: JSONObject) => JSONObject = (
  stepArgs: JSONObject,
): JSONObject => {
  return savedGraph(
    [
      {
        componentId: "manual-1",
        metadataId: ComponentID.Manual,
        componentType: ComponentType.Trigger,
      },
      {
        componentId: "get-attachments-1",
        metadataId: ComponentID.GetAttachmentsFromRecord,
        componentType: ComponentType.Component,
        args: stepArgs,
      },
      {
        componentId: "attachments-1",
        metadataId: ComponentID.JsonToText,
        componentType: ComponentType.Component,
        args: {
          json: `{"message": {"attachments": ${FILES}, "count": ${COUNT}}}`,
        },
      },
      {
        componentId: "log-error",
        metadataId: ComponentID.Log,
        componentType: ComponentType.Component,
        args: {
          value:
            "No email: {{local.components.get-attachments-1.returnValues.error}}",
        },
      },
    ],
    [
      { from: "manual-1", port: "success", to: "get-attachments-1" },
      { from: "get-attachments-1", port: "success", to: "attachments-1" },
      { from: "get-attachments-1", port: "error", to: "log-error" },
    ],
  );
};

const stepOf: (
  trace: WorkflowStepTrace,
  componentId: string,
) => WorkflowStepTraceEntry = (
  trace: WorkflowStepTrace,
  componentId: string,
): WorkflowStepTraceEntry => {
  const found: WorkflowStepTraceEntry | undefined = trace.steps.find(
    (step: WorkflowStepTraceEntry): boolean => {
      return step.componentId === componentId;
    },
  );

  if (!found) {
    throw new Error(`${componentId} did not run.`);
  }

  return found;
};

const ran: (trace: WorkflowStepTrace) => Array<string> = (
  trace: WorkflowStepTrace,
): Array<string> => {
  return trace.steps.map((step: WorkflowStepTraceEntry): string => {
    return step.componentId;
  });
};

describePostgres(
  "Get Attachments From Record, end to end, against a migrated Postgres",
  () => {
    const schema: string = `workflow_attachments_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    let database: DataSource;

    const files: Dictionary<StoredFile> = {};

    let incidentId: ObjectID;
    let privateIncidentId: ObjectID;
    let otherProjectIncidentId: ObjectID;
    let noteId: ObjectID;

    const insert: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];

          if (value instanceof ObjectID) {
            return value.toString();
          }

          if (
            value &&
            typeof value === "object" &&
            !Buffer.isBuffer(value) &&
            !(value instanceof Date)
          ) {
            return JSON.stringify(value);
          }

          return value;
        }),
      );
    };

    const insertFile: (data: {
      key: string;
      name: string;
      fileType: string;
      bytes: Buffer;
      projectId?: ObjectID;
    }) => Promise<StoredFile> = async (data: {
      key: string;
      name: string;
      fileType: string;
      bytes: Buffer;
      projectId?: ObjectID;
    }): Promise<StoredFile> => {
      const id: ObjectID = ObjectID.generate();

      await insert("File", {
        _id: id,
        projectId: data.projectId || projectId,
        name: data.name,
        slug: `file-${id.toString()}`,
        fileType: data.fileType,
        file: data.bytes,
        isPublic: false,
        version: 1,
      });

      const file: StoredFile = {
        id: id,
        name: data.name,
        fileType: data.fileType,
        bytes: data.bytes,
      };

      files[data.key] = file;

      return file;
    };

    // A custom field's value, as the server stores a file reference.
    const reference: (file: StoredFile) => JSONObject = (
      file: StoredFile,
    ): JSONObject => {
      return {
        fileId: file.id.toString(),
        name: file.name,
        fileType: file.fileType,
        size: file.bytes.length,
      };
    };

    const insertIncident: (data: {
      projectId?: ObjectID;
      title: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
      postmortemAttachments?: Array<StoredFile>;
    }) => Promise<ObjectID> = async (data: {
      projectId?: ObjectID;
      title: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
      postmortemAttachments?: Array<StoredFile>;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insert("Incident", {
        _id: id,
        projectId: data.projectId || projectId,
        title: data.title,
        slug: `incident-${id.toString()}`,
        currentIncidentStateId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        customFields: data.customFields || null,
        isPrivate: Boolean(data.isPrivate),
        version: 1,
      });

      for (const file of data.postmortemAttachments || []) {
        await insert("IncidentPostmortemAttachmentFile", {
          incidentId: id,
          fileId: file.id,
        });
      }

      return id;
    };

    const runGraph: (data: {
      graph: JSONObject;
      arguments: JSONObject;
    }) => Promise<RunResult> = async (data: {
      graph: JSONObject;
      arguments: JSONObject;
    }): Promise<RunResult> => {
      const runner: RunWorkflow = new RunWorkflow();

      const workflow: Workflow = new Workflow();
      workflow.id = WORKFLOW_ID;
      workflow.projectId = projectId;
      workflow.isEnabled = true;
      workflow.name = "Email the incident with its files";
      workflow.graph = data.graph;

      jest
        .spyOn(
          WorkflowService as unknown as {
            findOneById: (query: unknown) => Promise<Workflow | null>;
          },
          "findOneById",
        )
        .mockResolvedValue(workflow);

      const updateLogSpy: { mock: { calls: Array<Array<unknown>> } } = jest
        .spyOn(
          WorkflowLogService as unknown as {
            updateColumnsByIdWithoutHooks: (update: unknown) => Promise<void>;
          },
          "updateColumnsByIdWithoutHooks",
        )
        .mockResolvedValue(undefined) as unknown as {
        mock: { calls: Array<Array<unknown>> };
      };

      jest.spyOn(runner, "getVariables").mockResolvedValue({
        storageMap: {
          local: { variables: {}, components: {} },
          global: { variables: {} },
        },
        variables: [],
      });

      // The real JSON to Text, watched: what it returns is what it built.
      const jsonToText: { mock: { results: Array<{ value: unknown }> } } =
        jest.spyOn(
          Components[ComponentID.JsonToText] as unknown as {
            run: (...args: Array<unknown>) => Promise<RunReturnType>;
          },
          "run",
        ) as unknown as { mock: { results: Array<{ value: unknown }> } };

      await runner.runWorkflow({
        arguments: data.arguments,
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        timeout: 60_000,
      });

      const calls: Array<Array<unknown>> = updateLogSpy.mock.calls;
      const persisted: JSONObject = (
        calls[calls.length - 1]?.[0] as { data: JSONObject }
      ).data;

      const built: RunReturnType | undefined = jsonToText.mock.results[0]
        ? ((await jsonToText.mock.results[0].value) as RunReturnType)
        : undefined;

      return {
        persisted: persisted,
        trace: parseTrace(persisted["stepTrace"] as never),
        logs: String(persisted["logs"] || ""),
        builtText: built ? String(built.returnValues["text"]) : null,
      };
    };

    // What the next step was handed, read back from what it built.
    const attachmentsOf: (result: RunResult) => {
      count: number;
      attachments: Array<AttachmentFile>;
    } = (
      result: RunResult,
    ): { count: number; attachments: Array<AttachmentFile> } => {
      expect(result.builtText).not.toBeNull();

      const message: JSONObject = (
        JSON.parse(String(result.builtText)) as JSONObject
      )["message"] as JSONObject;

      return {
        count: message["count"] as number,
        attachments: message["attachments"] as unknown as Array<AttachmentFile>,
      };
    };

    const options: (runAs?: RunOptions["runAs"]) => RunOptions = (
      runAs?: RunOptions["runAs"],
    ): RunOptions => {
      return {
        log: jest.fn() as RunOptions["log"],
        workflowLogId: WORKFLOW_LOG_ID,
        workflowId: WORKFLOW_ID,
        workflowName: "Email the incident with its files",
        projectId: projectId,
        runAs: runAs,
        onError: ((exception: Exception): Exception => {
          return exception;
        }) as RunOptions["onError"],
        executeWorkflow: async (): Promise<void> => {},
      };
    };

    const expectBytesOf: (file: AttachmentFile, key: string) => void = (
      file: AttachmentFile,
      key: string,
    ): void => {
      const stored: StoredFile = files[key]!;

      expect(file.name).toBe(stored.name);
      expect(Buffer.from(file.base64, "base64").equals(stored.bytes)).toBe(
        true,
      );
      expect(file.sizeInBytes).toBe(stored.bytes.length);
      expect(file.contentId).toBe(
        RecordAttachments.getContentId(stored.id.toString()),
      );
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKFLOW_ATTACHMENTS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["WORKFLOW_ATTACHMENTS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKFLOW_ATTACHMENTS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        logging: ["error"],
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const [id, name] of [
        [projectId, "Home project"],
        [otherProjectId, "Other project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      // The project's custom fields: a File, a Multiple files and a Text field.
      for (const [name, type] of [
        ["Signed change request", CustomFieldType.File],
        ["Photos", CustomFieldType.MultipleFiles],
        ["Ticket link", CustomFieldType.Text],
      ] as Array<[string, CustomFieldType]>) {
        await insert("IncidentCustomField", {
          _id: ObjectID.generate(),
          projectId: projectId,
          name: name,
          customFieldType: type,
          version: 1,
        });
      }

      const changeRequest: StoredFile = await insertFile({
        key: "changeRequest",
        name: "change-request.pdf",
        fileType: MimeType.pdf,
        bytes: pdf("the change request"),
      });
      const graph: StoredFile = await insertFile({
        key: "graph",
        name: "latency.png",
        fileType: MimeType.png,
        bytes: png(1),
      });
      const diagram: StoredFile = await insertFile({
        key: "diagram",
        name: "diagram.svg",
        fileType: MimeType.svg,
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      });
      const pageAsPdf: StoredFile = await insertFile({
        key: "pageAsPdf",
        name: "totally-a.pdf",
        fileType: MimeType.pdf,
        bytes: Buffer.from(
          "<!doctype html><script>fetch('/api/user')</script>",
        ),
      });
      const theirs: StoredFile = await insertFile({
        key: "theirs",
        name: "theirs.pdf",
        fileType: MimeType.pdf,
        bytes: pdf("another project's"),
        projectId: otherProjectId,
      });
      const postmortem: StoredFile = await insertFile({
        key: "postmortem",
        name: "postmortem.pdf",
        fileType: MimeType.pdf,
        bytes: pdf("what happened"),
      });
      const signed: StoredFile = await insertFile({
        key: "signed",
        name: "signed.pdf",
        fileType: MimeType.pdf,
        bytes: pdf("signed by the change board"),
      });
      const rack: StoredFile = await insertFile({
        key: "rack",
        name: "rack.png",
        fileType: MimeType.png,
        bytes: png(2),
      });
      const cables: StoredFile = await insertFile({
        key: "cables",
        name: "cables.png",
        fileType: MimeType.png,
        bytes: png(3),
      });
      // Of the project, but no record holds it.
      await insertFile({
        key: "unheld",
        name: "never-attached.pdf",
        fileType: MimeType.pdf,
        bytes: pdf("never attached"),
      });

      incidentId = await insertIncident({
        title: "Checkout is down",
        postmortemAttachments: [postmortem],
        customFields: {
          "Signed change request": reference(signed),
          Photos: [reference(rack), reference(cables)],
          // A Text field holding a file's id is no file field.
          "Ticket link": files["unheld"]!.id.toString(),
        },
      });

      privateIncidentId = await insertIncident({
        title: "A private matter",
        isPrivate: true,
        postmortemAttachments: [postmortem],
      });

      otherProjectIncidentId = await insertIncident({
        projectId: otherProjectId,
        title: "Their incident",
        postmortemAttachments: [theirs],
      });

      noteId = ObjectID.generate();

      await insert("IncidentInternalNote", {
        _id: noteId,
        projectId: projectId,
        incidentId: incidentId,
        note: "The change request and the graph.",
        version: 1,
      });

      for (const file of [changeRequest, graph, diagram, pageAsPdf, theirs]) {
        await insert("IncidentInternalNoteFile", {
          incidentInternalNoteId: noteId,
          fileId: file.id,
        });
      }
    }, 120_000);

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);
      jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe("run by the runner", () => {
      test("a note's attachments are handed on whole, a document and a picture, ready to attach", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "IncidentInternalNote",
            recordId: "{{local.components.manual-1.returnValues.noteId}}",
          }),
          arguments: { noteId: noteId.toString() },
        });

        expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
        expect(ran(result.trace)).toEqual([
          "manual-1",
          "get-attachments-1",
          "attachments-1",
        ]);

        const handed: { count: number; attachments: Array<AttachmentFile> } =
          attachmentsOf(result);

        expect(handed.count).toBe(2);
        expect(
          handed.attachments.map((file: AttachmentFile): Array<unknown> => {
            return [file.name, file.mimeType, file.fields];
          }),
        ).toEqual([
          ["change-request.pdf", MimeType.pdf, ["attachments"]],
          ["latency.png", MimeType.png, ["attachments"]],
        ]);

        expectBytesOf(handed.attachments[0]!, "changeRequest");
        expectBytesOf(handed.attachments[1]!, "graph");
      });

      test("an SVG, a page stored as a PDF and another project's file are left out, with why", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "IncidentInternalNote",
            recordId: noteId.toString(),
          }),
          arguments: {},
        });

        const leftOut: Array<AttachmentLeftOut> = stepOf(
          result.trace,
          "get-attachments-1",
        ).returnValues["leftOut"] as unknown as Array<AttachmentLeftOut>;

        expect(
          leftOut.map((item: AttachmentLeftOut): Array<unknown> => {
            return [item.name, item.reason];
          }),
        ).toEqual([
          ["diagram.svg", AttachmentLeftOutReason.NotAllowed],
          ["totally-a.pdf", AttachmentLeftOutReason.NotAllowed],
          // Another project's file has no name to give.
          [null, AttachmentLeftOutReason.NotFound],
        ]);
        expect(result.logs).not.toContain(
          files["theirs"]!.bytes.toString("base64"),
        );
      });

      test("an incident's postmortem attachments, then its File and Multiple files fields, in order; not a Text field's", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: "{{local.components.manual-1.returnValues.incidentId}}",
          }),
          arguments: { incidentId: incidentId.toString() },
        });

        expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);

        const handed: { count: number; attachments: Array<AttachmentFile> } =
          attachmentsOf(result);

        expect(
          handed.attachments.map((file: AttachmentFile): Array<unknown> => {
            return [file.name, file.fields];
          }),
        ).toEqual([
          ["postmortem.pdf", ["postmortemAttachments"]],
          ["signed.pdf", ["Signed change request"]],
          ["rack.png", ["Photos"]],
          ["cables.png", ["Photos"]],
        ]);

        expectBytesOf(handed.attachments[0]!, "postmortem");
        expectBytesOf(handed.attachments[1]!, "signed");
        expectBytesOf(handed.attachments[2]!, "rack");
        expectBytesOf(handed.attachments[3]!, "cables");

        // The file a Text field names is not held: never read, never named.
        expect(result.logs).not.toContain("never-attached.pdf");
      });

      test("the files' data is in no line of the run's log: the step's own, nor the next step's that is handed them", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: incidentId.toString(),
          }),
          arguments: {},
        });

        const entry: WorkflowStepTraceEntry = stepOf(
          result.trace,
          "get-attachments-1",
        );

        expect(entry.returnValues["files"]).toBe(WORKFLOW_LOG_REDACTED_VALUE);
        expect(entry.returnValues["count"]).toBe(4);

        for (const key of ["postmortem", "signed", "rack", "cables"]) {
          const base64: string = files[key]!.bytes.toString("base64");

          expect(result.logs).not.toContain(base64);
          expect(JSON.stringify(result.persisted["stepTrace"])).not.toContain(
            base64,
          );
        }

        expect(result.logs).toContain("Found 4 files the Incident holds.");
      });

      test("a private incident is not read: Error, with the reason, and nothing handed on", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: privateIncidentId.toString(),
          }),
          arguments: {},
        });

        expect(ran(result.trace)).toEqual([
          "manual-1",
          "get-attachments-1",
          "log-error",
        ]);

        const entry: WorkflowStepTraceEntry = stepOf(
          result.trace,
          "get-attachments-1",
        );

        expect(entry.executedPortReason).toBe("Incident not found.");
        expect(entry.returnValues["files"]).toBeUndefined();
        expect(result.logs).not.toContain(
          files["postmortem"]!.bytes.toString("base64"),
        );
      });

      test("another project's incident is not read, by its ID or otherwise", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: otherProjectIncidentId.toString(),
          }),
          arguments: {},
        });

        expect(ran(result.trace)).toEqual([
          "manual-1",
          "get-attachments-1",
          "log-error",
        ]);
        expect(
          stepOf(result.trace, "get-attachments-1").executedPortReason,
        ).toBe("Incident not found.");
        expect(result.logs).not.toContain(
          files["theirs"]!.bytes.toString("base64"),
        );
      });

      test("a Record ID nothing filled in takes Error, and says why", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: "{{local.components.manual-1.returnValues.incidentId}}",
          }),
          arguments: {},
        });

        expect(ran(result.trace)).toEqual([
          "manual-1",
          "get-attachments-1",
          "log-error",
        ]);
        expect(
          String(stepOf(result.trace, "get-attachments-1").executedPortReason),
        ).toContain("nothing filled it in");
      });

      test("a Record Type that is no kind of record that holds files stops the run", async () => {
        for (const recordType of [
          "Project",
          "File",
          "IncidentFeed",
          "Nothing",
        ]) {
          const result: RunResult = await runGraph({
            graph: emailGraph({
              recordType: recordType,
              recordId: incidentId.toString(),
            }),
            arguments: {},
          });

          expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
          expect(result.logs).toContain(
            `Record Type "${recordType}" is not a kind of record that holds files.`,
          );
          expect(ran(result.trace)).not.toContain("attachments-1");
          expect(ran(result.trace)).not.toContain("log-error");
        }
      });
    });

    describe("what the workflow runs as", () => {
      const step: () => GetAttachmentsFromRecord =
        (): GetAttachmentsFromRecord => {
          return new GetAttachmentsFromRecord(Services);
        };

      const role: (
        name: string,
        permissions: Array<Permission>,
      ) => RunOptions["runAs"] = (
        name: string,
        permissions: Array<Permission>,
      ): RunOptions["runAs"] => {
        return {
          runAs: WorkflowRunAs.CustomRole,
          customRoleName: name,
          rolePermissions: permissions.map((permission: Permission) => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            };
          }),
        } as RunOptions["runAs"];
      };

      test("a custom role that may read incidents gets the incident's files", async () => {
        const result: RunReturnType = await step().run(
          { recordType: "Incident", recordId: incidentId.toString() },
          options(role("Incident readers", [Permission.ReadProjectIncident])),
        );

        expect(result.executePort?.id).toBe("success");
        expect(result.returnValues["count"]).toBe(4);
      });

      test("a custom role that may read incidents but not their internal notes is refused the note's attachments", async () => {
        const result: RunReturnType = await step().run(
          { recordType: "IncidentInternalNote", recordId: noteId.toString() },
          options(role("Incident readers", [Permission.ReadProjectIncident])),
        );

        expect(result.executePort?.id).toBe("error");
        expect(result.returnValues["files"]).toBeUndefined();
        expect(String(result.executePortReason)).toContain("Incident readers");
      });

      test("a custom role that may read internal notes too gets them", async () => {
        const result: RunReturnType = await step().run(
          { recordType: "IncidentInternalNote", recordId: noteId.toString() },
          options(
            role("Note readers", [
              Permission.ReadProjectIncident,
              Permission.ReadIncidentInternalNote,
            ]),
          ),
        );

        expect(result.executePort?.id).toBe("success");
        expect(
          (
            result.returnValues["files"] as unknown as Array<AttachmentFile>
          ).map((file: AttachmentFile): string => {
            return file.name;
          }),
        ).toEqual(["change-request.pdf", "latency.png"]);
      });

      test("a custom role that may not read incidents is refused, and hands out nothing", async () => {
        const result: RunReturnType = await step().run(
          { recordType: "Incident", recordId: incidentId.toString() },
          options(role("Monitor readers", [Permission.ReadProjectMonitor])),
        );

        expect(result.executePort?.id).toBe("error");
        expect(result.returnValues["files"]).toBeUndefined();
        expect(String(result.executePortReason)).toContain("Monitor readers");
      });

      test("the default permissions read the project's records, and nothing of another project", async () => {
        const own: RunReturnType = await step().run(
          { recordType: "Incident", recordId: incidentId.toString() },
          options(),
        );

        expect(own.executePort?.id).toBe("success");
        expect(own.returnValues["count"]).toBe(4);

        const theirs: RunReturnType = await step().run(
          {
            recordType: "Incident",
            recordId: otherProjectIncidentId.toString(),
          },
          options(),
        );

        expect(theirs.executePort?.id).toBe("error");
        expect(theirs.returnValues["files"]).toBeUndefined();
      });
    });
  },
);
