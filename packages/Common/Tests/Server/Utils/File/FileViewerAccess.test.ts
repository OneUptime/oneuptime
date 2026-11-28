import UserMiddleware from "../../../../Server/Middleware/UserAuthorization";
import FileService from "../../../../Server/Services/FileService";
import UserService from "../../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import FileViewerAccess, {
  FILE_VIEWERS_SELECT,
  FileViewer,
  SERVED_FILE_SELECT,
  ViewableFile,
} from "../../../../Server/Utils/File/FileViewerAccess";
import PublishedImages from "../../../../Server/Utils/File/PublishedImages";
import ShownImageAccess from "../../../../Server/Utils/File/ShownImageAccess";
import File from "../../../../Models/DatabaseModels/File";
import MimeType from "../../../../Types/File/MimeType";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import SsoAuthorizationException from "../../../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../../../Types/Exception/TenantNotFoundException";
import JSONWebTokenData from "../../../../Types/JsonWebTokenData";
import ObjectID from "../../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * Who may read a stored file through the image routes (FileViewerAccess):
 * a public file anyone; a private file of a project the people who can open
 * that project and uploaded it, or may read a record of it that shows it
 * (#11478, ShownImageAccess); a private file with no project its uploader;
 * server admins every file. The routes themselves are driven end to end in
 * Tests/Server/API/FileImageRouteViewers.test.ts, and against Postgres in
 * Tests/Server/API/FileImageRecordAccessPostgres.test.ts; this pins each
 * rule on its own, and the edges a route never shows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("a0000000-0000-4000-8000-000000000001");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000002",
);

const REQUEST: ExpressRequest = {} as ExpressRequest;

const MEMBER: FileViewer = { userId: USER_ID, isMasterAdmin: false };
const ADMIN: FileViewer = { userId: OTHER_USER_ID, isMasterAdmin: true };

// isPublic typed loose, so a varchar-era string can be fed through too.
function file(
  data: Omit<Partial<ViewableFile>, "isPublic"> & { isPublic?: unknown },
): ViewableFile {
  return data as ViewableFile;
}

type PermissionLookup =
  typeof UserMiddleware.getUserTenantAccessPermissionWithTenantId;

function canOpenProject(
  answer: boolean | Error,
): ReturnType<typeof jest.spyOn> {
  return jest
    .spyOn(UserMiddleware, "getUserTenantAccessPermissionWithTenantId")
    .mockImplementation((async () => {
      if (answer instanceof Error) {
        throw answer;
      }

      return answer
        ? ({
            projectId: PROJECT_ID,
            permissions: [],
          } as unknown as UserTenantAccessPermission)
        : null;
    }) as PermissionLookup);
}

/*
 * Whether a record of the project shows the image to the person, as
 * ShownImageAccess would answer after reading the records as them.
 */
function shownByARecord(
  answer: boolean | Error,
): ReturnType<typeof jest.spyOn> {
  return jest
    .spyOn(ShownImageAccess, "isShownTo")
    .mockImplementation(async (): Promise<boolean> => {
      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    });
}

function signedInAs(decoded: Partial<JSONWebTokenData> | Error | null): void {
  jest
    .spyOn(UserMiddleware, "getAccessTokenFromExpressRequest")
    .mockReturnValue(decoded === null ? undefined : "a-token");

  jest
    .spyOn(JSONWebToken, "decode")
    .mockImplementation((): JSONWebTokenData => {
      if (decoded instanceof Error) {
        throw decoded;
      }

      return decoded as JSONWebTokenData;
    });
}

beforeEach(() => {
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  // A session that says master admin is one whose person still is one, unless a test says otherwise.
  jest.spyOn(UserService, "isUserMasterAdmin").mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FileViewerAccess.isPublic", () => {
  test("is true only for the boolean true", () => {
    expect(FileViewerAccess.isPublic({ isPublic: true })).toBe(true);

    for (const value of [false, "true", "false", 1, "1", null, undefined]) {
      expect({
        value,
        isPublic: FileViewerAccess.isPublic({ isPublic: value }),
      }).toEqual({
        value,
        isPublic: false,
      });
    }

    expect(FileViewerAccess.isPublic(null)).toBe(false);
    expect(FileViewerAccess.isPublic(undefined)).toBe(false);
  });
});

