/*
 * ---------------------------------------------------------------------------
 * Registration: the URL the Runner calls, and what it says when that fails.
 *
 * A project-scoped Runner's very first request is a heartbeat to
 * ONEUPTIME_URL + /runner-ingest/heartbeat. If that URL is wrong — or right
 * but not routed by the ingress — the container comes up, retries forever, and
 * prints one line the operator has to work backwards from. It printed:
 *
 *     Error: Failed to register Runner: 404
 *
 * which does not say which URL was called, does not say the credentials were
 * never checked, and reads like an auth failure when it is not one (the ingest
 * middleware answers bad credentials with 400, never 404).
 *
 * These tests pin both halves: the URL is built correctly from every shape of
 * ONEUPTIME_URL a customer might paste, and the failure explains itself.
 * ---------------------------------------------------------------------------
 */

import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

/*
 * The retry loop's real backoff starts at 30 seconds, so the sleeps are
 * replaced with a recorder rather than driven by fake timers. Resolving
 * immediately keeps these tests fast, and keeping the requested delays makes
 * the backoff schedule itself assertable — a cap that silently stopped
 * applying would mean a Runner waiting hours to reconnect.
 */
const sleepsInMs: Array<number> = [];

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (ms: number): Promise<void> => {
        sleepsInMs.push(ms);
      },
    },
  };
});

/*
 * The registration loop logs its failures rather than throwing them out of
 * the process — that log line IS the operator's only diagnostic, so it is
 * captured here and asserted on directly.
 */
const errorLog: Array<unknown> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (value: unknown) => {
        errorLog.push(value);
      },
    },
  };
});

import Register from "../../Services/RegisterRunner";
import { RUNNER_INGEST_URL, ONEUPTIME_BASE_URL } from "../../Config";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";

function response(
  statusCode: number,
  data?: JSONObject,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(statusCode, data || {}, {});
}

/* The URL passed to API.post on call number `index`. */
function postedUrl(index: number): string {
  return String((postMock.mock.calls[index] as Array<JSONObject>)[0]!["url"]);
}

function postedData(index: number): JSONObject {
  return (postMock.mock.calls[index] as Array<JSONObject>)[0]![
    "data"
  ] as JSONObject;
}

/*
 * Everything the loop logged at error level, flattened to strings. The loop
 * logs the summary line and the Error itself as separate calls, so tests
 * assert against the whole of it rather than a chosen index.
 */
function loggedErrors(): Array<string> {
  return errorLog.map((entry: unknown) => {
    return entry instanceof Error ? entry.message : String(entry);
  });
}

