import { afterEach, describe, expect, test } from "@jest/globals";
import Dictionary from "../../../../Types/Dictionary";
import EgressGuardException from "../../../../Types/Exception/EgressGuardException";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementTransport,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import TenantServerClient, {
  MAX_RATE_LIMIT_RETRIES,
  MAX_REDIRECTS,
  PRIVATE_SERVER_HINT,
  TenantServerAnswer,
  TenantServerClientOptions,
  TenantServerSignIn,
} from "../../../../Server/Utils/DeviceManagement/TenantServerClient";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  EgressGuardedTransport,
  createEgressGuardedTransport,
} from "./EgressGuardedTransport";

/*
 * The one door to an API at a server the customer names (#10086, #10087):
 * Workspace ONE UEM's and SOTI MobiControl's. These pin what both rely on,
 * with a scripted server and a sign-in of the test's own:
 *
 *   - the credentials go to the configured server alone: HTTPS, its host
 *     and port, under the API's path - a redirect anywhere else is refused
 *     before anything is sent, one on the server is followed;
 *   - every request goes through the transport, so the egress guard checks
 *     each one - the first, a redirect, a retry - where it resolves then,
 *     and refuses a loopback, link-local or cloud metadata address always
 *     and a private one on OneUptime Cloud, without a retry;
 *   - 429 with and without Retry-After, a quota used up, server errors, a
 *     dropped connection, a token renewed once, the read's budget;
 *   - an error never carries a credential.
 *
 * Nothing here opens a socket: the real DataSourceHttpFetch is only handed
 * addresses its guard refuses before it would.
 */

const SERVER: string = "as1234.awmdm.com";
const BASE: string = `https://${SERVER}/api`;
const SECRET: string = "client-secret-0123456789ABCDEF";
const TOKEN: string = "token-AAAAAAAAAAAAAAAAAAAAAAAA";
const PUBLIC_ADDRESS: string = "52.10.20.30";

interface ScriptedAnswer {
  status: number;
  body?: unknown;
  headers?: Dictionary<string> | undefined;
}

// A server that answers each request with the next scripted answer, else 200 {"ok": true}.
class ScriptedServer {
  public readonly requests: Array<DataSourceHttpRequest> = [];
  private readonly answers: Array<ScriptedAnswer | Error> = [];

  public answer(...answers: Array<ScriptedAnswer | Error>): void {
    this.answers.push(...answers);
  }

  public get transport(): DeviceManagementTransport {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      this.requests.push(request);
      const next: ScriptedAnswer | Error | undefined = this.answers.shift();

      if (next instanceof Error) {
        throw next;
      }

      const answer: ScriptedAnswer = next || {
        status: 200,
        body: { ok: true },
      };
      const bodyText: string =
        answer.body === undefined
          ? ""
          : typeof answer.body === "string"
            ? answer.body
            : JSON.stringify(answer.body);

      return {
        statusCode: answer.status,
        bodyText,
        bodyJson: typeof answer.body === "string" ? undefined : answer.body,
        headers: answer.headers || {},
      };
    };
  }
}

// A token sign-in of the test's own: a token it hands out, renewed once forgotten.
class TestSignIn implements TenantServerSignIn {
  public tokensGiven: number = 0;
  private token: string | null = null;
  private readonly canRenew: boolean;

  public constructor(canRenew: boolean = true) {
    this.canRenew = canRenew;
  }

  public async authorize(): Promise<Dictionary<string>> {
    if (!this.token) {
      this.tokensGiven++;
      this.token = `${TOKEN}-${this.tokensGiven}`;
    }

    return { Authorization: `Bearer ${this.token}` };
  }

  public forget(): boolean {
    this.token = null;
    return this.canRenew;
  }

  public secretValues(): Array<string> {
    return [SECRET, this.token || ""].filter(Boolean);
  }
}

interface Harness {
  client: TenantServerClient;
  server: ScriptedServer;
  signIn: TestSignIn;
  slept: Array<number>;
}