describe("FileViewerAccess.getViewer: the signed-in person an image request comes from", () => {
  test("nobody without a session", async () => {
    signedInAs(null);

    expect(await FileViewerAccess.getViewer(REQUEST)).toBeNull();
  });

  test("nobody when the session does not verify", async () => {
    signedInAs(new Error("AccessToken is invalid or expired"));

    expect(await FileViewerAccess.getViewer(REQUEST)).toBeNull();
  });

  test("nobody for a status page visitor's own session", async () => {
    signedInAs({ userId: USER_ID, statusPageId: ObjectID.generate() });

    expect(await FileViewerAccess.getViewer(REQUEST)).toBeNull();
  });

  test("nobody for a session with no user", async () => {
    signedInAs({});

    expect(await FileViewerAccess.getViewer(REQUEST)).toBeNull();
  });

  test("nobody for a blocked user", async () => {
    signedInAs({ userId: USER_ID, isMasterAdmin: true });
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(true);

    expect(await FileViewerAccess.getViewer(REQUEST)).toBeNull();
  });

  test("the user, a server admin only when the session says exactly so", async () => {
    signedInAs({ userId: USER_ID, isMasterAdmin: false });
    expect(await FileViewerAccess.getViewer(REQUEST)).toEqual({
      userId: USER_ID,
      isMasterAdmin: false,
    });

    signedInAs({ userId: USER_ID, isMasterAdmin: true });
    expect(await FileViewerAccess.getViewer(REQUEST)).toEqual({
      userId: USER_ID,
      isMasterAdmin: true,
    });

    signedInAs({
      userId: USER_ID,
      isMasterAdmin: "true" as unknown as boolean,
    });
    expect((await FileViewerAccess.getViewer(REQUEST))?.isMasterAdmin).toBe(
      false,
    );
  });

  /*
   * A server admin sees every private image. Someone whose master admin
   * access was removed sees, with the session they already hold, only what
   * the member they are may see.
   */
  test("the user, no server admin once their master admin access was removed", async () => {
    signedInAs({ userId: USER_ID, isMasterAdmin: true });
    jest.spyOn(UserService, "isUserMasterAdmin").mockResolvedValue(false);

    expect(await FileViewerAccess.getViewer(REQUEST)).toEqual({
      userId: USER_ID,
      isMasterAdmin: false,
    });
  });
});

