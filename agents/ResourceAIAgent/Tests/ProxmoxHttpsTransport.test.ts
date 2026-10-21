import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import { after, describe, test } from "node:test";
import ProxmoxExecutor, {
  ProxmoxHttpRequest,
  ProxmoxHttpResponse,
  ProxmoxTransportError,
  httpsTransport,
} from "../Executors/ProxmoxExecutor";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";

/*
 * The real HTTPS transport (node's https module) against local servers: a
 * TLS server with a throwaway self-signed certificate (made with openssl,
 * as Proxy.test.ts does; the tests that need it are skipped where openssl
 * is missing), a plain HTTP server, a listener that never speaks TLS, and a
 * closed port. What is checked is what reaches the server and what comes
 * back: the exact request, TLS verification with and without the CA, no
 * redirect followed, the answer cap, the time budget, and that neither the
 * global agent nor the agent's egress proxy is ever used.
 */

const TOKEN_ID: string = "monitoring@pam!oneuptime";
const TOKEN_SECRET: string = "0b7f2a1e-5c3d-4e8f-9a6b-1c2d3e4f5a6b";
const UPID: string =
  "UPID:pve1:0001A2B3:0C4D5E6F:65A1B2C3:qmstart:101:monitoring@pam!oneuptime:";

const certDir: string = makeTempDir("agent-proxmox-tls-");
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
    "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ],
  { stdio: "ignore" },
);
const HAVE_CERTIFICATE: boolean =
  openssl.status === 0 && fs.existsSync(certFile) && fs.existsSync(keyFile);
const NEEDS_CERTIFICATE: string | false = HAVE_CERTIFICATE
  ? false
  : "openssl is not available to make a test certificate";

after((): void => {
  fs.rmSync(certDir, { recursive: true, force: true });
});

interface SeenRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface TestServer {
  port: number;
  seen: Array<SeenRequest>;
  close: () => Promise<void>;
}

type Handler = (
  seen: SeenRequest,
  res: http.ServerResponse,
  req: http.IncomingMessage,
) => void;

