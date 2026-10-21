import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import FileService from "../../../../../Server/Services/FileService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import { FileAccessFacts } from "../../../../../Server/Utils/File/RelatedFileAccess";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../../../Models/DatabaseModels/File";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A WORKFLOW READS ONLY ITS OWN PROJECT'S FILES.
 *
 * The Find One, Find Many and model-event steps read a record for the
 * workflow's project, with the select its author wrote - the logo's bytes
 * included, if asked for. They read as a Project Admin of that project
 * (WorkflowPrincipal), so DatabaseService's own check of every read made for
 * someone applies: a record's file comes back only when the project may see
 * it - a file of the project, or a public one (RelatedFileAccess). A file of
 * another project that a record saved before records were held to their own
 * files still names is left out.
 *
 * The steps run over DatabaseService's real read path - its permission and
 * tenant checks included. No database: the repository answers with the rows
 * given, and who may see each file is answered from a table of files.
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

type FindMock = Mock<
  (options: Record<string, unknown>) => Promise<Array<BaseModel>>
>;

class StatusPageReads extends DatabaseService<StatusPage> {
  public constructor() {
    super(StatusPage);
  }
}

class NoteReads extends DatabaseService<IncidentPublicNote> {
  public constructor() {
    super(IncidentPublicNote);
  }
}

/*
 * A repository answering every find with `rows`, as TypeORM loads them: each
 * File relation a model instance with the columns the read asked for.
 */
function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel>,
): FindMock {
  const find: FindMock = jest.fn(async (): Promise<Array<BaseModel>> => {
    return rows;
  });

  getJestSpyOn(service, "getRepository").mockReturnValue({ find } as never);

  return find;
}

function options(): RunOptions {
  return {
    log: jest.fn() as unknown as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Copy the status page logo",
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

/*
 * The tenant every find was scoped to, as the read path wrote its query: a
 * raw match on the project id, carried as its parameter.
 */
function tenantsOf(find: FindMock): Array<string> {
  return find.mock.calls.map((call: [Record<string, unknown>]): string => {
    const where: Record<string, unknown> = call[0]["where"] as Record<
      string,
      unknown
    >;
    const tenant: { _objectLiteralParameters?: Record<string, unknown> } =
      where["projectId"] as {
        _objectLiteralParameters?: Record<string, unknown>;
      };

    return Object.values(tenant._objectLiteralParameters || {})
      .map(String)
      .join(",");
  });
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

  // The project's plan, which a step's props carry (WorkflowPrincipal).
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
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
      const service: StatusPageReads = new StatusPageReads();
      const find: FindMock = useRepository(service as never, [
        statusPage(logoFileId),
      ]);

      const result: RunReturnType = await new FindOneBaseModel<StatusPage>(
        service,
      ).run({ query: { _id: RECORD_ID }, select: LOGO_SELECT }, options());

      const model: JSONObject = result.returnValues["model"] as JSONObject;

      expect(result.executePort?.id).toBe("success");
      expect(model["name"]).toBe("Status");
      expect(logoIdOf(model)).toBe(expected);
      expect(tenantsOf(find)).toEqual([PROJECT_ID.toString()]);
    },
  );

  test("finds nothing as it always did", async () => {
    const service: StatusPageReads = new StatusPageReads();
    useRepository(service as never, []);

    const result: RunReturnType = await new FindOneBaseModel<StatusPage>(
      service,
    ).run({ query: { _id: RECORD_ID }, select: LOGO_SELECT }, options());

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["model"]).toBeNull();
  });
});

describe("Find Many", () => {
  test("every record keeps the project's files, and loses another project's", async () => {
    const service: NoteReads = new NoteReads();

    const note: IncidentPublicNote = new IncidentPublicNote();
    note._id = RECORD_ID;
    note.projectId = PROJECT_ID;
    note.note = "Fixed.";
    note.attachments = [
      file(OWN_FILE_ID),
      file(FOREIGN_FILE_ID),
      file(PUBLIC_FOREIGN_FILE_ID),
    ];

    const find: FindMock = useRepository(service as never, [note]);

    const result: RunReturnType =
      await new FindManyBaseModel<IncidentPublicNote>(service).run(
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
    expect(tenantsOf(find)).toEqual([PROJECT_ID.toString()]);
  });
});

describe("the model-event triggers", () => {
  test("hand the record on with the project's logo, and without another project's", async () => {
    for (const [logoFileId, expected] of [
      [OWN_FILE_ID, OWN_FILE_ID],
      [FOREIGN_FILE_ID, undefined],
    ] as Array<[string, string | undefined]>) {
      const service: StatusPageReads = new StatusPageReads();
      const find: FindMock = useRepository(service as never, [
        statusPage(logoFileId),
      ]);

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
      expect(tenantsOf(find)).toEqual([PROJECT_ID.toString()]);
    }
  });
});
