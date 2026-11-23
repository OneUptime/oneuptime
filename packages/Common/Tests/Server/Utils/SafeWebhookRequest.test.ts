/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import SafeWebhookRequest, {
  WEBHOOK_MAX_RESPONSE_BYTES,
  WebhookAnswerTooLargeException,
  WebhookTarget,
} from "../../../Server/Utils/SafeWebhookRequest";
import DataSourceEgressGuard, {
  EgressLookupFunction,
  OUTBOUND_PROXY_ENVIRONMENT_VARIABLES,
  UNAPPROVED_LOOKUP_MESSAGE,
} from "../../../Server/Utils/DataSource/EgressGuard";
import SSRFProtection, {
  WebhookTargetValidationOptions,
} from "../../../Server/Utils/SSRFProtection";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import API, { APIRequestOptions } from "../../../Utils/API";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import dns from "dns";
import http from "http";
import net, { AddressInfo } from "net";

jest.mock("../../../Server/Utils/Logger");

/*
 * A WEBHOOK GOES TO THE ADDRESS ITS URL CHECK APPROVED, AND NOWHERE ELSE
 * (SafeWebhookRequest, issue #6611).
 *
 * These run real requests, through axios's Node adapter, to servers on this
 * machine. The URL check is the real one; only the DNS answer it reads is
 * stood in for. "localhost" is the name most of them send to: the check is
 * told it is at 127.0.0.2, while this machine's own resolver says
 * 127.0.0.1 - a name that resolves one way when it is checked and another
 * when it is dialled, which is what DNS rebinding is. Only a request that
 * dials what the check approved reaches a server on 127.0.0.2, and only one
 * that looks the name up again reaches a server on 127.0.0.1.
 *
 * The private-network allowlist names loopback exactly, the one way a
 * webhook may reach this machine at all.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const BLOCK_ENV: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";
const BILLING_ENV: string = "BILLING_ENABLED";
const NO_PROXY_ENVS: Array<string> = ["NO_PROXY", "no_proxy"];

const SAVED_ENV_NAMES: Array<string> = [
  ALLOW_ENV,
  ALLOWLIST_ENV,
  BLOCK_ENV,
  BILLING_ENV,
  ...OUTBOUND_PROXY_ENVIRONMENT_VARIABLES,
  ...NO_PROXY_ENVS,
];

// The rule a project member's own webhook is held to.
const MEMBER_POLICY: WebhookTargetValidationOptions = {
  allowPrivateNetworkTargets: true,
};

const PUBLIC_ADDRESS: string = "93.184.216.34";

interface SeenRequest {
  method: string;
  // As it arrived: a path, or a whole URL at a proxy.
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type Handler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  body: string,
) => void;

class TestServer {
  public requests: Array<SeenRequest> = [];
  // CONNECT requests a proxy was asked for: "host:port".
  public connects: Array<string> = [];
  public openSockets: Set<net.Socket> = new Set<net.Socket>();
  public closedSockets: number = 0;
  public handler: Handler = (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  };

  private readonly server: http.Server;
  public port: number = 0;
  public readonly host: string;

  public constructor(host: string) {
    this.host = host;
    this.server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        let body: string = "";

        request.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        request.on("end", () => {
          this.requests.push({
            method: request.method || "",
            url: request.url || "",
            headers: request.headers,
            body: body,
          });

          this.handler(request, response, body);
        });
      },
    );

    this.server.on("connection", (socket: net.Socket) => {
      this.openSockets.add(socket);

      socket.on("close", () => {
        this.openSockets.delete(socket);
        this.closedSockets++;
      });
    });

    // A proxy is asked to tunnel an https request: say who, and refuse.
    this.server.on(
      "connect",
      (request: http.IncomingMessage, socket: net.Socket) => {
        this.connects.push(request.url || "");
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      },
    );
  }

  public static async start(host: string = "127.0.0.1"): Promise<TestServer> {
    const testServer: TestServer = new TestServer(host);
    await testServer.listen();
    return testServer;
  }

  public url(path: string = "/hook", hostname?: string): string {
    return `http://${hostname || this.host}:${this.port}${path}`;
  }

  public async stop(): Promise<void> {
    this.server.closeAllConnections();

    await new Promise<void>((resolve: () => void) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private async listen(): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      this.server.listen(0, this.host, resolve);
    });

    this.port = (this.server.address() as AddressInfo).port;
  }
}

// What the URL check's DNS answers, by name. A name not here does not resolve.
let checkAnswers: Record<string, Array<string>> = {};
let checkLookup: SpyInstance<typeof dns.promises.lookup>;
const savedEnv: Record<string, string | undefined> = {};
const servers: Array<TestServer> = [];

async function serve(host?: string): Promise<TestServer> {
  const server: TestServer = await TestServer.start(host);
  servers.push(server);
  return server;
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline: number = Date.now() + 2000;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting.");
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
}

beforeEach(() => {
  for (const name of SAVED_ENV_NAMES) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way a webhook may reach this machine.
  process.env[ALLOWLIST_ENV] = "localhost,127.0.0.0/8";

  checkAnswers = {};

  checkLookup = jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const addresses: Array<string> | undefined = checkAnswers[hostname];

    if (!addresses) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return addresses.map((address: string) => {
      return { address: address, family: net.isIP(address) };
    });
  }) as never) as unknown as SpyInstance<typeof dns.promises.lookup>;
});

afterEach(async () => {
  jest.restoreAllMocks();

  for (const name of SAVED_ENV_NAMES) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }

  while (servers.length > 0) {
    await servers.pop()!.stop();
  }
});

let canListenOn127002: boolean = false;

beforeAll(async () => {
  // Linux answers every 127/8 address on loopback; not every machine does.
  canListenOn127002 = await new Promise<boolean>(
    (resolve: (value: boolean) => void) => {
      const probe: http.Server = http.createServer();
      probe.once("error", () => {
        resolve(false);
      });
      probe.listen(0, "127.0.0.2", () => {
        probe.close(() => {
          resolve(true);
        });
      });
    },
  );
});

describe("the socket dials the address the check approved, and no other", () => {
  test("a name checked at one address and resolving to another by the time it is dialled is sent to the approved one", async () => {
    if (!canListenOn127002) {
      return;
    }

    // The check is told localhost is 127.0.0.2; this machine resolves it to 127.0.0.1.
    const approved: TestServer = await serve("127.0.0.2");
    checkAnswers["localhost"] = ["127.0.0.2"];

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        approved.url("/hook", "localhost"),
        { hello: "world" },
        { validation: MEMBER_POLICY },
      );

    expect(response).toBeInstanceOf(HTTPResponse);
    expect(response.statusCode).toBe(200);
    expect(approved.requests).toHaveLength(1);
    expect(approved.requests[0]!.body).toBe(JSON.stringify({ hello: "world" }));
    // The name the URL gave, still: virtual hosting and TLS read it.
    expect(approved.requests[0]!.headers["host"]).toBe(
      `localhost:${approved.port}`,
    );
  });

  test("a name that resolves somewhere new after the check never reaches that address", async () => {
    if (!canListenOn127002) {
      return;
    }

    // Where this machine's resolver sends localhost now: 127.0.0.1.
    const rebound: TestServer = await serve("127.0.0.1");
    checkAnswers["localhost"] = ["127.0.0.2"];

    await expect(
      SafeWebhookRequest.post(
        rebound.url("/hook", "localhost"),
        {},
        { validation: MEMBER_POLICY },
      ),
    ).rejects.toThrow(/ECONNREFUSED 127\.0\.0\.2/);

    expect(rebound.requests).toHaveLength(0);
  });

  test("the name is looked up once, by the check: the socket asks DNS for nothing", async () => {
    const server: TestServer = await serve();
    checkAnswers["hooks.pinned.example"] = ["127.0.0.1"];
    const socketLookup: SpyInstance<typeof dns.lookup> = jest.spyOn(
      dns,
      "lookup",
    ) as unknown as SpyInstance<typeof dns.lookup>;

    await SafeWebhookRequest.post(
      server.url("/hook", "hooks.pinned.example"),
      {},
      { validation: MEMBER_POLICY },
    );

    expect(server.requests).toHaveLength(1);
    expect(checkLookup).toHaveBeenCalledTimes(1);
    expect(socketLookup).not.toHaveBeenCalled();
  });

  test("a URL written with an IP address is never looked up at all", async () => {
    const server: TestServer = await serve();

    await SafeWebhookRequest.post(
      server.url("/hook"),
      {},
      {
        validation: MEMBER_POLICY,
      },
    );

    expect(server.requests).toHaveLength(1);
    expect(checkLookup).not.toHaveBeenCalled();
  });

  test("every attempt of a request that is tried again dials the approved address", async () => {
    const server: TestServer = await serve();
    checkAnswers["hooks.retried.example"] = ["127.0.0.1"];
    const statuses: Array<number> = [503, 503, 200];

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(statuses.shift() || 200);
      response.end("{}");
    };

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        server.url("/hook", "hooks.retried.example"),
        {},
        { validation: MEMBER_POLICY, retries: 3 },
      );

    expect(response.statusCode).toBe(200);
    expect(server.requests).toHaveLength(3);
    expect(checkLookup).toHaveBeenCalledTimes(1);
  });

  test("it is sent with Node's http adapter, whichever one axios would pick by itself", async () => {
    /*
     * This file runs under jsdom, which has an XMLHttpRequest, so axios's
     * own choice would be its XHR adapter - which ignores agents and would
     * look the name up itself. hooks.adapter.example resolves nowhere real.
     */
    const server: TestServer = await serve();
    checkAnswers["hooks.adapter.example"] = ["127.0.0.1"];
    const fetch: SpyInstance<typeof API.post> = jest.spyOn(
      API,
      "post",
    ) as unknown as SpyInstance<typeof API.post>;

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        server.url("/hook", "hooks.adapter.example"),
        {},
        { validation: MEMBER_POLICY },
      );

    expect(response.statusCode).toBe(200);
    expect(
      (fetch.mock.calls[0]![0] as APIRequestOptions).options
        ?.useNodeHttpAdapter,
    ).toBe(true);
  });

  test("the agents are thrown away once the request is over, however it went", async () => {
    const server: TestServer = await serve();
    const destroyed: Array<string> = [];
    const realCreate: typeof SafeWebhookRequest.createPinnedAgents =
      SafeWebhookRequest.createPinnedAgents.bind(SafeWebhookRequest);

    jest
      .spyOn(SafeWebhookRequest, "createPinnedAgents")
      .mockImplementation((target: WebhookTarget) => {
        const agents: ReturnType<typeof SafeWebhookRequest.createPinnedAgents> =
          realCreate(target);
        const httpDestroy: () => void = agents.httpAgent.destroy.bind(
          agents.httpAgent,
        );
        const httpsDestroy: () => void = agents.httpsAgent.destroy.bind(
          agents.httpsAgent,
        );

        agents.httpAgent.destroy = (): void => {
          destroyed.push("http");
          httpDestroy();
        };
        agents.httpsAgent.destroy = (): void => {
          destroyed.push("https");
          httpsDestroy();
        };

        return agents;
      });

    await SafeWebhookRequest.post(
      server.url(),
      {},
      { validation: MEMBER_POLICY },
    );

    expect(destroyed.sort()).toEqual(["http", "https"]);

    destroyed.length = 0;
    const closed: TestServer = await serve();
    const closedUrl: string = closed.url();
    await closed.stop();
    servers.splice(servers.indexOf(closed), 1);

    await expect(
      SafeWebhookRequest.post(closedUrl, {}, { validation: MEMBER_POLICY }),
    ).rejects.toThrow(/ECONNREFUSED/);

    expect(destroyed.sort()).toEqual(["http", "https"]);
  });
});

