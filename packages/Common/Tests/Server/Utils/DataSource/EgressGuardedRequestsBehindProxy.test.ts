/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import Domain from "../../../../Server/Types/Domain";
import GuardedMcpHttpTransport, {
  McpHttpResponse,
} from "../../../../Server/Utils/AI/Mcp/McpHttpTransport";
import CodeHostHttp from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import DataSourceHttpFetch from "../../../../Server/Utils/DataSource/HttpFetch";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import MattermostWebhook from "../../../../Server/Utils/Mattermost/MattermostWebhook";
import SafeWebhookRequest from "../../../../Server/Utils/SafeWebhookRequest";
import ExternalCalendarFetch, {
  ExternalCalendarFetchResult,
} from "../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarFetch";
import { createToolImportAddressTransport } from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import OAuth2TokenClient from "../../../../Server/Utils/Workflow/OAuth2TokenClient";
import LlmType from "../../../../Types/LLM/LlmType";
import {
  LocalHttpServer,
  PLAIN_CREDENTIALS,
  PROXY_HOST_NAME,
  RESERVED_CHARACTER_CREDENTIALS,
  approveOnLoopback,
  canListenOn,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "../../TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";

jest.mock("../../../../Server/Utils/Logger");

/*
 * EVERY EGRESS-GUARDED REQUEST BEHIND AN OUTBOUND PROXY NAMED BY HOST NAME
 * (issue #8873).
 *
 * Axios sends a request through HTTPS_PROXY / HTTP_PROXY / ALL_PROXY,
 * unless NO_PROXY names its host, and has the request's agents connect to
 * the proxy. The egress guard's pinned agents answered every name from the
 * checked target's addresses, the proxy's too, so every caller below that
 * sends with axios dialled the target's address on the proxy's port. They
 * now reach the proxy at its own address and ask it for the target by name,
 * as every other request of the server does; a host in NO_PROXY is dialled
 * directly, at the address the guard approved.
 *
 * External calendars and MCP servers are read with Node's own HTTP client,
 * which reads no proxy setting, so they never went through one either
 * (#8932). Their agents now go through the proxy as axios decides
 * (DataSourceEgressGuard.createPinnedAgents), and they are held to the same
 * answers here. The callers that never go through a proxy are held to that
 * too: a Git server and a Mattermost server are reached with the proxy off
 * on purpose, dialled directly, at the approved address, whatever the
 * environment says. self-hosted/private-network-access says which is which.
 *
 * Every pinned agent goes through the proxy itself, through Node's own
 * proxy support, with axios's proxy off: axios sent a proxy's user name and
 * password percent-encoded, so a proxy whose password holds an @, a : or a
 * % refused every one of these with 407 (#10442). Each caller is held to
 * signing in with them as the operator set them, over http and https.
 *
 * The proxy and the servers run on this machine (OutboundProxyFixture):
 * the proxy at 127.0.0.1 named "localhost", the target approved at
 * 127.0.0.2 under a name only the check knows. The old agents would dial
 * 127.0.0.2 on the proxy's port, where nothing listens.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

let canUse127002: boolean = false;

beforeAll(async () => {
  canUse127002 = await canListenOn("127.0.0.2");
});

afterEach(() => {
  jest.restoreAllMocks();
});

// One answer every caller below reads as a success: an LLM's included.
function answerEveryCaller(server: LocalHttpServer): void {
  server.handler = (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        answeredBy: server.name,
        access_token: "token-from-proxy",
        token_type: "Bearer",
        expires_in: 3600,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  };
}

interface ProxiedCaller {
  name: string;
  // The host a test sends to: a name only the check knows.
  host: string;
  // The path the caller asks for under it.
  path: string;
  // Sends one request to `origin` (scheme, host, port), as the caller does.
  send: (origin: string) => Promise<unknown>;
}

const PROXIED_CALLERS: Array<ProxiedCaller> = [
  {
    name: "custom domain verification",
    host: "status.example.test",
    path: "/status-page-api/cname-verification/token-1",
    send: async (origin: string): Promise<unknown> => {
      return await Domain.getForDomainVerification({
        url: `${origin}/status-page-api/cname-verification/token-1`,
        targetLabel: "Status page domain",
      });
    },
  },
  {
    name: "a data source",
    host: "prometheus.example.test",
    path: "/api/v1/query?query=up",
    send: async (origin: string): Promise<unknown> => {
      return await DataSourceHttpFetch.fetch({
        method: "GET",
        url: `${origin}/api/v1/query?query=up`,
        timeoutInMs: 5000,
      });
    },
  },
  {
    name: "a workflow's or SMTP's OAuth token URL",
    host: "idp.example.test",
    path: "/oauth2/token",
    send: async (origin: string): Promise<unknown> => {
      return await OAuth2TokenClient.sendThroughEgressGuard({
        url: `${origin}/oauth2/token`,
        headers: { Accept: "application/json" },
        body: { grant_type: "client_credentials" },
        timeoutInMs: 5000,
      });
    },
  },
  {
    name: "a tool import (Grafana OnCall)",
    host: "oncall.example.test",
    path: "/api/v1/schedules/",
    send: async (origin: string): Promise<unknown> => {
      return await createToolImportAddressTransport({
        allowedHosts: ["oncall.example.test"],
        toolName: "Grafana OnCall",
        allowHttp: true,
      })({
        method: "GET",
        url: `${origin}/api/v1/schedules/`,
        headers: {},
        timeoutInMs: 5000,
      });
    },
  },
  {
    name: "an LLM provider",
    host: "llm.example.test",
    path: "/v1/chat/completions",
    send: async (origin: string): Promise<unknown> => {
      return await LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.OpenAICompatible,
          apiKey: "sk-8873",
          modelName: "some-model",
          baseUrl: `${origin}/v1`,
        },
        messages: [{ role: "user", content: "hi" }],
        requestRetries: 0,
        requestTimeoutInMs: 5000,
      });
    },
  },
  {
    name: "a webhook (SafeWebhookRequest: workflow API steps, playbook and notification webhooks)",
    host: "hooks.example.test",
    path: "/hook",
    send: async (origin: string): Promise<unknown> => {
      return await withLoopbackWebhooksAllowed(async (): Promise<unknown> => {
        return await SafeWebhookRequest.post(
          `${origin}/hook`,
          { via: "proxy" },
          { validation: { allowPrivateNetworkTargets: true } },
        );
      });
    },
  },
  {
    name: "an external calendar (Node's own HTTP client)",
    host: "calendar.example.test",
    path: "/basic.ics",
    send: async (origin: string): Promise<ExternalCalendarFetchResult> => {
      return await ExternalCalendarFetch.fetch(`${origin}/basic.ics`, {
        timeoutInMs: 5000,
      });
    },
  },
  {
    name: "an MCP server (Node's own HTTP client)",
    host: "mcp.example.test",
    path: "/mcp",
    send: async (origin: string): Promise<unknown> => {
      const response: McpHttpResponse =
        await new GuardedMcpHttpTransport().send({
          method: "POST",
          url: `${origin}/mcp`,
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: new AbortController().signal,
          maxResponseBytes: 1024 * 1024,
        });

      response.close();

      return response;
    },
  },
];

/*
 * A webhook reaches this machine only when the private-network allowlist
 * names loopback exactly, as the SafeWebhookRequest suite has it.
 */
async function withLoopbackWebhooksAllowed<T>(
  send: () => Promise<T>,
): Promise<T> {
  const saved: string | undefined =
    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"];
  process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "localhost,127.0.0.0/8";

  try {
    return await send();
  } finally {
    if (saved === undefined) {
      delete process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"];
    } else {
      process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = saved;
    }
  }
}

function targetAddress(): string {
  return canUse127002 ? "127.0.0.2" : "127.0.0.1";
}

async function settle(sending: Promise<unknown>): Promise<void> {
  try {
    await sending;
  } catch {
    // What the caller makes of the answer is its own suite's business.
  }
}

describe.each(PROXIED_CALLERS)(
  "$name, behind an outbound proxy",
  (caller: ProxiedCaller) => {
    let proxy: LocalHttpServer;
    let target: LocalHttpServer;

    beforeEach(async () => {
      proxy = await serve({ name: "proxy" });
      target = await serve({ host: targetAddress(), name: "target" });
      answerEveryCaller(proxy);
      answerEveryCaller(target);
      approveOnLoopback({ [caller.host]: [target.host] });
    });

    test("over http goes to a proxy named by host name, which is asked for the target by name", async () => {
      process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
      const origin: string = `http://${caller.host}:${target.port}`;

      await caller.send(origin);

      expect(
        proxy.requests.map((request: { url: string }): string => {
          return request.url;
        }),
      ).toEqual([`${origin}${caller.path}`]);
      expect(target.isUntouched).toBe(true);
    });

    test("over https is tunnelled through a proxy named by host name, to the target by name", async () => {
      process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

      // The proxy refuses every tunnel here; where it was asked to is the point.
      await settle(caller.send(`https://${caller.host}`));

      expect(proxy.connects).toEqual([`${caller.host}:443`]);
      expect(target.isUntouched).toBe(true);
    });

    test("a host in NO_PROXY is dialled directly, at the address the guard approved", async () => {
      process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
      process.env["NO_PROXY"] = `localhost,${caller.host}`;

      await caller.send(`http://${caller.host}:${target.port}`);

      // The name resolves nowhere real: only the pin reaches the server.
      expect(
        target.requests.map((request: { url: string }): string => {
          return request.url;
        }),
      ).toEqual([caller.path]);
      expect(proxy.isUntouched).toBe(true);
    });

    test("with no proxy at all, it is dialled at the address the guard approved", async () => {
      await caller.send(`http://${caller.host}:${target.port}`);

      expect(target.requests).toHaveLength(1);
      expect(target.requests[0]!.host).toBe(`${caller.host}:${target.port}`);
      expect(proxy.isUntouched).toBe(true);
    });

    test("over http, the proxy is signed in to with its real user name and password, @, : and % in them", async () => {
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      await caller.send(`http://${caller.host}:${target.port}`);

      expect(proxy.requestCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
      expect(target.isUntouched).toBe(true);
    });

    test("over https, the CONNECT is signed in with its real user name and password, @, : and % in them", async () => {
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );

      await settle(caller.send(`https://${caller.host}`));

      expect(proxy.connects).toEqual([`${caller.host}:443`]);
      expect(proxy.connectCredentials).toEqual([
        signedInAs(RESERVED_CHARACTER_CREDENTIALS),
      ]);
      expect(target.isUntouched).toBe(true);
    });

    test("a user name and password with no character a URL reserves sign in as they always did", async () => {
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        PLAIN_CREDENTIALS,
      );
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        PLAIN_CREDENTIALS,
      );

      await caller.send(`http://${caller.host}:${target.port}`);
      await settle(caller.send(`https://${caller.host}`));

      expect(proxy.requestCredentials).toEqual([signedInAs(PLAIN_CREDENTIALS)]);
      expect(proxy.connectCredentials).toEqual([signedInAs(PLAIN_CREDENTIALS)]);
    });

    test("a host in NO_PROXY is dialled directly, its proxy's credentials never sent anywhere", async () => {
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        RESERVED_CHARACTER_CREDENTIALS,
      );
      process.env["NO_PROXY"] = `localhost,${caller.host}`;

      await caller.send(`http://${caller.host}:${target.port}`);

      expect(target.requests).toHaveLength(1);
      expect(target.requestCredentials).toEqual([""]);
      expect(proxy.isUntouched).toBe(true);
    });
  },
);