describe("FileViewerAccess.mayViewPrivateFile", () => {
  test("a member who can open the file's project and uploaded it may; asked about that project", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(true);
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(false);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({
          isPublic: false,
          projectId: PROJECT_ID,
          createdByUserId: USER_ID,
        }),
      }),
    ).toBe(true);

    expect(lookup).toHaveBeenCalledWith({
      req: REQUEST,
      tenantId: PROJECT_ID,
      userId: USER_ID,
    });
    // Their own image: no record is read for it.
    expect(shown).not.toHaveBeenCalled();
  });

  test("a member who can open the project but did not upload it may only when a record of it shows them the image", async () => {
    canOpenProject(true);
    const image: ViewableFile = file({
      _id: "f0000000-0000-4000-8000-000000000009",
      isPublic: false,
      projectId: PROJECT_ID,
      createdByUserId: OTHER_USER_ID,
      imageAccessToken: "c4".repeat(32),
    });

    shownByARecord(false);
    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: image,
      }),
    ).toBe(false);

    jest.restoreAllMocks();
    canOpenProject(true);
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(true);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: image,
      }),
    ).toBe(true);

    // Asked as the person, in the file's project, with what they hold there.
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
      permission: { projectId: PROJECT_ID, permissions: [] },
      file: {
        fileId: "f0000000-0000-4000-8000-000000000009",
        token: "c4".repeat(32),
      },
    });
  });

  test("an image with no id or no token is no one's but its uploader's: no record is asked about", async () => {
    canOpenProject(true);
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(true);

    for (const image of [
      file({ isPublic: false, projectId: PROJECT_ID, imageAccessToken: "ab" }),
      file({
        _id: "f0000000-0000-4000-8000-000000000009",
        isPublic: false,
        projectId: PROJECT_ID,
      }),
      file({
        _id: "not-an-id",
        isPublic: false,
        projectId: PROJECT_ID,
        imageAccessToken: "ab",
      }),
    ]) {
      expect(
        await FileViewerAccess.mayViewPrivateFile({
          req: REQUEST,
          viewer: MEMBER,
          file: image,
        }),
      ).toBe(false);
    }

    expect(shown).not.toHaveBeenCalled();
  });

  test("a record lookup that fails is an error, not a decision", async () => {
    canOpenProject(true);
    shownByARecord(new Error("the records could not be read"));

    await expect(
      FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({
          _id: "f0000000-0000-4000-8000-000000000009",
          isPublic: false,
          projectId: PROJECT_ID,
          imageAccessToken: "ab",
        }),
      }),
    ).rejects.toThrow("the records could not be read");
  });

  test("someone who cannot open the project may not, and no record is asked about", async () => {
    canOpenProject(false);
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(true);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({
          _id: "f0000000-0000-4000-8000-000000000009",
          isPublic: false,
          projectId: PROJECT_ID,
          imageAccessToken: "ab",
        }),
      }),
    ).toBe(false);

    expect(shown).not.toHaveBeenCalled();
  });

  test("a project that requires SSO the request has not signed in with, or one that is gone, is a no", async () => {
    for (const refusal of [
      new SsoAuthorizationException(),
      new TenantNotFoundException("Invalid tenantId"),
    ]) {
      canOpenProject(refusal);

      expect(
        await FileViewerAccess.mayViewPrivateFile({
          req: REQUEST,
          viewer: MEMBER,
          file: file({ isPublic: false, projectId: PROJECT_ID }),
        }),
      ).toBe(false);

      jest.restoreAllMocks();
    }
  });

  test("a lookup that fails is an error, not a decision", async () => {
    canOpenProject(new Error("the database is unreachable"));

    await expect(
      FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false, projectId: PROJECT_ID }),
      }),
    ).rejects.toThrow("the database is unreachable");
  });

  test("a project id that is not one names no project anyone can open", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(true);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false, projectId: "not-a-project" }),
      }),
    ).toBe(false);

    expect(lookup).not.toHaveBeenCalled();
  });

  test("a file with no project is its uploader's alone", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(true);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false, createdByUserId: USER_ID }),
      }),
    ).toBe(true);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false, createdByUserId: OTHER_USER_ID }),
      }),
    ).toBe(false);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false }),
      }),
    ).toBe(false);

    // Its project membership never comes into it.
    expect(lookup).not.toHaveBeenCalled();
  });

  test("a file with a project is not its uploader's once they cannot open the project", async () => {
    canOpenProject(false);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({
          isPublic: false,
          projectId: PROJECT_ID,
          createdByUserId: USER_ID,
        }),
      }),
    ).toBe(false);
  });

  test("a server admin may see every file, without a membership lookup or a record read", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(false);
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(false);

    for (const owned of [
      file({ isPublic: false, projectId: PROJECT_ID }),
      file({ isPublic: false }),
    ]) {
      expect(
        await FileViewerAccess.mayViewPrivateFile({
          req: REQUEST,
          viewer: ADMIN,
          file: owned,
        }),
      ).toBe(true);
    }

    expect(lookup).not.toHaveBeenCalled();
    expect(shown).not.toHaveBeenCalled();
  });
});

