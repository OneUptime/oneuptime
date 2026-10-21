import GitHubAPI from "../../../Server/API/GitHubAPI";
import GitHubConnectAccess from "../../../Server/API/GitHubConnectAccess";
import GitHubUtil, {
  GitHubUserInstallation,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ConnectStartPage } from "../../../Types/Workspace/ConnectCallback";
import { GITHUB_INSTALLATION_CHOICE_QUERY_PARAM } from "../../../Types/CodeRepository/GitHubInstallationChoice";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Connecting a GitHub App installation that already exists.
 *
 * Installing from Code cannot do it: on an account that already
 * has the app, GitHub shows the installation's settings instead of
 * installing, drops the state on the way there, and sends nobody back. So
 * Code also offers "connect an existing installation", which
 * signs the person in to GitHub (GET /github/connect-existing-url) and comes
 * back to the same callback with an OAuth code. What they may connect is
 * every installation of the app their GitHub account administers - one is
 * connected straight away, several are offered, and the pick goes back
 * through the callback, which connects only an installation it offered.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    GitHubAppName: "oneuptime-test-app",
    GitHubAppClientId: "Iv1.github-client-id",
    GitHubAppClientSecret: "github-client-secret",
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
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

const START_ROUTE: string = "/github/connect-existing-url";
const CHOICES_ROUTE: string = "/github/installation-choices";
const CALLBACK_ROUTE: string = "/github/auth/callback";

function installation(
  installationId: string,
  accountLogin: string,
  accountType: string = "Organization",
): GitHubUserInstallation {
  return {
    installationId: installationId,
    accountLogin: accountLogin,
    accountId: null,
    accountType: accountType,
  };
}

// Where the callback sent the browser; it never answers with an error page.
function answeredAt(): string {
  expect(
    (Response.sendErrorResponse as unknown as jest.Mock).mock.calls,
  ).toEqual([]);

  const redirect: jest.Mock = Response.redirect as unknown as jest.Mock;

  expect(redirect.mock.calls.length).toBe(1);

  return (redirect.mock.calls[0]![2] as URL).toString();
}

function answeredQuery(): URLSearchParams {
  return new globalThis.URL(answeredAt()).searchParams;
}

