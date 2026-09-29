import File from "../../../Models/DatabaseModels/File";
import FileAPI from "../../../Server/API/FileAPI";
import FileService from "../../../Server/Services/FileService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
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
    getAccessTokenFromExpressRequest: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/JsonWebToken", () => {
  return {
    decode: jest.fn(),
  };
});

const TOKEN_ROUTE: string = "/file/image/access-token/:token";
const ID_ROUTE: string = "/file/image/:imageId";

type BuildFileFunction = (isPublic: unknown) => File;

/*
 * The route only ever reads file/fileType/isPublic, and isPublic is
 * deliberately typed loose here so the varchar-era value (the STRING
 * "false") can be fed through the gate as well as a real boolean.
 */
const buildFile: BuildFileFunction = (isPublic: unknown): File => {
  const file: File = new File();
  file.file = Buffer.from("png-bytes");
  file.fileType = MimeType.png;
  (file as unknown as { isPublic: unknown }).isPublic = isPublic;
  return file;
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
  const res: ExpressResponse = {} as ExpressResponse;
  const next: NextFunction = (() => {}) as NextFunction;

  await mockRouter.match("GET", uri).handlerFunction(req, res, next);
};

type SetAuthenticatedFunction = (isAuthenticated: boolean) => void;

const setAuthenticated: SetAuthenticatedFunction = (
  isAuthenticated: boolean,
): void => {
  (
    UserMiddleware.getAccessTokenFromExpressRequest as unknown as jest.Mock
  ).mockReturnValue(isAuthenticated ? "a-token" : undefined);
  (JSONWebToken.decode as unknown as jest.Mock).mockReturnValue({
    userId: isAuthenticated ? new ObjectID("user-id") : undefined,
  });
};

describe("FileAPI access control", () => {
  beforeAll(() => {
    new FileAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setAuthenticated(false);
  });

  describe("token route — anonymous callers", () => {
    it("serves a public file", async () => {
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        buildFile(true) as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).toHaveBeenCalled();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    it("refuses a private file", async () => {
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        buildFile(false) as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    /*
     * Regression guard for the varchar bug: isPublic was persisted as a
     * varchar, so a private file hydrated as the STRING "false", which is
     * truthy — the gate below never fired and every inline image was served
     * to anonymous callers. The column is a real boolean now; this pins the
     * gate to a strict boolean check so a loose value cannot slip through.
     */
    it("refuses a file whose isPublic is the string 'false'", async () => {
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        buildFile("false") as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses when no file matches the token", async () => {
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        null as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses when the token param is missing", async () => {
      await callRoute(TOKEN_ROUTE, {});

      expect(FileService.findOneBy).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses a public row that carries no bytes", async () => {
      const file: File = buildFile(true);
      delete (file as Partial<File>).file;
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        file as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses a public row that carries no fileType", async () => {
      const file: File = buildFile(true);
      delete (file as Partial<File>).fileType;
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        file as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });
  });

  describe("token route — authenticated callers", () => {
    it("serves a private file to a valid session", async () => {
      setAuthenticated(true);
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        buildFile(false) as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).toHaveBeenCalled();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    it("refuses a private file when the session token has no userId", async () => {
      (
        UserMiddleware.getAccessTokenFromExpressRequest as unknown as jest.Mock
      ).mockReturnValue("a-token");
      (JSONWebToken.decode as unknown as jest.Mock).mockReturnValue({});
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        buildFile(false) as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses a private file when the session token fails verification", async () => {
      (
        UserMiddleware.getAccessTokenFromExpressRequest as unknown as jest.Mock
      ).mockReturnValue("a-forged-token");
      (JSONWebToken.decode as unknown as jest.Mock).mockImplementation(() => {
        throw new Error("invalid signature");
      });
      (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
        buildFile(false) as never,
      );

      await callRoute(TOKEN_ROUTE, { token: "abc123" });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });
  });

  describe("legacy id route", () => {
    it("serves a public file", async () => {
      (FileService.findOneById as unknown as jest.Mock).mockResolvedValue(
        buildFile(true) as never,
      );

      await callRoute(ID_ROUTE, {
        imageId: "e7c4f2a1-0000-4000-8000-000000000000",
      });

      expect(Response.sendFileResponse).toHaveBeenCalled();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    it("refuses a private file", async () => {
      (FileService.findOneById as unknown as jest.Mock).mockResolvedValue(
        buildFile(false) as never,
      );

      await callRoute(ID_ROUTE, {
        imageId: "e7c4f2a1-0000-4000-8000-000000000000",
      });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses a file whose isPublic is the string 'false'", async () => {
      (FileService.findOneById as unknown as jest.Mock).mockResolvedValue(
        buildFile("false") as never,
      );

      await callRoute(ID_ROUTE, {
        imageId: "e7c4f2a1-0000-4000-8000-000000000000",
      });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    /*
     * This route is public-only by design — it addresses files by an
     * enumerable ObjectID, so a session is deliberately NOT enough to reach a
     * private file through it. Private inline images use the token route.
     */
    it("refuses a private file even to a valid session", async () => {
      setAuthenticated(true);
      (FileService.findOneById as unknown as jest.Mock).mockResolvedValue(
        buildFile(false) as never,
      );

      await callRoute(ID_ROUTE, {
        imageId: "e7c4f2a1-0000-4000-8000-000000000000",
      });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });

    it("refuses when no file matches the id", async () => {
      (FileService.findOneById as unknown as jest.Mock).mockResolvedValue(
        null as never,
      );

      await callRoute(ID_ROUTE, {
        imageId: "e7c4f2a1-0000-4000-8000-000000000000",
      });

      expect(Response.sendFileResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
    });
  });
});
