import FileService, {
  Service as FileServiceClass,
  UPLOAD_OUTSIDE_PROJECT_MESSAGE,
} from "../../../Server/Services/FileService";
import File from "../../../Models/DatabaseModels/File";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnType from "../../../Types/Database/ColumnType";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
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
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { getMetadataArgsStorage } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT AN UPLOAD IS, WHATEVER THE REQUEST SAYS (FileService).
 *
 *   - It starts private. A file becomes public only when a record that
 *     shows it to everyone is published (a public note, an announcement, a
 *     probe's icon) - never because an upload asked, and never by default.
 *   - Its access token is one OneUptime generates.
 *   - It is uploaded in the request's project, and only by someone who can
 *     act in that project: a member with access to it, an API key of it, or
 *     a server admin. Anyone else's upload into it is refused.
 *
 * Driven through the real create path (FileService.create, with its hooks
 * and DatabaseService's checks); the repository is an in-memory stand-in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const CLIENT_TOKEN: string = "1".repeat(64);

function upload(
  values: { isPublic?: unknown; imageAccessToken?: string } = {},
): File {
  const file: File = new File();
  file.name = "screenshot.png";
  file.file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  file.fileType = MimeType.png;

  for (const [column, value] of Object.entries(values)) {
    (file as unknown as Record<string, unknown>)[column] = value;
  }

  return file;
}

function grant(): UserPermission {
  return {
    permission: Permission.ProjectMember,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  } as unknown as UserPermission;
}

// A person signed in, with access to the projects listed (accepted members).
function personProps(data: {
  tenantId?: ObjectID | undefined;
  memberOf: Array<ObjectID>;
}): DatabaseCommonInteractionProps {
  const tenantAccess: Record<string, unknown> = {};

  for (const projectId of data.memberOf) {
    if (data.tenantId && projectId.toString() === data.tenantId.toString()) {
      tenantAccess[projectId.toString()] = {
        projectId: projectId,
        permissions: [grant()],
        _type: "UserTenantAccessPermission",
      };
    }
  }

  return {
    userId: USER_ID,
    userType: UserType.User,
    ...(data.tenantId ? { tenantId: data.tenantId } : {}),
    userGlobalAccessPermission: {
      projectIds: data.memberOf,
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      _type: "UserGlobalAccessPermission",
    },
    ...(Object.keys(tenantAccess).length > 0
      ? { userTenantAccessPermission: tenantAccess }
      : {}),
  } as unknown as DatabaseCommonInteractionProps;
}

// An API key of PROJECT_ID: its project is the key's, whatever header it sent.
function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    userType: UserType.API,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [grant()],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// A server admin, member of no project.
function adminProps(tenantId: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
    tenantId: tenantId,
  } as unknown as DatabaseCommonInteractionProps;
}

let save: Mock<(entity: unknown) => Promise<unknown>>;

beforeEach(() => {
  save = jest.fn(async (entity: unknown): Promise<unknown> => {
    return entity;
  });

  getJestSpyOn(FileService, "getRepository").mockReturnValue({
    save: save,
  } as never);
  // The unique checks (slug, access token) find nothing taken.
  getJestSpyOn(FileService, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(FileService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(FileService, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function create(
  data: File,
  props: DatabaseCommonInteractionProps,
): Promise<File> {
  return await FileService.create({ data: data, props: props });
}

function saved(): Record<string, unknown> {
  expect(save).toHaveBeenCalledTimes(1);
  return save.mock.calls[0]![0] as Record<string, unknown>;
}

describe("an upload starts private", () => {
  test("from a member's session that says nothing about it", async () => {
    await create(
      upload(),
      personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
    );

    expect(saved()["isPublic"]).toBe(false);
  });

  test("whatever the request says - an upload never makes itself public", async () => {
    for (const isPublic of [true, "true", 1]) {
      save.mockClear();

      await create(
        upload({ isPublic }),
        personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
      );

      expect({ isPublic, saved: saved()["isPublic"] }).toEqual({
        isPublic,
        saved: false,
      });
    }
  });

  test("from an API key that leaves isPublic out", async () => {
    await create(upload(), apiKeyProps());

    expect(saved()["isPublic"]).toBe(false);
  });

  test("from an API key that asks for it public", async () => {
    await create(upload({ isPublic: true }), apiKeyProps());

    expect(saved()["isPublic"]).toBe(false);
  });

  test("a client that still sends isPublic: false keeps uploading", async () => {
    const result: File = await create(
      upload({ isPublic: false }),
      personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
    );

    expect(result.isPublic).toBe(false);
  });

  test("OneUptime's own code says what it means", async () => {
    await create(upload({ isPublic: true }), { isRoot: true });

    expect(saved()["isPublic"]).toBe(true);
  });

  test("a row written without the column starts private in the database too", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.propertyName === "isPublic" &&
            (candidate.target as unknown) === FileModel
          );
        },
      );

    expect(column?.options.type).toBe(ColumnType.Boolean);
    expect(column?.options.default).toBe(false);
  });

  test("isPublic is OneUptime's to set: readable, never written by a request", () => {
    const file: File = new File();

    expect(file.getColumnAccessControlFor("isPublic")).toEqual({
      create: [],
      read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
      update: [],
    });
    expect(file.getTableColumnMetadata("isPublic")).toMatchObject({
      computed: true,
      defaultValue: false,
    });
  });
});

describe("an upload's access token is one OneUptime generates", () => {
  test("for every upload", async () => {
    await create(
      upload(),
      personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
    );

    expect(String(saved()["imageAccessToken"])).toMatch(/^[a-f0-9]{64}$/);
  });

  test("never one the request chose", async () => {
    for (const props of [
      personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
      apiKeyProps(),
    ]) {
      save.mockClear();

      await create(upload({ imageAccessToken: CLIENT_TOKEN }), props);

      const token: string = String(saved()["imageAccessToken"]);

      expect(token).not.toBe(CLIENT_TOKEN);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("a different one for every upload", async () => {
    const props: DatabaseCommonInteractionProps = personProps({
      tenantId: PROJECT_ID,
      memberOf: [PROJECT_ID],
    });

    await create(upload(), props);
    await create(upload(), props);

    const tokens: Array<unknown> = save.mock.calls.map(
      (call: [unknown]): unknown => {
        return (call[0] as Record<string, unknown>)["imageAccessToken"];
      },
    );

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  test("is closed to every request, and generated rather than refused", () => {
    const file: File = new File();

    expect(file.getColumnAccessControlFor("imageAccessToken")).toEqual({
      create: [],
      read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
      update: [],
    });
    expect(file.getTableColumnMetadata("imageAccessToken")).toMatchObject({
      computed: true,
      unique: true,
    });
  });
});

describe("an upload goes only into a project the uploader can act in", () => {
  test("a member uploads into their project, which the file then belongs to", async () => {
    await create(
      upload(),
      personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
    );

    expect(String(saved()["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(saved()["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("someone outside the project named by the request is refused, and nothing is saved", async () => {
    for (const memberOf of [[OTHER_PROJECT_ID], []]) {
      let refusal: unknown = null;

      try {
        await create(
          upload(),
          personProps({ tenantId: PROJECT_ID, memberOf: memberOf }),
        );
      } catch (err) {
        refusal = err;
      }

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(UPLOAD_OUTSIDE_PROJECT_MESSAGE);
    }

    expect(save).not.toHaveBeenCalled();
  });

  test("an API key uploads into its own project", async () => {
    await create(upload(), apiKeyProps());

    expect(String(saved()["projectId"])).toBe(PROJECT_ID.toString());
    expect(saved()["createdByUserId"]).toBeNull();
  });

  test("a server admin uploads into any project", async () => {
    await create(upload(), adminProps(OTHER_PROJECT_ID));

    expect(String(saved()["projectId"])).toBe(OTHER_PROJECT_ID.toString());
  });

  test("an upload outside any project needs no membership, and belongs to no project", async () => {
    await create(upload(), personProps({ memberOf: [] }));

    expect(saved()["projectId"]).toBeNull();
    expect(String(saved()["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("an upload with no one signed in is asked to sign in first", async () => {
    let refusal: unknown = null;

    try {
      await create(upload(), {
        tenantId: PROJECT_ID,
        userType: UserType.Public,
      } as DatabaseCommonInteractionProps);
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(NotAuthenticatedException);
    expect(save).not.toHaveBeenCalled();
  });

  test("the refusal says what to do, in plain words", () => {
    expect(UPLOAD_OUTSIDE_PROJECT_MESSAGE).toBe(
      "You can upload files only to a project you are a member of.",
    );
  });
});

describe("FileService.assertMayUploadToProject", () => {
  test("lets through those who can act in the project", () => {
    for (const props of [
      personProps({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
      apiKeyProps(),
      adminProps(PROJECT_ID),
      { isRoot: true },
    ]) {
      expect(() => {
        FileServiceClass.assertMayUploadToProject({
          props,
          projectId: PROJECT_ID,
        });
      }).not.toThrow();
    }
  });

  test("refuses access held in another project", () => {
    expect(() => {
      FileServiceClass.assertMayUploadToProject({
        props: personProps({
          tenantId: OTHER_PROJECT_ID,
          memberOf: [OTHER_PROJECT_ID],
        }),
        projectId: PROJECT_ID,
      });
    }).toThrow(UPLOAD_OUTSIDE_PROJECT_MESSAGE);
  });
});
