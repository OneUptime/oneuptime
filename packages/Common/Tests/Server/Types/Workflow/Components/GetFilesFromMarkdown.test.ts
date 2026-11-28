import Entities from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Services from "../../../../../Server/Services/Index";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import GetFilesFromMarkdown from "../../../../../Server/Types/Workflow/Components/MarkdownFiles/GetFilesFromMarkdown";
import Components from "../../../../../Server/Types/Workflow/Components/Index";
import MarkdownFiles from "../../../../../Server/Utils/File/MarkdownFiles";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import {
  MarkdownFileLeftOutReason,
  MarkdownFilesResult,
} from "../../../../../Types/File/MarkdownFiles";
import { getMarkdownFilesRecordTypes } from "../../../../../Types/File/MarkdownRecords";
import MimeType from "../../../../../Types/File/MimeType";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import MarkdownFilesComponents from "../../../../../Types/Workflow/Components/MarkdownFiles";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * Get Files From Markdown as a step decides (#11256), with what it reads
 * stubbed: which record types it reads (exactly the builder's), how it takes
 * its settings, that it reads the record as the workflow and never as root,
 * and what it hands on and says. The same step run by the runner against
 * Postgres: App/Tests/FeatureSet/Workflow/RunWorkflowGetFilesFromMarkdownPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const INCIDENT_ID: string = "cccccccc-0000-4000-8000-00000000000c";

interface Ran {
  result?: RunReturnType;
  error?: unknown;
  logs: Array<unknown>;
}

const step: GetFilesFromMarkdown = new GetFilesFromMarkdown(Services);

const run: (args: Record<string, unknown>) => Promise<Ran> = async (
  args: Record<string, unknown>,
): Promise<Ran> => {
  const logs: Array<unknown> = [];

  const options: RunOptions = {
    log: (item: unknown): void => {
      logs.push(item);
    },
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Email the incident",
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  try {
    return { result: await step.run(args as never, options), logs };
  } catch (error) {
    return { error, logs };
  }
};

const RESULT: MarkdownFilesResult = {
  files: [
    {
      name: "screenshot.png",
      mimeType: MimeType.png,
      sizeInBytes: 4,
      base64: "iVBORw==",
      contentId: "image-0123456789abcdef01234567",
      urls: ["https://oneuptime.example/file/image/access-token/abc"],
      fields: ["description"],
    },
  ],
  leftOut: [
    {
      name: "diagram.svg",
      urls: ["https://oneuptime.example/file/image/access-token/def"],
      fields: ["description"],
      reason: MarkdownFileLeftOutReason.NotAPicture,
      message: "Only pictures are handed out.",
    },
  ],
};

describe("the record types the step reads", () => {
  test("are exactly the ones the builder's Record Type list offers", () => {
    const offered: Array<string> = getMarkdownFilesRecordTypes(
      Entities.map((modelType: { new (): BaseModel }): BaseModel => {
        return new modelType();
      }),
    )
      .map((model: BaseModel): string => {
        return model.tableName!;
      })
      .sort();

    expect(step.getRecordTypes()).toEqual(offered);
    expect(offered.length).toBeGreaterThan(20);
  });

  test("the registry runs this step for its ID, from the catalog's own metadata", () => {
    const registered: unknown = Components[ComponentID.GetFilesFromMarkdown];

    expect(registered).toBeInstanceOf(GetFilesFromMarkdown);
    expect((registered as GetFilesFromMarkdown).getMetadata()).toBe(
      MarkdownFilesComponents[0],
    );
  });

  test("hide the images' data from the run's log, and nothing else", () => {
    const sensitive: Array<string> = MarkdownFilesComponents[0]!.returnValues
      .filter((value: { isSensitive?: boolean | undefined }): boolean => {
        return value.isSensitive === true;
      })
      .map((value: { id: string }): string => {
        return value.id;
      });

    expect(sensitive).toEqual(["files"]);
  });
});

describe("Get Files From Markdown, run", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the record as the workflow, in its project, never as root, and hands on what it found", async () => {
    let props: DatabaseCommonInteractionProps | undefined;
    let recordId: string | undefined;
    let tableName: string | null | undefined;

    getJestSpyOn(MarkdownFiles, "readRecordFiles").mockImplementation(
      (async (data: {
        props: DatabaseCommonInteractionProps;
        recordId: ObjectID;
        service: { getModel: () => BaseModel };
      }): Promise<MarkdownFilesResult> => {
        props = data.props;
        recordId = data.recordId.toString();
        tableName = data.service.getModel().tableName;
        return RESULT;
      }) as never,
    );

    const ran: Ran = await run({
      recordType: "Incident",
      recordId: ` ${INCIDENT_ID.toUpperCase()} `,
    });

    expect(ran.error).toBeUndefined();
    expect(ran.result?.executePort?.id).toBe("success");
    expect(ran.result?.returnValues).toEqual({
      files: RESULT.files,
      count: 1,
      leftOut: RESULT.leftOut,
    });

    expect(tableName).toBe("Incident");
    expect(recordId).toBe(INCIDENT_ID);
    expect(props?.isRoot).toBeFalsy();
    expect(props?.userType).toBe(UserType.Workflow);
    expect(props?.tenantId?.toString()).toBe(PROJECT_ID.toString());

    expect(ran.logs).toContain("Found 1 image in the Incident's Markdown.");
    expect(ran.logs).toContain(
      'Left out "diagram.svg": Only pictures are handed out.',
    );
  });

  test("a record that is not there for the workflow takes Error, with the reason, and hands on no file", async () => {
    getJestSpyOn(MarkdownFiles, "readRecordFiles").mockRejectedValue(
      new NotFoundException("Incident not found.") as never,
    );

    const ran: Ran = await run({
      recordType: "Incident",
      recordId: INCIDENT_ID,
    });

    expect(ran.result?.executePort?.id).toBe("error");
    expect(ran.result?.executePortReason).toBe("Incident not found.");
    expect(ran.result?.returnValues).toEqual({ error: "Incident not found." });
  });

  test("a Record ID that is not an ID takes Error before anything is read", async () => {
    const read: jest.SpyInstance<any, any> = getJestSpyOn(
      MarkdownFiles,
      "readRecordFiles",
    );

    const ran: Ran = await run({ recordType: "Incident", recordId: "INC-42" });

    expect(ran.result?.executePort?.id).toBe("error");
    expect(ran.result?.executePortReason).toBe(
      'Record ID "INC-42" is not an ID. Pick the ID of the Incident with { }, or paste one.',
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("a Record ID nothing filled in says so, and takes Error", async () => {
    const ran: Ran = await run({
      recordType: "IncidentPublicNote",
      recordId: "{{local.components.manual-1.returnValues.noteId}}",
    });

    expect(ran.result?.executePort?.id).toBe("error");
    expect(ran.result?.executePortReason).toContain("nothing filled it in");
    expect(ran.result?.executePortReason).toContain("Incident Public Note");
  });

  test("a long value that is not an ID is not repeated", async () => {
    const ran: Ran = await run({
      recordType: "Incident",
      recordId: "x".repeat(500),
    });

    expect(ran.result?.executePortReason).toBe(
      "Record ID is not an ID. Pick the ID of the Incident with { }, or paste one.",
    );
  });

  test("an empty Record ID, or Record Type, or a Record Type that is no record a workflow reads with Markdown, stops the run", async () => {
    for (const [args, message] of [
      [
        { recordType: "Incident", recordId: "  " },
        "Record ID is empty. Pick the ID of the Incident with { }, or paste one.",
      ],
      [
        { recordType: "", recordId: INCIDENT_ID },
        "Record Type is empty. Pick the kind of record whose Markdown shows the images.",
      ],
      [
        { recordType: "File", recordId: INCIDENT_ID },
        'Record Type "File" is not a kind of record whose Markdown can show images. Pick one from the list.',
      ],
      [
        { recordType: "Project", recordId: INCIDENT_ID },
        'Record Type "Project" is not a kind of record whose Markdown can show images. Pick one from the list.',
      ],
    ] as Array<[Record<string, unknown>, string]>) {
      const ran: Ran = await run(args);

      expect(ran.result).toBeUndefined();
      expect(ran.error).toBeInstanceOf(BadDataException);
      expect((ran.error as Error).message).toBe(message);
    }
  });
});
