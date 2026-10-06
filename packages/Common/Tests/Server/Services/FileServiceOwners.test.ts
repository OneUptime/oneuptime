import FileService from "../../../Server/Services/FileService";
import ProbeService from "../../../Server/Services/ProbeService";
import Probe from "../../../Models/DatabaseModels/Probe";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import { FileAccessFacts } from "../../../Server/Utils/File/RelatedFileAccess";
import {
  HIDE_UNSHOWN_FILES_SQL,
  PUBLISH_SHOWN_IMAGES_SQL,
} from "../../../Server/Utils/File/PublishedImages";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import File from "../../../Models/DatabaseModels/File";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * Who a file belongs to: the project it was uploaded in (File.projectId)
 * and the person who uploaded it (File.createdByUserId), both stamped by
 * FileService from the upload request and never from its body. What the
 * checks of FileOwnership read (getFileOwners), and how a probe's or an AI
 * agent's icon becomes public (makeRecordFilePublic): only a file of the
 * record's own project.
 *
 * No database: onBeforeCreate is called directly, and the repository is a
 * recording stand-in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f99",
);
const USER_ID: ObjectID = new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f04",
);
const FILE_ID: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000001");
const SECOND_FILE_ID: ObjectID = new ObjectID(
  "f1000000-0000-4000-8000-000000000002",
);

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

function upload(data: {
  props: DatabaseCommonInteractionProps;
  createdByUserId?: ObjectID | string | undefined;
}): CreateBy<File> {
  const file: File = new File();
  file.name = "logo.png";
  file.file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  file.fileType = MimeType.png;

  if (data.createdByUserId !== undefined) {
    (file as unknown as Record<string, unknown>)["createdByUserId"] =
      data.createdByUserId;
  }

  return { data: file, props: data.props } as CreateBy<File>;
}

