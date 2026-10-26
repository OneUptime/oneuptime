/*
 * ---------------------------------------------------------------------------
 * The GitHub tokens a code-fix run was handed end with the run.
 *
 * GitHub keeps an installation token good for an hour from when it is
 * minted, and a fix rarely takes that long: for the rest of the hour the
 * token would still push to its repository from wherever it was read - on a
 * global Runner, a host that also runs every project's JavaScript steps. The
 * Runner remembers each GitHub token it is handed (BackendAPI) and revokes
 * them all when the run ends (PollCodeFixWork.executeTask), with GitHub's
 * DELETE /installation/token. Best effort: a token GitHub could not be asked
 * about runs out within its hour, and what is logged never carries it.
 * ---------------------------------------------------------------------------
 */

import RepositoryTokenRevocation, {
  GITHUB_REVOKE_TOKEN_URL,
  REVOKE_TIMEOUT_IN_MS,
} from "../../Utils/RepositoryTokenRevocation";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

const deleteMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      delete: (...args: Array<unknown>) => {
        return deleteMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

interface DeleteCall {
  url: { toString: () => string };
  headers: Record<string, string>;
  options: {
    timeout?: number;
    retries?: number;
    sameServerRedirectsOnly?: boolean;
  };
}

function revoked(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(204, {}, {});
}

function deleteCalls(): Array<DeleteCall> {
  return deleteMock.mock.calls.map((call: Array<unknown>): DeleteCall => {
    return call[0] as DeleteCall;
  });
}

function everythingLogged(): string {
  return [
    ...(logger.warn as jest.Mock).mock.calls,
    ...(logger.error as jest.Mock).mock.calls,
    ...(logger.info as jest.Mock).mock.calls,
    ...(logger.debug as jest.Mock).mock.calls,
  ]
    .map((call: Array<unknown>): string => {
      return JSON.stringify(call);
    })
    .join("\n");
}

beforeEach(() => {
  jest.clearAllMocks();
  deleteMock.mockReset();
  deleteMock.mockResolvedValue(revoked());
  RepositoryTokenRevocation.reset();
});

afterAll(() => {
  RepositoryTokenRevocation.reset();
});

describe("revokeAll", () => {
  test("asks GitHub to revoke every token the run was handed, each with itself as the bearer", async () => {
    RepositoryTokenRevocation.remember("ghs_first_repository");
    RepositoryTokenRevocation.remember("ghs_second_repository");

    const count: number = await RepositoryTokenRevocation.revokeAll();

    expect(count).toBe(2);
    expect(deleteCalls()).toHaveLength(2);

    expect(
      deleteCalls().map((call: DeleteCall): string => {
        return call.headers["Authorization"]!;
      }),
    ).toEqual(["Bearer ghs_first_repository", "Bearer ghs_second_repository"]);

    for (const call of deleteCalls()) {
      expect(call.url.toString()).toBe(GITHUB_REVOKE_TOKEN_URL);
      expect(call.url.toString()).toBe(
        "https://api.github.com/installation/token",
      );
      expect(call.headers["Accept"]).toBe("application/vnd.github+json");
      expect(call.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
      // Quick, and once: the run's final report waits on it.
      expect(call.options.timeout).toBe(REVOKE_TIMEOUT_IN_MS);
      expect(call.options.retries).toBe(0);
      // The token rides in the request, so a redirect off GitHub's API is never followed.
      expect(call.options.sameServerRedirectsOnly).toBe(true);
    }
  });

  test("forgets every token once asked, whatever GitHub answered, so the next run revokes only its own", async () => {
    deleteMock.mockResolvedValueOnce(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}),
    );

    RepositoryTokenRevocation.remember("ghs_this_run");

    await RepositoryTokenRevocation.revokeAll();

    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);

    deleteMock.mockClear();

    expect(await RepositoryTokenRevocation.revokeAll()).toBe(0);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test("a token handed twice (two calls for one repository) is revoked once", async () => {
    RepositoryTokenRevocation.remember("ghs_same");
    RepositoryTokenRevocation.remember("ghs_same");

    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(1);
    expect(await RepositoryTokenRevocation.revokeAll()).toBe(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test("an empty token is never remembered", async () => {
    RepositoryTokenRevocation.remember("");

    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);
    expect(await RepositoryTokenRevocation.revokeAll()).toBe(0);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test("counts only what GitHub revoked (204), and says the rest end within their hour - never naming the token", async () => {
    deleteMock
      .mockResolvedValueOnce(revoked())
      .mockResolvedValueOnce(
        new HTTPErrorResponse(401, { message: "Bad credentials" }, {}),
      )
      .mockResolvedValueOnce(new HTTPResponse<JSONObject>(200, {}, {}));

    RepositoryTokenRevocation.remember("ghs_revoked_one");
    RepositoryTokenRevocation.remember("ghs_already_expired");
    RepositoryTokenRevocation.remember("ghs_answered_200");

    expect(await RepositoryTokenRevocation.revokeAll()).toBe(1);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(everythingLogged()).toContain("HTTP 401");
    expect(everythingLogged()).toContain("within the hour");
    expect(everythingLogged()).not.toContain("ghs_");
  });

  test("a request that fails outright is logged without the token, and the next token is still revoked", async () => {
    deleteMock
      .mockRejectedValueOnce(
        new Error("connect ETIMEDOUT for Bearer ghs_in_the_error"),
      )
      .mockResolvedValueOnce(revoked());

    RepositoryTokenRevocation.remember("ghs_in_the_error");
    RepositoryTokenRevocation.remember("ghs_next");

    await expect(RepositoryTokenRevocation.revokeAll()).resolves.toBe(1);

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // Not even the error's own words, which could quote the request.
    expect(everythingLogged()).not.toContain("ghs_");
    expect(everythingLogged()).not.toContain("ETIMEDOUT");
  });

  test("never throws, whatever revoking does", async () => {
    RepositoryTokenRevocation.setRevokeTokenFunction(async () => {
      throw "not even an Error";
    });

    RepositoryTokenRevocation.remember("ghs_a");

    await expect(RepositoryTokenRevocation.revokeAll()).resolves.toBe(0);
  });

  test("nothing remembered, nothing asked", async () => {
    expect(await RepositoryTokenRevocation.revokeAll()).toBe(0);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("the test seam", () => {
  test("a revoke function stands in for GitHub until reset puts GitHub back", async () => {
    const stand: jest.Mock = jest.fn().mockResolvedValue(revoked());

    RepositoryTokenRevocation.setRevokeTokenFunction(stand as never);
    RepositoryTokenRevocation.remember("ghs_a");
    await RepositoryTokenRevocation.revokeAll();

    expect(stand).toHaveBeenCalledWith("ghs_a");
    expect(deleteMock).not.toHaveBeenCalled();

    RepositoryTokenRevocation.reset();
    RepositoryTokenRevocation.remember("ghs_b");
    await RepositoryTokenRevocation.revokeAll();

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
