import UserMiddleware from "../../../../Server/Middleware/UserAuthorization";
import UserService from "../../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import FileViewerAccess, {
  FileViewer,
  ViewableFile,
} from "../../../../Server/Utils/File/FileViewerAccess";
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