async function stampedUploader(
  createBy: CreateBy<File>,
): Promise<ObjectID | null | undefined> {
  const result: OnCreate<File> = await onBeforeCreate(createBy);

  return result.createBy.data.createdByUserId as ObjectID | null | undefined;
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

describe("File.createdByUserId: who uploaded the file", () => {
  test("is the signed-in user making the upload", async () => {
    expect(
      String(
        await stampedUploader(
          upload({
            props: {
              userId: USER_ID,
              tenantId: PROJECT_ID,
              userType: UserType.User,
              ...PROJECT_ACCESS,
            },
          }),
        ),
      ),
    ).toBe(USER_ID.toString());
  });

  test("never what the request body says", async () => {
    for (const claimed of [OTHER_USER_ID, OTHER_USER_ID.toString()]) {
      expect(
        String(
          await stampedUploader(
            upload({
              props: {
                userId: USER_ID,
                tenantId: PROJECT_ID,
                ...PROJECT_ACCESS,
              },
              createdByUserId: claimed,
            }),
          ),
        ),
      ).toBe(USER_ID.toString());
    }
  });

  test("nobody for an API key's or the system's upload, whatever the body says", async () => {
    expect(
      await stampedUploader(
        upload({
          props: {
            tenantId: PROJECT_ID,
            userType: UserType.API,
            ...PROJECT_ACCESS,
          },
          createdByUserId: OTHER_USER_ID,
        }),
      ),
    ).toBeNull();

    expect(
      await stampedUploader(
        upload({ props: { isRoot: true }, createdByUserId: OTHER_USER_ID }),
      ),
    ).toBeNull();
  });

  test("is OneUptime's to write: the API can neither set, read nor change it", () => {
    const file: File = new File();

    expect(file.getColumnAccessControlFor("createdByUserId")).toEqual({
      create: [],
      read: [],
      update: [],
    });
    expect(file.getTableColumnMetadata("createdByUserId")).toMatchObject({
      computed: true,
      hideColumnInDocumentation: true,
    });
  });
});

/*
 * A recording stand-in for TypeORM's query builder: every call it was
 * given, and the rows it hands back.
 */
interface Recording {
  calls: Array<[string, Array<unknown>]>;
  createQueryBuilder: Mock<(alias: unknown) => unknown>;
}

function withRows(rows: Array<Record<string, unknown>>): Recording {
  const calls: Array<[string, Array<unknown>]> = [];
  const builder: Record<string, (...args: Array<unknown>) => unknown> = {};

  for (const method of ["select", "addSelect", "where", "andWhere"]) {
    builder[method] = (...args: Array<unknown>): unknown => {
      calls.push([method, args]);
      return builder;
    };
  }

  builder["getRawMany"] = async (): Promise<unknown> => {
    calls.push(["getRawMany", []]);
    return rows;
  };

  builder["getMany"] = async (): Promise<unknown> => {
    throw new Error("getFileOwners must never load whole Files");
  };

  const createQueryBuilder: Mock<(alias: unknown) => unknown> = jest.fn(
    (alias: unknown): unknown => {
      calls.push(["createQueryBuilder", [alias]]);
      return builder;
    },
  );

  jest.spyOn(FileService, "getRepository").mockReturnValue({
    createQueryBuilder,
  } as never);

  return { calls, createQueryBuilder };
}

describe("FileService.getFileOwners: who each file belongs to", () => {
  test("reads every file's project and uploader in one query - never the bytes", async () => {
    const recording: Recording = withRows([
      {
        _id: FILE_ID.toString(),
        projectId: PROJECT_ID.toString(),
        createdByUserId: USER_ID.toString(),
      },
      {
        _id: SECOND_FILE_ID.toString(),
        projectId: null,
        createdByUserId: null,
      },
    ]);

    const owners: Map<string, FileOwners> = await FileService.getFileOwners([
      new ObjectID(FILE_ID.toString().toUpperCase()),
      SECOND_FILE_ID,
      FILE_ID,
    ]);

    expect(recording.calls).toEqual([
      ["createQueryBuilder", ["file"]],
      ["select", ['"file"."_id"', "_id"]],
      ["addSelect", ['"file"."projectId"', "projectId"]],
      ["addSelect", ['"file"."createdByUserId"', "createdByUserId"]],
      [
        "where",
        [
          '"file"."_id" IN (:...ids)',
          { ids: [FILE_ID.toString(), SECOND_FILE_ID.toString()] },
        ],
      ],
      ["andWhere", ['"file"."deletedAt" IS NULL']],
      ["getRawMany", []],
    ]);

    expect(owners.get(FILE_ID.toString())).toEqual({
      projectId: PROJECT_ID,
      createdByUserId: USER_ID,
    });
    expect(owners.get(SECOND_FILE_ID.toString())).toEqual({
      projectId: null,
      createdByUserId: null,
    });

    for (const [, args] of recording.calls) {
      expect(String(args[0] ?? "")).not.toMatch(/"file"\."file"/);
    }
  });

  test("keys each file by its id in lower case", async () => {
    withRows([
      {
        _id: FILE_ID.toString().toUpperCase(),
        projectId: PROJECT_ID.toString(),
        createdByUserId: null,
      },
    ]);

    const owners: Map<string, FileOwners> = await FileService.getFileOwners([
      FILE_ID,
    ]);

    expect(Array.from(owners.keys())).toEqual([FILE_ID.toString()]);
  });

  test("leaves out a file that does not exist", async () => {
    withRows([]);

    expect((await FileService.getFileOwners([FILE_ID])).size).toBe(0);
  });

  test("reads an owner that is not an id as none", async () => {
    withRows([{ _id: FILE_ID.toString(), projectId: "", createdByUserId: 42 }]);

    expect(
      (await FileService.getFileOwners([FILE_ID])).get(FILE_ID.toString()),
    ).toEqual({ projectId: null, createdByUserId: null });
  });

  test("never asks Postgres about an id that is not one", async () => {
    const recording: Recording = withRows([]);

    expect(
      (
        await FileService.getFileOwners([
          new ObjectID("' OR 1=1 --"),
          new ObjectID(""),
          new ObjectID("../../etc/passwd"),
        ])
      ).size,
    ).toBe(0);
    expect(recording.createQueryBuilder).not.toHaveBeenCalled();

    await FileService.getFileOwners([]);
    expect(recording.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe("FileService.makeRecordFilePublic: only a record's own file becomes public", () => {
  type UpdateOneByIdMock = Mock<(...args: Array<unknown>) => unknown>;

  function stub(owners: Map<string, FileOwners>): {
    updateOneById: UpdateOneByIdMock;
    getFileOwners: Mock<(...args: Array<unknown>) => unknown>;
  } {
    const updateOneById: UpdateOneByIdMock = jest.fn(async () => {
      return undefined;
    });
    const getFileOwners: Mock<(...args: Array<unknown>) => unknown> = jest.fn(
      async () => {
        return owners;
      },
    );

    jest
      .spyOn(FileService, "updateOneById")
      .mockImplementation(updateOneById as never);
    jest
      .spyOn(FileService, "getFileOwners")
      .mockImplementation(getFileOwners as never);

    return { updateOneById, getFileOwners };
  }

  function madePublic(updateOneById: UpdateOneByIdMock): Array<string> {
    return updateOneById.mock.calls.map((call: Array<unknown>): string => {
      const update: { id: ObjectID; data: { isPublic?: boolean } } =
        call[0] as { id: ObjectID; data: { isPublic?: boolean } };

      expect(update.data).toEqual({ isPublic: true });

      return update.id.toString();
    });
  }

  test("makes a file of the record's own project public", async () => {
    const { updateOneById } = stub(
      new Map([
        [
          FILE_ID.toString(),
          { projectId: PROJECT_ID, createdByUserId: USER_ID },
        ],
      ]),
    );

    await FileService.makeRecordFilePublic({
      fileId: FILE_ID,
      projectId: PROJECT_ID,
    });

    expect(madePublic(updateOneById)).toEqual([FILE_ID.toString()]);
  });

  test("leaves a file of another project, of none, or none at all, as it is", async () => {
    for (const owners of [
      new Map([
        [
          FILE_ID.toString(),
          { projectId: OTHER_PROJECT_ID, createdByUserId: OTHER_USER_ID },
        ],
      ]),
      new Map([
        [FILE_ID.toString(), { projectId: null, createdByUserId: null }],
      ]),
      new Map(),
    ]) {
      const { updateOneById } = stub(owners as Map<string, FileOwners>);

      await FileService.makeRecordFilePublic({
        fileId: FILE_ID,
        projectId: PROJECT_ID,
      });

      expect(updateOneById).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    }
  });

  test("makes a record outside any project's file public, as only server admins write those", async () => {
    const { updateOneById, getFileOwners } = stub(new Map());

    await FileService.makeRecordFilePublic({
      fileId: FILE_ID,
      projectId: null,
    });

    expect(madePublic(updateOneById)).toEqual([FILE_ID.toString()]);
    expect(getFileOwners).not.toHaveBeenCalled();
  });

  test("does nothing for a record with no file", async () => {
    const { updateOneById, getFileOwners } = stub(new Map());

    await FileService.makeRecordFilePublic({
      fileId: undefined,
      projectId: PROJECT_ID,
    });
    await FileService.makeRecordFilePublic({ fileId: null, projectId: null });

    expect(updateOneById).not.toHaveBeenCalled();
    expect(getFileOwners).not.toHaveBeenCalled();
  });

  test("never fails the write that asked for it", async () => {
    jest
      .spyOn(FileService, "getFileOwners")
      .mockRejectedValue(new Error("db down") as never);

    await expect(
      FileService.makeRecordFilePublic({
        fileId: FILE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    jest.restoreAllMocks();

    jest
      .spyOn(FileService, "updateOneById")
      .mockRejectedValue(new Error("write failed") as never);

    await expect(
      FileService.makeRecordFilePublic({ fileId: FILE_ID, projectId: null }),
    ).resolves.toBeUndefined();
  });

  test("reads the owners of many records' files in one query, and makes each own file public once", async () => {
    const { updateOneById, getFileOwners } = stub(
      new Map([
        [
          FILE_ID.toString(),
          { projectId: PROJECT_ID, createdByUserId: USER_ID },
        ],
        [
          SECOND_FILE_ID.toString(),
          { projectId: OTHER_PROJECT_ID, createdByUserId: OTHER_USER_ID },
        ],
      ]),
    );

    await FileService.makeRecordFilesPublic([
      { fileId: FILE_ID, projectId: PROJECT_ID },
      // The same file twice is made public once.
      { fileId: FILE_ID, projectId: PROJECT_ID },
      // Another project's file stays as it is.
      { fileId: SECOND_FILE_ID, projectId: PROJECT_ID },
      // A record with no file is skipped.
      { fileId: null, projectId: PROJECT_ID },
    ]);

    expect(getFileOwners).toHaveBeenCalledTimes(1);
    expect(madePublic(updateOneById)).toEqual([FILE_ID.toString()]);
  });

  test("makes public the icon each written record holds now, read back as root", async () => {
    const { updateOneById } = stub(
      new Map([
        [
          FILE_ID.toString(),
          { projectId: PROJECT_ID, createdByUserId: USER_ID },
        ],
        [
          SECOND_FILE_ID.toString(),
          { projectId: OTHER_PROJECT_ID, createdByUserId: OTHER_USER_ID },
        ],
      ]),
    );

    const own: Probe = new Probe();
    own._id = "a0000000-0000-4000-8000-000000000001";
    own.projectId = PROJECT_ID;
    own.iconFileId = FILE_ID;

    const foreign: Probe = new Probe();
    foreign._id = "a0000000-0000-4000-8000-000000000002";
    foreign.projectId = PROJECT_ID;
    foreign.iconFileId = SECOND_FILE_ID;

    const findBy: Mock<(...args: Array<unknown>) => unknown> = jest.fn(
      async () => {
        return [own, foreign];
      },
    );

    jest.spyOn(ProbeService, "findBy").mockImplementation(findBy as never);

    await FileService.makeStoredIconsPublic({
      service: ProbeService,
      recordIds: [new ObjectID(own._id), new ObjectID(foreign._id)],
    });

    expect(madePublic(updateOneById)).toEqual([FILE_ID.toString()]);

    const read: {
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findBy.mock.calls[0]![0] as {
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      iconFileId: true,
    });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("reads nothing for a write that wrote no record", async () => {
    const findBy: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
    jest.spyOn(ProbeService, "findBy").mockImplementation(findBy as never);

    await FileService.makeStoredIconsPublic({
      service: ProbeService,
      recordIds: [],
    });

    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("FileService.getFileAccess: who may see each file", () => {
  test("reads every file's project, uploader and visibility in one query - never the bytes", async () => {
    const recording: Recording = withRows([
      {
        _id: FILE_ID.toString(),
        projectId: PROJECT_ID.toString(),
        createdByUserId: USER_ID.toString(),
        isPublic: false,
      },
      {
        _id: SECOND_FILE_ID.toString().toUpperCase(),
        projectId: null,
        createdByUserId: null,
        isPublic: true,
      },
    ]);

    const facts: Map<string, FileAccessFacts> = await FileService.getFileAccess(
      [new ObjectID(FILE_ID.toString().toUpperCase()), SECOND_FILE_ID, FILE_ID],
    );

    expect(recording.calls).toEqual([
      ["createQueryBuilder", ["file"]],
      ["select", ['"file"."_id"', "_id"]],
      ["addSelect", ['"file"."projectId"', "projectId"]],
      ["addSelect", ['"file"."createdByUserId"', "createdByUserId"]],
      ["addSelect", ['"file"."isPublic"', "isPublic"]],
      [
        "where",
        [
          '"file"."_id" IN (:...ids)',
          { ids: [FILE_ID.toString(), SECOND_FILE_ID.toString()] },
        ],
      ],
      ["andWhere", ['"file"."deletedAt" IS NULL']],
      ["getRawMany", []],
    ]);

    expect(facts.get(FILE_ID.toString())).toEqual({
      projectId: PROJECT_ID,
      createdByUserId: USER_ID,
      isPublic: false,
    });
    // Keyed in lower case, whatever case Postgres or the caller used.
    expect(facts.get(SECOND_FILE_ID.toString())).toEqual({
      projectId: null,
      createdByUserId: null,
      isPublic: true,
    });
  });

  test("reads only a real true as public", async () => {
    withRows([
      { _id: FILE_ID.toString(), projectId: null, isPublic: "true" },
      { _id: SECOND_FILE_ID.toString(), projectId: null, isPublic: null },
    ]);

    const facts: Map<string, FileAccessFacts> = await FileService.getFileAccess(
      [FILE_ID, SECOND_FILE_ID],
    );

    expect(facts.get(FILE_ID.toString())?.isPublic).toBe(false);
    expect(facts.get(SECOND_FILE_ID.toString())?.isPublic).toBe(false);
  });

  test("leaves out a file that does not exist, and never asks about an id that is not one", async () => {
    const recording: Recording = withRows([]);

    expect((await FileService.getFileAccess([FILE_ID])).size).toBe(0);

    recording.createQueryBuilder.mockClear();

    expect(
      (
        await FileService.getFileAccess([
          new ObjectID("' OR 1=1 --"),
          new ObjectID(""),
        ])
      ).size,
    ).toBe(0);
    expect(recording.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe("FileService.setVisibilityFromPublishedRecords: files from before the rule, once", () => {
  test("makes shown images public, then hides what nothing shows, and says how many moved", async () => {
    const query: Mock<(sql: string) => Promise<unknown>> = jest.fn(
      async (sql: string): Promise<unknown> => {
        // An UPDATE answers [rows, affected].
        return sql === PUBLISH_SHOWN_IMAGES_SQL ? [[], 3] : [[], 5];
      },
    );

    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    await expect(
      FileService.setVisibilityFromPublishedRecords(),
    ).resolves.toEqual({ madePublic: 3, madePrivate: 5 });

    expect(
      query.mock.calls.map((call: [string]): string => {
        return call[0];
      }),
    ).toEqual([PUBLISH_SHOWN_IMAGES_SQL, HIDE_UNSHOWN_FILES_SQL]);
  });

  test("an answer without a count reads as nothing moved", async () => {
    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<unknown> => {
          return [];
        },
      },
    } as never);

    await expect(
      FileService.setVisibilityFromPublishedRecords(),
    ).resolves.toEqual({ madePublic: 0, madePrivate: 0 });
  });
});
