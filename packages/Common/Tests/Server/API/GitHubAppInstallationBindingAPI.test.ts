import GitHubAPI from "../../../Server/API/GitHubAPI";
import GitHubConnectAccess from "../../../Server/API/GitHubConnectAccess";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
} from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GHSA-xx95-gmcf-7q86 — cross-tenant GitHub repository token minting.
 *
 * Project.gitHubAppInstallationId is what every token-minting path trusts to
 * decide which tenant owns an installation. This file pins the only route
 * allowed to write it.
 *
 * The original hole was that "who owns this installation?" was answered by
 * whoever asked. `/github/auth/install` signed a state for any (project, user)
 * pair named in the query string, without even requiring a session; the
 * callback then took `installation_id` straight off the URL. So an attacker
 * could start an install for a project they own, edit the callback URL to a
 * victim's installation ID, and have OneUptime record their project as the
 * owner — after which the victim's private repositories were imported into it
 * and write-scoped `ghs_` tokens were minted on request.
 */

// The install route refuses to run at all unless a GitHub App is configured.
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    GitHubAppName: "oneuptime-test-app",
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const INSTALL_ROUTE: string = "/github/install-url";
const CALLBACK_ROUTE: string = "/github/auth/callback";

// The two routes the fix removed.
const REMOVED_LIST_REPOSITORIES_ROUTE: string =
  "/github/repositories/:projectId/:installationId";
const REMOVED_CONNECT_ROUTE: string = "/github/repository/connect";

function thrownError(): Error | undefined {
  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  if (sendErrorResponse.mock.calls.length === 0) {
    return undefined;
  }

  return sendErrorResponse.mock.calls[0]![2] as Error;
}