describe("no redirect is followed", () => {
  test.each([301, 302, 303, 307, 308])(
    "a %s comes back as the answer it is, and where it points is never asked",
    async (status: number) => {
      const server: TestServer = await serve();

      server.handler = (
        request: http.IncomingMessage,
        response: http.ServerResponse,
      ): void => {
        if (request.url === "/hook") {
          response.writeHead(status, {
            Location: server.url("/redirected"),
          });
          response.end();
          return;
        }

        response.writeHead(200);
        response.end("{}");
      };

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await SafeWebhookRequest.post(
          server.url(),
          {},
          { validation: MEMBER_POLICY },
        );

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(response.statusCode).toBe(status);
      expect(
        server.requests.map((request: SeenRequest) => {
          return request.url;
        }),
      ).toEqual(["/hook"]);
    },
  );
});

describe("the policy the caller passes is the policy the URL is held to", () => {
  test("it reaches the check unchanged, with the URL as written", async () => {
    const check: SpyInstance<
      typeof SSRFProtection.validateAndResolveWebhookTarget
    > = jest.spyOn(SSRFProtection, "validateAndResolveWebhookTarget");
    const server: TestServer = await serve();
    const policy: WebhookTargetValidationOptions = {
      allowPrivateNetworkTargets: true,
      targetLabel: "Custom label",
      privateNetworkHint: " A hint.",
      includeResolutionDetailInError: false,
    };

    await SafeWebhookRequest.post(server.url(), {}, { validation: policy });

    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]![0]).toBe(server.url());
    expect(check.mock.calls[0]![1]).toBe(policy);
  });

  test("a refused address is refused with the check's own words, and nothing is sent", async () => {
    const createAgents: SpyInstance<
      typeof SafeWebhookRequest.createPinnedAgents
    > = jest.spyOn(SafeWebhookRequest, "createPinnedAgents");
    const post: SpyInstance<typeof API.post> = jest.spyOn(
      API,
      "post",
    ) as unknown as SpyInstance<typeof API.post>;

    await expect(
      SafeWebhookRequest.post(
        "http://10.0.0.5/hook",
        {},
        { validation: MEMBER_POLICY },
      ),
    ).rejects.toThrow(
      "Webhook URL points to a private network address and is not allowed. Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.",
    );

    expect(createAgents).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  test("a private address is reached where the instance allows private networks and the caller is eligible", async () => {
    process.env[ALLOW_ENV] = "true";
    checkAnswers["internal.example"] = ["10.20.30.40"];
    const post: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as never,
      ) as unknown as SpyInstance<typeof API.post>;

    await SafeWebhookRequest.post(
      "https://internal.example/hook",
      {},
      { validation: MEMBER_POLICY },
    );

    expect(post).toHaveBeenCalledTimes(1);
  });

  test("the same private address is refused for a strict caller, whatever the instance allows", async () => {
    process.env[ALLOW_ENV] = "true";
    checkAnswers["internal.example"] = ["10.20.30.40"];
    const post: SpyInstance<typeof API.post> = jest.spyOn(
      API,
      "post",
    ) as unknown as SpyInstance<typeof API.post>;

    await expect(
      SafeWebhookRequest.post("https://internal.example/hook", {}),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(post).not.toHaveBeenCalled();
  });

  test("the cloud metadata endpoint is refused on the most permissive setting", async () => {
    process.env[ALLOW_ENV] = "true";

    await expect(
      SafeWebhookRequest.post(
        "http://169.254.169.254/latest/meta-data/",
        {},
        { validation: MEMBER_POLICY },
      ),
    ).rejects.toThrow(
      "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
    );
  });

  test("a refusal without detail says nothing of what DNS answered", async () => {
    checkAnswers["internal.example"] = ["10.20.30.40"];

    await expect(
      SafeWebhookRequest.post(
        "https://internal.example/hook",
        {},
        {
          validation: {
            includeResolutionDetailInError: false,
          },
        },
      ),
    ).rejects.toThrow(/^Webhook URL could not be reached\.$/);
  });
});

