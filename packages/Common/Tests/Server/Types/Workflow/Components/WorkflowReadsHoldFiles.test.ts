import { RunOptions, RunReturnType } from "../../../../../Server/Types/Workflow/ComponentCode";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import FileService from "../../../../../Server/Services/FileService";
import { FileAccessFacts } from "../../../../../Server/Utils/File/RelatedFileAccess";
import File from "../../../../../Models/DatabaseModels/File";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A WORKFLOW READS ONLY ITS OWN PROJECT'S FILES.
 *
 * The Find One, Find Many and model-event steps read a record for the
 * workflow's project, with the select its author wrote - the logo's bytes
 * included, if asked for. They read as OneUptime itself, so the read path's
 * own check of the caller does not apply; each hands back a record's file
 * only when the project may see it: a file of the project, or a public one
 * (RelatedFileAccess). A file of another project that a record saved before
 * records were held to their own files still names is left out.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RECORD_ID: string = "eeeeeeee-0000-4000-8000-000000000001";

const OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const FOREIGN_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const PUBLIC_FOREIGN_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";

const FILES: Record<string, FileAccessFacts> = {
  [OWN_FILE_ID]: {
    projectId: PROJECT_ID,
    createdByUserId: null,
    isPublic: false,
  },
  [FOREIGN_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: null,
    isPublic: false,
  },
  [PUBLIC_FOREIGN_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: null,
    isPublic: true,
  },
};

const LOGO_SELECT: JSONObject = {
  name: true,
  logoFile: { _id: true, file: true, name: true },
};

function options(): RunOptions {
  return {
    log: jest.fn() as unknown as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: jest.fn((exception: Exception): Exception => {
      return exception;
    }) as unknown as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

function file(fileId: string): File {
  const value: File = new File();
  value._id = fileId;
  value.name = "logo.png";
  value.file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  return value;
}

function statusPage(logoFileId: string): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = RECORD_ID;
  page.projectId = PROJECT_ID;
  page.name = "Status";
  page.logoFile = file(logoFileId);
  return page;
}

function logoIdOf(model: JSONObject | null | undefined): unknown {
  const logo: JSONObject | undefined = model?.["logoFile"] as
    | JSONObject
    | undefined;

  return logo?.["_id"];
}

beforeEach(() => {
  jest.spyOn(FileService, "getFileAccess").mockImplementation((async (
    fileIds: Array<ObjectID>,
  ): Promise<Map<string, FileAccessFacts>> => {
    const facts: Map<string, FileAccessFacts> = new Map();

    for (const fileId of fileIds) {
      const key: string = fileId.toString().toLowerCase();

      if (FILES[key]) {
        facts.set(key, FILES[key]!);
      }
    }

    return facts;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Find One", () => {
  test.each([
    [OWN_FILE_ID, OWN_FILE_ID],
    [PUBLIC_FOREIGN_FILE_ID, PUBLIC_FOREIGN_FILE_ID],
    [FOREIGN_FILE_ID, undefined],
  ])(
    "a logo %s comes back as %s",
    async (logoFileId: string, expected: string | undefined) => {
      const service: DatabaseService<StatusPage> =
        new DatabaseService<StatusPage>(StatusPage);
      jest
        .spyOn(service, "findOneBy")
        .mockResolvedValue(statusPage(logoFileId) as never);

      const result: RunReturnType = await new FindOneBaseModel<StatusPage>(
        service,
      ).run({ query: { _id: RECORD_ID }, select: LOGO_SELECT }, options());

      const model: JSONObject = result.returnValues["model"] as JSONObject;

      expect(result.executePort?.id).toBe("success");
      expect(model["name"]).toBe("Status");
      expect(logoIdOf(model)).toBe(expected);
    },
  );

  test("finds nothing as it always did", async () => {
    const service: DatabaseService<StatusPage> =
      new DatabaseService<StatusPage>(StatusPage);
    jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);

    const result: RunReturnType = await new FindOneBaseModel<StatusPage>(
      service,
    ).run({ query: { _id: RECORD_ID }, select: LOGO_SELECT }, options());

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["model"]).toBeNull();
  });
});

describe("Find Many", () => {
  test("every record keeps the project's files, and loses another project's", async () => {
    const service: DatabaseService<IncidentPublicNote> =
      new DatabaseService<IncidentPublicNote>(IncidentPublicNote);

    const note: IncidentPublicNote = new IncidentPublicNote();
    note._id = RECORD_ID;
    note.projectId = PROJECT_ID;
    note.note = "Fixed.";
    note.attachments = [
      file(OWN_FILE_ID),
      file(FOREIGN_FILE_ID),
      file(PUBLIC_FOREIGN_FILE_ID),
    ];

    jest.spyOn(service, "findBy").mockResolvedValue([note] as never);

    const result: RunReturnType = await new FindManyBaseModel<IncidentPublicNote>(
      service,
    ).run(
      {
        query: {},
        select: { note: true, attachments: { _id: true, file: true } },
        limit: 10,
        skip: 0,
      },
      options(),
    );

    const models: JSONArray = result.returnValues["models"] as JSONArray;

    expect(result.executePort?.id).toBe("success");
    expect(
      ((models[0] as JSONObject)["attachments"] as JSONArray).map(
        (attachment: unknown): unknown => {
          return (attachment as JSONObject)["_id"];
        },
      ),
    ).toEqual([OWN_FILE_ID, PUBLIC_FOREIGN_FILE_ID]);
  });
});

describe("the model-event triggers", () => {
  test("hand the record on with the project's logo, and without another project's", async () => {
    for (const [logoFileId, expected] of [
      [OWN_FILE_ID, OWN_FILE_ID],
      [FOREIGN_FILE_ID, undefined],
    ] as Array<[string, string | undefined]>) {
      const service: DatabaseService<StatusPage> =
        new DatabaseService<StatusPage>(StatusPage);
      jest
        .spyOn(service, "findOneById")
        .mockResolvedValue(statusPage(logoFileId) as never);

      const trigger: OnTriggerBaseModel<StatusPage> =
        new OnTriggerBaseModel<StatusPage>(service, "on-update");

      const result: RunReturnType = await trigger.run(
        { data: { _id: RECORD_ID }, select: LOGO_SELECT },
        options(),
      );

      expect(result.executePort?.id).toBe("success");
      expect(logoIdOf(result.returnValues["model"] as JSONObject)).toBe(
        expected,
      );
    }
  });
});
