import GitHubAPI from "../../../Server/API/GitHubAPI";
import GitHubConnectAccess from "../../../Server/API/GitHubConnectAccess";
import GitHubConversation from "../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { JSONObject } from "../../../Types/JSON";
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
 * GitHub addresses an app by its slug, not its display name: the app named
 * "OneUptime Test" lives at github.com/apps/oneuptime-test, and
 * github.com/apps/OneUptime%20Test is a 404. GITHUB_APP_NAME is documented as
 * the display name, so the install link was a 404 for every self-hosted app
 * whose name has a space in it; OneUptime Cloud only worked because it puts
 * the slug in GITHUB_APP_NAME.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    GitHubAppName: "OneUptime Test",
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
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    redirect: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

async function installUrl(): Promise<string> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  await mockRouter
    .match("GET", "/github/install-url")
    .handlerFunction(
      req,
      { cookie: jest.fn() } as unknown as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );

  expect(
    (Response.sendErrorResponse as unknown as jest.Mock).mock.calls,
  ).toEqual([]);

  return (
    (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]![2] as JSONObject
  )["installUrl"] as string;
}

describe("GET /github/install-url", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new GitHubAPI().getRouter();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(GitHubConnectAccess, "assertMayStart").mockResolvedValue({
      projectId: ObjectID.generate(),
      userId: ObjectID.generate(),
    });

    jest
      .spyOn(WorkspaceOAuthState, "create")
      .mockResolvedValue({ state: "recorded-state" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("links to the app by the slug GitHub reports", async () => {
    jest
      .spyOn(GitHubConversation, "getAppSlug")
      .mockResolvedValue("oneuptime-test");

    expect(await installUrl()).toMatch(
      /^https:\/\/github\.com\/apps\/oneuptime-test\/installations\/new\?state=recorded-state&/,
    );
  });

  test("slugifies the display name the way GitHub does when GitHub cannot be asked", async () => {
    // getAppSlug's own fallback: GET /app fails without app credentials.
    jest
      .spyOn(GitHubConversation, "getAppSlug")
      .mockImplementation(async () => {
        return GitHubConversation.slugifyAppName("OneUptime Test");
      });

    const url: string = await installUrl();

    expect(url).toMatch(/^https:\/\/github\.com\/apps\/oneuptime-test\//);
    expect(url).not.toContain("OneUptime%20Test");
  });
});