describe("the request goes out on exactly the URL that was checked", () => {
  test("its path and query as written, not as another parser would rewrite them", async () => {
    const server: TestServer = await serve();

    await SafeWebhookRequest.post(
      server.url("/a//b?tag=one&tag=two"),
      {},
      { validation: MEMBER_POLICY },
    );

    expect(server.requests[0]!.url).toBe("/a//b?tag=one&tag=two");
  });

  test("query parameters are added to it, and the host stays the approved one", async () => {
    const server: TestServer = await serve();
    checkAnswers["hooks.query.example"] = ["127.0.0.1"];

    await SafeWebhookRequest.request(
      server.url("/api/v4/channels?page=0", "hooks.query.example"),
      {
        method: HTTPMethod.GET,
        params: { page: "2", per_page: "200" },
        validation: MEMBER_POLICY,
      },
    );

    expect(server.requests[0]!.url).toBe(
      "/api/v4/channels?page=2&per_page=200",
    );
    expect(server.requests[0]!.headers["host"]).toBe(
      `hooks.query.example:${server.port}`,
    );
  });

  test("a URL written without a scheme is checked and sent as https, as it always was", async () => {
    const check: SpyInstance<
      typeof SSRFProtection.validateAndResolveWebhookTarget
    > = jest.spyOn(SSRFProtection, "validateAndResolveWebhookTarget");
    checkAnswers["hooks.example.com"] = [PUBLIC_ADDRESS];

    const target: WebhookTarget = await SafeWebhookRequest.resolveTarget(
      "hooks.example.com/path",
    );

    expect(check.mock.calls[0]![0]).toBe("https://hooks.example.com/path");
    expect(target.url.href).toBe("https://hooks.example.com/path");
    expect(target.addresses).toEqual([{ address: PUBLIC_ADDRESS, family: 4 }]);
  });

  test("a URL with a scheme other than http or https is refused as written", async () => {
    await expect(
      SafeWebhookRequest.resolveTarget("file:///etc/passwd", MEMBER_POLICY),
    ).rejects.toThrow("Webhook URL must use http or https protocol.");
    await expect(
      SafeWebhookRequest.resolveTarget("gopher://hooks.example.com/x"),
    ).rejects.toThrow("Webhook URL must use http or https protocol.");
  });

  test.each([
    [HTTPMethod.GET, "GET"],
    [HTTPMethod.POST, "POST"],
    [HTTPMethod.PUT, "PUT"],
    [HTTPMethod.PATCH, "PATCH"],
    [HTTPMethod.DELETE, "DELETE"],
  ])("%s goes out as %s", async (method: HTTPMethod, wire: string) => {
    const server: TestServer = await serve();

    await SafeWebhookRequest.request(server.url(), {
      method: method,
      validation: MEMBER_POLICY,
    });

    expect(server.requests[0]!.method).toBe(wire);
  });

  test("a method no webhook is sent with is refused before anything is sent", async () => {
    const server: TestServer = await serve();

    await expect(
      SafeWebhookRequest.request(server.url(), {
        method: HTTPMethod.HEAD,
        validation: MEMBER_POLICY,
      }),
    ).rejects.toThrow("A webhook is not sent with HEAD.");

    expect(server.requests).toHaveLength(0);
  });

  test("an answer larger than the caller reads fails, unread, and its connection is closed", async () => {
    const server: TestServer = await serve();

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(`"${"x".repeat(64 * 1024)}"`);
    };

    const error: unknown = await SafeWebhookRequest.post(
      server.url(),
      {},
      { validation: MEMBER_POLICY, maxContentLength: 1024 },
    ).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(WebhookAnswerTooLargeException);
    expect(error).toBeInstanceOf(APIException);
    expect((error as WebhookAnswerTooLargeException).message).toBe(
      "The answer was larger than 1\u00A0KB, so it was not read.",
    );
    expect((error as WebhookAnswerTooLargeException).maxContentLength).toBe(
      1024,
    );
    expect(
      (error as WebhookAnswerTooLargeException).describe("Zabbix's answer"),
    ).toBe("Zabbix's answer was larger than 1\u00A0KB, so it was not read.");
    // Nothing of the URL, which can carry a secret.
    expect((error as Error).message).not.toContain(String(server.port));

    await eventually(() => {
      return server.openSockets.size === 0;
    });
  });

  test("a notification webhook reads at most a mebibyte of an answer", () => {
    expect(WEBHOOK_MAX_RESPONSE_BYTES).toBe(1024 * 1024);
  });

  test("a sender that names no limit reads at most a mebibyte, never an answer of any size", async () => {
    const server: TestServer = await serve();

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(`"${"x".repeat(WEBHOOK_MAX_RESPONSE_BYTES + 1)}"`);
    };

    await expect(
      SafeWebhookRequest.post(server.url(), {}, { validation: MEMBER_POLICY }),
    ).rejects.toThrow(
      "The answer was larger than 1\u00A0MB, so it was not read.",
    );

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      // Exactly the limit: the two quotes make up the rest.
      response.end(`"${"x".repeat(WEBHOOK_MAX_RESPONSE_BYTES - 2)}"`);
    };

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        server.url(),
        {},
        { validation: MEMBER_POLICY },
      );

    expect(response.statusCode).toBe(200);
  });

  test("an answer too large to read is not asked for again: it would only be as large again", async () => {
    const server: TestServer = await serve();

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(`"${"x".repeat(4096)}"`);
    };

    await expect(
      SafeWebhookRequest.post(
        server.url(),
        {},
        {
          validation: MEMBER_POLICY,
          maxContentLength: 1024,
          retries: 3,
          retryOnlyOnRetryableErrors: true,
        },
      ),
    ).rejects.toThrow(WebhookAnswerTooLargeException);

    expect(server.requests).toHaveLength(1);
  });

  test("headers and body are sent as given", async () => {
    const server: TestServer = await serve();

    await SafeWebhookRequest.post(
      server.url(),
      { event: "incident.created" },
      {
        validation: MEMBER_POLICY,
        headers: { "X-OneUptime-Event": "incident.created" },
      },
    );

    expect(server.requests[0]!.headers["x-oneuptime-event"]).toBe(
      "incident.created",
    );
    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      event: "incident.created",
    });
  });
});

