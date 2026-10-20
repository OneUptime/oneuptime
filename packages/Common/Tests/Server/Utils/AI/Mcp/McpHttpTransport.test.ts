import GuardedMcpHttpTransport, {
  McpHttpRequest,
  McpHttpResponse,
  describeConnectionError,
  getEgressFailure,
} from "../../../../../Server/Utils/AI/Mcp/McpHttpTransport";
import McpClientError from "../../../../../Server/Utils/AI/Mcp/McpClientError";
import { ExternalMcpServerFailureKind } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../../Types/Exception/EgressGuardException";
import FakeMcpServer, {
  LocalMcpHttpTransport,
} from "../../../../Helpers/FakeMcpServer";
import { startEachTestOnSelfHostedEgressPolicy } from "../../EgressPolicyEnvironment";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * How a request to an external MCP server leaves OneUptime: only through
 * the egress guard - loopback, link-local (the cloud metadata address) and
 * the other always-blocked ranges never, private ranges only on a
 * self-hosted OneUptime - with no redirect followed and the answer held to
 * its size.
 */

startEachTestOnSelfHostedEgressPolicy();

let fake: FakeMcpServer | null = null;

afterEach(async () => {
  if (fake) {
    await fake.stop();
    fake = null;
  }
});

function request(url: string): McpHttpRequest {
  return {
    method: "POST",
    url,
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: new AbortController().signal,
    maxResponseBytes: 1024,
  };
}

async function refusal(
  transport: GuardedMcpHttpTransport,
  url: string,
): Promise<McpClientError> {
  try {
    const response: McpHttpResponse = await transport.send(request(url));
    response.close();
  } catch (error) {
    expect(error).toBeInstanceOf(McpClientError);
    return error as McpClientError;
  }

  throw new Error(`${url} was not refused`);
}

describe("GuardedMcpHttpTransport", () => {
  test("never reaches the loopback address, even a server that is listening there", async () => {
    fake = await FakeMcpServer.start({});

    const error: McpClientError = await refusal(
      new GuardedMcpHttpTransport(),
      fake.url("/mcp"),
    );

    expect(error.kind).toBe(ExternalMcpServerFailureKind.AddressNotAllowed);
    expect(fake.requests).toHaveLength(0);
  });

  test("never reaches the cloud metadata address", async () => {
    const error: McpClientError = await refusal(
      new GuardedMcpHttpTransport(),
      "http://169.254.169.254/latest/meta-data/",
    );

    expect(error.kind).toBe(ExternalMcpServerFailureKind.AddressNotAllowed);
  });

  test("refuses a name that resolves to a blocked address", async () => {
    const error: McpClientError = await refusal(
      new GuardedMcpHttpTransport({
        egressOptions: {
          resolveFunction: async () => {
            return [{ address: "127.0.0.1", family: 4 }];
          },
        },
      }),
      "https://innocent-looking.example.com/mcp",
    );

    expect(error.kind).toBe(ExternalMcpServerFailureKind.AddressNotAllowed);
  });

  test("refuses a private address on OneUptime Cloud", async () => {
    process.env["BILLING_ENABLED"] = "true";

    const error: McpClientError = await refusal(
      new GuardedMcpHttpTransport({
        egressOptions: {
          resolveFunction: async () => {
            return [{ address: "10.0.0.5", family: 4 }];
          },
        },
      }),
      "https://mcp.internal.example.com/mcp",
    );

    expect([
      ExternalMcpServerFailureKind.AddressNotAllowed,
      ExternalMcpServerFailureKind.Unreachable,
    ]).toContain(error.kind);
  });

  test("names the MCP server in its refusals", async () => {
    const error: McpClientError = await refusal(
      new GuardedMcpHttpTransport(),
      "http://127.0.0.1:1/mcp",
    );

    expect(error.message).toContain("MCP server");
  });

  test("refuses a scheme the guard does not reach", async () => {
    const error: McpClientError = await refusal(
      new GuardedMcpHttpTransport(),
      "ftp://mcp.example.com/mcp",
    );

    expect(error.kind).toBe(ExternalMcpServerFailureKind.NotAnMcpServer);
  });
});