describe("the URL a Runner registers against", () => {
  /*
   * jest.setup.ts sets ONEUPTIME_URL=http://localhost, so this is the real
   * value Config computed — not a re-derivation that could agree with a broken
   * Config for the same wrong reason.
   */
  test("the ingest base is the server URL plus /runner-ingest", () => {
    expect(RUNNER_INGEST_URL.toString()).toBe(
      `${ONEUPTIME_BASE_URL.toString().replace(/\/$/, "")}/runner-ingest`,
    );
  });

  test("registration posts to /runner-ingest/heartbeat", () => {
    const heartbeatUrl: URL = URL.fromString(
      RUNNER_INGEST_URL.toString(),
    ).addRoute("/heartbeat");

    expect(heartbeatUrl.toString()).toBe(
      `${RUNNER_INGEST_URL.toString()}/heartbeat`,
    );
    expect(heartbeatUrl.toString()).toContain("/runner-ingest/heartbeat");
  });

  /*
   * The reported failure came from a server pasted WITH a trailing slash
   * (server=https://test.oneuptime.com/). A double slash would be a genuinely
   * different path to nginx, so this is worth pinning for every shape a
   * customer might paste rather than assumed from the one that was reported.
   */
  test.each([
    ["no trailing slash", "https://test.oneuptime.com"],
    ["a trailing slash", "https://test.oneuptime.com/"],
    ["plain http", "http://oneuptime.local"],
    ["a port", "http://localhost:3002"],
    ["a port and a trailing slash", "http://localhost:3002/"],
  ])(
    "%s builds a single-slash heartbeat URL",
    (_label: string, base: string) => {
      const ingest: URL = URL.fromString(base).addRoute("/runner-ingest");
      const heartbeat: URL = URL.fromString(ingest.toString()).addRoute(
        "/heartbeat",
      );

      const built: string = heartbeat.toString();

      expect(built).toContain("/runner-ingest/heartbeat");
      /* No "//" anywhere after the protocol. */
      expect(built.replace(/^[a-z]+:\/\//, "")).not.toContain("//");
      expect(built.endsWith("/runner-ingest/heartbeat")).toBe(true);
    },
  );

  /*
   * A base URL that already carries a path (a OneUptime behind a sub-path
   * proxy) must keep that prefix — dropping it would send the heartbeat to a
   * path the ingress does not own.
   */
  test("a base URL with a path prefix keeps the prefix", () => {
    const ingest: URL = URL.fromString(
      "https://example.com/oneuptime",
    ).addRoute("/runner-ingest");

    expect(
      URL.fromString(ingest.toString()).addRoute("/heartbeat").toString(),
    ).toBe("https://example.com/oneuptime/runner-ingest/heartbeat");
  });
});

describe("Register.describeRegistrationFailure", () => {
  const url: URL = URL.fromString(
    "https://test.oneuptime.com/runner-ingest/heartbeat",
  );

  /*
   * The URL is the single most useful fact in the message: it is what an
   * operator pastes into curl, and it is what reveals a mistyped
   * ONEUPTIME_URL at a glance.
   */
  test("always names the status code and the URL that was called", () => {
    for (const statusCode of [400, 401, 404, 500, 502]) {
      const message: string = Register.describeRegistrationFailure({
        statusCode,
        url,
      });

      expect(message).toContain(String(statusCode));
      expect(message).toContain(
        "https://test.oneuptime.com/runner-ingest/heartbeat",
      );
    }
  });

  /*
   * The heart of it. A 404 sends people to check their id and key, which are
   * fine — the request never got far enough to have them checked.
   */
  test("a 404 says the request never reached the work mount", () => {
    const message: string = Register.describeRegistrationFailure({
      statusCode: 404,
      url,
    });

    expect(message).toContain("did not reach");
    expect(message).toContain("ONEUPTIME_URL");
    /* Names the ingress route that has to exist — the actual fix. */
    expect(message).toContain("/runner-ingest");
  });

  test("a 404 explicitly rules out the credentials", () => {
    const message: string = Register.describeRegistrationFailure({
      statusCode: 404,
      url,
    });

    expect(message).toContain("400");
    expect(message.toLowerCase()).toContain("credentials were never checked");
  });

  test.each([400, 401])(
    "a %s points at the credentials, because that is what it means",
    (statusCode: number) => {
      const message: string = Register.describeRegistrationFailure({
        statusCode,
        url,
      });

      expect(message).toContain("ONEUPTIME_RUNNER_ID");
      expect(message).toContain("ONEUPTIME_RUNNER_KEY");
      /* Must NOT send them chasing the ingress: the creds really are wrong. */
      expect(message).not.toContain("did not reach");
    },
  );

  /*
   * A 5xx is the server's problem and there is nothing for the operator to
   * change locally, so it gets the facts and no speculative advice.
   */
  test.each([500, 502, 503])(
    "a %s gets the bare facts and no misleading advice",
    (statusCode: number) => {
      const message: string = Register.describeRegistrationFailure({
        statusCode,
        url,
      });

      expect(message).not.toContain("did not reach");
      expect(message).not.toContain("ONEUPTIME_RUNNER_KEY");
    },
  );
});

describe("registering a project-scoped Runner", () => {
  beforeEach(() => {
    postMock.mockReset();
    errorLog.length = 0;
    sleepsInMs.length = 0;
    LocalCache.setString("RUNNER", "RUNNER_ID", "");
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
  });

  afterEach(() => {
    LocalCache.setString("RUNNER", "RUNNER_ID", "");
  });

  test("posts its id, key and version to the ingest heartbeat", async () => {
    postMock.mockResolvedValue(response(200, { status: "ok" }) as never);

    await Register.registerRunner();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postedUrl(0)).toBe(`${RUNNER_INGEST_URL.toString()}/heartbeat`);

    const data: JSONObject = postedData(0);
    expect(data["agentId"]).toBe(process.env["ONEUPTIME_RUNNER_ID"]);
    expect(data["agentKey"]).toBe(process.env["ONEUPTIME_RUNNER_KEY"]);
    expect(data["agentVersion"]).toBeDefined();
  });

  test("caches the Runner id on success", async () => {
    postMock.mockResolvedValue(response(200, { status: "ok" }) as never);

    await Register.registerRunner();

    expect(LocalCache.getString("RUNNER", "RUNNER_ID")).toBe(
      process.env["ONEUPTIME_RUNNER_ID"],
    );
  });

  /*
   * The dashboard is the control plane for capabilities, so what comes back
   * from the heartbeat has to be what the Runner adopts.
   */
  test("adopts the capabilities the server granted", async () => {
    postMock.mockResolvedValue(
      response(200, {
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      }) as never,
    );

    await Register.registerRunner();

    expect(RunnerCapabilities.wasGrantedCodeFixesByServer()).toBe(true);
  });

  /*
   * An upgraded container carrying an AI Agent's old id and key has no Runner
   * row, so the ingest heartbeat legitimately refuses it. Falling back keeps
   * that container working instead of stranding it.
   */
  test("falls back to the legacy AI Agent endpoint when the ingest call fails", async () => {
    postMock
      .mockResolvedValueOnce(response(400) as never)
      .mockResolvedValueOnce(response(200, { status: "ok" }) as never);

    await Register.registerRunner();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postedUrl(1)).toContain("/api/ai-agent/alive");
    expect(LocalCache.getString("RUNNER", "RUNNER_ID")).toBe(
      process.env["ONEUPTIME_RUNNER_ID"],
    );
  });

  /*
   * The exact production failure: nginx did not route /runner-ingest, so the
   * heartbeat 404ed from the marketing site and the legacy endpoint could not
   * save it either.
   *
   * Driven through the public retry loop rather than the private attempt,
   * because the loop is what an operator actually experiences — the error is
   * logged, not thrown out of the process. The run is allowed to succeed on
   * the third attempt so the promise settles and no timer is left pending.
   */
  test("a 404 on both endpoints logs the actionable message", async () => {
    postMock
      .mockResolvedValueOnce(response(404) as never)
      .mockResolvedValueOnce(response(404) as never)
      .mockResolvedValue(response(200, { status: "ok" }) as never);

    await Register.registerRunner();

    const logged: string = loggedErrors().join("\n");

    expect(logged).toMatch(
      /Failed to register Runner: 404 from .*\/runner-ingest\/heartbeat/,
    );
    expect(logged).toContain("did not reach");
  });

  /*
   * The status code carried into the message must be the INGEST call's, not
   * the legacy fallback's — the ingest call is the one the operator is meant
   * to fix, and reporting the fallback's code would point at the wrong URL
   * with the wrong advice.
   */
  test("reports the ingest status code, not the fallback's", async () => {
    postMock
      .mockResolvedValueOnce(response(404) as never) // ingest
      .mockResolvedValueOnce(response(500) as never) // legacy fallback
      .mockResolvedValue(response(200, { status: "ok" }) as never);

    await Register.registerRunner();

    const logged: string = loggedErrors().join("\n");

    expect(logged).toContain("Failed to register Runner: 404");
    expect(logged).not.toContain("Failed to register Runner: 500");
  });

  /*
   * Registration retries forever by design: a server that is briefly
   * unreachable during a deploy must not kill the container. Proving it
   * recovers matters as much as proving it reports the failure.
   */
  test("keeps retrying until the server answers", async () => {
    postMock
      .mockResolvedValueOnce(response(404) as never)
      .mockResolvedValueOnce(response(404) as never)
      .mockResolvedValue(response(200, { status: "ok" }) as never);

    await expect(Register.registerRunner()).resolves.toBeUndefined();

    expect(LocalCache.getString("RUNNER", "RUNNER_ID")).toBe(
      process.env["ONEUPTIME_RUNNER_ID"],
    );
  });

  /*
   * Backoff, asserted through the recorded sleeps. It doubles from 30s and is
   * capped at 5 minutes: without the cap a Runner that was down through a long
   * outage would back off to hours and appear dead long after the server
   * returned.
   */
  test("backs off exponentially and never waits longer than five minutes", async () => {
    /* Fail the first twenty attempts (two posts each), then succeed. */
    for (let i: number = 0; i < 40; i++) {
      postMock.mockResolvedValueOnce(response(404) as never);
    }
    postMock.mockResolvedValue(response(200, { status: "ok" }) as never);

    await Register.registerRunner();

    expect(sleepsInMs.slice(0, 4)).toEqual([30_000, 60_000, 120_000, 240_000]);

    for (const waited of sleepsInMs) {
      expect(waited).toBeLessThanOrEqual(5 * 60 * 1000);
    }

    /* The cap is actually reached, so the assertion above is not vacuous. */
    expect(sleepsInMs).toContain(5 * 60 * 1000);
  });
});
