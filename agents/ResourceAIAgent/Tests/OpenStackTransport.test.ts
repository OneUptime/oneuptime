import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import { after, describe, test } from "node:test";
import OpenStackExecutor, {
  MAX_OPENSTACK_RESPONSE_BYTES,
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransportError,
  nodeTransport,
} from "../Executors/OpenStackExecutor";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
} from "../Executors/ResourceExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";

/*
 * The real transport (node's http and https modules) against local servers: a
 * plain HTTP server, as a DevStack is, a TLS server with a throwaway self-signed
 * certificate (made with openssl; those tests are skipped where it is missing), a
 * listener that never answers, and a closed port. What is checked is what reaches
 * the server and what comes back: the exact request, TLS verification with and
 * without the CA, no redirect followed, the answer cap and the time budget. And
 * the whole agent path once: a real login and a real call over a real socket.
 */

const certDir: string = makeTempDir("agent-openstack-tls-");
const keyFile: string = path.join(certDir, "key.pem");
const certFile: string = path.join(certDir, "cert.pem");
const openssl: SpawnSyncReturns<Buffer> = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyFile,
    "-out",
    certFile,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const hasCertificate: boolean =
  openssl.status === 0 && fs.existsSync(certFile) && fs.existsSync(keyFile);
const NO_CERTIFICATE: string | false = hasCertificate
  ? false
  : "openssl is not available to make a test certificate";

const closers: Array<() => Promise<void>> = [];

after(async (): Promise<void> => {
  for (const close of closers) {
    await close();
  }

  fs.rmSync(certDir, { recursive: true, force: true });
});