describe("FileViewerAccess.mayViewInProject: a member who can open the file's project", () => {
  const PERMISSION: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    permissions: [],
  } as unknown as UserTenantAccessPermission;

  const IMAGE: ViewableFile = file({
    _id: "f0000000-0000-4000-8000-000000000009",
    isPublic: false,
    projectId: PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
    imageAccessToken: "c4".repeat(32),
  });

  test("its uploader sees it whatever records show it, as in a draft not saved to one yet", async () => {
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(false);

    expect(
      await FileViewerAccess.mayViewInProject({
        viewer: { userId: OTHER_USER_ID, isMasterAdmin: false },
        file: IMAGE,
        projectId: PROJECT_ID,
        permission: PERMISSION,
      }),
    ).toBe(true);
    expect(shown).not.toHaveBeenCalled();
  });

  test("anyone else as a record shows it to them", async () => {
    for (const answer of [true, false]) {
      shownByARecord(answer);

      expect(
        await FileViewerAccess.mayViewInProject({
          viewer: MEMBER,
          file: IMAGE,
          projectId: PROJECT_ID,
          permission: PERMISSION,
        }),
      ).toBe(answer);

      jest.restoreAllMocks();
    }
  });

  test("an image with no uploader recorded is decided by its records alone", async () => {
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(false);

    expect(
      await FileViewerAccess.mayViewInProject({
        viewer: MEMBER,
        file: { ...IMAGE, createdByUserId: null },
        projectId: PROJECT_ID,
        permission: PERMISSION,
      }),
    ).toBe(false);
    expect(shown).toHaveBeenCalledTimes(1);
  });

  test("the file's id is read in lower case, however the read wrote it", async () => {
    const shown: ReturnType<typeof jest.spyOn> = shownByARecord(true);

    await FileViewerAccess.mayViewInProject({
      viewer: MEMBER,
      file: { ...IMAGE, _id: "F0000000-0000-4000-8000-000000000009" },
      projectId: PROJECT_ID,
      permission: PERMISSION,
    });

    expect(
      (shown.mock.calls[0]![0] as { file: { fileId: string } }).file.fileId,
    ).toBe("f0000000-0000-4000-8000-000000000009");
  });
});

describe("FileViewerAccess.keepReadableFile: the access-token image route", () => {
  test("a public file is kept for anyone, without asking who is there", async () => {
    signedInAs(null);
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(false);
    const image: ViewableFile = file({ isPublic: true, projectId: PROJECT_ID });

    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).toBe(image);
    expect(lookup).not.toHaveBeenCalled();
  });

  test("a private file is kept only for someone who may see it", async () => {
    const image: ViewableFile = file({
      _id: "f0000000-0000-4000-8000-000000000009",
      isPublic: false,
      projectId: PROJECT_ID,
      imageAccessToken: "c4".repeat(32),
    });

    signedInAs(null);
    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).toBeUndefined();

    signedInAs({ userId: USER_ID });
    canOpenProject(false);
    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).toBeUndefined();

    // A member no record shows it to.
    jest.restoreAllMocks();
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    shownByARecord(false);
    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).toBeUndefined();

    // A member a record shows it to.
    jest.restoreAllMocks();
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    shownByARecord(true);
    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).toBe(image);
  });

  test("a record read that fails keeps nothing, and is logged rather than thrown", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    shownByARecord(new Error("the records could not be read"));

    await expect(
      FileViewerAccess.keepReadableFile({
        req: REQUEST,
        file: file({
          _id: "f0000000-0000-4000-8000-000000000009",
          isPublic: false,
          projectId: PROJECT_ID,
          imageAccessToken: "c4".repeat(32),
        }),
      }),
    ).resolves.toBeUndefined();
  });

  test("no file, nothing kept", async () => {
    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: null }),
    ).toBeUndefined();
  });
});

describe("FileViewerAccess.keepReadableFile when who may see a file cannot be found out", () => {
  const image: ViewableFile = file({ isPublic: false, projectId: PROJECT_ID });

  test("a failed membership lookup keeps nothing, and is logged rather than thrown", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(new Error("the database is unreachable"));

    await expect(
      FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).resolves.toBeUndefined();
  });

  test("a failed blocked-user lookup keeps nothing either", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    jest
      .spyOn(UserService, "isUserBlocked")
      .mockRejectedValue(new Error("the database is unreachable"));

    await expect(
      FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).resolves.toBeUndefined();
  });
});

