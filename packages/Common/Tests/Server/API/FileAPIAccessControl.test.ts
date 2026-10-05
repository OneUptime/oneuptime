import File from "../../../Models/DatabaseModels/File";
import FileAPI from "../../../Server/API/FileAPI";
import FileService from "../../../Server/Services/FileService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import { beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendFileResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

jest.mock("../../../Server/Services/FileService", () => {
  return {
    findOneBy: jest.fn(),
    findOneById: jest.fn(),
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    getSessionUser: jest.fn(),
    getUserTenantAccessPermissionWithTenantId: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * The image routes' decisions with every collaborator stubbed: who is
 * asking (UserMiddleware.getSessionUser), whether they can open a project
 * (UserMiddleware.getUserTenantAccessPermissionWithTenantId), and the two
 * reads - the file's owners first, its bytes only once it may be served.
 * The same routes run end to end, with real signed sessions, in
 * FileImageRouteViewers.test.ts.
 */

const TOKEN_ROUTE: string = "/file/image/access-token/:token";
const ID_ROUTE: string = "/file/image/:imageId";

const IMAGE_ID: string = "e7c4f2a1-0000-4000-8000-000000000000";

const PROJECT_ID: ObjectID = new ObjectID(
  "e7c4f2a1-0000-4000-8000-0000000000aa",
);
const USER_ID: ObjectID = new ObjectID("e7c4f2a1-0000-4000-8000-0000000000bb");

type BuildFileFunction = (isPublic: unknown) => File;

/*
 * A file of PROJECT_ID. isPublic is deliberately typed loose here so the
 * varchar-era value (the STRING "false") can be fed through the gate as
 * well as a real boolean.
 */
const buildFile: BuildFileFunction = (isPublic: unknown): File => {
  const file: File = new File();
  file._id = IMAGE_ID;
  file.file = Buffer.from("png-bytes");
  file.fileType = MimeType.png;
  file.projectId = PROJECT_ID;
  (file as unknown as { isPublic: unknown }).isPublic = isPublic;
  return file;
};

type StoreFunction = (file: File | null) => void;

// What both reads find: the same row, as the database holds it.
const store: StoreFunction = (file: File | null): void => {
  (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
    file as never,
  );
  (FileService.findOneById as unknown as jest.Mock).mockResolvedValue(
    file as never,
  );
};

type CallRouteFunction = (
  uri: string,
  params: Record<string, string>,
) => Promise<void>;

const callRoute: CallRouteFunction = async (
  uri: string,
  params: Record<string, string>,
): Promise<void> => {
  const req: ExpressRequest = { params } as unknown as ExpressRequest;
  const res: ExpressResponse = { set: jest.fn() } as unknown as ExpressResponse;
  const next: NextFunction = (() => {}) as NextFunction;

  await mockRouter.match("GET", uri).handlerFunction(req, res, next);
};

type SetSessionFunction = (session: unknown) => void;

// The session the request carries, as UserMiddleware reads it (null: none).
const setSession: SetSessionFunction = (session: unknown): void => {
  (UserMiddleware.getSessionUser as unknown as jest.Mock).mockResolvedValue(
    session as never,
  );
};

type SetMemberFunction = (isMember: boolean) => void;

// Whether the signed-in user can open the file's project.
const setMember: SetMemberFunction = (isMember: boolean): void => {
  (
    UserMiddleware.getUserTenantAccessPermissionWithTenantId as unknown as jest.Mock
  ).mockResolvedValue(
    (isMember ? { projectId: PROJECT_ID, permissions: [] } : null) as never,
  );
};

const signedIn: () => void = (): void => {
  setSession({ userId: USER_ID, isMasterAdmin: false });
};

function expectServed(): void {
  expect(Response.sendFileResponse).toHaveBeenCalled();
  expect(Response.sendErrorResponse).not.toHaveBeenCalled();
}

function expectRefused(): void {
  expect(Response.sendFileResponse).not.toHaveBeenCalled();
  expect(Response.sendErrorResponse).toHaveBeenCalled();
}

describe("FileAPI access control", () => {
  beforeAll(() => {
    new FileAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setSession(null);
    setMember(false);
    store(null);
  });

  describe("token route — anonymous callers", () => {
    it("serves a public file", async () => {
      store(buildFile(true));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectServed();
    });

    it("refuses a private file, and never reads its bytes", async () => {
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
      expect(FileService.findOneById).not.toHaveBeenCalled();
    });

    /*
     * Regression guard for the varchar bug: isPublic was persisted as a
     * varchar, so a private file hydrated as the STRING "false", which is
     * truthy — the gate below never fired and every inline image was served
     * to anonymous callers. The column is a real boolean now; this pins the
     * gate to a strict boolean check so a loose value cannot slip through.
     */
    it("refuses a file whose isPublic is the string 'false'", async () => {
      store(buildFile("false"));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
    });

    it("refuses when no file matches the token", async () => {
      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
    });

    it("refuses when the token param is missing", async () => {
      await callRoute(TOKEN_ROUTE, {});

      expect(FileService.findOneBy).not.toHaveBeenCalled();
      expectRefused();
    });

    it("refuses a public row that carries no bytes", async () => {
      const file: File = buildFile(true);
      delete (file as Partial<File>).file;
      store(file);

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
    });

    it("refuses a public row that carries no fileType", async () => {
      const file: File = buildFile(true);
      delete (file as Partial<File>).fileType;
      store(file);

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
    });

    it("reads who may see the file first, and its bytes only to serve it", async () => {
      store(buildFile(true));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      const ownersRead: { query: unknown; select: Record<string, unknown> } = (
        FileService.findOneBy as unknown as jest.Mock
      ).mock.calls[0]![0] as {
        query: unknown;
        select: Record<string, unknown>;
      };

      expect(ownersRead.query).toEqual({ imageAccessToken: "abc123" });
      expect(ownersRead.select["file"]).toBeUndefined();

      const bytesRead: { id: ObjectID; select: Record<string, unknown> } = (
        FileService.findOneById as unknown as jest.Mock
      ).mock.calls[0]![0] as { id: ObjectID; select: Record<string, unknown> };

      expect(bytesRead.id.toString()).toBe(IMAGE_ID);
      expect(bytesRead.select["file"]).toBe(true);
    });
  });

  describe("token route — signed-in callers", () => {
    it("serves a private file to a member of its project", async () => {
      signedIn();
      setMember(true);
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectServed();

      // Asked about the file's own project, for the signed-in user.
      expect(
        UserMiddleware.getUserTenantAccessPermissionWithTenantId,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: PROJECT_ID,
          userId: USER_ID,
        }),
      );
    });

    it("refuses a private file to a session that cannot open its project, and never reads its bytes", async () => {
      signedIn();
      setMember(false);
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
      expect(FileService.findOneById).not.toHaveBeenCalled();
    });

    it("refuses a private file when the session has no user", async () => {
      setSession({});
      setMember(true);
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
    });

    it("refuses a private file to a status page visitor's own session", async () => {
      setSession({ userId: USER_ID, statusPageId: ObjectID.generate() });
      setMember(true);
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
    });

    it("answers as for a missing file when who may see it cannot be decided", async () => {
      signedIn();
      (
        UserMiddleware.getUserTenantAccessPermissionWithTenantId as unknown as jest.Mock
      ).mockRejectedValue(new Error("the database is unreachable") as never);
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectRefused();
      expect(FileService.findOneById).not.toHaveBeenCalled();
    });
  });

  describe("legacy id route", () => {
    it("serves a public file", async () => {
      store(buildFile(true));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expectServed();
    });

    it("reads only a public file", async () => {
      store(buildFile(true));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      const read: { query: Record<string, unknown> } = (
        FileService.findOneBy as unknown as jest.Mock
      ).mock.calls[0]![0] as { query: Record<string, unknown> };

      expect(String(read.query["_id"])).toBe(IMAGE_ID);
      expect(read.query["isPublic"]).toBe(true);
    });

    it("refuses a private file", async () => {
      store(buildFile(false));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expectRefused();
    });

    it("refuses a file whose isPublic is the string 'false'", async () => {
      store(buildFile("false"));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expectRefused();
    });

    /*
     * This route is public-only by design — it addresses files by an
     * enumerable ObjectID, so a session is deliberately NOT enough to reach a
     * private file through it. Private inline images use the token route.
     */
    it("refuses a private file even to a member of its project", async () => {
      signedIn();
      setMember(true);
      store(buildFile(false));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expectRefused();
    });

    it("refuses when no file matches the id", async () => {
      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expectRefused();
    });

    it("refuses an id that is not one without asking the database", async () => {
      await callRoute(ID_ROUTE, { imageId: "not-an-id" });

      expectRefused();
      expect(FileService.findOneBy).not.toHaveBeenCalled();
    });
  });
});