function harness(
  overrides: Partial<TenantServerClientOptions> = {},
  signIn: TestSignIn = new TestSignIn(),
): Harness {
  const server: ScriptedServer = new ScriptedServer();
  const slept: Array<number> = [];

  return {
    server,
    signIn,
    slept,
    client: new TenantServerClient({
      serviceTitle: "Workspace ONE UEM",
      egressLabel: "Workspace ONE UEM server",
      apiBaseUrl: BASE,
      signIn,
      headers: { Accept: "application/json;version=1" },
      readError: (response: DataSourceHttpResponse): string => {
        const body: Record<string, unknown> =
          (response.bodyJson as Record<string, unknown>) || {};

        return typeof body["message"] === "string" ? body["message"] : "";
      },
      transport: server.transport,
      now: (): Date => {
        return new Date("2026-11-19T12:00:00Z");
      },
      sleep: async (milliseconds: number): Promise<void> => {
        slept.push(milliseconds);
      },
      random: (): number => {
        return 0.5;
      },
      requestsPerSecond: 2,
      ...overrides,
    }),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }

  throw new Error("expected a failure");
}

afterEach(() => {
  delete process.env["BILLING_ENABLED"];
});

describe("where the credentials may go", () => {
  test("HTTPS, the configured host and port, under the API's path, and nothing else", () => {
    const { client } = harness();

    expect(client.isAllowedServerUrl(`${BASE}/mdm/devices/search`)).toBe(true);
    // Workspace ONE's own path is written either way.
    expect(
      client.isAllowedServerUrl(`https://${SERVER}/API/mdm/devices/search`),
    ).toBe(true);
    expect(client.isAllowedServerUrl(`https://${SERVER}:443/api/x`)).toBe(true);

    for (const url of [
      `http://${SERVER}/api/mdm/devices/search`,
      `https://${SERVER}:8443/api/mdm/devices/search`,
      `https://user:pass@${SERVER}/api/mdm/devices/search`,
      `https://${SERVER}/apix/mdm`,
      `https://${SERVER}/other/api/mdm`,
      `https://${SERVER}/api/../admin`,
      `https://${SERVER}.evil.example/api/mdm`,
      `https://evil.example/${SERVER}/api/mdm`,
      "https://169.254.169.254/api/latest",
      "https://127.0.0.1/api/mdm",
      "not a url",
    ]) {
      expect(client.isAllowedServerUrl(url)).toBe(false);
    }
  });

  test("a server on a port of its own keeps to that port", () => {
    const { client } = harness({
      apiBaseUrl: "https://mdm.acme.com:8443/MobiControl/api",
    });

    expect(
      client.isAllowedServerUrl(
        "https://mdm.acme.com:8443/MobiControl/api/devices",
      ),
    ).toBe(true);
    expect(
      client.isAllowedServerUrl("https://mdm.acme.com/MobiControl/api/devices"),
    ).toBe(false);
  });

  test("an API path and its query make the URL; the path is the API's own", () => {
    const { client } = harness();

    expect(
      client.urlOf("/mdm/devices/search", { page: 2, pagesize: 500 }),
    ).toBe(`${BASE}/mdm/devices/search?page=2&pagesize=500`);
    expect(client.urlOf("/mdm/devices/15/apps")).toBe(
      `${BASE}/mdm/devices/15/apps`,
    );
  });

  test("a redirect on the server is followed; one off it is refused before anything is sent there", async () => {
    const followed: Harness = harness();
    followed.server.answer({
      status: 302,
      headers: { location: "/API/mdm/devices/search?page=0" },
    });

    const answer: TenantServerAnswer = await followed.client.get(
      "/mdm/devices/search",
      {},
      "device list request",
    );
    expect(answer.status).toBe(200);
    expect(followed.server.requests[1]!.url).toBe(
      `https://${SERVER}/API/mdm/devices/search?page=0`,
    );

    for (const location of [
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://as1234.awmdm.com/api/mdm/devices/search",
      "https://as1234.awmdm.com.attacker.example/api/mdm",
      "https://as1234.awmdm.com:9443/api/mdm",
      "https://as1234.awmdm.com/login",
    ]) {
      const offHost: Harness = harness();
      offHost.server.answer({ status: 307, headers: { location } });

      const failure: LlmProviderError = await failureOf(
        offHost.client.get("/mdm/devices/search", {}, "device list request"),
      );

      expect(failure.message).toContain("nothing was sent there");
      // The first request only: nothing went where the redirect pointed.
      expect(offHost.server.requests).toHaveLength(1);
    }
  });

  test("redirects end, and a POST is never redirected", async () => {
    const loop: Harness = harness();
    for (let index: number = 0; index <= MAX_REDIRECTS; index++) {
      loop.server.answer({
        status: 302,
        headers: { location: `/api/mdm/devices/search?hop=${index}` },
      });
    }

    const tooMany: LlmProviderError = await failureOf(
      loop.client.get("/mdm/devices/search", {}, "device list request"),
    );
    expect(tooMany.message).toContain("redirect OneUptime could not follow");
    expect(loop.server.requests).toHaveLength(MAX_REDIRECTS + 1);

    const post: Harness = harness();
    post.server.answer({
      status: 307,
      headers: { location: "/api/mdm/devices/summary2" },
    });
    await failureOf(
      post.client.postJson(
        "/mdm/devices/summary",
        [],
        "device summary request",
      ),
    );
    expect(post.server.requests).toHaveLength(1);
  });
});