function listen(server: net.Server): Promise<number> {
  return new Promise<number>((resolve: (port: number) => void): void => {
    server.listen(0, "127.0.0.1", (): void => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function register(server: net.Server): void {
  closers.push((): Promise<void> => {
    return new Promise<void>((resolve: () => void): void => {
      if ("closeAllConnections" in server) {
        (server as http.Server).closeAllConnections();
      }

      server.close((): void => {
        resolve();
      });
    });
  });
}

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function startHttp(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => void,
): Promise<{ port: number; seen: Array<Seen> }> {
  const seen: Array<Seen> = [];
  const server: http.Server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      const chunks: Array<Buffer> = [];

      request.on("data", (chunk: Buffer): void => {
        chunks.push(chunk);
      });
      request.on("end", (): void => {
        seen.push({
          method: request.method || "",
          url: request.url || "",
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        handler(request, response);
      });
    },
  );

  register(server);

  return { port: await listen(server), seen };
}

function call(
  url: string,
  overrides: Partial<OpenStackHttpRequest> = {},
): Promise<OpenStackHttpResponse> {
  return nodeTransport({
    method: "GET",
    url,
    headers: { Accept: "application/json" },
    body: null,
    verifyTls: true,
    ca: null,
    timeoutInMs: 5_000,
    maxResponseBytes: MAX_OPENSTACK_RESPONSE_BYTES,
    ...overrides,
  });
}

async function failureOf(
  promise: Promise<OpenStackHttpResponse>,
): Promise<OpenStackTransportError> {
  try {
    await promise;
  } catch (err: unknown) {
    assert.ok(err instanceof OpenStackTransportError);

    return err;
  }

  throw new Error("expected the call to fail");
}

async function closedPort(): Promise<number> {
  const server: net.Server = net.createServer();
  const port: number = await listen(server);

  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });

  return port;
}

describe("over plain HTTP, as a DevStack answers", () => {
  test("a GET goes as it was written, and its answer comes back", async () => {
    const { port, seen } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "X-Subject-Token": "abc",
        });
        response.end('{"ok":true}');
      },
    );
    const answer: OpenStackHttpResponse = await call(
      `http://127.0.0.1:${port}/compute/v2.1/servers/detail?all_tenants=1&limit=5`,
      { headers: { "X-Auth-Token": "tok", Accept: "application/json" } },
    );

    assert.strictEqual(answer.statusCode, 200);
    assert.strictEqual(answer.body, '{"ok":true}');
    assert.strictEqual(answer.truncated, false);
    assert.strictEqual(answer.headers["x-subject-token"], "abc");
    assert.strictEqual(seen.length, 1);
    assert.strictEqual((seen[0] as Seen).method, "GET");
    assert.strictEqual(
      (seen[0] as Seen).url,
      "/compute/v2.1/servers/detail?all_tenants=1&limit=5",
    );
    assert.strictEqual((seen[0] as Seen).headers["x-auth-token"], "tok");
  });

  test("a POST's body arrives whole", async () => {
    const { port, seen } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(201);
        response.end("{}");
      },
    );
    const body: string = JSON.stringify({ auth: { a: "é" } });

    await call(`http://127.0.0.1:${port}/identity/v3/auth/tokens`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
    });

    assert.strictEqual((seen[0] as Seen).method, "POST");
    assert.strictEqual((seen[0] as Seen).body, body);
  });

  test("a redirect comes back as what it is, and is never followed", async () => {
    const { port: elsewhere, seen: reached } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end("{}");
      },
    );
    const { port } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(302, {
          Location: `http://127.0.0.1:${elsewhere}/stolen`,
        });
        response.end();
      },
    );
    const answer: OpenStackHttpResponse = await call(
      `http://127.0.0.1:${port}/x`,
      { headers: { "X-Auth-Token": "tok" } },
    );

    assert.strictEqual(answer.statusCode, 302);
    assert.strictEqual(reached.length, 0);
  });

  test("an answer past the cap is cut and says so", async () => {
    const { port } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end("x".repeat(10_000));
      },
    );
    const answer: OpenStackHttpResponse = await call(
      `http://127.0.0.1:${port}/x`,
      { maxResponseBytes: 100 },
    );

    assert.strictEqual(answer.truncated, true);
    assert.strictEqual(answer.body.length, 100);
  });

  test("an error status is an answer, not a failure", async () => {
    const { port } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(503, { "Content-Type": "text/html" });
        response.end("<html>Service Unavailable</html>");
      },
    );
    const answer: OpenStackHttpResponse = await call(
      `http://127.0.0.1:${port}/x`,
    );

    assert.strictEqual(answer.statusCode, 503);
    assert.match(answer.body, /Service Unavailable/);
  });

  test("a closed port is connection refused: nothing was sent", async () => {
    const failure: OpenStackTransportError = await failureOf(
      call(`http://127.0.0.1:${await closedPort()}/x`),
    );

    assert.strictEqual(failure.kind, "connect");
    assert.strictEqual(failure.code, "ECONNREFUSED");
    assert.strictEqual(failure.mayHaveBeenSent, false);
  });

  test("a name that does not resolve: nothing was sent", async () => {
    const failure: OpenStackTransportError = await failureOf(
      call("http://no-such-host.invalid/x"),
    );

    assert.strictEqual(failure.kind, "connect");
    assert.strictEqual(failure.mayHaveBeenSent, false);
  });

  test("a server that never answers is held to the budget, and may have been sent", async () => {
    const { port } = await startHttp((): void => {
      // No answer.
    });
    const failure: OpenStackTransportError = await failureOf(
      call(`http://127.0.0.1:${port}/x`, { timeoutInMs: 100 }),
    );

    assert.strictEqual(failure.kind, "timeout");
    assert.strictEqual(failure.mayHaveBeenSent, true);
  });

  test("a connection dropped partway through an answer reads as reset", async () => {
    const { port } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, { "Content-Length": "1000" });
        response.write("partial");
        response.destroy();
      },
    );
    const failure: OpenStackTransportError = await failureOf(
      call(`http://127.0.0.1:${port}/x`),
    );

    assert.strictEqual(failure.kind, "reset");
    assert.strictEqual(failure.mayHaveBeenSent, true);
  });

  test("the global agent is never used", async () => {
    const { port } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end("{}");
      },
    );
    const original: http.Agent = http.globalAgent;
    const spy: http.Agent = new http.Agent();
    const real: unknown = (spy as unknown as Record<string, unknown>)[
      "addRequest"
    ];
    let used: boolean = false;

    (spy as unknown as Record<string, unknown>)["addRequest"] = function (
      this: unknown,
      ...args: Array<unknown>
    ): unknown {
      used = true;

      return (real as (...args: Array<unknown>) => unknown).apply(this, args);
    };

    http.globalAgent = spy;

    try {
      await call(`http://127.0.0.1:${port}/x`);
    } finally {
      http.globalAgent = original;
      spy.destroy();
    }

    assert.strictEqual(used, false);
  });
});

