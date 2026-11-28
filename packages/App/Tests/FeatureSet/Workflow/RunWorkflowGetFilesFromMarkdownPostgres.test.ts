/*
 * GET FILES FROM MARKDOWN, END TO END, AGAINST A MIGRATED POSTGRES (#11256).
 *
 * A workflow as the builder saves it - a Manual trigger, Get Files From
 * Markdown, and the steps behind its outputs - run by the real runner, with
 * the real step from the registry reading real incidents, notes and files
 * as the workflow (WorkflowPrincipal), and the run's log as it is written.
 * Only the workflow's own row and its log row are not read from Postgres.
 *
 * What a run must do:
 *
 *   - hand the next step every picture the record's Markdown shows, whole,
 *     with its content ID, ready for an email: here JSON to Text builds the
 *     attachments, as a Microsoft Graph message would carry them;
 *   - keep the pictures' data out of the step's own entry in the run's log,
 *     and say there how many it found and why any were left out;
 *   - read nothing a Find One step of the workflow could not: a private
 *     incident, another project's incident, a table its Run As role may not
 *     read - the step takes Error, with the reason, and hands out nothing;
 *   - take Error for a Record ID nothing filled in, and stop the run for a
 *     Record Type that is no kind of record whose Markdown shows images.
 *
 * Opt in with RUN_POSTGRES_WORKFLOW_MARKDOWN_FILES_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_WORKFLOW_MARKDOWN_FILES_TESTS=true \
 *   WORKFLOW_MARKDOWN_FILES_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKFLOW_MARKDOWN_FILES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/FeatureSet/Workflow/RunWorkflowGetFilesFromMarkdownPostgres.test.ts
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
import GetFilesFromMarkdown from "Common/Server/Types/Workflow/Components/MarkdownFiles/GetFilesFromMarkdown";
import MarkdownFiles from "Common/Server/Utils/File/MarkdownFiles";
import logger from "Common/Server/Utils/Logger";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import Dictionary from "Common/Types/Dictionary";
import Exception from "Common/Types/Exception/Exception";
import {
  MarkdownFile,
  MarkdownFileLeftOut,
  MarkdownFileLeftOutReason,
} from "Common/Types/File/MarkdownFiles";
import MimeType from "Common/Types/File/MimeType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
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
  process.env["RUN_POSTGRES_WORKFLOW_MARKDOWN_FILES_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "File",
  "Incident",
  "IncidentCustomField",
  "IncidentPublicNote",
];

const HOST: string = "https://oneuptime.example.com";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface StoredImage {
  token: string;
  url: string;
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
}

const PNG_SIGNATURE: Array<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];

const png: (fill: number) => Buffer = (fill: number): Buffer => {
  const bytes: Buffer = Buffer.alloc(48, fill);
  Buffer.from(PNG_SIGNATURE).copy(bytes, 0);
  return bytes;
};

const token: () => string = (): string => {
  return (
    ObjectID.generate().toString().replace(/-/g, "") +
    ObjectID.generate().toString().replace(/-/g, "")
  );
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

const FILES: string = "{{local.components.get-files-1.returnValues.files}}";
const COUNT: string = "{{local.components.get-files-1.returnValues.count}}";

// Manual -> Get Files From Markdown -> the email's attachments, or the error.
const emailGraph: (getFilesArgs: JSONObject) => JSONObject = (
  getFilesArgs: JSONObject,
): JSONObject => {
  return savedGraph(
    [
      {
        componentId: "manual-1",
        metadataId: ComponentID.Manual,
        componentType: ComponentType.Trigger,
      },
      {
        componentId: "get-files-1",
        metadataId: ComponentID.GetFilesFromMarkdown,
        componentType: ComponentType.Component,
        args: getFilesArgs,
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
            "No email: {{local.components.get-files-1.returnValues.error}}",
        },
      },
    ],
    [
      { from: "manual-1", port: "success", to: "get-files-1" },
      { from: "get-files-1", port: "success", to: "attachments-1" },
      { from: "get-files-1", port: "error", to: "log-error" },
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
  "Get Files From Markdown, end to end, against a migrated Postgres",
  () => {
    const schema: string = `workflow_markdown_files_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    let database: DataSource;

    const images: Dictionary<StoredImage> = {};

    let incidentId: ObjectID;
    let privateIncidentId: ObjectID;
    let otherProjectIncidentId: ObjectID;
    let publicNoteId: ObjectID;

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

    const insertImage: (data: {
      key: string;
      name: string;
      fileType: string;
      bytes: Buffer;
      projectId?: ObjectID;
    }) => Promise<StoredImage> = async (data: {
      key: string;
      name: string;
      fileType: string;
      bytes: Buffer;
      projectId?: ObjectID;
    }): Promise<StoredImage> => {
      const id: ObjectID = ObjectID.generate();
      const imageToken: string = token();

      await insert("File", {
        _id: id,
        projectId: data.projectId || projectId,
        name: data.name,
        slug: `file-${id.toString()}`,
        fileType: data.fileType,
        file: data.bytes,
        imageAccessToken: imageToken,
        isPublic: false,
        version: 1,
      });

      const image: StoredImage = {
        token: imageToken,
        url: `${HOST}/file/image/access-token/${imageToken}`,
        name: data.name,
        fileType: data.fileType,
        bytes: data.bytes,
      };

      images[data.key] = image;

      return image;
    };

    const insertIncident: (data: {
      projectId?: ObjectID;
      title: string;
      description: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
    }) => Promise<ObjectID> = async (data: {
      projectId?: ObjectID;
      title: string;
      description: string;
      customFields?: JSONObject;
      isPrivate?: boolean;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insert("Incident", {
        _id: id,
        projectId: data.projectId || projectId,
        title: data.title,
        slug: `incident-${id.toString()}`,
        currentIncidentStateId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        description: data.description,
        customFields: data.customFields || null,
        isPrivate: Boolean(data.isPrivate),
        version: 1,
      });

      return id;
    };

    const runGraph: (data: {
      graph: JSONObject;
      arguments: JSONObject;
      workflowProjectId?: ObjectID;
    }) => Promise<RunResult> = async (data: {
      graph: JSONObject;
      arguments: JSONObject;
      workflowProjectId?: ObjectID;
    }): Promise<RunResult> => {
      const runner: RunWorkflow = new RunWorkflow();

      const workflow: Workflow = new Workflow();
      workflow.id = WORKFLOW_ID;
      workflow.projectId = data.workflowProjectId || projectId;
      workflow.isEnabled = true;
      workflow.name = "Email the incident with its screenshots";
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

      return {
        persisted: persisted,
        trace: parseTrace(persisted["stepTrace"] as never),
        logs: String(persisted["logs"] || ""),
      };
    };

    // The line of the run's log that holds a step's returned values.
    const returnedLineOf: (logs: string, componentId: string) => string = (
      logs: string,
      componentId: string,
    ): string => {
      const lines: Array<string> = logs.split("\n");
      const completed: number = lines.findIndex((line: string): boolean => {
        return line.endsWith(`Completed Execution Component: ${componentId}`);
      });

      expect(completed).toBeGreaterThanOrEqual(0);
      expect(lines[completed + 1]).toContain("Data Returned");

      return lines[completed + 2] || "";
    };

    const options: (runAs?: RunOptions["runAs"]) => RunOptions = (
      runAs?: RunOptions["runAs"],
    ): RunOptions => {
      return {
        log: jest.fn() as RunOptions["log"],
        workflowLogId: WORKFLOW_LOG_ID,
        workflowId: WORKFLOW_ID,
        workflowName: "Email the incident with its screenshots",
        projectId: projectId,
        runAs: runAs,
        onError: ((exception: Exception): Exception => {
          return exception;
        }) as RunOptions["onError"],
        executeWorkflow: async (): Promise<void> => {},
      };
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKFLOW_MARKDOWN_FILES_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["WORKFLOW_MARKDOWN_FILES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKFLOW_MARKDOWN_FILES_TEST_DATABASE_NAME"] ||
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

      await insert("IncidentCustomField", {
        _id: ObjectID.generate(),
        projectId: projectId,
        name: "Customer impact",
        customFieldType: CustomFieldType.Markdown,
        version: 1,
      });

      const screenshot: StoredImage = await insertImage({
        key: "screenshot",
        name: "screenshot.png",
        fileType: MimeType.png,
        bytes: png(1),
      });
      const impact: StoredImage = await insertImage({
        key: "impact",
        name: "impact.png",
        fileType: MimeType.png,
        bytes: png(2),
      });
      const diagram: StoredImage = await insertImage({
        key: "diagram",
        name: "diagram.svg",
        fileType: MimeType.svg,
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      });
      const theirs: StoredImage = await insertImage({
        key: "theirs",
        name: "theirs.png",
        fileType: MimeType.png,
        bytes: png(3),
        projectId: otherProjectId,
      });

      incidentId = await insertIncident({
        title: "Checkout is down",
        description: `The checkout page answers 502.\n\n![screenshot.png](${screenshot.url})\n\n![diagram.svg](${diagram.url})`,
        customFields: {
          "Customer impact": `Every checkout failed. ![impact.png](${impact.url})`,
        },
      });

      privateIncidentId = await insertIncident({
        title: "A private matter",
        description: `![screenshot.png](${screenshot.url})`,
        isPrivate: true,
      });

      otherProjectIncidentId = await insertIncident({
        projectId: otherProjectId,
        title: "Their incident",
        description: `![theirs.png](${theirs.url})`,
      });

      publicNoteId = ObjectID.generate();

      await insert("IncidentPublicNote", {
        _id: publicNoteId,
        projectId: projectId,
        incidentId: incidentId,
        note: `We are on it. ![screenshot.png](${screenshot.url})`,
        version: 1,
      });
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
      test("the next step is handed every picture the incident shows, whole, ready to attach", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: "{{local.components.manual-1.returnValues.incidentId}}",
          }),
          arguments: { incidentId: incidentId.toString() },
        });

        expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);
        expect(ran(result.trace)).toEqual([
          "manual-1",
          "get-files-1",
          "attachments-1",
        ]);

        const text: string = String(
          stepOf(result.trace, "attachments-1").returnValues["text"],
        );
        const message: JSONObject = (JSON.parse(text) as JSONObject)[
          "message"
        ] as JSONObject;
        const attachments: Array<MarkdownFile> = message[
          "attachments"
        ] as unknown as Array<MarkdownFile>;

        expect(message["count"]).toBe(2);
        expect(
          attachments.map((file: MarkdownFile): Array<unknown> => {
            return [file.name, file.mimeType, file.fields];
          }),
        ).toEqual([
          ["screenshot.png", MimeType.png, ["description"]],
          ["impact.png", MimeType.png, ["Customer impact"]],
        ]);

        for (const file of attachments) {
          const image: StoredImage = Object.values(images).find(
            (stored: StoredImage): boolean => {
              return stored.name === file.name;
            },
          )!;

          expect(Buffer.from(file.base64, "base64").equals(image.bytes)).toBe(
            true,
          );
          expect(file.sizeInBytes).toBe(image.bytes.length);
          expect(file.contentId).toBe(MarkdownFiles.getContentId(image.token));
          expect(file.urls).toEqual([image.url]);
        }
      });

      test("the step's own entry in the log keeps the pictures' data out, and says what it found and left out", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: "{{local.components.manual-1.returnValues.incidentId}}",
          }),
          arguments: { incidentId: incidentId.toString() },
        });

        const entry: WorkflowStepTraceEntry = stepOf(
          result.trace,
          "get-files-1",
        );

        expect(entry.returnValues["files"]).toBe(WORKFLOW_LOG_REDACTED_VALUE);
        expect(entry.returnValues["count"]).toBe(2);

        const leftOut: Array<MarkdownFileLeftOut> = entry.returnValues[
          "leftOut"
        ] as unknown as Array<MarkdownFileLeftOut>;

        expect(
          leftOut.map((item: MarkdownFileLeftOut): Array<unknown> => {
            return [item.name, item.reason];
          }),
        ).toEqual([["diagram.svg", MarkdownFileLeftOutReason.NotAPicture]]);

        const returned: string = returnedLineOf(result.logs, "get-files-1");

        expect(returned).toContain(WORKFLOW_LOG_REDACTED_VALUE);

        for (const key of ["screenshot", "impact"]) {
          expect(returned).not.toContain(images[key]!.bytes.toString("base64"));
        }

        expect(result.logs).toContain(
          "Found 2 images in the Incident's Markdown.",
        );
        expect(result.logs).toContain('Left out "diagram.svg"');
      });

      test("a note of the incident is read the same way", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "IncidentPublicNote",
            recordId: "{{local.components.manual-1.returnValues.noteId}}",
          }),
          arguments: { noteId: publicNoteId.toString() },
        });

        expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Success);

        const attachments: JSONArray = (
          (
            JSON.parse(
              String(
                stepOf(result.trace, "attachments-1").returnValues["text"],
              ),
            ) as JSONObject
          )["message"] as JSONObject
        )["attachments"] as JSONArray;

        expect(
          attachments.map((file: unknown): unknown => {
            return (file as MarkdownFile).name;
          }),
        ).toEqual(["screenshot.png"]);
      });

      test("a private incident is not read: Error, with the reason, and nothing handed on", async () => {
        const result: RunResult = await runGraph({
          graph: emailGraph({
            recordType: "Incident",
            recordId: "{{local.components.manual-1.returnValues.incidentId}}",
          }),
          arguments: { incidentId: privateIncidentId.toString() },
        });

        expect(ran(result.trace)).toEqual([
          "manual-1",
          "get-files-1",
          "log-error",
        ]);

        const entry: WorkflowStepTraceEntry = stepOf(
          result.trace,
          "get-files-1",
        );

        expect(entry.executedPortReason).toBe("Incident not found.");
        expect(entry.returnValues["files"]).toBeUndefined();
        expect(result.logs).not.toContain(
          images["screenshot"]!.bytes.toString("base64"),
        );
        expect(stepOf(result.trace, "log-error").argumentValues["value"]).toBe(
          "No email: Incident not found.",
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
          "get-files-1",
          "log-error",
        ]);
        expect(stepOf(result.trace, "get-files-1").executedPortReason).toBe(
          "Incident not found.",
        );
        expect(result.logs).not.toContain(
          images["theirs"]!.bytes.toString("base64"),
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
          "get-files-1",
          "log-error",
        ]);
        expect(
          String(stepOf(result.trace, "get-files-1").executedPortReason),
        ).toBe(
          "Record ID is still {{local.components.manual-1.returnValues.incidentId}}: nothing filled it in when this step ran. Check that the step it names ran before this one, and gives back an ID of the Incident.",
        );
      });

      test("a Record Type that is no kind of record a workflow reads with Markdown stops the run", async () => {
        for (const recordType of ["Project", "File", "Nothing"]) {
          const result: RunResult = await runGraph({
            graph: emailGraph({
              recordType: recordType,
              recordId: incidentId.toString(),
            }),
            arguments: {},
          });

          expect(result.persisted["workflowStatus"]).toBe(WorkflowStatus.Error);
          expect(result.logs).toContain(
            `Record Type "${recordType}" is not a kind of record whose Markdown can show images.`,
          );
          expect(ran(result.trace)).not.toContain("attachments-1");
          expect(ran(result.trace)).not.toContain("log-error");
        }
      });
    });

    describe("what the workflow runs as", () => {
      const step: () => GetFilesFromMarkdown = (): GetFilesFromMarkdown => {
        return new GetFilesFromMarkdown(Services);
      };

      test("a custom role that may read incidents gets the pictures", async () => {
        const result: RunReturnType = await step().run(
          { recordType: "Incident", recordId: incidentId.toString() },
          options({
            runAs: WorkflowRunAs.CustomRole,
            customRoleName: "Incident readers",
            rolePermissions: [
              {
                permission: Permission.ReadProjectIncident,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              },
            ],
          }),
        );

        expect(result.executePort?.id).toBe("success");
        expect(result.returnValues["count"]).toBe(2);
      });

      test("a custom role that may not read incidents is refused, and hands out nothing", async () => {
        const result: RunReturnType = await step().run(
          { recordType: "Incident", recordId: incidentId.toString() },
          options({
            runAs: WorkflowRunAs.CustomRole,
            customRoleName: "Monitor readers",
            rolePermissions: [
              {
                permission: Permission.ReadProjectMonitor,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              },
            ],
          }),
        );

        expect(result.executePort?.id).toBe("error");
        expect(result.returnValues["files"]).toBeUndefined();
        expect(String(result.executePortReason)).toContain("Incident");
        expect(String(result.executePortReason)).toContain("Monitor readers");
      });

      test("the default permissions read the project's incidents, and nothing of another project", async () => {
        const own: RunReturnType = await step().run(
          { recordType: "Incident", recordId: incidentId.toString() },
          options(),
        );

        expect(own.executePort?.id).toBe("success");
        expect(
          (own.returnValues["files"] as unknown as Array<MarkdownFile>).map(
            (file: MarkdownFile): string => {
              return file.name;
            },
          ),
        ).toEqual(["screenshot.png", "impact.png"]);

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

      test("the record types the step reads are the ones a workflow reads with Markdown", () => {
        const recordTypes: Array<string> = step().getRecordTypes();

        expect(recordTypes).toEqual(
          expect.arrayContaining([
            "Incident",
            "IncidentPublicNote",
            "IncidentInternalNote",
            "Alert",
            "ScheduledMaintenance",
          ]),
        );
        expect(recordTypes).not.toContain("File");
        expect(recordTypes).not.toContain("User");
        expect(recordTypes).not.toContain("Project");
      });
    });
  },
);
