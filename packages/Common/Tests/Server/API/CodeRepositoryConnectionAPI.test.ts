import CodeRepositoryConnectionAPI from "../../../Server/API/CodeRepositoryConnectionAPI";
import GitHubConnectAccess from "../../../Server/API/GitHubConnectAccess";
import CodeRepositoryConnector from "../../../Server/Utils/CodeRepository/CodeHost/CodeRepositoryConnector";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import getJestMockFunction, { MockFunction } from "../../MockType";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Code's connect routes (/code-repository-connection/*): each one signed in
 * (UserMiddleware) and asked, before anything else, whether the caller may
 * connect repositories - what connecting GitHub asks (GitHubConnectAccess:
 * a project member whose credential may write, with permission to create
 * code repositories, on the plan they are sold on). The project is the
 * caller's, never one the body names; a refusal reaches the error handler
 * and nothing is read from a Git server.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "c1b2c3d4-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "c1b2c3d4-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("c1b2c3d4-0000-4000-8000-000000000003");
const CONNECTION_ID: string = "c1b2c3d4-0000-4000-8000-000000000004";

const ROUTES: Array<string> = [
  "/code-repository-connection/repositories",
  "/code-repository-connection/connect",
  "/code-repository-connection/connect-git",
  "/code-repository-connection/list",
  "/code-repository-connection/:connectionId/token",
];

beforeAll(() => {
  new CodeRepositoryConnectionAPI();
});

let allowed: boolean = true;

beforeEach(() => {
  allowed = true;

  jest
    .spyOn(GitHubConnectAccess, "assertMayStart")
    .mockImplementation((async (): Promise<{
      projectId: ObjectID;
      userId: ObjectID;
    }> => {
      if (!allowed) {
        throw new NotAuthorizedException(
          "Connecting repositories needs permission to create code repositories.",
        );
      }

      return { projectId: PROJECT_ID, userId: USER_ID };
    }) as never);

  jest.spyOn(CodeRepositoryConnector, "listRepositories").mockResolvedValue({
    account: { login: "alice", name: "Alice" },
    hostUrl: "https://gitlab.com",
    repositories: [],
    hasMore: false,
  } as never);
  jest.spyOn(CodeRepositoryConnector, "connect").mockResolvedValue({
    connectionId: CONNECTION_ID,
    imported: 1,
    reconnected: 0,
    skipped: 0,
    repositoryIds: [],
  } as never);
  jest
    .spyOn(CodeRepositoryConnector, "connectGitRepository")
    .mockResolvedValue({ repositoryId: "r1" } as never);
  jest
    .spyOn(CodeRepositoryConnector, "listConnections")
    .mockResolvedValue([] as never);
  jest
    .spyOn(CodeRepositoryConnector, "replaceToken")
    .mockResolvedValue({ accountLogin: "alice", credentialHint: "abcd" });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

async function call(
  uri: string,
  body: Record<string, unknown>,
  params: Record<string, string> = {},
): Promise<{ next: MockFunction; sent: unknown }> {
  const next: MockFunction = getJestMockFunction();

  await mockRouter
    .match("POST", uri)
    .handlerFunction(
      { params, query: {}, headers: {}, body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  const sent: unknown = (Response.sendJsonObjectResponse as jest.Mock).mock
    .calls[0]?.[2];

  return { next, sent };
}

describe("Code's connect routes", () => {
  test("are each signed in, by the user middleware, ahead of their handler", () => {
    for (const uri of ROUTES) {
      expect(mockRouter.match("POST", uri).middlewares).toContain(
        UserMiddleware.getUserMiddleware,
      );
    }
  });

  test("ask whether the caller may connect before anything, and a refusal reaches the error handler with nothing read", async () => {
    allowed = false;

    for (const uri of ROUTES) {
      const { next } = await call(
        uri,
        { provider: "GitLab", hostUrl: "https://gitlab.com", token: "x" },
        { connectionId: CONNECTION_ID },
      );

      expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
    }

    expect(GitHubConnectAccess.assertMayStart).toHaveBeenCalledTimes(
      ROUTES.length,
    );
    expect(CodeRepositoryConnector.listRepositories).not.toHaveBeenCalled();
    expect(CodeRepositoryConnector.connect).not.toHaveBeenCalled();
    expect(CodeRepositoryConnector.connectGitRepository).not.toHaveBeenCalled();
    expect(CodeRepositoryConnector.listConnections).not.toHaveBeenCalled();
    expect(CodeRepositoryConnector.replaceToken).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("work in the caller's project, whatever project the body names", async () => {
    await call("/code-repository-connection/connect", {
      projectId: OTHER_PROJECT_ID.toString(),
      provider: CodeRepositoryType.GitLab,
      hostUrl: "https://gitlab.com",
      token: "glpat-0000000000000000",
      repositoryIds: ["1", 2, "3"],
    });

    expect(CodeRepositoryConnector.connect).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      source: {
        provider: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.com",
        token: "glpat-0000000000000000",
      },
      // Only the ids that are text.
      repositoryIds: ["1", "3"],
    });
  });

  test("list a source's repositories, page and search as asked", async () => {
    const { sent } = await call("/code-repository-connection/repositories", {
      connectionId: CONNECTION_ID,
      search: "check",
      page: 2,
    });

    expect(CodeRepositoryConnector.listRepositories).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      source: { connectionId: CONNECTION_ID },
      search: "check",
      page: 2,
    });
    expect(sent).toEqual(
      expect.objectContaining({ hostUrl: "https://gitlab.com" }),
    );
  });

  test("connect a Git repository with the person's answer about checking it", async () => {
    await call("/code-repository-connection/connect-git", {
      url: "https://git.example.com/team/app.git",
      username: "deploy",
      password: "secret-0000000000",
      connectWithoutCheck: "yes",
    });

    expect(CodeRepositoryConnector.connectGitRepository).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      url: "https://git.example.com/team/app.git",
      username: "deploy",
      password: "secret-0000000000",
      // Only a true answer is a yes.
      connectWithoutCheck: false,
    });
  });

  test("replace a connection's token by the connection the address names, answering only its last characters", async () => {
    const { sent } = await call(
      "/code-repository-connection/:connectionId/token",
      { token: "glpat-new-000000000000" },
      { connectionId: CONNECTION_ID },
    );

    expect(CodeRepositoryConnector.replaceToken).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      token: "glpat-new-000000000000",
      username: undefined,
    });
    expect(JSON.stringify(sent)).not.toContain("glpat-new-000000000000");
  });

  test("a body that is not an object is read as an empty one", async () => {
    const { next } = await call("/code-repository-connection/connect", [
      "not",
      "an",
      "object",
    ] as never);

    expect(next).toHaveBeenCalled();
    expect(CodeRepositoryConnector.connect).not.toHaveBeenCalled();
  });
});