describe("the egress guard checks every request", () => {
  function guarded(
    addresses: Record<string, Array<Array<string>>>,
    blockPrivateAddresses: boolean = true,
  ): { harness: Harness; guard: EgressGuardedTransport } {
    const inner: ScriptedServer = new ScriptedServer();
    const guard: EgressGuardedTransport = createEgressGuardedTransport({
      inner: inner.transport,
      addresses,
      blockPrivateAddresses,
    });
    const made: Harness = harness({ transport: guard.transport });

    return { harness: { ...made, server: inner }, guard };
  }

  test("a server that resolves to a public address is read", async () => {
    const { harness: made, guard } = guarded({
      [SERVER]: [[PUBLIC_ADDRESS]],
    });

    await made.client.get("/mdm/devices/search", {}, "device list request");

    expect(guard.allowed).toHaveLength(1);
    expect(guard.refused).toHaveLength(0);
  });

  test("loopback, link-local and the cloud metadata address are refused, never retried", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "::1", "0.0.0.0"]) {
      const { harness: made, guard } = guarded(
        { [SERVER]: [[address]] },
        // A self-hosted install: even there, these are refused.
        false,
      );

      const failure: LlmProviderError = await failureOf(
        made.client.get("/mdm/devices/search", {}, "device list request"),
      );

      expect(failure.kind).toBe(LlmConnectionFailureKind.Settings);
      expect(failure.message).toContain(
        "OneUptime did not connect to the Workspace ONE UEM server",
      );
      expect(guard.refused).toHaveLength(1);
      expect(made.server.requests).toHaveLength(0);
    }
  });

  test("a private address is refused on OneUptime Cloud, and read by a self-hosted OneUptime", async () => {
    const cloud: { harness: Harness; guard: EgressGuardedTransport } = guarded(
      { [SERVER]: [["10.0.4.17"]] },
      true,
    );

    await failureOf(
      cloud.harness.client.get(
        "/mdm/devices/search",
        {},
        "device list request",
      ),
    );
    expect(cloud.harness.server.requests).toHaveLength(0);

    const selfHosted: { harness: Harness; guard: EgressGuardedTransport } =
      guarded({ [SERVER]: [["10.0.4.17"]] }, false);

    await selfHosted.harness.client.get(
      "/mdm/devices/search",
      {},
      "device list request",
    );
    expect(selfHosted.harness.server.requests).toHaveLength(1);
  });

  test("a redirect is checked where the server resolves then: rebound to the metadata address, it is refused", async () => {
    const { harness: made, guard } = guarded({
      [SERVER]: [[PUBLIC_ADDRESS], ["169.254.169.254"]],
    });
    made.server.answer({
      status: 302,
      headers: { location: "/api/mdm/devices/search?page=1" },
    });

    const failure: LlmProviderError = await failureOf(
      made.client.get("/mdm/devices/search", {}, "device list request"),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Settings);
    expect(guard.allowed).toEqual([`${BASE}/mdm/devices/search`]);
    expect(guard.refused).toEqual([
      `https://${SERVER}/api/mdm/devices/search?page=1`,
    ]);
    // Only the first request reached the server.
    expect(made.server.requests).toHaveLength(1);
  });

  test("each request names the server and the private network hint to the guard", async () => {
    const { client, server } = harness();

    await client.get("/mdm/devices/search", {}, "device list request");

    expect(server.requests[0]!.egressOptions).toEqual({
      targetLabel: "Workspace ONE UEM server",
      privateNetworkHint: PRIVATE_SERVER_HINT,
    });
    expect(server.requests[0]!.acceptAnyStatus).toBe(true);
  });

  test("through the real DataSourceHttpFetch, the metadata, loopback and (on OneUptime Cloud) private addresses are refused before a socket opens", async () => {
    process.env["BILLING_ENABLED"] = "true";

    for (const host of [
      "169.254.169.254",
      "127.0.0.1",
      "10.0.4.17",
      "192.168.1.20",
    ]) {
      const { client } = harness({
        apiBaseUrl: `https://${host}/api`,
        transport: DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      });

      const failure: LlmProviderError = await failureOf(
        client.get("/mdm/devices/search", {}, "device list request"),
      );

      expect(failure.kind).toBe(LlmConnectionFailureKind.Settings);
      expect(failure.message).toContain(
        `Workspace ONE UEM server host ${host}`,
      );
      expect(failure.message).toContain("is not allowed");
    }
  });

  test("the guard's refusal is an EgressGuardException the client never retries", async () => {
    const { client, server } = harness();
    server.answer(
      new EgressGuardException(
        "Workspace ONE UEM server host as1234.awmdm.com could not be reached.",
        "Unreachable" as never,
      ),
    );

    await failureOf(
      client.get("/mdm/devices/search", {}, "device list request"),
    );
    expect(server.requests).toHaveLength(1);
  });
});