describe("an outbound proxy the operator configured keeps working", () => {
  test("an http webhook goes through HTTP_PROXY, which is asked for it by name", async () => {
    const proxy: TestServer = await serve();
    const target: TestServer = await serve();
    checkAnswers["hooks.proxied.example"] = ["127.0.0.1"];
    process.env["HTTP_PROXY"] = `http://127.0.0.1:${proxy.port}`;

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        target.url("/hook", "hooks.proxied.example"),
        { via: "proxy" },
        { validation: MEMBER_POLICY },
      );

    expect(response.statusCode).toBe(200);
    expect(target.requests).toHaveLength(0);
    expect(proxy.requests).toHaveLength(1);
    expect(proxy.requests[0]!.url).toBe(
      `http://hooks.proxied.example:${target.port}/hook`,
    );
    // Checked first all the same.
    expect(checkLookup).toHaveBeenCalledTimes(1);
  });

  test("a proxy named by host name is looked up as any request's would be; the webhook's name never is", async () => {
    const proxy: TestServer = await serve();
    checkAnswers["hooks.proxied.example"] = [PUBLIC_ADDRESS];
    process.env["http_proxy"] = `localhost:${proxy.port}`;
    const socketLookup: SpyInstance<typeof dns.lookup> = jest.spyOn(
      dns,
      "lookup",
    ) as unknown as SpyInstance<typeof dns.lookup>;

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        "http://hooks.proxied.example/hook",
        {},
        { validation: MEMBER_POLICY },
      );

    expect(response.statusCode).toBe(200);
    expect(proxy.requests[0]!.url).toBe("http://hooks.proxied.example/hook");

    const looked: Array<string> = socketLookup.mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    );

    expect(looked).toContain("localhost");
    expect(looked).not.toContain("hooks.proxied.example");
  });

  test("a host in NO_PROXY is sent to directly, and pinned", async () => {
    const proxy: TestServer = await serve();
    const target: TestServer = await serve();
    checkAnswers["hooks.direct.example"] = ["127.0.0.1"];
    process.env["HTTP_PROXY"] = `http://127.0.0.1:${proxy.port}`;
    process.env["NO_PROXY"] = "hooks.direct.example";

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        target.url("/hook", "hooks.direct.example"),
        {},
        { validation: MEMBER_POLICY },
      );

    // hooks.direct.example resolves nowhere real: only the pinned lookup reaches the server.
    expect(response.statusCode).toBe(200);
    expect(target.requests).toHaveLength(1);
    expect(proxy.requests).toHaveLength(0);
  });

  test("an https webhook goes through HTTPS_PROXY as a CONNECT tunnel to its name, never to an address the proxy was not asked for", async () => {
    const proxy: TestServer = await serve();
    checkAnswers["hooks.secure.example"] = [PUBLIC_ADDRESS];
    process.env["HTTPS_PROXY"] = `http://127.0.0.1:${proxy.port}`;

    /*
     * The test's proxy refuses every tunnel. The webhook never got the
     * request, so it is the proxy's refusal that comes back, and not as an
     * answer of the webhook's (#10442: Node's tunnel, not axios's).
     */
    let refusal: unknown = undefined;

    try {
      await SafeWebhookRequest.post(
        "https://hooks.secure.example/hook",
        {},
        { validation: MEMBER_POLICY },
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(APIException);
    expect((refusal as Error).message).toBe(
      "Request failed to https://hooks.secure.example/hook. The outbound proxy did not open a connection to hooks.secure.example:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    // The proxy's address is the operator's, and stays out of the error.
    expect((refusal as Error).message).not.toContain(String(proxy.port));
    expect(proxy.connects).toEqual(["hooks.secure.example:443"]);
  });

  test("the proxies' host names are read from the environment as axios reads them", () => {
    process.env["HTTP_PROXY"] = "http://Proxy.Corp.Example:3128";
    process.env["https_proxy"] = "secure-proxy.corp.example:8443";
    process.env["ALL_PROXY"] = "socks5://[fd00::1]:1080";
    process.env["all_proxy"] = "::: not a URL :::";

    expect(
      Array.from(DataSourceEgressGuard.getOutboundProxyHostnames()).sort(),
    ).toEqual(
      ["fd00::1", "proxy.corp.example", "secure-proxy.corp.example"].sort(),
    );
  });

  test("with no proxy configured there are no proxy names to look up", () => {
    expect(DataSourceEgressGuard.getOutboundProxyHostnames().size).toBe(0);
  });
});

describe("the pinned lookup the agents carry (DataSourceEgressGuard's, one implementation for every pinned request)", () => {
  const target: WebhookTarget = {
    url: new globalThis.URL("https://Hooks.Example.com/hook"),
    addresses: [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ],
  };

  function look(
    lookup: EgressLookupFunction,
    hostname: string,
    options: { all?: boolean; family?: number },
  ): Promise<{ error: NodeJS.ErrnoException | null; address: unknown }> {
    return new Promise(
      (
        resolve: (value: {
          error: NodeJS.ErrnoException | null;
          address: unknown;
        }) => void,
      ) => {
        lookup(
          hostname,
          options,
          (error: NodeJS.ErrnoException | null, address: unknown) => {
            resolve({ error: error, address: address });
          },
        );
      },
    );
  }

  test("answers the target's name with the approved addresses, as the socket asks for them", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);

    expect(
      (await look(lookup, "hooks.example.com", { all: true })).address,
    ).toEqual(target.addresses);
    expect(
      (await look(lookup, "HOOKS.EXAMPLE.COM", { family: 4 })).address,
    ).toBe("93.184.216.34");
    expect(
      (await look(lookup, "hooks.example.com", { all: true, family: 6 }))
        .address,
    ).toEqual([target.addresses[1]]);
  });

  test("refuses any other name", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);

    for (const name of [
      "169.254.169.254.nip.io",
      "localhost",
      "hooks.example.com.evil.example",
      "example.com",
    ]) {
      const answer: { error: NodeJS.ErrnoException | null } = await look(
        lookup,
        name,
        { all: true },
      );

      expect(answer.error?.message).toBe(UNAPPROVED_LOOKUP_MESSAGE);
      expect(answer.error?.code).toBe("ENOTFOUND");
    }
  });

  test("answers asynchronously, as dns.lookup does", () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookupForTarget(target);
    let answered: boolean = false;

    lookup("elsewhere.example", {}, () => {
      answered = true;
    });
    lookup("hooks.example.com", {}, () => {
      answered = true;
    });

    expect(answered).toBe(false);
  });
});

