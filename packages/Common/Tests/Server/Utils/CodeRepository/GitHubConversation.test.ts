/*
 * ---------------------------------------------------------------------------
 * GitHubConversation — the CONVERSATION half of the interactive GitHub App.
 *
 * Every method here writes into a repository OneUptime does not own, on behalf
 * of whoever typed "@oneuptime <something>" into a thread that anyone with a
 * GitHub account can post to. Four invariants are pinned below, and each one
 * is a real incident if it regresses:
 *
 * 1. AUTHORIZATION FAILS CLOSED. getUserRepositoryPermission is the only
 *    question that decides whether a command runs at all — `author_association`
 *    on the webhook payload describes past activity, not permission. So every
 *    way this call can go wrong (404, 403, 500, a thrown request, an
 *    installation token that can no longer be minted) has to answer None.
 *    Refusing a command because GitHub was unreachable is a bad minute;
 *    running one because GitHub was unreachable is a stranger writing to
 *    someone else's repository. `role_name` is preferred over the
 *    backwards-compatible `permission` field for the same reason: that field
 *    flattens "triage" to "read" and "maintain" to "write", and Triage — which
 *    may label and close but may not push — must never be able to command the
 *    agent.
 *
 * 2. A REVIEW IS A COMMENT, NEVER AN APPROVAL. An APPROVE submitted by the app
 *    satisfies a branch protection rule, which turns an automated reviewer into
 *    an automated merger. The review's opinion belongs in its text.
 *
 * 3. NOTHING COSMETIC MAY FAIL A COMMAND, AND NOTHING MAY LOOP. A reaction
 *    that does not land returns false instead of throwing, and a comment
 *    written by ANY bot is recognised as one so the app never answers itself.
 *
 * 4. A FORK'S BRANCH IS NOT PUSHABLE. isFromFork gates the "revise this" path;
 *    a wrong answer either pushes nothing or creates a same-named branch in the
 *    BASE repository that the pull request does not point at.
 *
 * The installation-token cache is covered here too. That token is a live write
 * credential for other people's repositories, so both halves matter: one token
 * for a burst of calls, and never one installation's token on another
 * installation's request.
 * ---------------------------------------------------------------------------
 */

import GitHubConversation, {
  GitHubIssueComment,
  GitHubPullRequestDetails,
  GitHubReaction,
  GitHubRepositoryPermission,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubUtil, {
  GitHubInstallationToken,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Headers from "../../../../Types/API/Headers";
import URL from "../../../../Types/API/URL";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const getMock: jest.Mock = jest.fn();
const postMock: jest.Mock = jest.fn();
const patchMock: jest.Mock = jest.fn();

/*
 * jest hoists this above the imports, so the factory runs before
 * GitHubConversation is loaded. The mocks are only dereferenced inside the
 * arrows — reading them in the factory body itself would hit the TDZ.
 *
 * The path is the one the source resolves to ("../../../../Utils/API" from
 * Common/Server/Utils/CodeRepository/GitHub), reached from this file's own
 * directory.
 */
jest.mock("../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      patch: (...args: Array<unknown>) => {
        return patchMock(...args);
      },
    },
  };
});

const REPO: {
  installationId: string;
  organizationName: string;
  repositoryName: string;
} = {
  installationId: "installation-1",
  organizationName: "acme",
  repositoryName: "checkout",
};

let tokenSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let debugSpy: jest.SpyInstance;

function installationToken(
  token: string,
  expiresInSeconds: number,
): GitHubInstallationToken {
  return {
    token: token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  };
}

function okJson(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function okArray(data: Array<JSONObject>): HTTPResponse<JSONArray> {
  return new HTTPResponse<JSONArray>(200, data, {});
}

function errorResponse(
  statusCode: number,
  data: JSONObject,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, data, {});
}

interface ApiCall {
  url: URL;
  data?: JSONObject | undefined;
  headers: Headers;
}

// The Nth call's options object, 1-indexed so retries read the way they happen.
function callAt(
  mock: jest.Mock,
  callNumber: number,
  methodName: string,
): ApiCall {
  const args: Array<ApiCall> | undefined = mock.mock.calls[callNumber - 1] as
    | Array<ApiCall>
    | undefined;

  if (!args || !args[0]) {
    throw new Error(`API.${methodName} was not called ${callNumber} time(s)`);
  }

  return args[0];
}

function postCall(callNumber: number): ApiCall {
  return callAt(postMock, callNumber, "post");
}

function getCall(callNumber: number): ApiCall {
  return callAt(getMock, callNumber, "get");
}

function patchCall(callNumber: number): ApiCall {
  return callAt(patchMock, callNumber, "patch");
}

function postBody(callNumber: number): JSONObject {
  return postCall(callNumber).data || {};
}

function everyPostedBody(): Array<JSONObject> {
  return postMock.mock.calls.map((args: Array<unknown>): JSONObject => {
    return (args[0] as ApiCall).data || {};
  });
}

