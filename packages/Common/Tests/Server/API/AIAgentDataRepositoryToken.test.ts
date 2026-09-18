import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import OpenPullRequestCap from "../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GHSA-xx95-gmcf-7q86 — the endpoint at the sharp end.
 *
 * This route hands back a live GitHub installation token with contents:write
 * and pull_requests:write. It used to authorize by comparing the repository
 * row's projectId against the calling agent's project — but an attacker
 * controls BOTH sides of that comparison, because they can create their own
 * project, issue themselves an agent key in it, and (before this fix) put a
 * row in it carrying any installation ID they liked. The row being "in your
 * project" says nothing about whether the INSTALLATION is.
 *
 * So the binding is re-derived from the project itself, immediately before
 * minting.
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
    redirect: jest.fn(),
  };
});

const TOKEN_ROUTE: string = "/ai-agent-data/get-repository-token";

function thrownError(): Error | undefined {
  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  if (sendErrorResponse.mock.calls.length === 0) {
    return undefined;
  }

  return sendErrorResponse.mock.calls[0]![2] as Error;
}

function jsonResponse(): JSONObject | undefined {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  if (sendJson.mock.calls.length === 0) {
    return undefined;
  }

  return sendJson.mock.calls[0]![2] as JSONObject;
}

describe("POST /ai-agent-data/get-repository-token", () => {
  let attackerProjectId: ObjectID;
  let codeRepositoryId: ObjectID;
  let victimInstallationId: string;
  let ownInstallationId: string;

  let mintTokenSpy: jest.SpyInstance;
  let bindingSpy: jest.SpyInstance;
  let findRepositorySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    attackerProjectId = ObjectID.generate();
    codeRepositoryId = ObjectID.generate();
    victimInstallationId = "99999999";
    ownInstallationId = "11111111";

    // The agent key is project-scoped and self-issued in the attacker's project.
    jest.spyOn(CodeFixAgentAuth, "resolveAgentIdentity").mockResolvedValue({
      id: ObjectID.generate(),
      projectId: attackerProjectId,
      source: CodeFixAgentSource.AIAgent,
    });

    findRepositorySpy = jest.spyOn(CodeRepositoryService, "findOneById");

    const capSpy: jest.SpyInstance = jest.spyOn(
      OpenPullRequestCap,
      "checkForRepository",
    );
    capSpy.mockResolvedValue({ allowed: true });

    bindingSpy = jest.spyOn(
      GitHubInstallationBinding,
      "isInstallationBoundToProject",
    );

    mintTokenSpy = jest.spyOn(GitHubUtil, "getInstallationAccessToken");
    mintTokenSpy.mockResolvedValue({
      token: "ghs_live_token",
      expiresAt: OneUptimeDate.getCurrentDate(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The row IS in the attacker's own project — that check has always passed.
   * The installation ID on it is what decides whose repositories the token
   * opens.
   */
  function mockRepository(installationId: string | null): void {
    const repository: CodeRepository = new CodeRepository();
    repository.id = codeRepositoryId;
    repository.projectId = attackerProjectId;
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.organizationName = "victim-org";
    repository.repositoryName = "victim-private-repo";

    if (installationId) {
      repository.gitHubAppInstallationId = installationId;
    }

    findRepositorySpy.mockResolvedValue(repository);
  }

  async function callRoute(): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "attacker-self-issued-key",
        codeRepositoryId: codeRepositoryId.toString(),
      },
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("POST", TOKEN_ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);
  }

  describe("cross-tenant token minting", () => {
    /*
     * The advisory's step 3. Everything up to here passes: valid agent key,
     * repository row in the agent's own project. Only the binding check stands
     * between the attacker and a `ghs_` token over the victim's repositories.
     */
    test("refuses to mint when the row names an installation the project does not own", async () => {
      mockRepository(victimInstallationId);
      bindingSpy.mockResolvedValue(false);

      await callRoute();

      expect(mintTokenSpy).not.toHaveBeenCalled();
      expect(thrownError()).toBeInstanceOf(BadDataException);
    });

    test("returns no token in the response when the binding is missing", async () => {
      mockRepository(victimInstallationId);
      bindingSpy.mockResolvedValue(false);

      await callRoute();

      expect(jsonResponse()).toBeUndefined();
    });

    test("checks the binding against the repository's project and installation", async () => {
      mockRepository(ownInstallationId);
      bindingSpy.mockResolvedValue(true);

      await callRoute();

      expect(bindingSpy).toHaveBeenCalledTimes(1);

      const args: { projectId: ObjectID; installationId: string } = bindingSpy
        .mock.calls[0]![0] as {
        projectId: ObjectID;
        installationId: string;
      };

      expect(args.projectId.toString()).toBe(attackerProjectId.toString());
      expect(args.installationId).toBe(ownInstallationId);
    });

    /*
     * Being in the right project is necessary but not sufficient — pin that
     * the binding check is what gates the mint, so nobody "simplifies" it away
     * on the grounds that the project check already ran.
     */
    test("the project check alone does not authorize a mint", async () => {
      mockRepository(victimInstallationId);
      bindingSpy.mockResolvedValue(false);

      await callRoute();

      // Repository genuinely belongs to the caller's project...
      const repository: CodeRepository = (await findRepositorySpy.mock
        .results[0]!.value) as CodeRepository;
      expect(repository.projectId!.toString()).toBe(
        attackerProjectId.toString(),
      );

      // ...and it still does not get a token.
      expect(mintTokenSpy).not.toHaveBeenCalled();
    });

    test("checks the binding before calling GitHub at all", async () => {
      const callOrder: Array<string> = [];

      mockRepository(ownInstallationId);
      bindingSpy.mockImplementation(async (): Promise<boolean> => {
        callOrder.push("binding");
        return true;
      });
      mintTokenSpy.mockImplementation(async (): Promise<JSONObject> => {
        callOrder.push("mint");
        return {
          token: "ghs_live_token",
          expiresAt: OneUptimeDate.getCurrentDate(),
        } as unknown as JSONObject;
      });

      await callRoute();

      expect(callOrder).toEqual(["binding", "mint"]);
    });
  });

  describe("legitimate use keeps working", () => {
    test("mints a token when the project genuinely owns the installation", async () => {
      mockRepository(ownInstallationId);
      bindingSpy.mockResolvedValue(true);

      await callRoute();

      expect(thrownError()).toBeUndefined();
      expect(mintTokenSpy).toHaveBeenCalledTimes(1);
      expect(mintTokenSpy.mock.calls[0]![0]).toBe(ownInstallationId);
      expect(jsonResponse()!["token"]).toBe("ghs_live_token");
    });

    test("still requests only the scopes the agent needs", async () => {
      mockRepository(ownInstallationId);
      bindingSpy.mockResolvedValue(true);

      await callRoute();

      const options: {
        permissions: {
          contents?: string;
          pull_requests?: string;
          metadata?: string;
        };
      } = mintTokenSpy.mock.calls[0]![1] as {
        permissions: {
          contents?: string;
          pull_requests?: string;
          metadata?: string;
        };
      };

      expect(options.permissions.contents).toBe("write");
      expect(options.permissions.pull_requests).toBe("write");
      expect(options.permissions.metadata).toBe("read");
    });
  });

  describe("pre-existing guards still hold", () => {
    test("rejects invalid agent credentials before reading anything", async () => {
      jest
        .spyOn(CodeFixAgentAuth, "resolveAgentIdentity")
        .mockResolvedValue(null);

      await callRoute();

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(findRepositorySpy).not.toHaveBeenCalled();
      expect(mintTokenSpy).not.toHaveBeenCalled();
    });

    test("rejects a repository in another project without checking a binding", async () => {
      const repository: CodeRepository = new CodeRepository();
      repository.id = codeRepositoryId;
      repository.projectId = ObjectID.generate(); // someone else's project
      repository.repositoryHostedAt = CodeRepositoryType.GitHub;
      repository.gitHubAppInstallationId = victimInstallationId;
      findRepositorySpy.mockResolvedValue(repository);

      await callRoute();

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(bindingSpy).not.toHaveBeenCalled();
      expect(mintTokenSpy).not.toHaveBeenCalled();
    });

    test("rejects a repository with no installation id", async () => {
      mockRepository(null);

      await callRoute();

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(mintTokenSpy).not.toHaveBeenCalled();
    });

    test("rejects a repository that does not exist", async () => {
      findRepositorySpy.mockResolvedValue(null);

      await callRoute();

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(mintTokenSpy).not.toHaveBeenCalled();
    });

    test("still enforces the open pull request cap", async () => {
      mockRepository(ownInstallationId);
      bindingSpy.mockResolvedValue(true);

      const capSpy: jest.SpyInstance = jest.spyOn(
        OpenPullRequestCap,
        "checkForRepository",
      );
      capSpy.mockResolvedValue({ allowed: false, openCount: 5, limit: 5 });

      await callRoute();

      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(mintTokenSpy).not.toHaveBeenCalled();
    });
  });
});
