import { afterEach, describe, expect, jest, test } from "@jest/globals";
import FileService, { FileFacts } from "../../../Server/Services/FileService";
import File from "../../../Models/DatabaseModels/File";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * The project a file was uploaded in (File.projectId), and what a caller
 * deciding whether a file may be used somewhere is told about it
 * (FileService.getFileFacts). Files have no owner otherwise; this is what
 * lets a form refuse a logo or favicon uploaded in another project, so the
 * form's anonymous public page can never be used to read some other
 * project's file by its id (FormService, FormBranding).
 *
 *   - the project is always the request's - the dashboard's tenant, an API
 *     key's project - never what the request body says, and none without
 *     one;
 *   - the facts are a file's type, size and project, measured in Postgres:
 *     the bytes are never loaded, and an id that is not one never reaches
 *     the database.
 *
 * No database: onBeforeCreate is called directly, and the query builder is
 * a recording stand-in.
 */

type OnBeforeCreateFunction = (
  createBy: CreateBy<File>,
) => Promise<OnCreate<File>>;

const onBeforeCreate: OnBeforeCreateFunction = (
  createBy: CreateBy<File>,
): Promise<OnCreate<File>> => {
  return (
    FileService as unknown as { onBeforeCreate: OnBeforeCreateFunction }
  ).onBeforeCreate(createBy);
};

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f99",
);
const FILE_ID: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000001");

function upload(data: {
  props: DatabaseCommonInteractionProps;
  projectId?: ObjectID | string | undefined;
}): CreateBy<File> {
  const file: File = new File();
  file.name = "logo.png";
  file.file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  file.fileType = MimeType.png;

  if (data.projectId !== undefined) {
    (file as unknown as Record<string, unknown>)["projectId"] = data.projectId;
  }

  return { data: file, props: data.props } as CreateBy<File>;
}

async function stampedProject(
  createBy: CreateBy<File>,
): Promise<ObjectID | null | undefined> {
  const result: OnCreate<File> = await onBeforeCreate(createBy);

  return result.createBy.data.projectId as ObjectID | null | undefined;
}

/*
 * Access to PROJECT_ID, as the request was resolved with for a member or an
 * API key of it: an upload goes only into a project its uploader can act in.
 */
const PROJECT_ACCESS: Partial<DatabaseCommonInteractionProps> = {
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      permissions: [],
    },
  },
} as unknown as Partial<DatabaseCommonInteractionProps>;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("File.projectId: the project a file was uploaded in", () => {
  test("is the request's project", async () => {
    expect(
      String(
        await stampedProject(
          upload({
            props: {
              userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03"),
              tenantId: PROJECT_ID,
              ...PROJECT_ACCESS,
            },
          }),
        ),
      ),
    ).toBe(PROJECT_ID.toString());
  });

  test("never what the request body says", async () => {
    for (const claimed of [OTHER_PROJECT_ID, OTHER_PROJECT_ID.toString()]) {
      expect(
        String(
          await stampedProject(
            upload({
              props: { tenantId: PROJECT_ID, ...PROJECT_ACCESS },
              projectId: claimed,
            }),
          ),
        ),
      ).toBe(PROJECT_ID.toString());
    }
  });

  test("none for a file uploaded with no project, whatever the body says", async () => {
    expect(
      await stampedProject(upload({ props: { isRoot: true } })),
    ).toBeNull();
    expect(
      await stampedProject(
        upload({ props: { isRoot: true }, projectId: OTHER_PROJECT_ID }),
      ),
    ).toBeNull();
  });

  /*
   * The stamp is written before the create's permission check reads the
   * columns it was given, so the column must be one every uploader may
   * create - or every upload would be refused.
   */
  test("does not cost a member's or an API key's upload its permission to create", async () => {
    const tenantPermissions: Array<UserPermission> = [
      Permission.CurrentUser,
      Permission.UnAuthorizedSsoUser,
    ].map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as unknown as UserPermission;
    });

    const caller: (
      userType: UserType,
      globalPermissions: Array<Permission>,
    ) => DatabaseCommonInteractionProps = (
      userType: UserType,
      globalPermissions: Array<Permission>,
    ): DatabaseCommonInteractionProps => {
      return {
        tenantId: PROJECT_ID,
        userType: userType,
        ...(userType === UserType.User
          ? { userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03") }
          : {}),
        userGlobalAccessPermission: {
          projectIds: [PROJECT_ID],
          globalPermissions: globalPermissions,
        },
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            projectId: PROJECT_ID,
            permissions: tenantPermissions,
            isBlockPermission: false,
          },
        },
      } as unknown as DatabaseCommonInteractionProps;
    };

    for (const props of [
      // A member's session.
      caller(UserType.User, [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ]),
      // An API key of the project.
      caller(UserType.API, [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ]),
    ]) {
      const result: OnCreate<File> = await onBeforeCreate(upload({ props }));

      expect(String(result.createBy.data.projectId)).toBe(
        PROJECT_ID.toString(),
      );
      expect(() => {
        return CreatePermission.checkCreatePermissions(
          File,
          result.createBy.data,
          props,
        );
      }).not.toThrow();
    }
  });

  test("is OneUptime's to write: the API can neither set, read nor change it", () => {
    const file: File = new File();
    const access: {
      create: Array<string>;
      read: Array<string>;
      update: Array<string>;
    } = file.getColumnAccessControlFor("projectId") as never;

    expect(access).toEqual({ create: [], read: [], update: [] });
    // Computed, as a password's salt is, and kept out of the API reference.
    expect(file.getTableColumnMetadata("projectId")).toMatchObject({
      computed: true,
      hideColumnInDocumentation: true,
    });
  });
});

