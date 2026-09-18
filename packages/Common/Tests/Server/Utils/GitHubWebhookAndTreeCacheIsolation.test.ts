import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../Utils/API";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import * as crypto from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Two hardening fixes found while remediating GHSA-xx95-gmcf-7q86. Neither is
 * in the advisory; both sit on the same GitHub App code path.
 *
 * 1. verifyWebhookSignature used to return true when no webhook secret was
 *    configured, leaving POST /api/github/webhook unauthenticated on those
 *    instances — and its `installation.deleted` branch clears installation IDs
 *    across every tenant.
 *
 * 2. getRepositoryTreePaths caches a repository's full private file listing
 *    and reads that cache BEFORE minting a token, so the cache key is what
 *    stands in for access control on a hit. Keyed on org/repo/branch alone, it
 *    could serve one installation's file listing to another.
 */

const WEBHOOK_SECRET: string = "test-webhook-secret";

function loadGitHubUtilWithWebhookSecret(
  secret: string | null,
): typeof GitHubUtil {
  jest.resetModules();
  jest.doMock("../../../Server/EnvironmentConfig", () => {
    return {
      ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
        string,
        unknown
      >),
      GitHubAppWebhookSecret: secret,
    };
  });

  /*
   * A re-require is the point here: GitHubAppWebhookSecret is read at module
   * load, so the only way to exercise the unconfigured branch is to reload the
   * module against a different mocked config.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require("../../../Server/Utils/CodeRepository/GitHub/GitHub")
    .default as typeof GitHubUtil;
}

function signPayload(payload: string, secret: string): string {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;
}

describe("GitHub webhook signature verification", () => {
  const payload: string = JSON.stringify({
    action: "deleted",
    installation: { id: 12345678 },
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("accepts a correctly signed payload", () => {
    const util: typeof GitHubUtil =
      loadGitHubUtilWithWebhookSecret(WEBHOOK_SECRET);

    expect(
      util.verifyWebhookSignature(
        payload,
        signPayload(payload, WEBHOOK_SECRET),
      ),
    ).toBe(true);
  });

  test("rejects a payload signed with the wrong secret", () => {
    const util: typeof GitHubUtil =
      loadGitHubUtilWithWebhookSecret(WEBHOOK_SECRET);

    expect(
      util.verifyWebhookSignature(payload, signPayload(payload, "wrong")),
    ).toBe(false);
  });

  test("rejects a tampered payload", () => {
    const util: typeof GitHubUtil =
      loadGitHubUtilWithWebhookSecret(WEBHOOK_SECRET);

    const signature: string = signPayload(payload, WEBHOOK_SECRET);
    const tampered: string = JSON.stringify({
      action: "deleted",
      installation: { id: 99999999 },
    });

    expect(util.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  test("rejects a garbage signature without throwing", () => {
    const util: typeof GitHubUtil =
      loadGitHubUtilWithWebhookSecret(WEBHOOK_SECRET);

    expect(util.verifyWebhookSignature(payload, "not-a-signature")).toBe(false);
  });

  /*
   * The fix. Previously this returned true — so on an instance with no secret
   * configured, anyone who could reach the endpoint could send an
   * `installation.deleted` for any installation id and have OneUptime clear
   * that installation from every project that had it.
   */
  test("fails CLOSED when no webhook secret is configured", () => {
    const util: typeof GitHubUtil = loadGitHubUtilWithWebhookSecret(null);

    expect(
      util.verifyWebhookSignature(
        payload,
        signPayload(payload, WEBHOOK_SECRET),
      ),
    ).toBe(false);
  });

  test("an unconfigured instance rejects even a well-formed signature", () => {
    const util: typeof GitHubUtil = loadGitHubUtilWithWebhookSecret("");

    expect(util.verifyWebhookSignature(payload, signPayload(payload, ""))).toBe(
      false,
    );
  });
});

describe("Repository tree cache is scoped to the installation", () => {
  const TREE_RESPONSE: JSONObject = {
    tree: [
      { path: "src/secret.ts", type: "blob" },
      { path: "src", type: "tree" },
    ],
  };

  let getCacheSpy: jest.SpyInstance;
  let setCacheSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(GitHubUtil, "getInstallationAccessToken")
      .mockResolvedValue({ token: "ghs_token", expiresAt: new Date() });

    jest
      .spyOn(API, "get")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, TREE_RESPONSE, {}));

    getCacheSpy = jest.spyOn(GlobalCache, "getStringArray");
    getCacheSpy.mockResolvedValue(null);

    setCacheSpy = jest.spyOn(GlobalCache, "setStringArray");
    setCacheSpy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function argsFor(installationId: string): {
    installationId: string;
    organizationName: string;
    repositoryName: string;
    branchName: string;
  } {
    return {
      installationId: installationId,
      organizationName: "victim-org",
      repositoryName: "private-repo",
      branchName: "main",
    };
  }

  test("includes the installation id in the cache key", async () => {
    await GitHubUtil.getRepositoryTreePaths(argsFor("11111111"));

    const cacheKey: string = getCacheSpy.mock.calls[0]![1] as string;
    expect(cacheKey).toContain("11111111");
  });

  /*
   * The point of the fix: the same org/repo/branch reached through a different
   * installation must not collide, because a hit is served without minting a
   * token or calling GitHub at all.
   */
  test("two installations naming the same repository use different keys", async () => {
    await GitHubUtil.getRepositoryTreePaths(argsFor("11111111"));
    await GitHubUtil.getRepositoryTreePaths(argsFor("99999999"));

    const firstKey: string = getCacheSpy.mock.calls[0]![1] as string;
    const secondKey: string = getCacheSpy.mock.calls[1]![1] as string;

    expect(firstKey).not.toBe(secondKey);
  });

  test("writes back under the same installation-scoped key it read", async () => {
    await GitHubUtil.getRepositoryTreePaths(argsFor("11111111"));

    const readKey: string = getCacheSpy.mock.calls[0]![1] as string;
    const writeKey: string = setCacheSpy.mock.calls[0]![1] as string;

    expect(writeKey).toBe(readKey);
  });

  test("still distinguishes repositories and branches within one installation", async () => {
    await GitHubUtil.getRepositoryTreePaths({
      installationId: "11111111",
      organizationName: "org",
      repositoryName: "repo-a",
      branchName: "main",
    });
    await GitHubUtil.getRepositoryTreePaths({
      installationId: "11111111",
      organizationName: "org",
      repositoryName: "repo-b",
      branchName: "main",
    });
    await GitHubUtil.getRepositoryTreePaths({
      installationId: "11111111",
      organizationName: "org",
      repositoryName: "repo-a",
      branchName: "develop",
    });

    const keys: Array<string> = getCacheSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[1] as string;
      },
    );

    expect(new Set(keys).size).toBe(3);
  });

  test("serves a cache hit without minting a token", async () => {
    getCacheSpy.mockResolvedValue(["src/cached.ts"]);

    const paths: Array<string> = await GitHubUtil.getRepositoryTreePaths(
      argsFor("11111111"),
    );

    expect(paths).toEqual(["src/cached.ts"]);
    expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
  });
});