async function callRoute(data: {
  method: string;
  uri: string;
  query?: Dictionary<string> | undefined;
  userId?: ObjectID | undefined;
}): Promise<void> {
  const req: ExpressRequest = {
    params: {},
    query: data.query || {},
    body: {},
    headers: {},
    userAuthorization: data.userId
      ? {
          userId: data.userId,
        }
      : undefined,
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(data.method, data.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);
}

describe("GitHub App installation binding", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let victimInstallationId: string;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new GitHubAPI().getRouter();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    victimInstallationId = "99999999";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The routes that made the installation ID a client-supplied input. Neither
   * had a caller — the dashboard only ever uses install -> callback — so they
   * are gone rather than patched. If one is ever re-added, it has to justify
   * itself against this advisory first.
   */
  describe("removed routes", () => {
    test.each([
      ["GET", REMOVED_LIST_REPOSITORIES_ROUTE],
      ["POST", REMOVED_CONNECT_ROUTE],
    ])("%s %s is not registered", (method: string, uri: string) => {
      const exists: boolean = mockRouter.routes.some(
        (route: { method: string; uri: string }) => {
          return route.method === method && route.uri === uri;
        },
      );

      expect(exists).toBe(false);
    });

    test("no remaining route accepts an installation id as a request parameter", () => {
      const routesTakingInstallationId: Array<string> = mockRouter.routes
        .filter((route: { uri: string }) => {
          return route.uri.includes(":installationId");
        })
        .map((route: { uri: string }) => {
          return route.uri;
        });

      expect(routesTakingInstallationId).toEqual([]);
    });
  });

  /*
   * A connection starts with GET /github/install-url, which the Dashboard
   * asks through its API client, and which records a one-use state for the
   * signed-in caller and their browser (WorkspaceOAuthState). Who may start
   * one, and who may finish it, is pinned in GitHubConnectPermission.test.ts.
   */
  describe("starting a connection", () => {
    test("the old navigation route is not registered", () => {
      const exists: boolean = mockRouter.routes.some(
        (route: { method: string; uri: string }) => {
          return route.method === "GET" && route.uri === "/github/auth/install";
        },
      );

      expect(exists).toBe(false);
    });

    test("the start route reads the session before its handler runs", () => {
      const route: {
        middlewares: Array<unknown>;
      } = mockRouter.match("GET", INSTALL_ROUTE) as unknown as {
        middlewares: Array<unknown>;
      };

      expect(route.middlewares.length).toBe(1);
    });
  });

  describe("GET /github/auth/callback", () => {
    let updateProjectSpy: jest.SpyInstance;
    let importSpy: jest.SpyInstance;
    let verifySpy: jest.SpyInstance;
    let consumeSpy: jest.SpyInstance;
    let finishSpy: jest.SpyInstance;

    beforeEach(() => {
      // The one-use state this callback spends, for this project and person.
      consumeSpy = jest.spyOn(WorkspaceOAuthState, "consume");
      consumeSpy.mockResolvedValue({
        flow: WorkspaceOAuthFlow.GitHubAppInstall,
        projectId: projectId,
        userId: userId,
      });

      // And that person may still add code repositories to it.
      finishSpy = jest.spyOn(GitHubConnectAccess, "assertMayFinish");
      finishSpy.mockResolvedValue(undefined);

      updateProjectSpy = jest.spyOn(ProjectService, "updateOneById");
      updateProjectSpy.mockResolvedValue(1);

      importSpy = jest.spyOn(
        CodeRepositoryService,
        "importReposFromInstallation",
      );
      importSpy.mockResolvedValue({ imported: 0, skipped: 0 });

      verifySpy = jest.spyOn(GitHubUtil, "assertUserControlsInstallation");
      verifySpy.mockResolvedValue(undefined);
    });

    function callbackQuery(overrides?: Dictionary<string>): Dictionary<string> {
      return {
        state: "signed-state",
        installation_id: victimInstallationId,
        code: "oauth-code",
        ...(overrides || {}),
      };
    }

    test("binds the installation to the project once GitHub confirms the installer controls it", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(thrownError()).toBeUndefined();
      expect(updateProjectSpy).toHaveBeenCalledTimes(1);

      const updateArgs: {
        id: ObjectID;
        data: { gitHubAppInstallationId?: string };
      } = updateProjectSpy.mock.calls[0]![0] as {
        id: ObjectID;
        data: { gitHubAppInstallationId?: string };
      };
      expect(updateArgs.id.toString()).toBe(projectId.toString());
      expect(updateArgs.data.gitHubAppInstallationId).toBe(
        victimInstallationId,
      );
    });

    test("verifies the exact installation id from the URL, not some other one", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(verifySpy).toHaveBeenCalledTimes(1);

      const verifyArgs: { oauthCode: string; installationId: string } =
        verifySpy.mock.calls[0]![0] as {
          oauthCode: string;
          installationId: string;
        };
      expect(verifyArgs.installationId).toBe(victimInstallationId);
      expect(verifyArgs.oauthCode).toBe("oauth-code");
    });

    /*
     * The core of the fix. A valid state only proves "this user asked to
     * install something for this project" — it says nothing about WHICH
     * installation. Without the OAuth round trip, hand-editing installation_id
     * is enough to claim someone else's installation.
     */
    test("refuses to bind an installation the installer does not control", async () => {
      verifySpy.mockRejectedValue(
        new BadDataException("does not have access to this installation"),
      );

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(updateProjectSpy).not.toHaveBeenCalled();
      expect(importSpy).not.toHaveBeenCalled();
    });

    test("refuses to bind when GitHub returned no OAuth code to verify with", async () => {
      const query: Dictionary<string> = callbackQuery();
      delete query["code"];

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: query,
      });

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
      expect(importSpy).not.toHaveBeenCalled();
    });

    /*
     * Import is what pulls the victim's private repositories into the
     * attacker's project, so it must sit strictly behind verification.
     */
    test("does not import any repositories when verification fails", async () => {
      verifySpy.mockRejectedValue(new BadDataException("nope"));

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(importSpy).not.toHaveBeenCalled();
    });

    test("verifies before writing the binding", async () => {
      const callOrder: Array<string> = [];

      verifySpy.mockImplementation(async (): Promise<void> => {
        callOrder.push("verify");
      });
      updateProjectSpy.mockImplementation(async (): Promise<void> => {
        callOrder.push("bind");
      });

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(callOrder).toEqual(["verify", "bind"]);
    });

    test("refuses someone who may no longer add code repositories to the state's project", async () => {
      finishSpy.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to add code repositories to this project.",
        ),
      );

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(thrownError()).toBeInstanceOf(NotAuthorizedException);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
      expect(importSpy).not.toHaveBeenCalled();
    });

    test("asks about the person and project the state names", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(finishSpy).toHaveBeenCalledTimes(1);

      const record: { projectId: ObjectID; userId: ObjectID } = finishSpy.mock
        .calls[0]![0] as { projectId: ObjectID; userId: ObjectID };

      expect(record.projectId.toString()).toBe(projectId.toString());
      expect(record.userId.toString()).toBe(userId.toString());
    });

    test("spends the state for the GitHub App installation only", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(consumeSpy).toHaveBeenCalledTimes(1);
      expect(
        (consumeSpy.mock.calls[0]![0] as { flows: Array<string> }).flows,
      ).toEqual([WorkspaceOAuthFlow.GitHubAppInstall]);
      expect((consumeSpy.mock.calls[0]![0] as { state: string }).state).toBe(
        "signed-state",
      );
    });

    test("rejects a missing state", async () => {
      consumeSpy.mockResolvedValue(null);

      const query: Dictionary<string> = callbackQuery();
      delete query["state"];

      await callRoute({ method: "GET", uri: CALLBACK_ROUTE, query: query });

      expect(thrownError()).toBeInstanceOf(BadRequestException);
      expect(finishSpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });

    test("rejects a state OneUptime did not issue, or has already spent", async () => {
      consumeSpy.mockResolvedValue(null);

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(thrownError()).toBeInstanceOf(BadRequestException);
      expect(finishSpy).not.toHaveBeenCalled();
      expect(verifySpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });

    test("refuses, writing nothing, when the state cannot be read at all", async () => {
      consumeSpy.mockRejectedValue(new Error("cache unavailable"));

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: callbackQuery(),
      });

      expect(thrownError()).toBeInstanceOf(BadRequestException);
      expect(finishSpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });

    test("rejects a missing installation id", async () => {
      const query: Dictionary<string> = callbackQuery();
      delete query["installation_id"];

      await callRoute({ method: "GET", uri: CALLBACK_ROUTE, query: query });

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });
  });
});