describe("a request that does not answer in time fails, and frees its socket", () => {
  test("an endpoint that takes the connection and never answers fails at its timeout", async () => {
    const server: TestServer = await serve();

    server.handler = (): void => {
      // Never answers.
    };

    const startedAt: number = Date.now();

    await expect(
      SafeWebhookRequest.post(
        server.url(),
        {},
        { validation: MEMBER_POLICY, timeout: 300 },
      ),
    ).rejects.toThrow(/timeout/i);

    expect(Date.now() - startedAt).toBeLessThan(3000);
    await eventually(() => {
      return server.closedSockets === 1 && server.openSockets.size === 0;
    });
  });

  test("an endpoint that answers slowly, inside the timeout, is delivered", async () => {
    const server: TestServer = await serve();

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      setTimeout(() => {
        response.writeHead(200);
        response.end("{}");
      }, 150);
    };

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await SafeWebhookRequest.post(
        server.url(),
        {},
        { validation: MEMBER_POLICY, timeout: 2000, totalTimeoutInMs: 4000 },
      );

    expect(response.statusCode).toBe(200);
  });

  test("the total timeout is a hard one: an answer that trickles in forever is given up, and its socket closed", async () => {
    const server: TestServer = await serve();
    let trickle: ReturnType<typeof setInterval> | null = null;

    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      // A byte now and then: never idle long enough for the attempt's timeout.
      trickle = setInterval(() => {
        response.write(" ");
      }, 50);
    };

    const startedAt: number = Date.now();

    try {
      await expect(
        SafeWebhookRequest.post(
          server.url(),
          {},
          {
            validation: MEMBER_POLICY,
            timeout: 5000,
            totalTimeoutInMs: 400,
          },
        ),
      ).rejects.toThrow(SafeWebhookRequest.getDeadlineMessage(400));

      expect(Date.now() - startedAt).toBeLessThan(3000);
      await eventually(() => {
        return server.openSockets.size === 0;
      });
    } finally {
      if (trickle) {
        clearInterval(trickle);
      }
    }
  }, 10000);

  test("no attempt starts that the total timeout cannot pay for", async () => {
    const server: TestServer = await serve();

    server.handler = (): void => {
      // Never answers.
    };

    await expect(
      SafeWebhookRequest.post(
        server.url(),
        {},
        {
          validation: MEMBER_POLICY,
          timeout: 200,
          retries: 10,
          totalTimeoutInMs: 500,
        },
      ),
    ).rejects.toBeInstanceOf(Error);

    // 200 ms an attempt in 500 ms: three at most, never eleven.
    expect(server.requests.length).toBeLessThanOrEqual(3);
  });

  test("what a request given up by its total timeout says names no part of the URL", () => {
    expect(SafeWebhookRequest.getDeadlineMessage(120000)).toBe(
      "The webhook did not answer within 120 seconds, so the request was given up.",
    );
    expect(SafeWebhookRequest.getDeadlineMessage(1000)).toBe(
      "The webhook did not answer within 1 second, so the request was given up.",
    );
  });

  test("an error thrown while the deadline has not run out is passed on as it was", async () => {
    const thrown: APIException = new APIException("connect ECONNREFUSED");

    jest.spyOn(API, "post").mockRejectedValue(thrown as never);

    await expect(
      SafeWebhookRequest.post(
        "http://127.0.0.1:9/hook",
        {},
        { validation: MEMBER_POLICY, totalTimeoutInMs: 60000 },
      ),
    ).rejects.toBe(thrown);
  });
});