describe("the Node HTTP request every transport sends", () => {
  test("holds a body to its size, and fails it with TooLarge past it", async () => {
    fake = await FakeMcpServer.start({
      sessionIds: false,
      rawAnswer: { contentType: "application/json", body: "x".repeat(5000) },
    });

    const response: McpHttpResponse = await new LocalMcpHttpTransport().send({
      method: "POST",
      url: fake.url("/mcp"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      signal: new AbortController().signal,
      maxResponseBytes: 1000,
    });

    let error: unknown = null;

    try {
      for await (const chunk of response.readChunks()) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    } catch (caught) {
      error = caught;
    }

    expect((error as McpClientError).kind).toBe(
      ExternalMcpServerFailureKind.TooLarge,
    );
  });

  test("never follows a redirect", async () => {
    fake = await FakeMcpServer.start({
      redirectTo: "http://169.254.169.254/",
    });

    let error: unknown = null;

    try {
      await new LocalMcpHttpTransport().send(request(fake.url("/mcp")));
    } catch (caught) {
      error = caught;
    }

    expect((error as McpClientError).kind).toBe(
      ExternalMcpServerFailureKind.NotAnMcpServer,
    );
    expect((error as McpClientError).status).toBe(307);
  });

  test("aborting a stream that is still open stops the read", async () => {
    fake = await FakeMcpServer.start({ sse: true, sseWithoutEndpoint: true });
    const abort: AbortController = new AbortController();

    const response: McpHttpResponse = await new LocalMcpHttpTransport().send({
      method: "GET",
      url: fake.url("/sse"),
      headers: { Accept: "text/event-stream" },
      signal: abort.signal,
      maxResponseBytes: 1000,
    });

    expect(response.status).toBe(200);

    setTimeout(() => {
      abort.abort();
    }, 50);

    const startedAt: number = Date.now();
    let error: unknown = null;

    try {
      for await (const chunk of response.readChunks()) {
        expect(chunk).toBeDefined();
      }
    } catch (caught) {
      error = caught;
    }

    expect(error).not.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("aborting a request the server has not answered yet is a timeout", async () => {
    fake = await FakeMcpServer.start({ sessionIds: false, hangOnCall: true });
    const abort: AbortController = new AbortController();

    setTimeout(() => {
      abort.abort();
    }, 50);

    let error: unknown = null;

    try {
      await new LocalMcpHttpTransport().send({
        method: "POST",
        url: fake.url("/mcp"),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "x", arguments: {} },
        }),
        signal: abort.signal,
        maxResponseBytes: 1000,
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as McpClientError).kind).toBe(
      ExternalMcpServerFailureKind.TimedOut,
    );
  });
});

describe("describeConnectionError", () => {
  test("says each socket failure plainly", () => {
    const cases: Array<[string, ExternalMcpServerFailureKind, string]> = [
      [
        "ENOTFOUND",
        ExternalMcpServerFailureKind.Unreachable,
        "The server's host name could not be found.",
      ],
      [
        "ECONNREFUSED",
        ExternalMcpServerFailureKind.Unreachable,
        "The server refused the connection.",
      ],
      [
        "ECONNRESET",
        ExternalMcpServerFailureKind.Unreachable,
        "The server closed the connection.",
      ],
      [
        "ETIMEDOUT",
        ExternalMcpServerFailureKind.TimedOut,
        "The connection to the server timed out.",
      ],
      [
        "ABORT_ERR",
        ExternalMcpServerFailureKind.TimedOut,
        "The server did not answer in time.",
      ],
      [
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        ExternalMcpServerFailureKind.Unreachable,
        "The server's TLS certificate was not accepted (DEPTH_ZERO_SELF_SIGNED_CERT).",
      ],
    ];

    for (const [code, kind, message] of cases) {
      const error: NodeJS.ErrnoException = new Error("raw");
      error.code = code;

      const described: McpClientError = describeConnectionError(error);
      expect(described.kind).toBe(kind);
      expect(described.message).toBe(message);
    }
  });

  test("passes an McpClientError through, and says anything else as unreachable", () => {
    const own: McpClientError = new McpClientError({
      kind: ExternalMcpServerFailureKind.TooLarge,
      message: "too big",
    });

    expect(describeConnectionError(own)).toBe(own);
    expect(describeConnectionError(new Error("boom")).message).toBe(
      "Could not reach the server: boom",
    );
  });

  test("reads the egress guard's refusals by their stage", () => {
    expect(
      getEgressFailure(
        new EgressGuardException("blocked", EgressFailureReason.AddressBlocked),
      )?.kind,
    ).toBe(ExternalMcpServerFailureKind.AddressNotAllowed);
    expect(
      getEgressFailure(
        new EgressGuardException("x", EgressFailureReason.Unreachable),
      )?.kind,
    ).toBe(ExternalMcpServerFailureKind.Unreachable);
    expect(
      getEgressFailure(
        new EgressGuardException("x", EgressFailureReason.InvalidTarget),
      )?.kind,
    ).toBe(ExternalMcpServerFailureKind.NotAnMcpServer);
    expect(getEgressFailure(new Error("x"))).toBeNull();
  });
});