describe("FileViewerAccess's reads: a public file whole at once, a private one only once it may be served", () => {
  const FILE_ID: string = "f0000000-0000-4000-8000-000000000001";
  const TOKEN: string = "a1".repeat(32);

  interface Read {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    // Whether the read came back with the file's bytes.
    gotBytes: boolean;
  }

  /*
   * One stored file, read as Postgres would: a query by token or id,
   * optionally only if public, and the bytes only when selected.
   * `flipsBeforeReads` turns isPublic over just before the reads it lists
   * (0 is the first), as a note published or unpublished between two reads
   * would.
   */
  function database(data: {
    isPublic: boolean;
    flipsBeforeReads?: Array<number>;
  }): Array<Read> {
    const reads: Array<Read> = [];
    let isPublic: boolean = data.isPublic;

    jest.spyOn(FileService, "findOneBy").mockImplementation((async (find: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => {
      if ((data.flipsBeforeReads || []).includes(reads.length)) {
        isPublic = !isPublic;
      }

      const matches: boolean =
        (find.query["imageAccessToken"] === undefined ||
          find.query["imageAccessToken"] === TOKEN) &&
        (find.query["_id"] === undefined ||
          String(find.query["_id"]) === FILE_ID) &&
        (find.query["isPublic"] === undefined ||
          find.query["isPublic"] === isPublic);

      reads.push({
        query: find.query,
        select: find.select,
        gotBytes: matches && Boolean(find.select["file"]),
      });

      if (!matches) {
        return null;
      }

      const row: File = new File();
      row._id = FILE_ID;
      row.projectId = PROJECT_ID;
      row.isPublic = isPublic;
      row.imageAccessToken = TOKEN;
      row.fileType = MimeType.png;

      if (find.select["file"]) {
        row.file = Buffer.from("image-bytes");
      }

      return row;
    }) as never);

    return reads;
  }

  test("deciding reads no bytes; serving reads them", () => {
    expect(FILE_VIEWERS_SELECT).toEqual({
      _id: true,
      isPublic: true,
      projectId: true,
      createdByUserId: true,
      // To ask whether a record has started showing it since.
      imageAccessToken: true,
    });
    expect(SERVED_FILE_SELECT).toMatchObject({
      file: true,
      fileType: true,
      isPublic: true,
    });
  });

  test("a public file: one read, whole, asking only for a public file", async () => {
    signedInAs(null);
    const reads: Array<Read> = database({ isPublic: true });

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(served?.file?.toString()).toBe("image-bytes");
    expect(reads).toEqual([
      {
        query: { imageAccessToken: TOKEN, isPublic: true },
        select: SERVED_FILE_SELECT,
        gotBytes: true,
      },
    ]);
  });

  test("a private file someone may not see: its owners are read, its bytes never", async () => {
    signedInAs(null);
    const reads: Array<Read> = database({ isPublic: false });

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      }),
    ).toBeUndefined();

    expect(reads).toEqual([
      {
        query: { imageAccessToken: TOKEN, isPublic: true },
        select: SERVED_FILE_SELECT,
        gotBytes: false,
      },
      {
        query: { imageAccessToken: TOKEN },
        select: FILE_VIEWERS_SELECT,
        gotBytes: false,
      },
    ]);
  });

  test("a private file a member may see: read whole, by its id, after the decision", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    shownByARecord(true);
    const reads: Array<Read> = database({ isPublic: false });

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(served?.file?.toString()).toBe("image-bytes");
    expect(
      reads.map((read: Read) => {
        return { query: read.query, gotBytes: read.gotBytes };
      }),
    ).toEqual([
      { query: { imageAccessToken: TOKEN, isPublic: true }, gotBytes: false },
      { query: { imageAccessToken: TOKEN }, gotBytes: false },
      { query: { _id: FILE_ID }, gotBytes: true },
    ]);
  });

  test("a file that was public when decided is read whole only if it still is", async () => {
    signedInAs(null);

    // Public when its owners are read, private again by the whole read.
    const reads: Array<Read> = database({
      isPublic: false,
      flipsBeforeReads: [1, 2],
    });

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      }),
    ).toBeUndefined();

    expect(reads[2]?.query).toEqual({ _id: FILE_ID, isPublic: true });
    expect(reads[2]?.gotBytes).toBe(false);
  });

  test("a file that was public when decided, and still is, is served", async () => {
    signedInAs(null);

    // Turned public between the first read and its owners read.
    const reads: Array<Read> = database({
      isPublic: false,
      flipsBeforeReads: [1],
    });

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(served?.file?.toString()).toBe("image-bytes");
    expect(reads[2]?.query).toEqual({ _id: FILE_ID, isPublic: true });
  });

  test("no file: nothing read whole", async () => {
    signedInAs(null);
    jest.spyOn(FileService, "findOneBy").mockResolvedValue(null as never);

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      }),
    ).toBeUndefined();
  });

  test("by id: only a public file is asked for", async () => {
    const reads: Array<Read> = database({ isPublic: true });

    expect(
      (await FileViewerAccess.findPublicFile(new ObjectID(FILE_ID)))?.file,
    ).toBeDefined();
    expect(reads).toEqual([
      {
        query: { _id: new ObjectID(FILE_ID), isPublic: true },
        select: SERVED_FILE_SELECT,
        gotBytes: true,
      },
    ]);
  });

  test("by id: a private file is never read whole", async () => {
    const reads: Array<Read> = database({ isPublic: false });

    expect(
      await FileViewerAccess.findPublicFile(new ObjectID(FILE_ID)),
    ).toBeUndefined();
    expect(
      reads.map((read: Read) => {
        return read.gotBytes;
      }),
    ).toEqual([false]);
  });
});