/*
 * A recording stand-in for TypeORM's query builder: every call it was
 * given, and the row it hands back.
 */
interface RecordingQueryBuilder {
  calls: Array<[string, Array<unknown>]>;
  builder: Record<string, (...args: Array<unknown>) => unknown>;
}

function recordingQueryBuilder(row: unknown): RecordingQueryBuilder {
  const calls: Array<[string, Array<unknown>]> = [];
  const builder: Record<string, (...args: Array<unknown>) => unknown> = {};

  for (const method of ["select", "addSelect", "where", "andWhere"]) {
    builder[method] = (...args: Array<unknown>): unknown => {
      calls.push([method, args]);
      return builder;
    };
  }

  builder["getRawOne"] = async (): Promise<unknown> => {
    calls.push(["getRawOne", []]);
    return row;
  };

  builder["getOne"] = async (): Promise<unknown> => {
    throw new Error("getFileFacts must never load a whole File");
  };

  return { calls, builder };
}

function withRow(row: unknown): {
  recording: RecordingQueryBuilder;
  createQueryBuilder: ReturnType<typeof jest.fn>;
} {
  const recording: RecordingQueryBuilder = recordingQueryBuilder(row);
  const createQueryBuilder: ReturnType<typeof jest.fn> = jest.fn(
    (alias: unknown): unknown => {
      recording.calls.push(["createQueryBuilder", [alias]]);
      return recording.builder;
    },
  );

  jest.spyOn(FileService, "getRepository").mockReturnValue({
    createQueryBuilder,
  } as never);

  return { recording, createQueryBuilder };
}

describe("FileService.getFileFacts: a file's type, size and project", () => {
  test("measured in Postgres, for a live file of that id - never its bytes", async () => {
    const { recording } = withRow({
      fileType: "image/png",
      size: 2048,
      projectId: PROJECT_ID.toString(),
    });

    const facts: FileFacts | null = await FileService.getFileFacts(FILE_ID);

    expect(facts).toEqual({
      fileType: "image/png",
      size: 2048,
      projectId: PROJECT_ID,
    });
    expect(recording.calls).toEqual([
      ["createQueryBuilder", ["file"]],
      ["select", ['"file"."fileType"', "fileType"]],
      ["addSelect", ['octet_length("file"."file")', "size"]],
      ["addSelect", ['"file"."projectId"', "projectId"]],
      ["where", ['"file"."_id" = :id', { id: FILE_ID.toString() }]],
      ["andWhere", ['"file"."deletedAt" IS NULL']],
      ["getRawOne", []],
    ]);

    // Nothing selects the bytes themselves.
    for (const [, args] of recording.calls) {
      expect(String(args[0] ?? "")).not.toMatch(/^"file"\."file"$/);
    }
  });

  test("a size Postgres hands back as text is still a number", async () => {
    withRow({ fileType: "image/png", size: "2048", projectId: null });

    expect((await FileService.getFileFacts(FILE_ID))?.size).toBe(2048);
  });

  test("a file uploaded with no project, or before files recorded one, has none", async () => {
    for (const projectId of [null, undefined, "", "not-a-uuid", 42]) {
      withRow({ fileType: "image/png", size: 10, projectId });

      expect((await FileService.getFileFacts(FILE_ID))?.projectId).toBeNull();

      jest.restoreAllMocks();
    }
  });

  test("a file with no bytes, or no type, says so rather than guessing", async () => {
    withRow({ fileType: null, size: null, projectId: PROJECT_ID.toString() });

    expect(await FileService.getFileFacts(FILE_ID)).toEqual({
      fileType: "",
      size: 0,
      projectId: PROJECT_ID,
    });
  });

  test("null when there is no such file (or it was deleted)", async () => {
    withRow(undefined);

    expect(await FileService.getFileFacts(FILE_ID)).toBeNull();
  });

  test("null for an id that is not one, without asking Postgres", async () => {
    const { createQueryBuilder } = withRow({
      fileType: "image/png",
      size: 10,
      projectId: PROJECT_ID.toString(),
    });

    for (const id of [
      "../../etc/passwd",
      "' OR 1=1 --",
      "",
      "f1000000-0000-4000-8000-00000000000",
    ]) {
      expect(await FileService.getFileFacts(new ObjectID(id))).toBeNull();
    }

    expect(createQueryBuilder).not.toHaveBeenCalled();
  });
});