describe("throttling, failures and the budget", () => {
  test("a 429 waits what Retry-After says, halves the pace, and tries again", async () => {
    const { client, server, slept } = harness();
    server.answer({ status: 429, headers: { "retry-after": "7" } });

    const answer: TenantServerAnswer = await client.get(
      "/mdm/devices/search",
      {},
      "device list request",
    );

    expect(answer.status).toBe(200);
    expect(slept).toContain(7000);
    expect(client.wasRateLimited()).toBe(true);
    expect(client.getRequestsPerSecond()).toBe(1);
  });

  test("a 429 without Retry-After backs off with jitter; too many, or too long a wait, give up and say so", async () => {
    const backingOff: Harness = harness();
    backingOff.server.answer({ status: 429 });

    await backingOff.client.get(
      "/mdm/devices/search",
      {},
      "device list request",
    );
    expect(backingOff.slept).toContain(backingOff.client.backoffMs(1));

    const tooMany: Harness = harness();
    for (let index: number = 0; index <= MAX_RATE_LIMIT_RETRIES; index++) {
      tooMany.server.answer({
        status: 429,
        body: { message: "Too many requests." },
      });
    }
    const gaveUp: LlmProviderError = await failureOf(
      tooMany.client.get("/mdm/devices/search", {}, "device list request"),
    );
    expect(gaveUp.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(gaveUp.message).toContain(
      "slow down (HTTP 429) on the device list request. Too many requests.",
    );

    const longWait: Harness = harness();
    longWait.server.answer({ status: 429, headers: { "retry-after": "3600" } });
    const waitedNot: LlmProviderError = await failureOf(
      longWait.client.get("/mdm/devices/search", {}, "device list request"),
    );
    expect(waitedNot.retryAfterSeconds).toBe(3600);
    expect(longWait.server.requests).toHaveLength(1);
  });

  test("a 429 that says a quota is used up is not tried again this read", async () => {
    const { client, server } = harness({
      isRateLimitFinal: (said: string): boolean => {
        return said.includes("quota");
      },
    });
    server.answer({
      status: 429,
      body: { message: "The daily quota of API calls is exceeded." },
    });

    const failure: LlmProviderError = await failureOf(
      client.get("/mdm/devices/search", {}, "device list request"),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(failure.message).toContain("daily quota");
    expect(server.requests).toHaveLength(1);
  });

  test("a server error is tried again a little; a dropped connection once more", async () => {
    const { client, server } = harness();
    server.answer({ status: 503 }, new Error("socket hang up"));

    const answer: TenantServerAnswer = await client.get(
      "/mdm/devices/search",
      {},
      "device list request",
    );
    expect(answer.status).toBe(200);
    expect(server.requests).toHaveLength(3);

    const down: Harness = harness();
    down.server.answer({ status: 500 }, { status: 502 }, { status: 503 });
    const failure: LlmProviderError = await failureOf(
      down.client.get("/mdm/devices/search", {}, "device list request"),
    );
    expect(failure.kind).toBe(LlmConnectionFailureKind.Unavailable);
  });

  test("a token the server no longer takes is renewed once; a second 401 stands", async () => {
    const { client, server, signIn } = harness();
    server.answer({
      status: 401,
      body: { message: "OAuth token is expired." },
    });

    await client.get("/mdm/devices/search", {}, "device list request");
    expect(signIn.tokensGiven).toBe(2);
    expect(server.requests[1]!.headers!["Authorization"]).toBe(
      `Bearer ${TOKEN}-2`,
    );

    const refused: Harness = harness();
    refused.server.answer(
      { status: 401, body: { message: "OAuth token is expired." } },
      { status: 401, body: { message: "OAuth token is expired." } },
    );
    const failure: LlmProviderError = await failureOf(
      refused.client.get("/mdm/devices/search", {}, "device list request"),
    );
    expect(failure.kind).toBe(LlmConnectionFailureKind.Authentication);
    expect(refused.server.requests).toHaveLength(2);
  });

  test("a sign-in that cannot be renewed (an account's) takes its 401 at once", async () => {
    const { client, server } = harness({}, new TestSignIn(false));
    server.answer({
      status: 401,
      body: { message: "User credentials are invalid." },
    });

    const failure: LlmProviderError = await failureOf(
      client.get("/mdm/devices/search", {}, "device list request"),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Authentication);
    expect(server.requests).toHaveLength(1);
  });

  test("a refusal says the service's hint, and never a credential", async () => {
    const { client, server } = harness({
      describeRefusal: (status: number) => {
        return status === 403
          ? {
              kind: LlmConnectionFailureKind.Permission,
              hint: "Give the role Read on Devices.",
            }
          : undefined;
      },
    });
    server.answer({
      status: 403,
      body: {
        message: `Forbidden for ${SECRET} with Bearer ${TOKEN}-1`,
      },
    });

    const failure: LlmProviderError = await failureOf(
      client.get("/mdm/devices/search", {}, "device list request"),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Permission);
    expect(failure.message).toContain(
      "The Workspace ONE UEM server answered the device list request with HTTP 403",
    );
    expect(failure.message).toContain("Give the role Read on Devices.");
    expect(failure.message).not.toContain(SECRET);
    expect(failure.message).not.toContain(`${TOKEN}-1`);
    expect(failure.responseBody).not.toContain(SECRET);
  });

  test("every request counts against the read's budget, a sign-in's too", async () => {
    const { client } = harness({ maxRequests: 1 });

    await client.get("/mdm/devices/search", {}, "device list request");
    await expect(
      client.get("/mdm/devices/search", {}, "device list request"),
    ).rejects.toBeInstanceOf(DeviceManagementBudgetSpent);
    expect(client.getRequestCount()).toBe(1);
    expect(client.hasBudgetFor(1)).toBe(false);

    const signingIn: Harness = harness({ maxRequests: 1 });
    await signingIn.client.sendSignInRequest(
      {
        method: "POST",
        url: "https://na.uemauth.workspaceone.com/connect/token",
      },
      "token request",
    );
    expect(signingIn.client.hasBudgetFor(1)).toBe(false);
  });

  test("a 204 is an answer with no body", async () => {
    const { client, server } = harness();
    server.answer({ status: 204 });

    const answer: TenantServerAnswer = await client.get(
      "/mdm/devices/search",
      {},
      "device list request",
    );

    expect(answer).toMatchObject({ status: 204, body: undefined });
  });

  test("a POST carries its JSON body, its type and the sign-in", async () => {
    const { client, server } = harness();

    await client.postJson(
      "/mdm/devices/summary",
      [{ DevicePropertyName: "Mode" }],
      "device summary request",
    );

    expect(server.requests[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/mdm/devices/summary`,
      body: '[{"DevicePropertyName":"Mode"}]',
    });
    expect(server.requests[0]!.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}-1`,
      Accept: "application/json;version=1",
    });
  });
});