/*
 * An image a record starts showing with no write at that moment - an
 * announcement whose Start Showing Announcement At has come since it was
 * written - is private until the first request for it that the rules above
 * would refuse: that request asks PublishedImages.publishWhenShown, which
 * makes it public only while a record of its own project shows it, and then
 * it is served as any public image.
 */
describe("FileViewerAccess.findReadableFile: an image a record has started showing since", () => {
  const TOKEN: string = "ab".repeat(32);
  const FILE_ID: string = "f0000000-0000-4000-8000-000000000001";

  // The stored file: private until made public.
  let stored: { isPublic: boolean };
  let reads: Array<{ query: Record<string, unknown>; gotBytes: boolean }>;
  let publishWhenShown: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    stored = { isPublic: false };
    reads = [];

    jest.spyOn(FileService, "findOneBy").mockImplementation((async (find: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => {
      const matches: boolean =
        (find.query["imageAccessToken"] === undefined ||
          find.query["imageAccessToken"] === TOKEN) &&
        (find.query["_id"] === undefined ||
          String(find.query["_id"]) === FILE_ID) &&
        (find.query["isPublic"] === undefined ||
          find.query["isPublic"] === stored.isPublic);

      reads.push({
        query: find.query,
        gotBytes: matches && Boolean(find.select["file"]),
      });

      if (!matches) {
        return null;
      }

      const row: File = new File();
      row._id = FILE_ID;
      row.projectId = PROJECT_ID;
      row.isPublic = stored.isPublic;
      row.imageAccessToken = TOKEN;
      row.fileType = MimeType.png;

      if (find.select["file"]) {
        row.file = Buffer.from("image-bytes");
      }

      return row;
    }) as never);

    // Shown now, unless a test says otherwise: made public, as the statement does.
    publishWhenShown = jest
      .spyOn(PublishedImages, "publishWhenShown")
      .mockImplementation(async (): Promise<boolean> => {
        stored.isPublic = true;
        return true;
      });
  });

  test("shown now: made public by the first request that would be refused, then served whole as a public file", async () => {
    signedInAs(null);

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(served?.file?.toString()).toBe("image-bytes");
    expect(stored.isPublic).toBe(true);
    expect(reads).toEqual([
      { query: { imageAccessToken: TOKEN, isPublic: true }, gotBytes: false },
      { query: { imageAccessToken: TOKEN }, gotBytes: false },
      { query: { _id: FILE_ID, isPublic: true }, gotBytes: true },
    ]);
    // Public from then on: the next request is answered by the first read.
    expect(FileViewerAccess.isPublic(served)).toBe(true);
  });

  test("asks about the file as it was read: its id, its project and its token", async () => {
    signedInAs(null);

    await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(publishWhenShown).toHaveBeenCalledTimes(1);

    const asked: File = publishWhenShown.mock.calls[0]![0] as File;

    expect(String(asked._id)).toBe(FILE_ID);
    expect(String(asked.projectId)).toBe(PROJECT_ID.toString());
    expect(asked.imageAccessToken).toBe(TOKEN);
    expect(asked.isPublic).toBe(false);
  });

  test("not shown yet: answered as a missing file is, its bytes never read", async () => {
    signedInAs(null);
    publishWhenShown.mockResolvedValue(false);

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      }),
    ).toBeUndefined();
    expect(stored.isPublic).toBe(false);
    expect(
      reads.some((read: { gotBytes: boolean }): boolean => {
        return read.gotBytes;
      }),
    ).toBe(false);
  });

  test("a status page visitor, or someone signed in to another project, is asked about the same way", async () => {
    for (const session of [
      { userId: USER_ID, statusPageId: new ObjectID(FILE_ID) },
      { userId: OTHER_USER_ID },
    ]) {
      stored.isPublic = false;
      publishWhenShown.mockClear();
      signedInAs(session);
      canOpenProject(false);

      const served: File | undefined = await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      });

      expect(served?.file?.toString()).toBe("image-bytes");
      expect(publishWhenShown).toHaveBeenCalledTimes(1);
    }
  });

  test("a member who may see the private image is served it as it is: nothing is made public for them", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    shownByARecord(true);

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(served?.file?.toString()).toBe("image-bytes");
    expect(publishWhenShown).not.toHaveBeenCalled();
    expect(stored.isPublic).toBe(false);
  });

  test("a member no record shows it to is refused, then asked about as anyone is: an announcement may show it now", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    shownByARecord(false);

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });

    expect(publishWhenShown).toHaveBeenCalledTimes(1);
    expect(served?.file?.toString()).toBe("image-bytes");

    // Shown by nothing at all: refused.
    stored.isPublic = false;
    publishWhenShown.mockResolvedValue(false);

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      }),
    ).toBeUndefined();
  });

  test("a public image, or no image, asks nothing", async () => {
    signedInAs(null);
    stored.isPublic = true;

    await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: TOKEN },
    });
    await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: "cd".repeat(32) },
    });

    expect(publishWhenShown).not.toHaveBeenCalled();
  });

  test("made public, but private again by the whole read: nothing is served", async () => {
    signedInAs(null);
    publishWhenShown.mockResolvedValue(true);

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: TOKEN },
      }),
    ).toBeUndefined();
  });

  test("by id: never asked - only a public file is served by its id", async () => {
    await FileViewerAccess.findPublicFile(new ObjectID(FILE_ID));

    expect(publishWhenShown).not.toHaveBeenCalled();
  });
});

describe("FileViewerAccess.setCacheHeaders", () => {
  function headersFor(image: ViewableFile): Record<string, string> {
    const headers: Record<string, string> = {};
    const res: ExpressResponse = {
      set: (name: string, value: string): void => {
        headers[name] = value;
      },
    } as unknown as ExpressResponse;

    FileViewerAccess.setCacheHeaders(res, image);

    return headers;
  }

  test("a public file's answer is cached as it always was", () => {
    expect(headersFor(file({ isPublic: true }))).toEqual({});
  });

  test("a private file is kept by no cache between its viewer and OneUptime", () => {
    expect(headersFor(file({ isPublic: false }))).toEqual({
      "Cache-Control": "private, no-cache",
    });
  });
});