function listen(server: net.Server): Promise<number> {
  return new Promise<number>((resolve: (port: number) => void): void => {
    server.listen(0, "127.0.0.1", (): void => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function closer(
  server: net.Server,
  sockets: Set<net.Socket>,
): () => Promise<void> {
  return (): Promise<void> => {
    for (const socket of sockets) {
      socket.destroy();
    }

    return new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  };
}

async function startServer(
  handler: Handler,
  secure: boolean = true,
): Promise<TestServer> {
  const seen: Array<SeenRequest> = [];
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  const onRequest: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const chunks: Array<Buffer> = [];

    req.on("data", (chunk: Buffer): void => {
      chunks.push(chunk);
    });
    req.on("end", (): void => {
      const entry: SeenRequest = {
        method: req.method || "",
        url: req.url || "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      seen.push(entry);
      handler(entry, res, req);
    });
  };
  const server: net.Server = secure
    ? https.createServer(
        { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
        onRequest,
      )
    : http.createServer(onRequest);

  server.on("connection", (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on("close", (): void => {
      sockets.delete(socket);
    });
  });

  const port: number = await listen(server);

  return { port, seen, close: closer(server, sockets) };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text: string = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json;charset=UTF-8",
    "Content-Length": String(Buffer.byteLength(text)),
  });
  res.end(text);
}

function transportRequest(
  port: number,
  overrides: Partial<ProxmoxHttpRequest> = {},
): ProxmoxHttpRequest {
  return {
    method: "GET",
    hostname: "127.0.0.1",
    port,
    path: "/api2/json/version",
    headers: {
      Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
      Accept: "application/json",
      "User-Agent": "oneuptime-resource-ai-agent/test",
    },
    body: null,
    verifyTls: false,
    ca: null,
    timeoutInMs: 5_000,
    maxResponseBytes: 64 * 1024,
    ...overrides,
  };
}

async function failureOf(
  promise: Promise<ProxmoxHttpResponse>,
): Promise<ProxmoxTransportError> {
  try {
    await promise;
  } catch (err: unknown) {
    assert.ok(
      err instanceof ProxmoxTransportError,
      `expected a ProxmoxTransportError, got ${String(err)}`,
    );
    return err;
  }

  assert.fail("expected the call to fail");
}

// A port nothing listens on.
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

describe("httpsTransport against a local TLS server", () => {
  test(
    "a GET reaches the server exactly as built, and its answer comes back",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (_seen: SeenRequest, res: http.ServerResponse): void => {
          json(res, 200, { data: { version: "8.2.4" } });
        },
      );

      try {
        const response: ProxmoxHttpResponse = await httpsTransport(
          transportRequest(server.port, {
            path: "/api2/json/nodes/pve1/tasks?errors=1&limit=20",
          }),
        );

        assert.deepStrictEqual(response, {
          statusCode: 200,
          statusMessage: "OK",
          location: null,
          contentType: "application/json;charset=UTF-8",
          body: '{"data":{"version":"8.2.4"}}',
          truncated: false,
        });
        assert.strictEqual(server.seen.length, 1);

        const seen: SeenRequest | undefined = server.seen[0];
        assert.ok(seen);
        assert.strictEqual(seen.method, "GET");
        assert.strictEqual(
          seen.url,
          "/api2/json/nodes/pve1/tasks?errors=1&limit=20",
        );
        assert.strictEqual(
          seen.headers["authorization"],
          `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
        );
        assert.strictEqual(seen.headers["accept"], "application/json");
        assert.strictEqual(
          seen.headers["user-agent"],
          "oneuptime-resource-ai-agent/test",
        );
        assert.strictEqual(seen.body, "");
        // Only what was built, plus what HTTP itself adds.
        assert.deepStrictEqual(Object.keys(seen.headers).sort(), [
          "accept",
          "authorization",
          "connection",
          "host",
          "user-agent",
        ]);
      } finally {
        await server.close();
      }
    },
  );

  test(
    "a POST carries its form body",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (_seen: SeenRequest, res: http.ServerResponse): void => {
          json(res, 200, { data: UPID });
        },
      );

      try {
        await httpsTransport(
          transportRequest(server.port, {
            method: "POST",
            path: "/api2/json/nodes/pve1/qemu/101/status/start",
            headers: {
              Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "Content-Length": "10",
            },
            body: "timeout=30",
          }),
        );

        assert.strictEqual(server.seen[0]?.method, "POST");
        assert.strictEqual(server.seen[0]?.body, "timeout=30");
        assert.strictEqual(
          server.seen[0]?.headers["content-type"],
          "application/x-www-form-urlencoded",
        );
      } finally {
        await server.close();
      }
    },
  );

  test(
    "TLS: unverified by default; verified against the CA; an untrusted certificate never gets the request",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (_seen: SeenRequest, res: http.ServerResponse): void => {
          json(res, 200, { data: {} });
        },
      );

      try {
        assert.strictEqual(
          (await httpsTransport(transportRequest(server.port))).statusCode,
          200,
        );
        assert.strictEqual(
          (
            await httpsTransport(
              transportRequest(server.port, {
                verifyTls: true,
                ca: fs.readFileSync(certFile, "utf8"),
              }),
            )
          ).statusCode,
          200,
        );

        const untrusted: ProxmoxTransportError = await failureOf(
          httpsTransport(transportRequest(server.port, { verifyTls: true })),
        );

        assert.strictEqual(untrusted.kind, "tls");
        assert.strictEqual(untrusted.mayHaveBeenSent, false);
        assert.match(
          String(untrusted.code),
          /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/,
        );
        // The token never reached a server whose certificate was refused.
        assert.strictEqual(server.seen.length, 2);
      } finally {
        await server.close();
      }
    },
  );

  test(
    "a redirect is returned, never followed",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (seen: SeenRequest, res: http.ServerResponse): void => {
          if (seen.url === "/elsewhere") {
            json(res, 200, { data: "followed" });
            return;
          }

          res.writeHead(302, { Location: "/elsewhere", "Content-Length": "0" });
          res.end();
        },
      );

      try {
        const response: ProxmoxHttpResponse = await httpsTransport(
          transportRequest(server.port),
        );

        assert.strictEqual(response.statusCode, 302);
        assert.strictEqual(response.location, "/elsewhere");
        assert.strictEqual(server.seen.length, 1);
      } finally {
        await server.close();
      }
    },
  );

  test(
    "the answer is read up to maxResponseBytes, and says it was cut",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (_seen: SeenRequest, res: http.ServerResponse): void => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(`{"data":"${"x".repeat(200_000)}"}`);
        },
      );

      try {
        const response: ProxmoxHttpResponse = await httpsTransport(
          transportRequest(server.port, { maxResponseBytes: 10_000 }),
        );

        assert.strictEqual(response.truncated, true);
        assert.strictEqual(Buffer.byteLength(response.body), 10_000);
      } finally {
        await server.close();
      }
    },
  );

  test(
    "no answer after the request went out: a timeout, within the budget",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer((): void => {
        // Never answers.
      });

      try {
        const startedAt: number = Date.now();
        const error: ProxmoxTransportError = await failureOf(
          httpsTransport(transportRequest(server.port, { timeoutInMs: 300 })),
        );

        assert.strictEqual(error.kind, "timeout");
        assert.strictEqual(error.mayHaveBeenSent, true);
        assert.ok(Date.now() - startedAt < 3_000);
        assert.strictEqual(server.seen.length, 1, "the request was sent");
      } finally {
        await server.close();
      }
    },
  );

  test(
    "the connection closes before the answer: reset (the request went out)",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (
          _seen: SeenRequest,
          _res: http.ServerResponse,
          req: http.IncomingMessage,
        ): void => {
          req.socket.destroy();
        },
      );

      try {
        const error: ProxmoxTransportError = await failureOf(
          httpsTransport(transportRequest(server.port)),
        );

        assert.strictEqual(error.kind, "reset");
        assert.strictEqual(error.mayHaveBeenSent, true);
      } finally {
        await server.close();
      }
    },
  );

  test(
    "never the global agent (which proxy support may point at a proxy)",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (_seen: SeenRequest, res: http.ServerResponse): void => {
          json(res, 200, { data: {} });
        },
      );
      const saved: https.Agent = https.globalAgent;
      let globalAgentUsed: boolean = false;
      const trap: https.Agent = new https.Agent();

      trap.createConnection = (): net.Socket => {
        globalAgentUsed = true;
        throw new Error("the global agent must not be used");
      };
      https.globalAgent = trap;

      try {
        const response: ProxmoxHttpResponse = await httpsTransport(
          transportRequest(server.port),
        );

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(globalAgentUsed, false);
      } finally {
        https.globalAgent = saved;
        await server.close();
      }
    },
  );

  const setGlobalProxyFromEnv: unknown = (
    http as unknown as Record<string, unknown>
  )["setGlobalProxyFromEnv"];

  test(
    "with the agent's egress proxy switched on, the Proxmox VE API is still reached directly",
    {
      skip:
        NEEDS_CERTIFICATE ||
        (typeof setGlobalProxyFromEnv !== "function" &&
          "this Node has no http.setGlobalProxyFromEnv"),
    },
    async () => {
      const server: TestServer = await startServer(
        (_seen: SeenRequest, res: http.ServerResponse): void => {
          json(res, 200, { data: {} });
        },
      );
      const deadProxyPort: number = await closedPort();
      const restore: unknown = (
        setGlobalProxyFromEnv as (env: Record<string, string>) => unknown
      )({
        HTTPS_PROXY: `http://127.0.0.1:${deadProxyPort}`,
        HTTP_PROXY: `http://127.0.0.1:${deadProxyPort}`,
      });

      try {
        const response: ProxmoxHttpResponse = await httpsTransport(
          transportRequest(server.port),
        );

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(server.seen.length, 1);
      } finally {
        if (typeof restore === "function") {
          (restore as () => void)();
        }
        await server.close();
      }
    },
  );
});

describe("httpsTransport without a TLS server", () => {
  test("a closed port: connect (never sent)", async () => {
    const port: number = await closedPort();
    const error: ProxmoxTransportError = await failureOf(
      httpsTransport(transportRequest(port)),
    );

    assert.strictEqual(error.kind, "connect");
    assert.strictEqual(error.code, "ECONNREFUSED");
    assert.strictEqual(error.mayHaveBeenSent, false);
  });

  test("a plain HTTP port: a TLS failure (never sent)", async () => {
    const server: TestServer = await startServer(
      (_seen: SeenRequest, res: http.ServerResponse): void => {
        json(res, 200, { data: {} });
      },
      false,
    );

    try {
      const error: ProxmoxTransportError = await failureOf(
        httpsTransport(transportRequest(server.port)),
      );

      assert.strictEqual(error.kind, "tls", `${error.code} ${error.message}`);
      assert.strictEqual(server.seen.length, 0);
    } finally {
      await server.close();
    }
  });

  test("a listener that never completes the TLS handshake: connect-timeout (never sent)", async () => {
    const sockets: Set<net.Socket> = new Set<net.Socket>();
    const server: net.Server = net.createServer((socket: net.Socket): void => {
      sockets.add(socket);
      // Accept the connection and say nothing.
    });
    const port: number = await listen(server);

    try {
      const error: ProxmoxTransportError = await failureOf(
        httpsTransport(transportRequest(port, { timeoutInMs: 300 })),
      );

      assert.strictEqual(error.kind, "connect-timeout");
      assert.strictEqual(error.mayHaveBeenSent, false);
    } finally {
      await closer(server, sockets)();
    }
  });
});

describe("ProxmoxExecutor end to end over HTTPS", () => {
  function executorFor(
    port: number,
    env: Record<string, string> = {},
  ): ProxmoxExecutor {
    return new ProxmoxExecutor(
      {
        config: testConfig("https://oneuptime.example.com", {
          DOCKER_HOST_NAME: "",
          ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "proxmox",
          PROXMOX_CLUSTER_NAME: "pve-prod",
          ONEUPTIME_AI_ALLOW_WRITES: "true",
        }),
        env: {
          PVE_HOST: "127.0.0.1",
          PVE_PORT: String(port),
          PVE_API_TOKEN_ID: TOKEN_ID,
          PVE_API_TOKEN_SECRET: TOKEN_SECRET,
          ...env,
        },
        tmpDir: certDir,
        logger: recordingLogger(),
      },
      { pollIntervalMs: 20 },
    );
  }

  function run(
    executor: ProxmoxExecutor,
    argv: Array<string>,
    origin: string,
    tier: string,
  ): Promise<ExecResult> {
    const prepared: PrepareResult = executor.prepare({
      payload: {
        resourceType: AiResourceType.ProxmoxCluster,
        resourceId: TEST_RESOURCE_ID,
        resourceIdentifier: "pve-prod",
        program: argv[0],
        args: argv.slice(1),
        displayCommand: argv.join(" "),
        tier,
      },
      origin,
      timeoutInMs: 10_000,
      agentResourceId: TEST_RESOURCE_ID,
    });

    assert.strictEqual(prepared.refusal, null, String(prepared.refusal));
    return (prepared as PreparedCommand).run();
  }

  test(
    "a start: POST, then its task followed until it stops",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      let polls: number = 0;
      const server: TestServer = await startServer(
        (seen: SeenRequest, res: http.ServerResponse): void => {
          if (seen.method === "POST") {
            json(res, 200, { data: UPID });
            return;
          }

          polls++;
          json(res, 200, {
            data:
              polls < 3
                ? { status: "running" }
                : { status: "stopped", exitstatus: "OK" },
          });
        },
      );

      try {
        const result: ExecResult = await run(
          executorFor(server.port, { PVE_CA_FILE: certFile }),
          [
            "pvesh",
            "create",
            "/nodes/pve1/qemu/101/status/start",
            "--timeout",
            "30",
          ],
          "AiRemediation",
          "SafeWrite",
        );

        assert.deepStrictEqual(result, {
          success: true,
          exitCode: 0,
          output: `[stdout]\n"${UPID}"\n\nTask ${UPID} finished: OK`,
        });
        assert.deepStrictEqual(
          server.seen.map((seen: SeenRequest): string => {
            return `${seen.method} ${seen.url} ${seen.body}`;
          }),
          [
            "POST /api2/json/nodes/pve1/qemu/101/status/start timeout=30",
            "GET /api2/json/nodes/pve1/tasks/UPID%3Apve1%3A0001A2B3%3A0C4D5E6F%3A65A1B2C3%3Aqmstart%3A101%3Amonitoring%40pam!oneuptime%3A/status ",
            "GET /api2/json/nodes/pve1/tasks/UPID%3Apve1%3A0001A2B3%3A0C4D5E6F%3A65A1B2C3%3Aqmstart%3A101%3Amonitoring%40pam!oneuptime%3A/status ",
            "GET /api2/json/nodes/pve1/tasks/UPID%3Apve1%3A0001A2B3%3A0C4D5E6F%3A65A1B2C3%3Aqmstart%3A101%3Amonitoring%40pam!oneuptime%3A/status ",
          ],
        );
      } finally {
        await server.close();
      }
    },
  );

  test(
    "the posture probe over TLS verified against PVE_CA_FILE",
    { skip: NEEDS_CERTIFICATE },
    async () => {
      const server: TestServer = await startServer(
        (seen: SeenRequest, res: http.ServerResponse): void => {
          json(
            res,
            200,
            seen.url === "/api2/json/version"
              ? { data: { version: "9.0.3", release: "9.0" } }
              : {
                  data: [
                    { type: "cluster", name: "homelab", quorate: 1 },
                    { type: "node", name: "pve1", online: 1 },
                    { type: "node", name: "pve2", online: 1 },
                  ],
                },
          );
        },
      );

      try {
        const probe: ResourcePostureProbe = await executorFor(server.port, {
          PVE_CA_FILE: certFile,
        }).probePosture();

        assert.strictEqual(probe.reachable, true, String(probe.reachError));
        assert.strictEqual(probe.toolVersion, "9.0.3");
        assert.strictEqual(probe.details?.["nodes"], 2);
        assert.strictEqual(probe.details?.["quorate"], true);
        assert.strictEqual(probe.details?.["tlsVerified"], true);
        assert.ok(!JSON.stringify(probe).includes(TOKEN_SECRET));
      } finally {
        await server.close();
      }
    },
  );

  test("a closed port: the posture says the API is unreachable, and why", async () => {
    const port: number = await closedPort();
    const probe: ResourcePostureProbe = await executorFor(port).probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^Could not connect to the Proxmox VE API at https:\/\/127\.0\.0\.1:\d+: nothing is listening there \(connection refused\)\..* PVE_HOST is "127\.0\.0\.1", which inside the agent's container is the container itself/,
    );
  });
});