interface DirectCaller {
  name: string;
  host: string;
  path: string;
  send: (origin: string) => Promise<unknown>;
}

const DIRECT_CALLERS: Array<DirectCaller> = [
  {
    name: "a Mattermost server (the proxy is off on purpose)",
    host: "chat.example.test",
    path: "/hooks/abc123",
    send: async (origin: string): Promise<unknown> => {
      return await withLoopbackWebhooksAllowed(async (): Promise<unknown> => {
        return await MattermostWebhook.send({
          webhookUrl: `${origin}/hooks/abc123`,
          message: { text: "A monitor is down." },
          timeoutInMs: 5000,
        });
      });
    },
  },
  {
    name: "a Git server (the proxy is off on purpose)",
    host: "git.example.test",
    path: "/api/v4/version",
    send: async (origin: string): Promise<unknown> => {
      return await CodeHostHttp.createTransport()({
        method: "GET",
        url: `${origin}/api/v4/version`,
        headers: {},
        timeoutInMs: 5000,
      });
    },
  },
];

describe.each(DIRECT_CALLERS)("$name", (caller: DirectCaller) => {
  test("is dialled directly, at the address the guard approved, whatever proxy is set", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const target: LocalHttpServer = await serve({
      host: targetAddress(),
      name: "target",
    });
    answerEveryCaller(target);
    approveOnLoopback({ [caller.host]: [target.host] });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["ALL_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;

    await caller.send(`http://${caller.host}:${target.port}`);

    expect(
      target.requests.map((request: { url: string }): string => {
        return request.url;
      }),
    ).toEqual([caller.path]);
    expect(proxy.isUntouched).toBe(true);
  });
});
