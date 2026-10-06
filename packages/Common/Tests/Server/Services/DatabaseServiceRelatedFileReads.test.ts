import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import FileOwnership, {
  FileReferenceColumn,
} from "../../../Server/Utils/File/FileOwnership";
import { FileAccessFacts } from "../../../Server/Utils/File/RelatedFileAccess";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import File from "../../../Models/DatabaseModels/File";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import fs from "fs";
import path from "path";

jest.mock("../../../Server/Utils/Logger");

/*
 * A READ RETURNS A RECORD'S FILES ONLY TO PEOPLE WHO MAY SEE THEM
 * (DatabaseService, RelatedFileAccess).
 *
 * Every read made for a caller - the dashboard, the API, Terraform, the
 * mobile app - that selects one of a record's files beyond its id gets the
 * file only when the caller may see it: a file of a project the request may
 * open, a public file, a file they uploaded with no project, their own
 * picture. Any other file is left out of the record rather than the read
 * failing. OneUptime's own reads (root) and server admins read every file.
 *
 * The services are DatabaseService itself, with no hooks of their own, so
 * what is tested is DatabaseService's read path - including its permission
 * checks. No database: the repository answers with the rows given, and who
 * may see each file is answered from a table of files.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const FOREIGN_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const PUBLIC_FOREIGN_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";
// Uploaded before files recorded their project, by the member reading.
const MY_LEGACY_FILE_ID: string = "cccccccc-0000-4000-8000-000000000001";
// Uploaded before files recorded their project, by someone else.
const LEGACY_FILE_ID: string = "cccccccc-0000-4000-8000-000000000002";

const FILES: Record<string, FileAccessFacts> = {
  [OWN_FILE_ID]: {
    projectId: PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    isPublic: false,
  },
  [FOREIGN_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    isPublic: false,
  },
  [PUBLIC_FOREIGN_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    isPublic: true,
  },
  [MY_LEGACY_FILE_ID]: {
    projectId: null,
    createdByUserId: USER_ID,
    isPublic: false,
  },
  [LEGACY_FILE_ID]: {
    projectId: null,
    createdByUserId: null,
    isPublic: false,
  },
};

const LOGO_WITH_BYTES: Record<string, unknown> = {
  name: true,
  logoFile: { _id: true, file: true, fileType: true, name: true },
};

type GetFileAccessMock = Mock<
  (fileIds: Array<ObjectID>) => Promise<Map<string, FileAccessFacts>>
>;

let getFileAccess: GetFileAccessMock;

interface FakeRepository {
  find: Mock<(options: Record<string, unknown>) => Promise<Array<BaseModel>>>;
}

/*
 * A repository answering every find with `rows`, as TypeORM loads them:
 * each File relation a model instance with the columns the read asked for.
 */
function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel>,
): FakeRepository {
  const repository: FakeRepository = {
    find: jest.fn(async (): Promise<Array<BaseModel>> => {
      return rows;
    }),
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);

  return repository;
}

function userPermission(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

// A project owner of PROJECT_ID, signed in, on a plan that has every feature.
function memberProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [userPermission(Permission.ProjectOwner)],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

// An API key of PROJECT_ID allowed to read everything in it.
function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    userType: UserType.API,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [userPermission(Permission.ProjectOwner)],
        _type: "UserTenantAccessPermission",
      },
    },
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
  page._id = ObjectID.generate().toString();
  page.projectId = PROJECT_ID;
  page.name = "Status";
  page.logoFile = file(logoFileId);
  return page;
}

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

class UserReads extends DatabaseService<User> {
  public constructor() {
    super(User);
  }
}

async function readLogo(data: {
  logoFileId: string;
  props: DatabaseCommonInteractionProps;
  select?: Record<string, unknown>;
}): Promise<StatusPage> {
  const service: StatusPageReads = new StatusPageReads();
  useRepository(service as never, [statusPage(data.logoFileId)]);

  const page: StatusPage | null = await service.findOneBy({
    query: {},
    select: (data.select || LOGO_WITH_BYTES) as never,
    props: data.props,
  });

  expect(page).not.toBeNull();

  return page!;
}