describe("over TLS", { skip: NO_CERTIFICATE }, () => {
  async function startTls(): Promise<number> {
    const server: https.Server = https.createServer(
      {
        key: fs.readFileSync(keyFile),
        cert: fs.readFileSync(certFile),
      },
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end('{"tls":true}');
      },
    );

    register(server);

    return listen(server);
  }

  test("a certificate nobody trusts is refused: nothing was sent", async () => {
    const port: number = await startTls();
    const failure: OpenStackTransportError = await failureOf(
      call(`https://127.0.0.1:${port}/x`),
    );

    assert.strictEqual(failure.kind, "tls");
    assert.strictEqual(failure.mayHaveBeenSent, false);
  });

  test("the cloud's CA makes it trusted", async () => {
    const port: number = await startTls();
    const answer: OpenStackHttpResponse = await call(
      `https://127.0.0.1:${port}/x`,
      { ca: fs.readFileSync(certFile, "utf8") },
    );

    assert.strictEqual(answer.body, '{"tls":true}');
  });

  test("verify: false, as clouds.yaml can say, skips the check", async () => {
    const port: number = await startTls();
    const answer: OpenStackHttpResponse = await call(
      `https://127.0.0.1:${port}/x`,
      { verifyTls: false },
    );

    assert.strictEqual(answer.statusCode, 200);
  });

  test("a port that does not speak TLS fails the handshake", async () => {
    const { port } = await startHttp(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end("{}");
      },
    );
    const failure: OpenStackTransportError = await failureOf(
      call(`https://127.0.0.1:${port}/x`),
    );

    assert.ok(failure.kind === "tls" || failure.kind === "connect");
    assert.strictEqual(failure.mayHaveBeenSent, false);
  });
});

describe("the whole agent path, over a real socket", () => {
  test("a login, Nova's versions, and one GET with the token it got", async () => {
    const token: string = "gAAAAA-real-socket-token";
    let url: string = "";
    const { port, seen } = await startHttp(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        if (request.method === "POST") {
          response.writeHead(201, {
            "Content-Type": "application/json",
            "X-Subject-Token": token,
          });
          response.end(
            JSON.stringify({
              token: {
                expires_at: "2099-01-01T00:00:00Z",
                catalog: [
                  {
                    type: "compute",
                    endpoints: [
                      {
                        url: `${url}/compute/v2.1`,
                        interface: "public",
                        region_id: "RegionOne",
                      },
                    ],
                  },
                ],
              },
            }),
          );
          return;
        }

        if (request.url === "/compute/") {
          response.writeHead(300, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              versions: [{ id: "v2.1", version: "2.96", min_version: "2.1" }],
            }),
          );
          return;
        }

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            services: [
              {
                id: "1",
                binary: "nova-compute",
                host: "compute-01",
                zone: "nova",
                status: "enabled",
                state: "down",
                updated_at: "2026-11-04T12:37:01.000000",
              },
            ],
          }),
        );
      },
    );

    url = `http://127.0.0.1:${port}`;

    const directory: string = makeTempDir("agent-openstack-real-");
    const clouds: string = path.join(directory, "clouds.yaml");

    fs.writeFileSync(
      clouds,
      `clouds:\n  RegionOne:\n    region_name: RegionOne\n    auth:\n      auth_url: ${url}/identity/v3\n      application_credential_id: id-1\n      application_credential_secret: secret-1\n`,
    );

    const executor: OpenStackExecutor = new OpenStackExecutor({
      config: testConfig("https://oneuptime.example.com", {
        DOCKER_HOST_NAME: "",
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "openstack",
        OPENSTACK_CLOUD_NAME: "prod-eu",
      }),
      env: { OS_CLIENT_CONFIG_FILE: clouds },
      tmpDir: directory,
      logger: recordingLogger(),
    });
    const prepared: PrepareResult = executor.prepare({
      payload: {
        resourceType: AiResourceType.OpenStackCloud,
        resourceId: TEST_RESOURCE_ID,
        resourceIdentifier: "prod-eu",
        program: "openstack",
        args: ["compute", "service", "list", "--service", "nova-compute"],
        tier: "Read",
      },
      origin: "AiInvestigation",
      timeoutInMs: 10_000,
      agentResourceId: TEST_RESOURCE_ID,
    });

    assert.strictEqual(prepared.refusal, null);

    const result: ExecResult = await (prepared as PreparedCommand).run();

    fs.rmSync(directory, { recursive: true, force: true });

    assert.strictEqual(result.success, true, result.errorMessage || "");
    assert.match(result.output, /nova-compute/);
    assert.match(result.output, /down/);
    assert.ok(!result.output.includes(token));
    assert.deepStrictEqual(
      seen.map((request: Seen): string => {
        return `${request.method} ${request.url}`;
      }),
      [
        "POST /identity/v3/auth/tokens",
        "GET /compute/",
        "GET /compute/v2.1/os-services?binary=nova-compute",
      ],
    );
    assert.strictEqual(
      (seen[2] as Seen).headers["openstack-api-version"],
      "compute 2.90",
    );
    assert.strictEqual((seen[2] as Seen).headers["x-auth-token"], token);
    assert.strictEqual((seen[1] as Seen).headers["x-auth-token"], undefined);
  });
});
