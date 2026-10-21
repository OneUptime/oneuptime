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

// Every read of the stored file, and whether it came back with its bytes.
let reads: Array<{ query: Record<string, unknown>; gotBytes: boolean }> = [];

type StoreFunction = (file: File | null) => void;

/*
 * The one stored row, read as the database would: a read that asks only for
 * a public file finds it only when it is exactly public, and the bytes come
 * back only when the read selected them.
 */
const store: StoreFunction = (file: File | null): void => {
  (FileService.findOneBy as unknown as jest.Mock).mockImplementation(
    (async (find: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => {
      const matches: boolean = Boolean(
        file &&
          (find.query["isPublic"] === undefined ||
            (file as unknown as { isPublic: unknown }).isPublic ===
              find.query["isPublic"]),
      );

      reads.push({
        query: find.query,
        gotBytes: matches && Boolean(find.select["file"]),
      });

      if (!matches || !file) {
        return null;
      }

      const row: File = new File();
      row._id = file._id!;
      row.projectId = file.projectId!;
      (row as unknown as { isPublic: unknown }).isPublic = (
        file as unknown as { isPublic: unknown }
      ).isPublic;

      if (file.fileType) {
        row.fileType = file.fileType;
      }

      if (find.select["file"] && file.file) {
        row.file = file.file;
      }

      return row;
    }) as never,
  );
};

// Whether any read came back with the file's bytes.
const readAnyBytes: () => boolean = (): boolean => {
  return reads.some((read: { gotBytes: boolean }): boolean => {
    return read.gotBytes;
  });
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
    reads = [];
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
      expect(readAnyBytes()).toBe(false);
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

    it("reads a public file whole at once, asking only for a public file", async () => {
      store(buildFile(true));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(reads).toEqual([
        {
          query: { imageAccessToken: "abc123", isPublic: true },
          gotBytes: true,
        },
      ]);
    });
  });

  describe("token route — signed-in callers", () => {
    it("serves a private file to a member of its project", async () => {
      signedIn();
      setMember(true);
      store(buildFile(false));

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expectServed();

      // Who may see it first, its bytes only once they may.
      expect(reads).toEqual([
        {
          query: { imageAccessToken: "abc123", isPublic: true },
          gotBytes: false,
        },
        { query: { imageAccessToken: "abc123" }, gotBytes: false },
        { query: { _id: IMAGE_ID }, gotBytes: true },
      ]);

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
      expect(readAnyBytes()).toBe(false);
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
      expect(readAnyBytes()).toBe(false);
    });
  });

  describe("legacy id route", () => {
    it("serves a public file", async () => {
      store(buildFile(true));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expectServed();
    });

    it("asks only for a public file", async () => {
      store(buildFile(true));

      await callRoute(ID_ROUTE, { imageId: IMAGE_ID });

      expect(reads).toHaveLength(1);
      expect(String(reads[0]!.query["_id"])).toBe(IMAGE_ID);
      expect(reads[0]!.query["isPublic"]).toBe(true);
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
