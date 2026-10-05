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
 * that project; a private file with no project its uploader; server admins
 * every file. The routes themselves are driven end to end in
 * Tests/Server/API/FileImageRouteViewers.test.ts; this pins each rule on
 * its own, and the edges a route never shows.
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

describe("FileViewerAccess.keepPublicFile: the id-based image route", () => {
  test("keeps a public file", () => {
    const icon: ViewableFile = file({ isPublic: true, projectId: PROJECT_ID });

    expect(FileViewerAccess.keepPublicFile(icon)).toBe(icon);
  });

  test("drops a private file, or none", () => {
    expect(
      FileViewerAccess.keepPublicFile(file({ isPublic: false })),
    ).toBeUndefined();
    expect(
      FileViewerAccess.keepPublicFile(file({ isPublic: "true" })),
    ).toBeUndefined();
    expect(FileViewerAccess.keepPublicFile(null)).toBeUndefined();
    expect(FileViewerAccess.keepPublicFile(undefined)).toBeUndefined();
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
});

describe("FileViewerAccess.mayViewPrivateFile", () => {
  test("a member who can open the file's project may; asked about that project", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(true);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false, projectId: PROJECT_ID }),
      }),
    ).toBe(true);

    expect(lookup).toHaveBeenCalledWith({
      req: REQUEST,
      tenantId: PROJECT_ID,
      userId: USER_ID,
    });
  });

  test("someone who cannot open the project may not", async () => {
    canOpenProject(false);

    expect(
      await FileViewerAccess.mayViewPrivateFile({
        req: REQUEST,
        viewer: MEMBER,
        file: file({ isPublic: false, projectId: PROJECT_ID }),
      }),
    ).toBe(false);
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

  test("a server admin may see every file, without a membership lookup", async () => {
    const lookup: ReturnType<typeof jest.spyOn> = canOpenProject(false);

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
      isPublic: false,
      projectId: PROJECT_ID,
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

    jest.restoreAllMocks();
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    expect(
      await FileViewerAccess.keepReadableFile({ req: REQUEST, file: image }),
    ).toBe(image);
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

describe("FileViewerAccess's reads: who a file belongs to first, its bytes only to serve it", () => {
  const FILE_ID: string = "f0000000-0000-4000-8000-000000000001";

  function stored(isPublic: boolean): File {
    const row: File = new File();
    row._id = FILE_ID;
    row.file = Buffer.from("image-bytes");
    row.fileType = MimeType.png;
    row.projectId = PROJECT_ID;
    row.isPublic = isPublic;
    return row;
  }

  function reads(): {
    findOneBy: ReturnType<typeof jest.spyOn>;
    findOneById: ReturnType<typeof jest.spyOn>;
  } {
    return {
      findOneBy: jest
        .spyOn(FileService, "findOneBy")
        .mockResolvedValue(stored(false) as never),
      findOneById: jest
        .spyOn(FileService, "findOneById")
        .mockResolvedValue(stored(false) as never),
    };
  }

  test("deciding reads no bytes; serving reads them", () => {
    expect(FILE_VIEWERS_SELECT).toEqual({
      _id: true,
      isPublic: true,
      projectId: true,
      createdByUserId: true,
    });
    expect(SERVED_FILE_SELECT).toMatchObject({
      file: true,
      fileType: true,
      isPublic: true,
    });
  });

  test("a private file someone may not see: its owners are read, its bytes never", async () => {
    signedInAs(null);
    const { findOneBy, findOneById } = reads();

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: "a1".repeat(32) },
      }),
    ).toBeUndefined();

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { imageAccessToken: "a1".repeat(32) },
        select: FILE_VIEWERS_SELECT,
      }),
    );
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("a private file a member may see: read whole, by its id, after the decision", async () => {
    signedInAs({ userId: USER_ID });
    canOpenProject(true);
    const { findOneById } = reads();

    const served: File | undefined = await FileViewerAccess.findReadableFile({
      req: REQUEST,
      query: { imageAccessToken: "a1".repeat(32) },
    });

    expect(served?.file?.toString()).toBe("image-bytes");
    expect(findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ select: SERVED_FILE_SELECT }),
    );
    expect(
      (findOneById.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(FILE_ID);
  });

  test("a public file: served to anyone, read whole only after its owners", async () => {
    signedInAs(null);
    jest
      .spyOn(FileService, "findOneBy")
      .mockResolvedValue(stored(true) as never);
    const findOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(FileService, "findOneById")
      .mockResolvedValue(stored(true) as never);

    expect(
      (
        await FileViewerAccess.findReadableFile({
          req: REQUEST,
          query: { imageAccessToken: "a1".repeat(32) },
        })
      )?.file?.toString(),
    ).toBe("image-bytes");
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("no file: nothing read whole", async () => {
    jest.spyOn(FileService, "findOneBy").mockResolvedValue(null as never);
    const findOneById: ReturnType<typeof jest.spyOn> = jest.spyOn(
      FileService,
      "findOneById",
    );

    expect(
      await FileViewerAccess.findReadableFile({
        req: REQUEST,
        query: { imageAccessToken: "a1".repeat(32) },
      }),
    ).toBeUndefined();
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("by id: only a public file is asked for, and only a strictly public one kept", async () => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(FileService, "findOneBy")
      .mockResolvedValue(stored(true) as never);

    expect(
      (await FileViewerAccess.findPublicFile(new ObjectID(FILE_ID)))?.file,
    ).toBeDefined();
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: new ObjectID(FILE_ID), isPublic: true },
        select: SERVED_FILE_SELECT,
      }),
    );

    const loose: File = stored(true);
    (loose as unknown as { isPublic: unknown }).isPublic = "true";
    findOneBy.mockResolvedValue(loose as never);

    expect(
      await FileViewerAccess.findPublicFile(new ObjectID(FILE_ID)),
    ).toBeUndefined();
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

  test("a public file is asked for again before every use", () => {
    expect(headersFor(file({ isPublic: true }))).toEqual({
      "Cache-Control": "no-cache",
    });
  });

  test("a private file is kept by no cache between its viewer and OneUptime", () => {
    expect(headersFor(file({ isPublic: false }))).toEqual({
      "Cache-Control": "private, no-cache",
    });
  });
});