beforeEach(() => {
  getFileAccess = jest.fn(
    async (fileIds: Array<ObjectID>): Promise<Map<string, FileAccessFacts>> => {
      const facts: Map<string, FileAccessFacts> = new Map();

      for (const fileId of fileIds) {
        const key: string = fileId.toString().toLowerCase();

        if (FILES[key]) {
          facts.set(key, FILES[key]!);
        }
      }

      return facts;
    },
  );

  jest
    .spyOn(FileService, "getFileAccess")
    .mockImplementation(getFileAccess as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project member reading their project's records", () => {
  test("gets the record's logo of the project, with its bytes", async () => {
    const page: StatusPage = await readLogo({
      logoFileId: OWN_FILE_ID,
      props: memberProps(),
    });

    expect(page.logoFile?._id).toBe(OWN_FILE_ID);
    expect(page.logoFile?.file).toBeDefined();
    expect(getFileAccess).toHaveBeenCalledTimes(1);
  });

  test("gets the record without a logo of another project, and the rest of it as it is", async () => {
    const page: StatusPage = await readLogo({
      logoFileId: FOREIGN_FILE_ID,
      props: memberProps(),
    });

    expect(page.logoFile).toBeUndefined();
    expect(page.name).toBe("Status");
  });

  test("gets a public file of another project: anyone may see it", async () => {
    const page: StatusPage = await readLogo({
      logoFileId: PUBLIC_FOREIGN_FILE_ID,
      props: memberProps(),
    });

    expect(page.logoFile?._id).toBe(PUBLIC_FOREIGN_FILE_ID);
  });

  test("gets a file with no project only when they uploaded it", async () => {
    expect(
      (await readLogo({ logoFileId: MY_LEGACY_FILE_ID, props: memberProps() }))
        .logoFile?._id,
    ).toBe(MY_LEGACY_FILE_ID);
    expect(
      (await readLogo({ logoFileId: LEGACY_FILE_ID, props: memberProps() }))
        .logoFile,
    ).toBeUndefined();
  });

  test("gets a note's attachments of the project, without those of another", async () => {
    const service: NoteReads = new NoteReads();
    const stored: IncidentPublicNote = new IncidentPublicNote();
    stored._id = ObjectID.generate().toString();
    stored.projectId = PROJECT_ID;
    stored.attachments = [
      file(OWN_FILE_ID),
      file(FOREIGN_FILE_ID),
      file(LEGACY_FILE_ID),
    ];
    useRepository(service as never, [stored]);

    const notes: Array<IncidentPublicNote> = await service.findBy({
      query: {},
      select: { attachments: { _id: true, name: true } } as never,
      limit: 10,
      skip: 0,
      props: memberProps(),
    });

    expect(
      (notes[0]!.attachments || []).map((attachment: File): string => {
        return String(attachment._id);
      }),
    ).toEqual([OWN_FILE_ID]);
  });
});

describe("an API key of the project", () => {
  test("gets its project's files, and not another project's", async () => {
    expect(
      (await readLogo({ logoFileId: OWN_FILE_ID, props: apiKeyProps() }))
        .logoFile?._id,
    ).toBe(OWN_FILE_ID);
    expect(
      (await readLogo({ logoFileId: FOREIGN_FILE_ID, props: apiKeyProps() }))
        .logoFile,
    ).toBeUndefined();
    // A key uploads nothing outside its project: no project-less file is its own.
    expect(
      (await readLogo({ logoFileId: MY_LEGACY_FILE_ID, props: apiKeyProps() }))
        .logoFile,
    ).toBeUndefined();
  });
});

describe("a person reading themselves", () => {
  test("gets their own picture, whatever project it was uploaded in, and no one else's", async () => {
    jest.spyOn(FileService, "getFileAccess").mockResolvedValue(
      new Map<string, FileAccessFacts>([
        [
          OWN_FILE_ID,
          {
            projectId: OTHER_PROJECT_ID,
            createdByUserId: USER_ID,
            isPublic: false,
          },
        ],
        [
          FOREIGN_FILE_ID,
          {
            projectId: OTHER_PROJECT_ID,
            createdByUserId: OTHER_USER_ID,
            isPublic: false,
          },
        ],
      ]) as never,
    );

    for (const [pictureId, expected] of [
      [OWN_FILE_ID, OWN_FILE_ID],
      [FOREIGN_FILE_ID, undefined],
    ] as Array<[string, string | undefined]>) {
      const service: UserReads = new UserReads();
      const me: User = new User();
      me._id = USER_ID.toString();
      me.profilePictureFile = file(pictureId);
      useRepository(service as never, [me]);

      const read: User | null = await service.findOneBy({
        query: {},
        select: { profilePictureFile: { _id: true, file: true } } as never,
        props: { userId: USER_ID },
      });

      expect(read?.profilePictureFile?._id).toBe(expected);
    }
  });
});

describe("OneUptime itself and server admins", () => {
  test("read every file, and nothing is looked up", async () => {
    expect(
      (await readLogo({ logoFileId: FOREIGN_FILE_ID, props: { isRoot: true } }))
        .logoFile?._id,
    ).toBe(FOREIGN_FILE_ID);
    expect(
      (
        await readLogo({
          logoFileId: FOREIGN_FILE_ID,
          props: { isMasterAdmin: true, userId: USER_ID },
        })
      ).logoFile?._id,
    ).toBe(FOREIGN_FILE_ID);
    expect(getFileAccess).not.toHaveBeenCalled();
  });
});

describe("a read that selects no file beyond its id", () => {
  test("is answered as it always was, and nothing is looked up", async () => {
    const page: StatusPage = await readLogo({
      logoFileId: FOREIGN_FILE_ID,
      props: memberProps(),
      select: { name: true, logoFile: true },
    });

    expect(page.name).toBe("Status");
    expect(getFileAccess).not.toHaveBeenCalled();
  });
});

/*
 * GUARD: every File column of every model, through the read path every
 * caller's read takes. A model given a File column later is covered with no
 * change here, and a read path that hands back a file without asking who
 * may see it fails here first.
 */
interface FileColumnCase {
  table: string;
  modelType: { new (): BaseModel };
  column: FileReferenceColumn;
}

const FILE_COLUMN_CASES: Array<FileColumnCase> = AllModelTypes.flatMap(
  (modelType: { new (): BaseModel }): Array<FileColumnCase> => {
    return FileOwnership.getFileReferenceColumns(new modelType()).map(
      (column: FileReferenceColumn): FileColumnCase => {
        return {
          table: new modelType().tableName || "",
          modelType: modelType,
          column: column,
        };
      },
    );
  },
);

describe("GUARD: every model's files reach a caller only when they may see them", () => {
  test("there are File columns to hold, in every model that has them", () => {
    expect(FILE_COLUMN_CASES.length).toBeGreaterThanOrEqual(19);
  });

  test.each(
    FILE_COLUMN_CASES.map((entry: FileColumnCase) => {
      return { ...entry, name: entry.column.relationColumn };
    }),
  )(
    "$table $name: the caller's own file is handed back, another project's is left out",
    async ({ modelType, column }: FileColumnCase) => {
      const isUser: boolean = new modelType().tableName === "User";

      // The record's own file, and one of another project.
      const own: File = file(OWN_FILE_ID);
      const foreign: File = file(FOREIGN_FILE_ID);

      const ownFacts: FileAccessFacts = isUser
        ? {
            projectId: OTHER_PROJECT_ID,
            createdByUserId: USER_ID,
            isPublic: false,
          }
        : { projectId: PROJECT_ID, createdByUserId: null, isPublic: false };

      jest.spyOn(FileService, "getFileAccess").mockResolvedValue(
        new Map<string, FileAccessFacts>([
          [OWN_FILE_ID, ownFacts],
          [FOREIGN_FILE_ID, FILES[FOREIGN_FILE_ID]!],
        ]) as never,
      );

      const rowWith: (value: File) => BaseModel = (value: File): BaseModel => {
        const row: BaseModel = new modelType();
        row._id = isUser ? USER_ID.toString() : ObjectID.generate().toString();

        if (!isUser) {
          (row as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;
        }

        (row as unknown as Record<string, unknown>)[column.relationColumn] =
          column.isList ? [value] : value;

        return row;
      };

      const service: DatabaseService<BaseModel> = new DatabaseService(
        modelType,
      );
      const repository: FakeRepository = useRepository(service, [
        rowWith(own),
        rowWith(foreign),
      ]);

      const rows: Array<BaseModel> = await service.findBy({
        query: {},
        select: {
          [column.relationColumn]: { _id: true, file: true, name: true },
        } as never,
        limit: 10,
        skip: 0,
        props: isUser ? { userId: USER_ID } : memberProps(),
      });

      // The relation was really asked of the database, bytes and all.
      expect(
        (repository.find.mock.calls[0]![0] as Record<string, unknown>)[
          "relations"
        ],
      ).toMatchObject({ [column.relationColumn]: true });

      const filesOf: (row: BaseModel) => Array<string> = (
        row: BaseModel,
      ): Array<string> => {
        const value: unknown = (row as unknown as Record<string, unknown>)[
          column.relationColumn
        ];

        return (Array.isArray(value) ? value : value ? [value] : []).map(
          (entry: unknown): string => {
            return String((entry as File)._id);
          },
        );
      };

      expect(rows.map(filesOf)).toEqual([[OWN_FILE_ID], []]);
    },
  );
});

/*
 * GUARD: no read path around DatabaseService's. The check above lives in
 * DatabaseService's one read path; a service of a model with File columns
 * that answered reads on its own - overriding the finds, or querying its
 * repository - would hand files back unchecked. And the workflow steps
 * that read records as OneUptime itself, with a select their author wrote,
 * hold the files they read to the workflow's project.
 */
describe("GUARD: every read of a record's files goes through the check", () => {
  const SERVICES_DIR: string = path.resolve(
    __dirname,
    "../../../Server/Services",
  );
  const WORKFLOW_DIR: string = path.resolve(
    __dirname,
    "../../../Server/Types/Workflow/Components/BaseModel",
  );

  const tablesWithFiles: Array<string> = Array.from(
    new Set<string>(
      FILE_COLUMN_CASES.map((entry: FileColumnCase): string => {
        return entry.table;
      }),
    ),
  ).sort();

  test.each(tablesWithFiles)(
    "%sService answers reads only through DatabaseService",
    (table: string) => {
      const servicePath: string = path.join(SERVICES_DIR, `${table}Service.ts`);

      expect(fs.existsSync(servicePath)).toBe(true);

      const source: string = fs.readFileSync(servicePath, "utf8");

      for (const pattern of [
        /override\s+async\s+(findBy|findOneBy|findOneById|findAllBy)\s*\(/,
        /getRepository\(\)\s*\.\s*(find|findOne|findBy|findOneBy|createQueryBuilder)\s*\(/,
      ]) {
        expect({ table, match: source.match(pattern)?.[0] || null }).toEqual({
          table,
          match: null,
        });
      }
    },
  );

  test("DatabaseService checks the files of every read made for a caller", () => {
    const source: string = fs.readFileSync(
      path.join(SERVICES_DIR, "DatabaseService.ts"),
      "utf8",
    );

    expect(source).toContain(
      "const fileReader: RelatedFileReader | null = RelatedFileAccess.getReader(",
    );
    expect(source).toContain("await RelatedFileAccess.keepReadableFiles({");
  });

  test.each(["FindOneBaseModel", "FindManyBaseModel", "OnTriggerBaseModel"])(
    "the workflow step %s holds what it reads to the workflow's project",
    (component: string) => {
      const source: string = fs.readFileSync(
        path.join(WORKFLOW_DIR, `${component}.ts`),
        "utf8",
      );

      expect(source).toContain("await RelatedFileAccess.keepReadableFiles({");
      expect(source).toContain(
        "reader: RelatedFileAccess.getProjectReader(options.projectId),",
      );
    },
  );
});
