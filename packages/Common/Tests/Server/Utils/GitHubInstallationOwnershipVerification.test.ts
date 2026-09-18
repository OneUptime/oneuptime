import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import URL from "../../../Types/API/URL";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GHSA-xx95-gmcf-7q86 — proving the installer owns the installation.
 *
 * `installation_id` arrives on the install redirect as a bare integer in a
 * query string. Anyone can type any value there, so on its own it proves
 * nothing about who owns the installation — and OneUptime writes that value
 * into Project.gitHubAppInstallationId, which every token-minting path then
 * treats as authoritative.
 *
 * The OAuth `code` is what closes the gap: GitHub mints it for one specific
 * GitHub account and it is single-use, so trading it in reveals which
 * installations that account can actually administer.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    GitHubAppClientId: "test-client-id",
    GitHubAppClientSecret: "test-client-secret",
  };
});

function okResponse(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function errorResponse(statusCode: number): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, {}, {});
}

function installationsPage(ids: Array<number>): JSONObject {
  return {
    installations: ids.map((id: number) => {
      return { id: id };
    }),
  };
}

describe("GitHub installation ownership verification", () => {
  let postSpy: jest.SpyInstance;
  let getSpy: jest.SpyInstance;

  beforeEach(() => {
    postSpy = jest.spyOn(API, "post");
    getSpy = jest.spyOn(API, "get");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("exchangeOAuthCodeForUserAccessToken", () => {
    test("returns the user access token GitHub issues for the code", async () => {
      postSpy.mockResolvedValue(okResponse({ access_token: "gho_user_token" }));

      await expect(
        GitHubUtil.exchangeOAuthCodeForUserAccessToken("the-code"),
      ).resolves.toBe("gho_user_token");
    });

    test("sends the app credentials and the code to GitHub's token endpoint", async () => {
      postSpy.mockResolvedValue(okResponse({ access_token: "gho_user_token" }));

      await GitHubUtil.exchangeOAuthCodeForUserAccessToken("the-code");

      const callArgs: {
        url: URL;
        data: JSONObject;
      } = postSpy.mock.calls[0]![0] as { url: URL; data: JSONObject };

      expect(callArgs.url.toString()).toContain(
        "github.com/login/oauth/access_token",
      );
      expect(callArgs.data["client_id"]).toBe("test-client-id");
      expect(callArgs.data["client_secret"]).toBe("test-client-secret");
      expect(callArgs.data["code"]).toBe("the-code");
    });

    /*
     * GitHub answers a bad, expired or already-redeemed code with HTTP 200 and
     * an `error` body rather than a 4xx. Treating "not an HTTP error" as
     * success would accept a replayed or invented code and let the caller skip
     * verification entirely.
     */
    test("rejects a 200 response that carries no access token", async () => {
      postSpy.mockResolvedValue(
        okResponse({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
      );

      await expect(
        GitHubUtil.exchangeOAuthCodeForUserAccessToken("replayed-code"),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("rejects when GitHub returns an HTTP error", async () => {
      postSpy.mockResolvedValue(errorResponse(401));

      await expect(
        GitHubUtil.exchangeOAuthCodeForUserAccessToken("the-code"),
      ).rejects.toBeInstanceOf(BadDataException);
    });
  });

  describe("listInstallationIdsForUserAccessToken", () => {
    test("returns the installation ids the user can administer", async () => {
      getSpy.mockResolvedValue(okResponse(installationsPage([111, 222])));

      await expect(
        GitHubUtil.listInstallationIdsForUserAccessToken("gho_user_token"),
      ).resolves.toEqual(["111", "222"]);
    });

    test("asks GitHub as the user, not as the app", async () => {
      getSpy.mockResolvedValue(okResponse(installationsPage([111])));

      await GitHubUtil.listInstallationIdsForUserAccessToken("gho_user_token");

      const callArgs: {
        url: URL;
        headers: { Authorization?: string };
      } = getSpy.mock.calls[0]![0] as {
        url: URL;
        headers: { Authorization?: string };
      };

      expect(callArgs.url.toString()).toContain(
        "api.github.com/user/installations",
      );
      expect(callArgs.headers.Authorization).toBe("Bearer gho_user_token");
    });

    /*
     * A user with more than a page of installations must not silently lose the
     * one they are installing — that would fail a legitimate install.
     */
    test("pages through every installation", async () => {
      const firstPage: Array<number> = Array.from(
        { length: 100 },
        (_unused: unknown, index: number) => {
          return index + 1;
        },
      );

      getSpy
        .mockResolvedValueOnce(okResponse(installationsPage(firstPage)))
        .mockResolvedValueOnce(okResponse(installationsPage([999])));

      const ids: Array<string> =
        await GitHubUtil.listInstallationIdsForUserAccessToken("gho_token");

      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(ids).toHaveLength(101);
      expect(ids).toContain("999");
    });

    test("returns an empty list when the user administers nothing", async () => {
      getSpy.mockResolvedValue(okResponse({ installations: [] }));

      await expect(
        GitHubUtil.listInstallationIdsForUserAccessToken("gho_token"),
      ).resolves.toEqual([]);
    });

    test("rejects when GitHub returns an HTTP error", async () => {
      getSpy.mockResolvedValue(errorResponse(401));

      await expect(
        GitHubUtil.listInstallationIdsForUserAccessToken("gho_token"),
      ).rejects.toBeInstanceOf(BadDataException);
    });
  });

  describe("assertUserControlsInstallation", () => {
    beforeEach(() => {
      postSpy.mockResolvedValue(okResponse({ access_token: "gho_user_token" }));
    });

    test("resolves when the installation is one the user administers", async () => {
      getSpy.mockResolvedValue(okResponse(installationsPage([111, 222])));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "the-code",
          installationId: "222",
        }),
      ).resolves.toBeUndefined();
    });

    /*
     * The exact attack: a valid code for the attacker's own GitHub account,
     * paired with a victim's installation ID typed into the redirect URL.
     */
    test("rejects an installation the authorizing account does not administer", async () => {
      getSpy.mockResolvedValue(okResponse(installationsPage([111])));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "attackers-own-valid-code",
          installationId: "99999999",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("rejects when the user administers no installations at all", async () => {
      getSpy.mockResolvedValue(okResponse({ installations: [] }));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "the-code",
          installationId: "111",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    /*
     * Fail closed: a verification step that can be skipped by breaking the
     * call it depends on is not a verification step.
     */
    test("rejects rather than passing when the code exchange fails", async () => {
      postSpy.mockResolvedValue(okResponse({ error: "bad_verification_code" }));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "bad-code",
          installationId: "111",
        }),
      ).rejects.toBeInstanceOf(BadDataException);

      expect(getSpy).not.toHaveBeenCalled();
    });

    test("rejects rather than passing when the installation list cannot be read", async () => {
      getSpy.mockResolvedValue(errorResponse(500));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "the-code",
          installationId: "111",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    // Ids cross the boundary as strings on one side and numbers on the other.
    test("matches ids regardless of string/number representation", async () => {
      getSpy.mockResolvedValue(okResponse(installationsPage([12345678])));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "the-code",
          installationId: "12345678",
        }),
      ).resolves.toBeUndefined();
    });

    /*
     * A prefix or substring match would let "1111" pass for installation
     * "11110". Membership must be exact.
     */
    test("does not accept an installation id that merely looks similar", async () => {
      getSpy.mockResolvedValue(okResponse(installationsPage([11110])));

      await expect(
        GitHubUtil.assertUserControlsInstallation({
          oauthCode: "the-code",
          installationId: "1111",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });
  });
});

describe("GitHub OAuth verification when the app is not configured", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  /*
   * An instance without OAuth credentials must refuse to bind rather than
   * quietly skipping verification — a soft fallback here would reopen the
   * vulnerability for every self-hosted install that never set the vars.
   */
  test("refuses to exchange a code without client credentials", async () => {
    jest.resetModules();
    jest.doMock("../../../Server/EnvironmentConfig", () => {
      return {
        ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
          string,
          unknown
        >),
        GitHubAppClientId: null,
        GitHubAppClientSecret: null,
      };
    });

    /*
     * A re-require is the point here: the client credentials are read at
     * module load, so the unconfigured branch can only be reached by reloading
     * the module against a different mocked config.
     */
    const UnconfiguredGitHubUtil: typeof GitHubUtil =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../../Server/Utils/CodeRepository/GitHub/GitHub").default;

    const postSpy: jest.SpyInstance = jest.spyOn(API, "post");

    let thrown: Error | null = null;

    try {
      await UnconfiguredGitHubUtil.exchangeOAuthCodeForUserAccessToken(
        "the-code",
      );
    } catch (err) {
      thrown = err as Error;
    }

    /*
     * jest.resetModules() reloads the exception class too, so `instanceof`
     * would compare two distinct copies of it — assert the contract instead.
     */
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("GITHUB_APP_CLIENT_ID");
    expect(postSpy).not.toHaveBeenCalled();
  });
});