// GitHub's issue-comment shape, trimmed to the fields the mapper reads.
function commentJson(overrides: JSONObject): JSONObject {
  return {
    id: 555,
    html_url: "https://github.com/acme/checkout/issues/42#issuecomment-555",
    body: "on it",
    user: { login: "octocat", type: "User" },
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

async function postAComment(body: string): Promise<GitHubIssueComment> {
  return GitHubConversation.createIssueComment({
    ...REPO,
    issueNumber: 42,
    body: body,
  });
}

beforeEach(() => {
  /*
   * The token cache is a module-level Map, so without this the first case to
   * mint a token would silently satisfy every case after it.
   */
  GitHubConversation.clearTokenCache();

  getMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();

  tokenSpy = jest
    .spyOn(GitHubUtil, "getInstallationAccessToken")
    .mockResolvedValue(installationToken("ghs_installation_1", 60 * 60));

  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  debugSpy = jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  // Spies mutate shared module state that leaks between tests in one worker.
  jest.restoreAllMocks();
});

describe("GitHubConversation", () => {
  describe("slugifyAppName — the display name a mention has to match", () => {
    test("lowercases a single-word app name", () => {
      expect(GitHubConversation.slugifyAppName("OneUptime")).toBe("oneuptime");
    });

    /*
     * The whole reason this exists: GITHUB_APP_NAME holds the DISPLAY name,
     * and GitHub derives "@acme-ai-bot" from it. An app configured as
     * "Acme AI Bot" that looked for "@Acme AI Bot" would never match a
     * mention, and every command would be silently dropped.
     */
    test("turns each run of spaces in a display name into one hyphen", () => {
      expect(GitHubConversation.slugifyAppName("Acme AI Bot")).toBe(
        "acme-ai-bot",
      );
      expect(GitHubConversation.slugifyAppName("Acme   AI    Bot")).toBe(
        "acme-ai-bot",
      );
    });

    test("trims surrounding whitespace before slugifying", () => {
      expect(GitHubConversation.slugifyAppName("   OneUptime   ")).toBe(
        "oneuptime",
      );
    });

    test("drops leading and trailing punctuation instead of hyphenating it", () => {
      expect(GitHubConversation.slugifyAppName("  ~OneUptime!  ")).toBe(
        "oneuptime",
      );
      expect(GitHubConversation.slugifyAppName("---OneUptime---")).toBe(
        "oneuptime",
      );
    });

    test("keeps digits, which are legal in a GitHub slug", () => {
      expect(GitHubConversation.slugifyAppName("OneUptime 2")).toBe(
        "oneuptime-2",
      );
    });

    test("collapses emoji and other non-alphanumerics inside the name", () => {
      expect(GitHubConversation.slugifyAppName("OneUptime 🚀 AI")).toBe(
        "oneuptime-ai",
      );
      expect(GitHubConversation.slugifyAppName("One_Uptime/AI")).toBe(
        "one-uptime-ai",
      );
    });

    test("answers null for an empty, blank or missing app name", () => {
      expect(GitHubConversation.slugifyAppName("")).toBeNull();
      expect(GitHubConversation.slugifyAppName("     ")).toBeNull();
      expect(GitHubConversation.slugifyAppName("\t\n")).toBeNull();
      expect(GitHubConversation.slugifyAppName(null)).toBeNull();
    });

    /*
     * A name with nothing sluggable left must answer null, never "". An empty
     * slug would build a bot login of "[bot]", and isBotLogin("[bot]") is true
     * for it — i.e. every bot on the platform would read as THIS app.
     */
    test("answers null when nothing sluggable survives, never an empty slug", () => {
      expect(GitHubConversation.slugifyAppName("!!!")).toBeNull();
      expect(GitHubConversation.slugifyAppName("---")).toBeNull();
      expect(GitHubConversation.slugifyAppName("日本語")).toBeNull();
      expect(GitHubConversation.slugifyAppName("🚀")).toBeNull();
    });
  });

  describe("toBotLogin", () => {
    test("appends GitHub's [bot] suffix to the slug", () => {
      expect(GitHubConversation.toBotLogin("oneuptime")).toBe("oneuptime[bot]");
    });

    test("lowercases the slug, because GitHub's bot login is lowercase", () => {
      expect(GitHubConversation.toBotLogin("OneUptime")).toBe("oneuptime[bot]");
    });

    test("composes with slugifyAppName to go from display name to bot login", () => {
      const slug: string | null =
        GitHubConversation.slugifyAppName("Acme AI Bot");

      expect(slug).not.toBeNull();
      expect(GitHubConversation.toBotLogin(slug as string)).toBe(
        "acme-ai-bot[bot]",
      );
    });

    test("round-trips: the login it builds is recognised as a bot login", () => {
      expect(
        GitHubConversation.isBotLogin(
          GitHubConversation.toBotLogin("oneuptime"),
        ),
      ).toBe(true);
    });
  });

  describe("isBotLogin — the loop guard", () => {
    test("recognises this app's own login", () => {
      expect(GitHubConversation.isBotLogin("oneuptime[bot]")).toBe(true);
    });

    /*
     * Deliberately broad: two bots mentioning each other is the failure mode
     * that burns a budget overnight, so ANY app's login counts.
     */
    test("recognises any other app's login too, not only this app's", () => {
      expect(GitHubConversation.isBotLogin("dependabot[bot]")).toBe(true);
      expect(GitHubConversation.isBotLogin("renovate[bot]")).toBe(true);
      expect(GitHubConversation.isBotLogin("github-actions[bot]")).toBe(true);
    });

    test("is case-insensitive about the suffix", () => {
      expect(GitHubConversation.isBotLogin("OneUptime[BOT]")).toBe(true);
      expect(GitHubConversation.isBotLogin("OneUptime[Bot]")).toBe(true);
    });

    test("does not treat a human login as a bot", () => {
      expect(GitHubConversation.isBotLogin("octocat")).toBe(false);
      expect(GitHubConversation.isBotLogin("bot")).toBe(false);
      expect(GitHubConversation.isBotLogin("not-a-bot")).toBe(false);
      expect(GitHubConversation.isBotLogin("robot")).toBe(false);
    });

    /*
     * The suffix has to be at the END. A human who put "[bot]" anywhere else
     * in their login would otherwise have every command they type dropped.
     */
    test("only matches the suffix, not [bot] anywhere in the login", () => {
      expect(GitHubConversation.isBotLogin("[bot]octocat")).toBe(false);
      expect(GitHubConversation.isBotLogin("oct[bot]ocat")).toBe(false);
      expect(GitHubConversation.isBotLogin("oneuptime[bot]-real")).toBe(false);
    });

    test("treats a missing login as human-unknown rather than throwing", () => {
      expect(GitHubConversation.isBotLogin(null)).toBe(false);
      expect(GitHubConversation.isBotLogin(undefined)).toBe(false);
      expect(GitHubConversation.isBotLogin("")).toBe(false);
    });
  });

  describe("canCommandApp — who may drive the agent", () => {
    test("allows the three permissions that can already push", () => {
      expect(
        GitHubConversation.canCommandApp(GitHubRepositoryPermission.Write),
      ).toBe(true);
      expect(
        GitHubConversation.canCommandApp(GitHubRepositoryPermission.Maintain),
      ).toBe(true);
      expect(
        GitHubConversation.canCommandApp(GitHubRepositoryPermission.Admin),
      ).toBe(true);
    });

    /*
     * Read is anyone who can see the repository — on a public repository, the
     * whole internet. Triage may label and close but may NOT push, so it must
     * not be able to make the app push either.
     */
    test("refuses Read, Triage and None", () => {
      expect(
        GitHubConversation.canCommandApp(GitHubRepositoryPermission.Read),
      ).toBe(false);
      expect(
        GitHubConversation.canCommandApp(GitHubRepositoryPermission.Triage),
      ).toBe(false);
      expect(
        GitHubConversation.canCommandApp(GitHubRepositoryPermission.None),
      ).toBe(false);
    });

    // A permission level added later defaults to refused until considered.
    test("allows exactly three of the known permission levels", () => {
      const allowed: Array<GitHubRepositoryPermission> = Object.values(
        GitHubRepositoryPermission,
      ).filter((permission: GitHubRepositoryPermission) => {
        return GitHubConversation.canCommandApp(permission);
      });

      expect(allowed).toEqual([
        GitHubRepositoryPermission.Write,
        GitHubRepositoryPermission.Maintain,
        GitHubRepositoryPermission.Admin,
      ]);
    });
  });

  describe("isFromFork — whether the head branch is pushable at all", () => {
    function isFork(headRepositoryFullName: string | null): boolean {
      return GitHubConversation.isFromFork({
        headRepositoryFullName: headRepositoryFullName,
        organizationName: "Acme",
        repositoryName: "Checkout",
      });
    }

    test("says no for a branch in the same repository", () => {
      expect(isFork("Acme/Checkout")).toBe(false);
    });

    /*
     * GitHub owner and repository names are case-insensitive, and the webhook
     * payload's casing does not always match the configuration's. Treating a
     * case difference as a fork would refuse every revision on a repository
     * whose name was stored with different capitalisation.
     */
    test("compares owner and repository case-insensitively", () => {
      expect(isFork("acme/checkout")).toBe(false);
      expect(isFork("ACME/CHECKOUT")).toBe(false);
      expect(isFork("aCmE/ChEcKoUt")).toBe(false);
    });

    test("says yes when the owner differs", () => {
      expect(isFork("contributor/Checkout")).toBe(true);
      expect(isFork("evil-acme/Checkout")).toBe(true);
    });

    test("says yes when the repository name differs", () => {
      expect(isFork("Acme/Checkout-fork")).toBe(true);
      expect(isFork("Acme/Check")).toBe(true);
      expect(isFork("Acme/checkout2")).toBe(true);
    });

    /*
     * GitHub reports a null head repository for a fork that has been deleted.
     * That branch is certainly not one this installation can push to, so the
     * answer has to be "fork" — the fail-closed direction.
     */
    test("treats a deleted fork (null head repository) as a fork", () => {
      expect(isFork(null)).toBe(true);
    });

    test("treats an empty or whitespace-padded head repository as a fork", () => {
      expect(isFork("")).toBe(true);
      expect(isFork(" Acme/Checkout")).toBe(true);
      expect(isFork("Acme/Checkout ")).toBe(true);
    });
  });

  describe("getUserRepositoryPermission — the authorization question", () => {
    function permissionOf(
      username: string,
    ): Promise<GitHubRepositoryPermission> {
      return GitHubConversation.getUserRepositoryPermission({
        ...REPO,
        username: username,
      });
    }

    /*
     * The top-level `permission` field collapses "maintain" to "write" and
     * "triage" to "read" for backwards compatibility, so role_name has to win.
     */
    test("prefers role_name so a maintainer is not flattened to write", async () => {
      getMock.mockResolvedValueOnce(
        okJson({ permission: "write", role_name: "maintain" }),
      );

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.Maintain,
      );
    });

    /*
     * The security-relevant half of the same preference. A triage user reads
     * as "read" on the compatibility field; either way they may not command
     * the app, and the answer must name the real role.
     */
    test("prefers role_name so a triage user is reported as Triage, and refused", async () => {
      getMock.mockResolvedValueOnce(
        okJson({ permission: "read", role_name: "triage" }),
      );

      const permission: GitHubRepositoryPermission =
        await permissionOf("triager");

      expect(permission).toBe(GitHubRepositoryPermission.Triage);
      expect(GitHubConversation.canCommandApp(permission)).toBe(false);
    });

    test("reads an admin as Admin", async () => {
      getMock.mockResolvedValueOnce(
        okJson({ permission: "admin", role_name: "admin" }),
      );

      await expect(permissionOf("owner")).resolves.toBe(
        GitHubRepositoryPermission.Admin,
      );
    });

    test("falls back to the permission field when GitHub sends no role_name", async () => {
      getMock.mockResolvedValueOnce(okJson({ permission: "write" }));

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.Write,
      );
    });

    test("lowercases whatever casing GitHub used", async () => {
      getMock
        .mockResolvedValueOnce(okJson({ permission: "WRITE" }))
        .mockResolvedValueOnce(
          okJson({ permission: "write", role_name: "Maintain" }),
        );

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.Write,
      );
      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.Maintain,
      );
    });

    /*
     * An organization's custom role name is not one of GitHub's six. Falling
     * back to the coarse field keeps a custom read-only role read-only rather
     * than inventing a level for it.
     */
    test("falls back to the coarse field for an organization's custom role name", async () => {
      getMock.mockResolvedValueOnce(
        okJson({ permission: "read", role_name: "security-auditor" }),
      );

      const permission: GitHubRepositoryPermission =
        await permissionOf("auditor");

      expect(permission).toBe(GitHubRepositoryPermission.Read);
      expect(GitHubConversation.canCommandApp(permission)).toBe(false);
    });

    test("answers None when neither field names a permission it knows", async () => {
      getMock.mockResolvedValueOnce(
        okJson({ permission: "banana", role_name: "banana" }),
      );

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );
    });

    test("answers None for a response body with no permission at all", async () => {
      getMock.mockResolvedValueOnce(okJson({}));

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );
    });

    /*
     * 404 is GitHub's answer both for "not a collaborator" and for "no such
     * user". Both are ordinary — the overwhelming majority of commands from
     * strangers land here — and logging them as warnings would bury the real
     * failures.
     */
    test("answers None for a 404 WITHOUT logging it as a problem", async () => {
      getMock.mockResolvedValueOnce(
        errorResponse(404, { message: "Not Found" }),
      );

      await expect(permissionOf("a-stranger")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );

      expect(warnSpy).not.toHaveBeenCalled();
    });

    test("answers None for a 403, and does say so in the log", async () => {
      getMock.mockResolvedValueOnce(
        errorResponse(403, { message: "Resource not accessible" }),
      );

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test("answers None for a 500 rather than letting the command through", async () => {
      getMock.mockResolvedValueOnce(
        errorResponse(500, { message: "Server Error" }),
      );

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );
    });

    /*
     * The fail-closed property. A rejected request — DNS, TLS, a socket
     * hang-up — must not propagate as an exception the caller might treat as
     * "check skipped", and must never resolve to a usable permission.
     */
    test("answers None when the request throws instead of answering", async () => {
      getMock.mockRejectedValueOnce(new Error("socket hang up"));

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );
    });

    test("answers None when the installation token cannot be minted", async () => {
      tokenSpy.mockRejectedValueOnce(new Error("installation not found"));

      await expect(permissionOf("octocat")).resolves.toBe(
        GitHubRepositoryPermission.None,
      );

      expect(getMock).not.toHaveBeenCalled();
    });

    test("asks the collaborator permission endpoint with the installation token", async () => {
      getMock.mockResolvedValueOnce(okJson({ permission: "write" }));

      await permissionOf("octocat");

      expect(getCall(1).url.toString()).toBe(
        "https://api.github.com/repos/acme/checkout/collaborators/octocat/permission",
      );
      expect(getCall(1).headers["Authorization"]).toBe(
        "Bearer ghs_installation_1",
      );
    });

    /*
     * The username comes off a webhook payload, i.e. from whoever typed the
     * comment. Encoding keeps it a single path segment, so it cannot walk out
     * of /collaborators/ into another endpoint whose answer would be read as
     * a permission.
     */
    test("url-encodes the username so it cannot escape the collaborators path", async () => {
      getMock.mockResolvedValueOnce(okJson({ permission: "none" }));

      await permissionOf("../../../orgs/acme/members");

      const requestedUrl: string = getCall(1).url.toString();

      expect(requestedUrl).toContain(
        "/collaborators/..%2F..%2F..%2Forgs%2Facme%2Fmembers/permission",
      );
      expect(requestedUrl).not.toContain("/orgs/acme/members");
    });

    test("url-encodes a username with spaces or unicode rather than sending it raw", async () => {
      getMock.mockResolvedValueOnce(okJson({ permission: "none" }));

      await permissionOf("oct cat");

      expect(getCall(1).url.toString()).toContain(
        "/collaborators/oct%20cat/permission",
      );
    });
  });

  describe("createPullRequestReview — a comment, never an approval", () => {
    const REVIEW_URL: string =
      "https://api.github.com/repos/acme/checkout/pulls/12/reviews";

    function reviewCreated(): HTTPResponse<JSONObject> {
      return okJson({
        html_url:
          "https://github.com/acme/checkout/pull/12#pullrequestreview-9001",
      });
    }

    function postReview(data: {
      body?: string;
      comments?: Array<{ path: string; line: number; body: string }>;
      commitSha?: string | undefined;
    }): Promise<string> {
      return GitHubConversation.createPullRequestReview({
        ...REPO,
        pullRequestNumber: 12,
        body: data.body ?? "Two things stood out.",
        comments: data.comments ?? [],
        commitSha: data.commitSha,
      });
    }

    test("submits the review as an event of COMMENT", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await postReview({});

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postBody(1)["event"]).toBe("COMMENT");
    });

    /*
     * An APPROVE from the app satisfies a branch protection rule, which makes
     * the automated reviewer an automated merger. REQUEST_CHANGES is the other
     * side of the same coin: it BLOCKS a merge until the app dismisses it.
     */
    test("never sends APPROVE or REQUEST_CHANGES, whatever the review text says", async () => {
      postMock
        .mockResolvedValueOnce(errorResponse(422, { message: "bad anchor" }))
        .mockResolvedValueOnce(reviewCreated());

      await postReview({
        body: "LGTM — I approve of this, no changes requested.",
        comments: [{ path: "src/a.ts", line: 3, body: "approve" }],
      });

      const serialized: string = JSON.stringify(everyPostedBody());

      expect(serialized).not.toContain("APPROVE");
      expect(serialized).not.toContain("REQUEST_CHANGES");

      for (const body of everyPostedBody()) {
        expect(body["event"]).toBe("COMMENT");
      }
    });

    test("posts once, with no comments key, when there are no inline comments", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await postReview({ body: "Looks reasonable." });

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(Object.keys(postBody(1))).not.toContain("comments");
      expect(postBody(1)["body"]).toBe("Looks reasonable.");
    });

    test("anchors inline comments to the RIGHT side of the diff", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await postReview({
        comments: [
          { path: "src/checkout.ts", line: 42, body: "cart may be undefined" },
          { path: "src/cart.ts", line: 7, body: "unused import" },
        ],
      });

      expect(postBody(1)["comments"]).toEqual([
        {
          path: "src/checkout.ts",
          line: 42,
          side: "RIGHT",
          body: "cart may be undefined",
        },
        { path: "src/cart.ts", line: 7, side: "RIGHT", body: "unused import" },
      ]);
    });

    test("pins the review to the reviewed commit when a sha is given", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await postReview({ commitSha: "abc123" });

      expect(postBody(1)["commit_id"]).toBe("abc123");
    });

    test("omits commit_id entirely when no sha is given", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await postReview({ commitSha: undefined });

      expect(Object.keys(postBody(1))).not.toContain("commit_id");
    });

    test("posts to the pull request's reviews endpoint with the installation token", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await postReview({});

      expect(postCall(1).url.toString()).toBe(REVIEW_URL);
      expect(postCall(1).headers["Authorization"]).toBe(
        "Bearer ghs_installation_1",
      );
    });

    test("returns the review's html url", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      await expect(postReview({})).resolves.toBe(
        "https://github.com/acme/checkout/pull/12#pullrequestreview-9001",
      );
    });

    test("returns an empty string when GitHub answers without an html url", async () => {
      postMock.mockResolvedValueOnce(okJson({ id: 1 }));

      await expect(postReview({})).resolves.toBe("");
    });

    test("sends a unicode review body through verbatim", async () => {
      postMock.mockResolvedValueOnce(reviewCreated());

      const body: string = "レビュー: `cart` は undefined になり得ます 🚨";

      await postReview({ body: body });

      expect(postBody(1)["body"]).toBe(body);
    });

    describe("when GitHub rejects the inline anchors", () => {
      /*
       * 422 is GitHub's answer for an anchor that is not part of the diff — a
       * line the agent misjudged, a file whose patch was elided, a review
       * racing a force-push. Losing the whole review to one bad anchor is far
       * worse than losing the anchors.
       */
      test("retries with the body alone and succeeds", async () => {
        postMock
          .mockResolvedValueOnce(
            errorResponse(422, {
              message: "Validation Failed",
              errors: [{ resource: "PullRequestReviewComment", field: "line" }],
            }),
          )
          .mockResolvedValueOnce(reviewCreated());

        await expect(
          postReview({
            comments: [{ path: "gone.ts", line: 999, body: "?" }],
          }),
        ).resolves.toBe(
          "https://github.com/acme/checkout/pull/12#pullrequestreview-9001",
        );

        expect(postMock).toHaveBeenCalledTimes(2);
        expect(Object.keys(postBody(2))).not.toContain("comments");
      });

      test("keeps the body, the event and the commit on the retry", async () => {
        postMock
          .mockResolvedValueOnce(errorResponse(422, { message: "nope" }))
          .mockResolvedValueOnce(reviewCreated());

        await postReview({
          body: "The retry must still say this.",
          comments: [{ path: "gone.ts", line: 999, body: "?" }],
          commitSha: "abc123",
        });

        expect(postBody(2)).toEqual({
          body: "The retry must still say this.",
          event: "COMMENT",
          commit_id: "abc123",
        });
      });

      /*
       * The dropped anchors are the one thing a reader of the posted review
       * cannot see, so the log has to name the pull request they were dropped
       * from — and say what happened instead, rather than reading as a failure.
       */
      test("logs which pull request lost its anchors, and that the body still went out", async () => {
        postMock
          .mockResolvedValueOnce(errorResponse(422, { message: "nope" }))
          .mockResolvedValueOnce(reviewCreated());

        await postReview({
          comments: [{ path: "gone.ts", line: 999, body: "?" }],
        });

        const logged: string = String(debugSpy.mock.calls[0]?.[0] ?? "");

        expect(logged).toContain("acme/checkout#12");
        expect(logged).toContain("on its own");
        expect(warnSpy).not.toHaveBeenCalled();
      });

      /*
       * With no comments there is nothing to drop, so a retry would re-post an
       * identical review — either a duplicate on the pull request or a second
       * copy of the same failure in place of the real one.
       */
      test("does NOT retry a 422 when there were no inline comments to drop", async () => {
        const failure: HTTPErrorResponse = errorResponse(422, {
          message: "Validation Failed",
        });

        postMock.mockResolvedValueOnce(failure);

        await expect(postReview({})).rejects.toBe(failure);

        expect(postMock).toHaveBeenCalledTimes(1);
      });

      test("does NOT retry a failure that is not a 422", async () => {
        const failure: HTTPErrorResponse = errorResponse(403, {
          message: "Resource not accessible by integration",
        });

        postMock.mockResolvedValueOnce(failure);

        await expect(
          postReview({
            comments: [{ path: "src/a.ts", line: 1, body: "?" }],
          }),
        ).rejects.toBe(failure);

        expect(postMock).toHaveBeenCalledTimes(1);
      });

      test("surfaces the retry's own failure rather than the first one", async () => {
        const retryFailure: HTTPErrorResponse = errorResponse(401, {
          message: "Bad credentials",
        });

        postMock
          .mockResolvedValueOnce(errorResponse(422, { message: "nope" }))
          .mockResolvedValueOnce(retryFailure);

        await expect(
          postReview({
            comments: [{ path: "src/a.ts", line: 1, body: "?" }],
          }),
        ).rejects.toBe(retryFailure);

        expect(postMock).toHaveBeenCalledTimes(2);
      });

      test("retries at most once, never in a loop", async () => {
        postMock
          .mockResolvedValueOnce(errorResponse(422, { message: "nope" }))
          .mockResolvedValueOnce(errorResponse(422, { message: "nope again" }));

        await expect(
          postReview({
            comments: [{ path: "src/a.ts", line: 1, body: "?" }],
          }),
        ).rejects.toBeInstanceOf(HTTPErrorResponse);

        expect(postMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("the installation token cache", () => {
    beforeEach(() => {
      postMock.mockResolvedValue(okJson(commentJson({})));
    });

    /*
     * Answering one mention touches GitHub five or six times. Minting a fresh
     * ghs_ token for each is pointless latency and a real slice of the
     * installation's rate limit.
     */
    test("mints ONE token for two conversation calls in a row", async () => {
      await postAComment("first");
      await postAComment("second");

      expect(tokenSpy).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledTimes(2);
      expect(postCall(1).headers["Authorization"]).toBe(
        "Bearer ghs_installation_1",
      );
      expect(postCall(2).headers["Authorization"]).toBe(
        "Bearer ghs_installation_1",
      );
    });

    /*
     * The cache is keyed by installation. One shared entry would send one
     * tenant's write credential to another tenant's repository — the single
     * worst thing this file could do.
     */
    test("never reuses one installation's token on another installation's request", async () => {
      tokenSpy
        .mockResolvedValueOnce(installationToken("ghs_tenant_a", 60 * 60))
        .mockResolvedValueOnce(installationToken("ghs_tenant_b", 60 * 60));

      await GitHubConversation.createIssueComment({
        installationId: "installation-a",
        organizationName: "acme",
        repositoryName: "checkout",
        issueNumber: 1,
        body: "hello",
      });

      await GitHubConversation.createIssueComment({
        installationId: "installation-b",
        organizationName: "other",
        repositoryName: "shop",
        issueNumber: 1,
        body: "hello",
      });

      expect(tokenSpy).toHaveBeenCalledTimes(2);
      expect(postCall(1).headers["Authorization"]).toBe("Bearer ghs_tenant_a");
      expect(postCall(2).headers["Authorization"]).toBe("Bearer ghs_tenant_b");
    });

    test("re-mints a token GitHub has already expired", async () => {
      tokenSpy
        .mockResolvedValueOnce(installationToken("ghs_expired", -5 * 60))
        .mockResolvedValueOnce(installationToken("ghs_fresh", 60 * 60));

      await postAComment("first");
      await postAComment("second");

      expect(tokenSpy).toHaveBeenCalledTimes(2);
      expect(postCall(2).headers["Authorization"]).toBe("Bearer ghs_fresh");
    });

    /*
     * The safety margin. A token with 30 seconds left passes a naive
     * "expiresAt > now" check and then expires between that check and the
     * request that uses it — a 401 on a command the user watched acknowledge.
     */
    test("re-mints a token that expires inside the safety margin", async () => {
      tokenSpy
        .mockResolvedValueOnce(installationToken("ghs_nearly_stale", 30))
        .mockResolvedValueOnce(installationToken("ghs_fresh", 60 * 60));

      await postAComment("first");
      await postAComment("second");

      expect(tokenSpy).toHaveBeenCalledTimes(2);
      expect(postCall(2).headers["Authorization"]).toBe("Bearer ghs_fresh");
    });

    test("keeps a token that is comfortably clear of the margin", async () => {
      tokenSpy.mockResolvedValueOnce(installationToken("ghs_good", 5 * 60));

      await postAComment("first");
      await postAComment("second");

      expect(tokenSpy).toHaveBeenCalledTimes(1);
      expect(postCall(2).headers["Authorization"]).toBe("Bearer ghs_good");
    });

    test("clearTokenCache forces the next call to mint again", async () => {
      await postAComment("first");

      GitHubConversation.clearTokenCache();

      await postAComment("second");

      expect(tokenSpy).toHaveBeenCalledTimes(2);
    });

    /*
     * Least privilege for the conversation path: it may write conversation
     * (GitHub routes pull request comments through the issues API) and
     * reviews, but only READ code. Anything that changes code goes through
     * GitHub.ts with its own, wider token.
     */
    test("asks for issues:write and pull_requests:write but only contents:read", async () => {
      await postAComment("first");

      expect(tokenSpy).toHaveBeenCalledWith("installation-1", {
        permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "read",
          metadata: "read",
        },
      });
    });
  });

  describe("addReactionToComment / addReactionToIssue", () => {
    test("reacts on the comment and reports that it landed", async () => {
      postMock.mockResolvedValueOnce(okJson({ id: 1, content: "eyes" }));

      await expect(
        GitHubConversation.addReactionToComment({
          ...REPO,
          commentId: 99,
          reaction: GitHubReaction.Eyes,
        }),
      ).resolves.toBe(true);

      expect(postCall(1).url.toString()).toBe(
        "https://api.github.com/repos/acme/checkout/issues/comments/99/reactions",
      );
      expect(postBody(1)).toEqual({ content: "eyes" });
    });

    /*
     * The issue route and the comment route differ by one path segment, and
     * reacting on the wrong one puts an emoji on an unrelated object — comment
     * ids and issue numbers are different id spaces.
     */
    test("reacts on the issue itself through the issue route", async () => {
      postMock.mockResolvedValueOnce(okJson({ id: 1, content: "rocket" }));

      await expect(
        GitHubConversation.addReactionToIssue({
          ...REPO,
          issueNumber: 7,
          reaction: GitHubReaction.Rocket,
        }),
      ).resolves.toBe(true);

      expect(postCall(1).url.toString()).toBe(
        "https://api.github.com/repos/acme/checkout/issues/7/reactions",
      );
      expect(postBody(1)).toEqual({ content: "rocket" });
    });

    /*
     * A reaction is the cheapest acknowledgement there is, and it is never
     * worth failing a command over. Every failure below has to come back as
     * false — a throw here would abort a run the user had already been told
     * was starting.
     */
    test("returns false, without throwing, when GitHub refuses the reaction", async () => {
      postMock.mockResolvedValueOnce(
        errorResponse(403, { message: "Resource not accessible" }),
      );

      await expect(
        GitHubConversation.addReactionToComment({
          ...REPO,
          commentId: 99,
          reaction: GitHubReaction.Confused,
        }),
      ).resolves.toBe(false);
    });

    test("returns false when the request itself throws", async () => {
      postMock.mockRejectedValueOnce(new Error("socket hang up"));

      await expect(
        GitHubConversation.addReactionToComment({
          ...REPO,
          commentId: 99,
          reaction: GitHubReaction.Eyes,
        }),
      ).resolves.toBe(false);
    });

    test("returns false when the installation token cannot be minted", async () => {
      tokenSpy.mockRejectedValueOnce(new Error("installation not found"));

      await expect(
        GitHubConversation.addReactionToIssue({
          ...REPO,
          issueNumber: 7,
          reaction: GitHubReaction.Eyes,
        }),
      ).resolves.toBe(false);

      expect(postMock).not.toHaveBeenCalled();
    });

    test("returns false for a 404 on a comment that has since been deleted", async () => {
      postMock.mockResolvedValueOnce(
        errorResponse(404, { message: "Not Found" }),
      );

      await expect(
        GitHubConversation.addReactionToComment({
          ...REPO,
          commentId: 99,
          reaction: GitHubReaction.Confused,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("comment mapping — who wrote it, and is it a bot", () => {
    test("marks a comment as a bot when GitHub types the author as Bot", async () => {
      postMock.mockResolvedValueOnce(
        okJson(
          commentJson({ user: { login: "some-integration", type: "Bot" } }),
        ),
      );

      const comment: GitHubIssueComment = await postAComment("hi");

      expect(comment.isBot).toBe(true);
      expect(comment.authorLogin).toBe("some-integration");
    });

    /*
     * The other half of the OR. Some payloads report a bot author as type
     * "User" while the login still carries the suffix, and either one alone
     * would let the app answer itself.
     */
    test("marks a comment as a bot when the login ends in [bot], whatever the type says", async () => {
      postMock.mockResolvedValueOnce(
        okJson(
          commentJson({ user: { login: "oneuptime[bot]", type: "User" } }),
        ),
      );

      await expect(postAComment("hi")).resolves.toMatchObject({
        isBot: true,
        authorLogin: "oneuptime[bot]",
      });
    });

    test("marks a bot login with unusual casing as a bot", async () => {
      postMock.mockResolvedValueOnce(
        okJson(commentJson({ user: { login: "Renovate[BOT]", type: "User" } })),
      );

      await expect(postAComment("hi")).resolves.toMatchObject({ isBot: true });
    });

    test("does not mark an ordinary human author as a bot", async () => {
      postMock.mockResolvedValueOnce(
        okJson(commentJson({ user: { login: "octocat", type: "User" } })),
      );

      await expect(postAComment("hi")).resolves.toMatchObject({
        isBot: false,
        authorLogin: "octocat",
      });
    });

    /*
     * The loop guard reads the AUTHOR, not the text. A human quoting the bot's
     * login must still be answered.
     */
    test("does not mark a human who merely mentions a bot login as a bot", async () => {
      postMock.mockResolvedValueOnce(
        okJson(
          commentJson({
            body: "cc @oneuptime[bot] — can you look?",
            user: { login: "carol", type: "User" },
          }),
        ),
      );

      await expect(postAComment("hi")).resolves.toMatchObject({
        isBot: false,
        authorLogin: "carol",
      });
    });

    test("survives a comment with no author object at all", async () => {
      postMock.mockResolvedValueOnce(okJson(commentJson({ user: null })));

      await expect(postAComment("hi")).resolves.toMatchObject({
        isBot: false,
        authorLogin: "",
      });
    });

    test("fills in safe defaults for a sparse comment payload", async () => {
      postMock.mockResolvedValueOnce(okJson({}));

      await expect(postAComment("hi")).resolves.toEqual({
        commentId: 0,
        htmlUrl: "",
        body: "",
        authorLogin: "",
        isBot: false,
        createdAt: "",
      });
    });

    test("throws when GitHub refuses the comment, unlike a reaction", async () => {
      const failure: HTTPErrorResponse = errorResponse(403, {
        message: "Resource not accessible by integration",
      });

      postMock.mockResolvedValueOnce(failure);

      await expect(postAComment("hi")).rejects.toBe(failure);
    });
  });

  describe("updateIssueComment — one comment per command, edited in place", () => {
    /*
     * A long-running run that appended a comment per status change would turn
     * somebody's thread into a status log (and email every watcher each time).
     * The acknowledgement is EDITED instead.
     */
    test("patches the existing comment instead of posting a new one", async () => {
      patchMock.mockResolvedValueOnce(okJson(commentJson({ body: "done" })));

      const comment: GitHubIssueComment =
        await GitHubConversation.updateIssueComment({
          ...REPO,
          commentId: 555,
          body: "done",
        });

      expect(postMock).not.toHaveBeenCalled();
      expect(patchMock).toHaveBeenCalledTimes(1);
      expect(patchCall(1).url.toString()).toBe(
        "https://api.github.com/repos/acme/checkout/issues/comments/555",
      );
      expect(patchCall(1).data).toEqual({ body: "done" });
      expect(comment.body).toBe("done");
    });

    test("throws when the edit is refused, so the caller does not report success", async () => {
      const failure: HTTPErrorResponse = errorResponse(410, {
        message: "Gone",
      });

      patchMock.mockResolvedValueOnce(failure);

      await expect(
        GitHubConversation.updateIssueComment({
          ...REPO,
          commentId: 555,
          body: "done",
        }),
      ).rejects.toBe(failure);
    });
  });

  describe("listIssueComments — the thread the agent reads", () => {
    function commentsPage(): Array<JSONObject> {
      return [
        commentJson({ id: 1, body: "one", user: { login: "a", type: "User" } }),
        commentJson({
          id: 2,
          body: "two",
          user: { login: "oneuptime[bot]", type: "Bot" },
        }),
        commentJson({
          id: 3,
          body: "three",
          user: { login: "c", type: "User" },
        }),
        commentJson({
          id: 4,
          body: "four",
          user: { login: "d", type: "User" },
        }),
      ];
    }

    /*
     * GitHub is asked for the NEWEST comments, not the first page of the
     * oldest. On a 200-comment issue the first page is the discussion from six
     * months ago, while the review feedback that prompted this run is on the
     * last page — so a reader that took page one would feed the agent
     * everything except the request it is answering.
     */
    test("asks GitHub for the newest comments, not the oldest page", async () => {
      getMock.mockResolvedValueOnce(okArray([]));

      await GitHubConversation.listIssueComments({
        ...REPO,
        issueNumber: 42,
        maxComments: 5,
      });

      const requestedUrl: string = getMock.mock.calls[0]![0].url.toString();

      expect(requestedUrl).toContain("direction=desc");
      expect(requestedUrl).toContain("sort=created");
    });

    /*
     * ...and then handed back OLDEST FIRST, so the agent reads the thread the
     * way a person would. The mock answers in the descending order GitHub
     * actually returns for that request, so this pins the whole round trip
     * rather than just the mapper.
     */
    test("returns the newest comments, re-ordered oldest first", async () => {
      getMock.mockResolvedValueOnce(okArray([...commentsPage()].reverse()));

      const comments: Array<GitHubIssueComment> =
        await GitHubConversation.listIssueComments({
          ...REPO,
          issueNumber: 42,
          maxComments: 2,
        });

      expect(
        comments.map((comment: GitHubIssueComment): string => {
          return comment.body;
        }),
      ).toEqual(["three", "four"]);
    });

    // The app's own comments come back too; the caller decides what to do.
    test("returns the app's own comments, marked as bot-authored", async () => {
      getMock.mockResolvedValueOnce(okArray([...commentsPage()].reverse()));

      const comments: Array<GitHubIssueComment> =
        await GitHubConversation.listIssueComments({
          ...REPO,
          issueNumber: 42,
          maxComments: 10,
        });

      expect(comments).toHaveLength(4);
      expect(comments[1]?.isBot).toBe(true);
      expect(comments[0]?.isBot).toBe(false);
    });

    /*
     * per_page is GitHub's hard maximum. Asking for more is refused outright,
     * which would lose the whole thread rather than truncate it.
     */
    test("never asks GitHub for more than 100 comments in a page", async () => {
      getMock.mockResolvedValueOnce(okArray(commentsPage()));

      await GitHubConversation.listIssueComments({
        ...REPO,
        issueNumber: 42,
        maxComments: 5000,
      });

      expect(getCall(1).url.toString()).toContain("per_page=100");
    });

    test("survives a thread with no comments", async () => {
      getMock.mockResolvedValueOnce(okArray([]));

      await expect(
        GitHubConversation.listIssueComments({
          ...REPO,
          issueNumber: 42,
          maxComments: 10,
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("getPullRequestDetails — feeding the fork check", () => {
    test("carries the head repository's full name through for the fork check", async () => {
      getMock.mockResolvedValueOnce(
        okJson({
          number: 12,
          head: {
            ref: "patch-1",
            sha: "abc123",
            repo: { full_name: "contributor/checkout" },
          },
          base: { ref: "main" },
        }),
      );

      const pullRequest: GitHubPullRequestDetails =
        await GitHubConversation.getPullRequestDetails({
          ...REPO,
          pullRequestNumber: 12,
        });

      expect(pullRequest.headRepositoryFullName).toBe("contributor/checkout");
      expect(
        GitHubConversation.isFromFork({
          headRepositoryFullName: pullRequest.headRepositoryFullName,
          organizationName: REPO.organizationName,
          repositoryName: REPO.repositoryName,
        }),
      ).toBe(true);
    });

    /*
     * GitHub sends `head.repo: null` once the fork is deleted. Reading that
     * must not throw, and must produce the null that isFromFork treats as
     * "not pushable".
     */
    test("maps a deleted fork's head repository to null instead of throwing", async () => {
      getMock.mockResolvedValueOnce(
        okJson({
          number: 12,
          head: { ref: "patch-1", sha: "abc123", repo: null },
          base: { ref: "main" },
        }),
      );

      const pullRequest: GitHubPullRequestDetails =
        await GitHubConversation.getPullRequestDetails({
          ...REPO,
          pullRequestNumber: 12,
        });

      expect(pullRequest.headRepositoryFullName).toBeNull();
      expect(
        GitHubConversation.isFromFork({
          headRepositoryFullName: pullRequest.headRepositoryFullName,
          organizationName: REPO.organizationName,
          repositoryName: REPO.repositoryName,
        }),
      ).toBe(true);
    });

    test("reports a same-repository branch as pushable", async () => {
      getMock.mockResolvedValueOnce(
        okJson({
          number: 12,
          head: {
            ref: "oneuptime-ai/fix",
            sha: "abc123",
            repo: { full_name: "Acme/Checkout" },
          },
          base: { ref: "main" },
        }),
      );

      const pullRequest: GitHubPullRequestDetails =
        await GitHubConversation.getPullRequestDetails({
          ...REPO,
          pullRequestNumber: 12,
        });

      expect(
        GitHubConversation.isFromFork({
          headRepositoryFullName: pullRequest.headRepositoryFullName,
          organizationName: REPO.organizationName,
          repositoryName: REPO.repositoryName,
        }),
      ).toBe(false);
      expect(pullRequest.headRefName).toBe("oneuptime-ai/fix");
    });
  });
});