describe("what API is handed", () => {
  test("the URL it reports is the one that was checked", async () => {
    const post: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as never,
      ) as unknown as SpyInstance<typeof API.post>;
    checkAnswers["hooks.example.com"] = [PUBLIC_ADDRESS];

    await SafeWebhookRequest.post(
      URL.fromString("https://hooks.example.com/v1/abc?key=1"),
      {},
    );

    const request: APIRequestOptions = post.mock
      .calls[0]![0] as APIRequestOptions;

    expect(request.url.toString()).toBe(
      "https://hooks.example.com/v1/abc?key=1",
    );
    expect(request.options?.dispatchUrl).toBe(
      "https://hooks.example.com/v1/abc?key=1",
    );
    expect(request.options?.doNotFollowRedirects).toBe(true);
    expect(request.options?.httpAgent).toBeInstanceOf(http.Agent);
    expect(request.options?.httpsAgent).toBeDefined();
  });

  test("only the options a caller gave, besides the ones every webhook is sent with", async () => {
    const post: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as never,
      ) as unknown as SpyInstance<typeof API.post>;
    checkAnswers["hooks.example.com"] = [PUBLIC_ADDRESS];

    await SafeWebhookRequest.post("https://hooks.example.com/hook", {}, {});

    expect(
      Object.keys(
        (post.mock.calls[0]![0] as APIRequestOptions).options || {},
      ).sort(),
    ).toEqual(
      [
        "disableProxy",
        "dispatchUrl",
        "doNotFollowRedirects",
        "httpAgent",
        "httpsAgent",
        "maxContentLength",
        "useNodeHttpAdapter",
      ].sort(),
    );
    // The agents go through the outbound proxy themselves (#10442).
    expect(
      (post.mock.calls[0]![0] as APIRequestOptions).options?.disableProxy,
    ).toBe(true);
    // A sender that names no limit reads as much as a webhook does.
    expect(
      (post.mock.calls[0]![0] as APIRequestOptions).options?.maxContentLength,
    ).toBe(WEBHOOK_MAX_RESPONSE_BYTES);
  });

  test("a sender's own limit is the one API is handed", async () => {
    const post: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as never,
      ) as unknown as SpyInstance<typeof API.post>;
    checkAnswers["hooks.example.com"] = [PUBLIC_ADDRESS];

    await SafeWebhookRequest.post(
      "https://hooks.example.com/hook",
      {},
      { maxContentLength: 10 * 1024 * 1024 },
    );

    expect(
      (post.mock.calls[0]![0] as APIRequestOptions).options?.maxContentLength,
    ).toBe(10 * 1024 * 1024);
  });
});
