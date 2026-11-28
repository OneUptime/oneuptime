import Entities from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Services from "../../../../../Server/Services/Index";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import GetAttachmentsFromRecord from "../../../../../Server/Types/Workflow/Components/RecordAttachments/GetAttachmentsFromRecord";
import Components from "../../../../../Server/Types/Workflow/Components/Index";
import RecordAttachments from "../../../../../Server/Utils/File/RecordAttachments";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import MimeType from "../../../../../Types/File/MimeType";
import {
  AttachmentLeftOutReason,
  getAttachmentRecordTypes,
  RecordAttachmentsResult,
} from "../../../../../Types/File/RecordAttachments";
import ObjectID from "../../../../../Types/ObjectID";
import UserType from "../../../../../Types/UserType";
import { ComponentInputType } from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import MarkdownFilesComponents from "../../../../../Types/Workflow/Components/MarkdownFiles";
import RecordAttachmentsComponents from "../../../../../Types/Workflow/Components/RecordAttachments";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * Get Attachments From Record as a step decides (#11477), with what it
 * reads stubbed: which record types it reads (exactly the builder's), how it
 * takes its settings, that it reads the record as the workflow and never as
 * root, and what it hands on and says. The same step run by the runner
 * against Postgres:
 * App/Tests/FeatureSet/Workflow/RunWorkflowGetAttachmentsFromRecordPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const NOTE_ID: string = "cccccccc-0000-4000-8000-00000000000c";

interface Ran {
  result?: RunReturnType;
  error?: unknown;
  logs: Array<unknown>;
}

const step: GetAttachmentsFromRecord = new GetAttachmentsFromRecord(Services);

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

const RESULT: RecordAttachmentsResult = {
  files: [
    {
      name: "change-request.pdf",
      mimeType: MimeType.pdf,
      sizeInBytes: 5,
      base64: "JVBERi0=",
      contentId: "attachment-0123456789abcdef01234567",
      fields: ["attachments"],
    },
  ],
  leftOut: [
    {
      name: "diagram.svg",
      fields: ["attachments"],
      reason: AttachmentLeftOutReason.NotAllowed,
      message: "An SVG can carry script, so it is left out.",
    },
    {
      name: null,
      fields: ["Signed change request"],
      reason: AttachmentLeftOutReason.NotFound,
      message: "No file of this project the workflow may see has this id.",
    },
  ],
};

describe("the record types the step reads", () => {
  test("are exactly the ones the builder's Record Type list offers", () => {
    const offered: Array<string> = getAttachmentRecordTypes(
      Entities.map((modelType: { new (): BaseModel }): BaseModel => {
        return new modelType();
      }),
    )
      .map((model: BaseModel): string => {
        return model.tableName!;
      })
      .sort();

    expect(step.getRecordTypes()).toEqual(offered);
    // Incidents, alerts, maintenance, their notes, announcements, templates, teams...
    expect(offered.length).toBeGreaterThan(15);
  });

  test("a note, an incident and an announcement are among them; a record that holds no files is not", () => {
    const types: Array<string> = step.getRecordTypes();

    for (const tableName of [
      "Incident",
      "IncidentInternalNote",
      "IncidentPublicNote",
      "AlertInternalNote",
      "ScheduledMaintenancePublicNote",
      "StatusPageAnnouncement",
      "Alert",
    ]) {
      expect(types).toContain(tableName);
    }

    for (const tableName of ["File", "Project", "User", "IncidentFeed"]) {
      expect(types).not.toContain(tableName);
    }
  });

  test("the registry runs this step for its ID, from the catalog's own metadata", () => {
    const registered: unknown =
      Components[ComponentID.GetAttachmentsFromRecord];

    expect(registered).toBeInstanceOf(GetAttachmentsFromRecord);
    expect((registered as GetAttachmentsFromRecord).getMetadata()).toBe(
      RecordAttachmentsComponents[0],
    );
  });

  test("hide the files' data from the run's log, and nothing else", () => {
    const sensitive: Array<string> =
      RecordAttachmentsComponents[0]!.returnValues
        .filter((value: { isSensitive?: boolean | undefined }): boolean => {
          return value.isSensitive === true;
        })
        .map((value: { id: string }): string => {
          return value.id;
        });

    expect(sensitive).toEqual(["files"]);
  });

  test("takes its settings and gives its outputs as Get Files From Markdown does, with a list of its own", () => {
    const own: (typeof RecordAttachmentsComponents)[0] =
      RecordAttachmentsComponents[0]!;
    const sibling: (typeof MarkdownFilesComponents)[0] =
      MarkdownFilesComponents[0]!;

    const ids: (list: Array<{ id: string }>) => Array<string> = (
      list: Array<{ id: string }>,
    ): Array<string> => {
      return list.map((item: { id: string }): string => {
        return item.id;
      });
    };

    expect(ids(own.arguments)).toEqual(ids(sibling.arguments));
    expect(ids(own.returnValues)).toEqual(ids(sibling.returnValues));
    expect(ids(own.outPorts)).toEqual(ids(sibling.outPorts));
    expect(own.arguments[0]!.type).toBe(
      ComponentInputType.AttachmentRecordType,
    );
    expect(sibling.arguments[0]!.type).toBe(
      ComponentInputType.MarkdownRecordType,
    );
  });
});

describe("Get Attachments From Record, run", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the record as the workflow, in its project, never as root, and hands on what it found", async () => {
    let props: DatabaseCommonInteractionProps | undefined;
    let recordId: string | undefined;
    let tableName: string | undefined | null;

    getJestSpyOn(RecordAttachments, "readRecordAttachments").mockImplementation(
      (async (data: {
        props: DatabaseCommonInteractionProps;
        recordId: ObjectID;
        service: { getModel: () => BaseModel };
      }): Promise<RecordAttachmentsResult> => {
        props = data.props;
        recordId = data.recordId.toString();
        tableName = data.service.getModel().tableName;
        return RESULT;
      }) as never,
    );

    const ran: Ran = await run({
      recordType: "IncidentInternalNote",
      recordId: ` ${NOTE_ID.toUpperCase()} `,
    });

    expect(ran.error).toBeUndefined();
    expect(ran.result?.executePort?.id).toBe("success");
    expect(ran.result?.returnValues).toEqual({
      files: RESULT.files,
      count: 1,
      leftOut: RESULT.leftOut,
    });

    expect(tableName).toBe("IncidentInternalNote");
    expect(recordId).toBe(NOTE_ID);
    expect(props?.isRoot).toBeFalsy();
    expect(props?.userType).toBe(UserType.Workflow);
    expect(props?.tenantId?.toString()).toBe(PROJECT_ID.toString());

    expect(ran.logs).toContain(
      "Found 1 file the Incident Internal Note holds.",
    );
    expect(ran.logs).toContain(
      'Left out "diagram.svg": An SVG can carry script, so it is left out.',
    );
    expect(ran.logs).toContain(
      "Left out a file of Signed change request: No file of this project the workflow may see has this id.",
    );
  });

  test("says how many files, in the plural too", async () => {
    getJestSpyOn(RecordAttachments, "readRecordAttachments").mockResolvedValue({
      files: [RESULT.files[0]!, RESULT.files[0]!],
      leftOut: [],
    } as never);

    const ran: Ran = await run({ recordType: "Incident", recordId: NOTE_ID });

    expect(ran.logs).toContain("Found 2 files the Incident holds.");
    expect(ran.result?.returnValues["count"]).toBe(2);
  });

  test("a record that is not there for the workflow takes Error, with the reason, and hands on no file", async () => {
    getJestSpyOn(RecordAttachments, "readRecordAttachments").mockRejectedValue(
      new NotFoundException("Incident Internal Note not found.") as never,
    );

    const ran: Ran = await run({
      recordType: "IncidentInternalNote",
      recordId: NOTE_ID,
    });

    expect(ran.result?.executePort?.id).toBe("error");
    expect(ran.result?.executePortReason).toBe(
      "Incident Internal Note not found.",
    );
    expect(ran.result?.returnValues).toEqual({
      error: "Incident Internal Note not found.",
    });
  });

  test("a table the workflow may not read takes Error with the refusal", async () => {
    getJestSpyOn(RecordAttachments, "readRecordAttachments").mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to read Incident Internal Note.",
      ) as never,
    );

    const ran: Ran = await run({
      recordType: "IncidentInternalNote",
      recordId: NOTE_ID,
    });

    expect(ran.result?.executePort?.id).toBe("error");
    expect(ran.result?.executePortReason).toContain("Incident Internal Note");
    expect(ran.result?.returnValues["files"]).toBeUndefined();
  });

  test("a Record ID that is not an ID takes Error before anything is read", async () => {
    const read: jest.SpyInstance<any, any> = getJestSpyOn(
      RecordAttachments,
      "readRecordAttachments",
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

  test("an empty Record ID, or Record Type, or a Record Type that holds no files a workflow reads, stops the run", async () => {
    for (const [args, message] of [
      [
        { recordType: "Incident", recordId: "  " },
        "Record ID is empty. Pick the ID of the Incident with { }, or paste one.",
      ],
      [
        { recordType: "", recordId: NOTE_ID },
        "Record Type is empty. Pick the kind of record that holds the files.",
      ],
      [
        { recordType: "File", recordId: NOTE_ID },
        'Record Type "File" is not a kind of record that holds files. Pick one from the list.',
      ],
      [
        { recordType: "IncidentFeed", recordId: NOTE_ID },
        'Record Type "IncidentFeed" is not a kind of record that holds files. Pick one from the list.',
      ],
      [
        { recordType: 42, recordId: NOTE_ID },
        'Record Type "42" is not a kind of record that holds files. Pick one from the list.',
      ],
    ] as Array<[Record<string, unknown>, string]>) {
      const ran: Ran = await run(args);

      expect(ran.result).toBeUndefined();
      expect(ran.error).toBeInstanceOf(BadDataException);
      expect((ran.error as Error).message).toBe(message);
    }
  });
});