async function callRoute(data: {
  method: string;
  uri: string;
  query?: Dictionary<string> | undefined;
}): Promise<void> {
  const req: ExpressRequest = {
    params: {},
    query: data.query || {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
    cookie: jest.fn(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match(data.method, data.uri)
    .handlerFunction(req, res, jest.fn() as unknown as NextFunction);
}

describe("Connecting a GitHub App installation that already exists", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let createStateSpy: jest.SpyInstance;
  let updateProjectSpy: jest.SpyInstance;
  let importSpy: jest.SpyInstance;
  let administeredSpy: jest.SpyInstance;
  let verifySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new GitHubAPI().getRouter();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    jest.spyOn(GitHubConnectAccess, "assertMayStart").mockResolvedValue({
      projectId: projectId,
      userId: userId,
    });

    createStateSpy = jest.spyOn(WorkspaceOAuthState, "create");
    createStateSpy.mockResolvedValue({ state: "recorded-state" });

    updateProjectSpy = jest.spyOn(ProjectService, "updateOneById");
    updateProjectSpy.mockResolvedValue(1);

    importSpy = jest.spyOn(
      CodeRepositoryService,
      "importReposFromInstallation",
    );
    importSpy.mockResolvedValue({ imported: 1, reconnected: 0, skipped: 0 });

    administeredSpy = jest.spyOn(
      GitHubUtil,
      "listInstallationsUserAdministers",
    );

    verifySpy = jest.spyOn(GitHubUtil, "assertUserControlsInstallation");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /github/connect-existing-url", () => {
    test("reads the session before its handler runs", () => {
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "GET",
        START_ROUTE,
      ) as unknown as { middlewares: Array<unknown> };

      expect(route.middlewares.length).toBe(1);
    });

    test("answers GitHub's sign-in URL, with a state recorded for the caller and this flow", async () => {
      await callRoute({ method: "GET", uri: START_ROUTE });

      expect(createStateSpy).toHaveBeenCalledTimes(1);

      const created: {
        flow: WorkspaceOAuthFlow;
        projectId: ObjectID;
        userId: ObjectID;
      } = createStateSpy.mock.calls[0]![0] as {
        flow: WorkspaceOAuthFlow;
        projectId: ObjectID;
        userId: ObjectID;
      };

      expect(created.flow).toBe(WorkspaceOAuthFlow.GitHubAppConnectExisting);
      expect(created.projectId.toString()).toBe(projectId.toString());
      expect(created.userId.toString()).toBe(userId.toString());

      const answer: JSONObject = (
        Response.sendJsonObjectResponse as unknown as jest.Mock
      ).mock.calls[0]![2] as JSONObject;
      const authorizeUrl: globalThis.URL = new globalThis.URL(
        answer["authorizeUrl"] as string,
      );

      expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
        "https://github.com/login/oauth/authorize",
      );
      expect(authorizeUrl.searchParams.get("client_id")).toBe(
        "Iv1.github-client-id",
      );
      expect(authorizeUrl.searchParams.get("state")).toBe("recorded-state");
      expect(authorizeUrl.searchParams.get("redirect_uri")).toMatch(
        /\/api\/github\/auth\/callback$/,
      );
    });

    test("records no state for someone who may not connect one", async () => {
      jest
        .spyOn(GitHubConnectAccess, "assertMayStart")
        .mockRejectedValue(new NotAuthorizedException("no"));

      await callRoute({ method: "GET", uri: START_ROUTE });

      expect(createStateSpy).not.toHaveBeenCalled();
      expect(
        (Response.sendErrorResponse as unknown as jest.Mock).mock.calls.length,
      ).toBe(1);
    });
  });

  describe("GET /github/auth/callback, after signing in", () => {
    beforeEach(() => {
      jest.spyOn(WorkspaceOAuthState, "consume").mockResolvedValue({
        flow: WorkspaceOAuthFlow.GitHubAppConnectExisting,
        projectId: projectId,
        userId: userId,
        startPage: ConnectStartPage.ProjectSettings,
      });

      jest
        .spyOn(GitHubConnectAccess, "assertMayFinish")
        .mockResolvedValue(undefined);
    });

    test("connects the one installation the GitHub account administers", async () => {
      administeredSpy.mockResolvedValue([installation("111", "acme")]);

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state", code: "oauth-code" },
      });

      expect(administeredSpy).toHaveBeenCalledWith("oauth-code");
      expect(updateProjectSpy).toHaveBeenCalledTimes(1);
      expect(
        (
          updateProjectSpy.mock.calls[0]![0] as {
            data: { gitHubAppInstallationId: string };
          }
        ).data.gitHubAppInstallationId,
      ).toBe("111");
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(answeredAt()).toContain(
        `/${projectId.toString()}/code?installation_id=111`,
      );
      // No installation id from the redirect is ever needed, or trusted.
      expect(verifySpy).not.toHaveBeenCalled();
    });

    test("offers several, writing nothing until one is picked", async () => {
      administeredSpy.mockResolvedValue([
        installation("111", "acme"),
        installation("222", "the-user", "User"),
      ]);
      createStateSpy.mockResolvedValue({ state: "choice-state" });

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state", code: "oauth-code" },
      });

      expect(updateProjectSpy).not.toHaveBeenCalled();
      expect(importSpy).not.toHaveBeenCalled();

      const created: {
        flow: WorkspaceOAuthFlow;
        projectId: ObjectID;
        userId: ObjectID;
        payload: JSONObject;
      } = createStateSpy.mock.calls[0]![0] as {
        flow: WorkspaceOAuthFlow;
        projectId: ObjectID;
        userId: ObjectID;
        payload: JSONObject;
      };

      expect(created.flow).toBe(WorkspaceOAuthFlow.GitHubAppChooseInstallation);
      expect(created.projectId.toString()).toBe(projectId.toString());
      expect(created.userId.toString()).toBe(userId.toString());
      expect(created.payload["installations"]).toEqual([
        {
          installationId: "111",
          accountLogin: "acme",
          accountType: "Organization",
        },
        {
          installationId: "222",
          accountLogin: "the-user",
          accountType: "User",
        },
      ]);

      expect(answeredAt()).toContain(`/${projectId.toString()}/code`);
      expect(answeredQuery().get(GITHUB_INSTALLATION_CHOICE_QUERY_PARAM)).toBe(
        "choice-state",
      );
      expect(answeredQuery().get("error")).toBeNull();
    });

    test("says so when the GitHub account administers no installation", async () => {
      administeredSpy.mockResolvedValue([]);

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state", code: "oauth-code" },
      });

      expect(answeredQuery().get("error")).toBe(
        "github-no-installation-to-connect",
      );
      expect(updateProjectSpy).not.toHaveBeenCalled();
      expect(createStateSpy).not.toHaveBeenCalled();
    });

    test("could not finish without a code, and asks GitHub nothing", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state" },
      });

      expect(answeredQuery().get("error")).toBe("could-not-finish");
      expect(administeredSpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });

    test("could not finish when GitHub cannot be read, and writes nothing", async () => {
      administeredSpy.mockRejectedValue(new Error("GitHub is down"));

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state", code: "oauth-code" },
      });

      expect(answeredQuery().get("error")).toBe("could-not-finish");
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });

    test("a cancelled sign-in is answered as cancelled", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state", error: "access_denied" },
      });

      expect(answeredQuery().get("error")).toBe("cancelled");
      expect(administeredSpy).not.toHaveBeenCalled();
    });

    test("asks again, before GitHub, whether the person may still connect", async () => {
      jest
        .spyOn(GitHubConnectAccess, "assertMayFinish")
        .mockRejectedValue(new NotAuthorizedException("no longer"));

      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "signed-state", code: "oauth-code" },
      });

      expect(answeredQuery().get("error")).toBe("no-permission");
      expect(administeredSpy).not.toHaveBeenCalled();
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });
  });

  describe("GET /github/auth/callback, with the installation picked", () => {
    const offered: WorkspaceOAuthStateRecord["payload"] = {
      installations: [
        {
          installationId: "111",
          accountLogin: "acme",
          accountType: "Organization",
        },
        {
          installationId: "222",
          accountLogin: "the-user",
          accountType: "User",
        },
      ],
    };

    beforeEach(() => {
      jest.spyOn(WorkspaceOAuthState, "consume").mockResolvedValue({
        flow: WorkspaceOAuthFlow.GitHubAppChooseInstallation,
        projectId: projectId,
        userId: userId,
        startPage: ConnectStartPage.ProjectSettings,
        payload: offered,
      });

      jest
        .spyOn(GitHubConnectAccess, "assertMayFinish")
        .mockResolvedValue(undefined);
    });

    test("connects the installation picked, from the ones offered", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "choice-state", installation_id: "222" },
      });

      expect(
        (
          updateProjectSpy.mock.calls[0]![0] as {
            id: ObjectID;
            data: { gitHubAppInstallationId: string };
          }
        ).data.gitHubAppInstallationId,
      ).toBe("222");
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(answeredAt()).toContain(
        `/${projectId.toString()}/code?installation_id=222`,
      );
      expect(administeredSpy).not.toHaveBeenCalled();
      expect(verifySpy).not.toHaveBeenCalled();
    });

    test("refuses an installation it did not offer", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "choice-state", installation_id: "99999999" },
      });

      expect(answeredQuery().get("error")).toBe("could-not-finish");
      expect(updateProjectSpy).not.toHaveBeenCalled();
      expect(importSpy).not.toHaveBeenCalled();
    });

    test("refuses a pick without an installation", async () => {
      await callRoute({
        method: "GET",
        uri: CALLBACK_ROUTE,
        query: { state: "choice-state" },
      });

      expect(answeredQuery().get("error")).toBe("could-not-finish");
      expect(updateProjectSpy).not.toHaveBeenCalled();
    });
  });

  describe("GET /github/installation-choices", () => {
    let peekSpy: jest.SpyInstance;

    beforeEach(() => {
      peekSpy = jest.spyOn(WorkspaceOAuthState, "peek");
      peekSpy.mockResolvedValue({
        flow: WorkspaceOAuthFlow.GitHubAppChooseInstallation,
        projectId: projectId,
        userId: userId,
        startPage: ConnectStartPage.ProjectSettings,
        payload: {
          installations: [
            {
              installationId: "111",
              accountLogin: "acme",
              accountType: "Organization",
            },
            // Anything malformed in a record is dropped, never shown.
            { accountLogin: "no-id" },
          ],
        },
      });
    });

    function answered(): JSONObject | null {
      const calls: Array<Array<unknown>> = (
        Response.sendJsonObjectResponse as unknown as jest.Mock
      ).mock.calls;

      return calls.length > 0 ? (calls[0]![2] as JSONObject) : null;
    }

    test("reads the session before its handler runs", () => {
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "GET",
        CHOICES_ROUTE,
      ) as unknown as { middlewares: Array<unknown> };

      expect(route.middlewares.length).toBe(1);
    });

    test("answers the installations offered, reading the state without spending it", async () => {
      const consumeSpy: jest.SpyInstance = jest.spyOn(
        WorkspaceOAuthState,
        "consume",
      );

      await callRoute({
        method: "GET",
        uri: CHOICES_ROUTE,
        query: { choice: "choice-state" },
      });

      expect(peekSpy).toHaveBeenCalledTimes(1);
      expect(
        (peekSpy.mock.calls[0]![0] as { state: string; flows: Array<string> })
          .state,
      ).toBe("choice-state");
      expect(
        (peekSpy.mock.calls[0]![0] as { state: string; flows: Array<string> })
          .flows,
      ).toEqual([WorkspaceOAuthFlow.GitHubAppChooseInstallation]);
      expect(consumeSpy).not.toHaveBeenCalled();
      expect(answered()).toEqual({
        installations: [
          {
            installationId: "111",
            accountLogin: "acme",
            accountType: "Organization",
          },
        ],
      });
    });

    test("answers nobody but the person it was recorded for", async () => {
      jest.spyOn(GitHubConnectAccess, "assertMayStart").mockResolvedValue({
        projectId: projectId,
        userId: ObjectID.generate(),
      });

      await callRoute({
        method: "GET",
        uri: CHOICES_ROUTE,
        query: { choice: "choice-state" },
      });

      expect(answered()).toBeNull();
      expect(
        (Response.sendErrorResponse as unknown as jest.Mock).mock.calls.length,
      ).toBe(1);
    });

    test("answers nothing in another project", async () => {
      jest.spyOn(GitHubConnectAccess, "assertMayStart").mockResolvedValue({
        projectId: ObjectID.generate(),
        userId: userId,
      });

      await callRoute({
        method: "GET",
        uri: CHOICES_ROUTE,
        query: { choice: "choice-state" },
      });

      expect(answered()).toBeNull();
    });

    test("answers nothing for a choice that cannot be read", async () => {
      peekSpy.mockResolvedValue(null);

      await callRoute({
        method: "GET",
        uri: CHOICES_ROUTE,
        query: { choice: "expired" },
      });

      expect(answered()).toBeNull();
      expect(
        (Response.sendErrorResponse as unknown as jest.Mock).mock.calls.length,
      ).toBe(1);
    });

    test("asks nothing of someone who may not connect", async () => {
      jest
        .spyOn(GitHubConnectAccess, "assertMayStart")
        .mockRejectedValue(new NotAuthorizedException("no"));

      await callRoute({
        method: "GET",
        uri: CHOICES_ROUTE,
        query: { choice: "choice-state" },
      });

      expect(peekSpy).not.toHaveBeenCalled();
      expect(answered()).toBeNull();
    });
  });
});
