import "./Helpers/TestSupport";
import assert from "assert";
import { spawn, spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import { after, before, describe, test } from "node:test";
import {
  ProxySetup,
  describeProxyEnvironment,
  describeProxyError,
  enableProxyFromEnvironment,
  hasProxyEnvironment,
  redactProxyUrl,
} from "../Proxy";
import FakeOneUptime from "./Helpers/FakeOneUptime";
import { makeTempDir } from "./Helpers/FakeBinary";

/*
 * Networks behind an egress proxy reach OneUptime through HTTPS_PROXY /
 * HTTP_PROXY, with NO_PROXY for what must not go through it. The agent uses
 * Node's fetch, which only honours those once proxy support is switched on
 * — the agent does it at start-up with http.setGlobalProxyFromEnv() (Node
 * 26); an older Node needs NODE_USE_ENV_PROXY=1 — so this is tested for
 * real: the compiled IngestClient, and the whole agent, run in a child
 * process against a local proxy and a local OneUptime.
 */

const AGENT_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const INGEST_CLIENT_JS: string = path.resolve(
  __dirname,
  "..",
  "IngestClient.js",
);
const PROXY_JS: string = path.resolve(__dirname, "..", "Proxy.js");
const AGENT_JS: string = path.resolve(__dirname, "..", "Agent.js");
const UNAVAILABLE_EXECUTOR_JS: string = path.resolve(
  __dirname,
  "..",
  "Executors",
  "UnavailableExecutor.js",
);

// This Node can switch proxy support on at runtime (Node 26, the image's).
const HAS_SET_GLOBAL_PROXY: boolean =
  typeof (http as { setGlobalProxyFromEnv?: unknown }).setGlobalProxyFromEnv ===
  "function";

const NEEDS_SET_GLOBAL_PROXY: string | false = HAS_SET_GLOBAL_PROXY
  ? false
  : "this Node has no http.setGlobalProxyFromEnv";

/*
 * How the child switches proxy support on: the agent's own way where this
 * Node has it, else NODE_USE_ENV_PROXY=1 — what the agent's warning tells
 * an operator on an older Node to set.
 */
const SWITCH_PROXY_ON: Record<string, string> = HAS_SET_GLOBAL_PROXY
  ? { TEST_ENABLE_PROXY: "1" }
  : { NODE_USE_ENV_PROXY: "1" };

// A proxy value with a password in it, which must never reach a log.
const SECRET: string = "S3cr3tPr0xyPw";

interface ProxyHit {
  kind: "forward" | "connect";
  target: string;
}

// A minimal forward proxy: absolute-URI requests and CONNECT tunnels.
class TestProxy {
  public readonly hits: Array<ProxyHit> = [];
  private server: http.Server | null = null;
  private readonly sockets: Set<net.Socket> = new Set();
  public url: string = "";

  public async start(): Promise<void> {
    this.server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse): void => {
        this.hits.push({ kind: "forward", target: req.url || "" });
        const target: URL = new URL(req.url || "");
        const upstream: http.ClientRequest = http.request(
          {
            host: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: req.method,
            headers: req.headers,
          },
          (upstreamRes: http.IncomingMessage): void => {
            res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
            upstreamRes.pipe(res);
          },
        );
        upstream.on("error", (): void => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(upstream);
      },
    );

    this.server.on(
      "connect",
      (req: http.IncomingMessage, socket: net.Socket, head: Buffer): void => {
        this.hits.push({ kind: "connect", target: req.url || "" });
        const [host, port] = (req.url || "").split(":");
        const upstream: net.Socket = net.connect(
          Number(port),
          host || "127.0.0.1",
          (): void => {
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
          },
        );
        this.sockets.add(socket);
        this.sockets.add(upstream);
        upstream.on("error", (): void => {
          socket.destroy();
        });
        socket.on("error", (): void => {
          upstream.destroy();
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    this.url = `http://127.0.0.1:${(this.server.address() as net.AddressInfo).port}`;
  }

  public async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    const server: http.Server | null = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve: () => void): void => {
        server.close((): void => {
          resolve();
        });
      });
    }
  }
}

const CHILD_SCRIPT: string = `
const IngestClient = require(${JSON.stringify(INGEST_CLIENT_JS)}).default;
const { enableProxyFromEnvironment } = require(${JSON.stringify(PROXY_JS)});
const setup = process.env.TEST_ENABLE_PROXY === "1" ? enableProxyFromEnvironment(process.env) : null;
const posture = { resourceType: "DockerHost", resourceIdentifier: "web-host-1", allowWrites: false, writeTargets: [], protectedTargets: [], reachable: true };
(async () => {
  const client = new IngestClient({ oneuptimeUrl: process.env.TEST_TARGET, apiKey: "ingestion-key", timeoutMs: 10000 });
  const register = await client.register({ resourceType: "DockerHost", resourceIdentifier: "web-host-1", posture });
  const heartbeat = await client.heartbeat({ agentId: "agent-1", agentKey: "key-1" }, { posture });
  process.stdout.write(JSON.stringify({ setup, register: register.kind, registerMessage: register.message, heartbeat: heartbeat.kind }));
})();
`;

interface ChildResult {
  setup: ProxySetup | null;
  register: string;
  registerMessage: string;
  heartbeat: string;
}

let scratch: string;
let childScript: string;

function runChild(env: Record<string, string>): Promise<ChildResult> {
  return new Promise<ChildResult>(
    (
      resolve: (result: ChildResult) => void,
      reject: (err: Error) => void,
    ): void => {
      const child: ReturnType<typeof spawn> = spawn(
        process.execPath,
        [childScript],
        {
          // A clean environment: only what the test sets, plus PATH.
          env: { PATH: process.env["PATH"] || "", ...env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout: string = "";
      let stderr: string = "";
      child.stdout!.on("data", (chunk: Buffer): void => {
        stdout += chunk.toString("utf8");
      });
      child.stderr!.on("data", (chunk: Buffer): void => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (): void => {
        try {
          resolve(JSON.parse(stdout) as ChildResult);
        } catch {
          reject(new Error(`child printed ${stdout} / ${stderr}`));
        }
      });
    },
  );
}

describe("proxy settings", () => {
  test("hasProxyEnvironment looks at the proxy URLs, not NO_PROXY alone", () => {
    assert.strictEqual(hasProxyEnvironment({}), false);
    assert.strictEqual(hasProxyEnvironment({ NO_PROXY: "localhost" }), false);
    assert.strictEqual(hasProxyEnvironment({ HTTPS_PROXY: " " }), false);
    for (const name of [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
    ]) {
      assert.strictEqual(
        hasProxyEnvironment({ [name]: "http://proxy:3128" }),
        true,
        name,
      );
    }
  });

  test("proxy URLs are logged without credentials", () => {
    assert.strictEqual(
      redactProxyUrl("http://user:s3cret@proxy.corp:3128/"),
      "http://proxy.corp:3128",
    );
    assert.strictEqual(redactProxyUrl("not a url"), "(not a URL)");
    assert.strictEqual(
      redactProxyUrl(`http://user:${SECRET}@[bad:3128`),
      "(not a URL)",
    );
    // No scheme: parses as a URL without a host — never echoed.
    assert.strictEqual(
      redactProxyUrl("proxy.corp:3128"),
      "(missing http:// or https://)",
    );
    assert.strictEqual(
      redactProxyUrl(`user:${SECRET}@proxy.corp:3128`),
      "(missing http:// or https://)",
    );
    // Node 26 also takes SOCKS5 proxies: scheme and host are kept.
    assert.strictEqual(
      redactProxyUrl(`socks5://user:${SECRET}@proxy.corp:1080`),
      "socks5://proxy.corp:1080",
    );
    assert.deepStrictEqual(
      describeProxyEnvironment({
        https_proxy: "http://u:p@proxy:3128",
        HTTP_PROXY: "http://proxy:3129",
        NO_PROXY: "10.0.0.0/8,.svc",
      }),
      {
        httpsProxy: "http://proxy:3128",
        httpProxy: "http://proxy:3129",
        noProxy: "10.0.0.0/8,.svc",
      },
    );
    assert.deepStrictEqual(describeProxyEnvironment({}), {});
  });

  test("enableProxyFromEnvironment: nothing to do without a proxy", () => {
    let called: boolean = false;
    const setup: ProxySetup = enableProxyFromEnvironment(
      {},
      {
        setGlobalProxyFromEnv: (): void => {
          called = true;
        },
      },
    );

    assert.deepStrictEqual(setup, { support: "none" });
    assert.strictEqual(called, false);
  });

  test("enableProxyFromEnvironment: switched on through setGlobalProxyFromEnv with the agent's env", () => {
    const env: NodeJS.ProcessEnv = { HTTPS_PROXY: "http://proxy:3128" };
    let received: NodeJS.ProcessEnv | undefined;

    const setup: ProxySetup = enableProxyFromEnvironment(env, {
      setGlobalProxyFromEnv: (given?: NodeJS.ProcessEnv): void => {
        received = given;
      },
    });

    assert.deepStrictEqual(setup, { support: "enabled" });
    assert.strictEqual(received, env);
  });

  test("enableProxyFromEnvironment: an invalid proxy URL is reported, not thrown", () => {
    const setup: ProxySetup = enableProxyFromEnvironment(
      { HTTPS_PROXY: "proxy.corp:3128" },
      {
        setGlobalProxyFromEnv: (): void => {
          throw Object.assign(
            new Error(
              "Invalid URL protocol: the URL must start with `http:` or `https:`.",
            ),
            { code: "UND_ERR_INVALID_ARG" },
          );
        },
      },
    );

    assert.deepStrictEqual(setup, {
      support: "invalid",
      error:
        "UND_ERR_INVALID_ARG: Invalid URL protocol: the URL must start with `http:` or `https:`.",
    });
  });

  /*
   * Node's ERR_PROXY_INVALID_CONFIG message is the raw value it refused,
   * password and all (checked against Node 26.10 below).
   */
  test("enableProxyFromEnvironment: the password in a refused URL never reaches the error", () => {
    const value: string = `http://user:${SECRET}@[bad:3128`;
    const setup: ProxySetup = enableProxyFromEnvironment(
      { HTTPS_PROXY: value },
      {
        setGlobalProxyFromEnv: (): void => {
          throw Object.assign(new Error(value), {
            code: "ERR_PROXY_INVALID_CONFIG",
          });
        },
      },
    );

    assert.deepStrictEqual(setup, {
      support: "invalid",
      error: "ERR_PROXY_INVALID_CONFIG: the proxy URL is not valid",
    });
  });

  test("describeProxyError: any proxy value, in any of the four variables, is kept out", () => {
    for (const name of [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
    ]) {
      const value: string = `corp-${SECRET}:3128`;
      const text: string = describeProxyError(
        new Error(`Invalid proxy URL: ${value}`),
        { [name]: `  ${value}  ` },
      );

      assert.strictEqual(text, "the proxy URL is not valid", name);
    }
  });

  test("describeProxyError: URL credentials are kept out even when they are not the configured value", () => {
    const text: string = describeProxyError(
      Object.assign(new Error(`cannot use http://admin:${SECRET}@other:8080`), {
        code: "ERR_PROXY_INVALID_CONFIG",
      }),
      { HTTPS_PROXY: "http://proxy:3128" },
    );

    assert.strictEqual(
      text,
      "ERR_PROXY_INVALID_CONFIG: the proxy URL is not valid",
    );
    assert.ok(!text.includes(SECRET));
  });

  test("describeProxyError: a message without the URL is kept, with its code once", () => {
    assert.strictEqual(
      describeProxyError(
        Object.assign(new Error("Invalid URL"), { code: "ERR_INVALID_URL" }),
        { HTTPS_PROXY: "http://[bad" },
      ),
      "ERR_INVALID_URL: Invalid URL",
    );
    assert.strictEqual(
      describeProxyError(
        Object.assign(new Error("ERR_X: already prefixed"), { code: "ERR_X" }),
        {},
      ),
      "ERR_X: already prefixed",
    );
    assert.strictEqual(describeProxyError(new Error("plain"), {}), "plain");
    assert.strictEqual(describeProxyError("a string", {}), "a string");
    // NO_PROXY holds host names, not credentials: it does not hide a message.
    assert.strictEqual(
      describeProxyError(new Error("Invalid URL"), { NO_PROXY: "URL" }),
      "Invalid URL",
    );
  });

  test(
    "Node's own refusals, as the image's Node words them, come back without the password",
    { skip: NEEDS_SET_GLOBAL_PROXY },
    () => {
      /*
       * Each of these makes setGlobalProxyFromEnv throw before it changes
       * anything, so fetch in this process stays as it was.
       */
      for (const value of [
        `http://user:${SECRET}@[bad:3128`,
        "not a url",
        "proxy.corp:3128",
      ]) {
        const setup: ProxySetup = enableProxyFromEnvironment({
          HTTPS_PROXY: value,
        });

        assert.strictEqual(setup.support, "invalid", value);
        assert.ok(setup.error, value);
        assert.ok(!setup.error!.includes(SECRET), setup.error);
        assert.ok(!setup.error!.includes(value), setup.error);
      }
    },
  );

  test("enableProxyFromEnvironment: an older Node relies on NODE_USE_ENV_PROXY", () => {
    assert.deepStrictEqual(
      enableProxyFromEnvironment(
        { HTTPS_PROXY: "http://proxy:3128", NODE_USE_ENV_PROXY: "1" },
        {},
      ),
      { support: "enabled_by_environment" },
    );
    assert.deepStrictEqual(
      enableProxyFromEnvironment({ HTTPS_PROXY: "http://proxy:3128" }, {}),
      { support: "unsupported" },
    );
  });

  /*
   * With NODE_USE_ENV_PROXY=1 in the image, Node parses the proxy
   * variables before the agent runs, and one typo kills the process on
   * every start (a container restarting in a loop). The agent switches the
   * proxy on itself instead — which needs Node 26's setGlobalProxyFromEnv.
   */
  test("the image leaves NODE_USE_ENV_PROXY unset, and runs a Node that can switch the proxy on itself", () => {
    const dockerfile: string = fs.readFileSync(
      path.join(AGENT_ROOT, "Dockerfile.tpl"),
      "utf8",
    );

    assert.doesNotMatch(dockerfile, /^\s*ENV\s+[^\n]*NODE_USE_ENV_PROXY/m);

    const nodeMajors: Array<number> = [
      ...dockerfile.matchAll(/^FROM \S+\/node:(\d+)-/gm),
    ].map((match: RegExpMatchArray): number => {
      return Number(match[1]);
    });
    assert.ok(nodeMajors.length > 0, "the image is built FROM node");
    for (const major of nodeMajors) {
      assert.ok(major >= 26, `node:${major} has no setGlobalProxyFromEnv`);
    }
  });
});

describe("register and heartbeat through a real proxy", () => {
  let oneuptime: FakeOneUptime;
  let proxy: TestProxy;

  before(async (): Promise<void> => {
    scratch = makeTempDir("agent-proxy-");
    childScript = path.join(scratch, "child.js");
    fs.writeFileSync(childScript, CHILD_SCRIPT);
    oneuptime = new FakeOneUptime();
    await oneuptime.start();
    proxy = new TestProxy();
    await proxy.start();
  });

  after(async (): Promise<void> => {
    await oneuptime.stop();
    await proxy.stop();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("with proxy support on, both calls go through HTTP_PROXY", async () => {
    oneuptime.reset();
    proxy.hits.length = 0;

    const result: ChildResult = await runChild({
      ...SWITCH_PROXY_ON,
      HTTP_PROXY: proxy.url,
      TEST_TARGET: oneuptime.url,
    });

    assert.strictEqual(result.register, "ok", result.registerMessage);
    assert.strictEqual(result.heartbeat, "ok");
    assert.strictEqual(oneuptime.requestsTo("/register").length, 1);
    assert.strictEqual(oneuptime.requestsTo("/heartbeat").length, 1);
    // Node forwards plain http:// through the proxy (older Node tunnels it).
    assert.ok(proxy.hits.length >= 1, "the proxy carried the traffic");
    for (const hit of proxy.hits) {
      assert.ok(
        hit.target.includes(oneuptime.url.replace("http://", "")),
        JSON.stringify(hit),
      );
    }
  });

  test("NO_PROXY hosts bypass the proxy", async () => {
    oneuptime.reset();
    proxy.hits.length = 0;

    const result: ChildResult = await runChild({
      ...SWITCH_PROXY_ON,
      HTTP_PROXY: proxy.url,
      HTTPS_PROXY: proxy.url,
      NO_PROXY: "127.0.0.1",
      TEST_TARGET: oneuptime.url,
    });

    assert.strictEqual(result.register, "ok");
    assert.strictEqual(result.heartbeat, "ok");
    assert.strictEqual(proxy.hits.length, 0);
    assert.strictEqual(oneuptime.requests.length, 2);
  });

  test("an unreachable proxy is a transient failure, not a silent direct connection", async () => {
    oneuptime.reset();

    const result: ChildResult = await runChild({
      ...SWITCH_PROXY_ON,
      HTTP_PROXY: "http://127.0.0.1:1",
      TEST_TARGET: oneuptime.url,
    });

    assert.strictEqual(result.register, "transient");
    assert.strictEqual(oneuptime.requests.length, 0);
  });

  test(
    "setGlobalProxyFromEnv switches it on without NODE_USE_ENV_PROXY (Node 26)",
    { skip: NEEDS_SET_GLOBAL_PROXY },
    async () => {
      oneuptime.reset();
      proxy.hits.length = 0;

      const result: ChildResult = await runChild({
        TEST_ENABLE_PROXY: "1",
        HTTP_PROXY: proxy.url,
        TEST_TARGET: oneuptime.url,
      });

      assert.deepStrictEqual(result.setup, { support: "enabled" });
      assert.strictEqual(result.register, "ok");
      assert.strictEqual(result.heartbeat, "ok");
      assert.ok(proxy.hits.length >= 1);
    },
  );

  test("an https:// OneUptime is tunnelled with CONNECT through HTTPS_PROXY", async () => {
    const certDir: string = makeTempDir("agent-proxy-tls-");
    const openssl: SpawnSyncReturns<Buffer> = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        path.join(certDir, "key.pem"),
        "-out",
        path.join(certDir, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    const haveCertificate: boolean =
      openssl.status === 0 && fs.existsSync(path.join(certDir, "cert.pem"));

    /*
     * With a certificate the whole exchange must succeed through the
     * tunnel. Without openssl the target is a plain TCP listener: TLS then
     * fails, but the CONNECT the proxy saw still proves the tunnel.
     */
    const requests: Array<string> = [];
    const target: net.Server = haveCertificate
      ? https.createServer(
          {
            key: fs.readFileSync(path.join(certDir, "key.pem")),
            cert: fs.readFileSync(path.join(certDir, "cert.pem")),
          },
          (req: http.IncomingMessage, res: http.ServerResponse): void => {
            requests.push(req.url || "");
            req.resume();
            req.on("end", (): void => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify(
                  (req.url || "").endsWith("/register")
                    ? {
                        agentId: "a",
                        agentKey: "k",
                        resourceId: "r",
                        resourceName: "n",
                      }
                    : { status: "ok" },
                ),
              );
            });
          },
        )
      : net.createServer((socket: net.Socket): void => {
          socket.destroy();
        });

    await new Promise<void>((resolve: () => void): void => {
      target.listen(0, "127.0.0.1", resolve);
    });
    const port: number = (target.address() as net.AddressInfo).port;
    proxy.hits.length = 0;

    try {
      const result: ChildResult = await runChild({
        ...SWITCH_PROXY_ON,
        HTTPS_PROXY: proxy.url,
        TEST_TARGET: `https://127.0.0.1:${port}`,
        ...(haveCertificate
          ? { NODE_EXTRA_CA_CERTS: path.join(certDir, "cert.pem") }
          : {}),
      });

      assert.ok(
        proxy.hits.some((hit: ProxyHit): boolean => {
          return hit.kind === "connect" && hit.target === `127.0.0.1:${port}`;
        }),
        JSON.stringify(proxy.hits),
      );

      if (haveCertificate) {
        assert.strictEqual(result.register, "ok", result.registerMessage);
        assert.strictEqual(result.heartbeat, "ok");
        assert.deepStrictEqual(requests, [
          "/resource-ai-agent-ingest/register",
          "/resource-ai-agent-ingest/heartbeat",
        ]);
      } else {
        assert.strictEqual(result.register, "transient");
      }
    } finally {
      if ("closeAllConnections" in target) {
        (target as http.Server).closeAllConnections();
      }
      await new Promise<void>((resolve: () => void): void => {
        target.close((): void => {
          resolve();
        });
      });
      fs.rmSync(certDir, { recursive: true, force: true });
    }
  });
});

/*
 * The whole agent, started as the image starts it (no NODE_USE_ENV_PROXY):
 * its own start-up switches the proxy on, and a proxy value Node refuses is
 * one log line — the container stays up, ready, and connects directly. The
 * executor is the one that runs nothing, so no resource is ever touched.
 */
const AGENT_CHILD_SCRIPT: string = `
const http = require("http");
const ResourceAiAgent = require(${JSON.stringify(AGENT_JS)}).default;
const UnavailableExecutor = require(${JSON.stringify(UNAVAILABLE_EXECUTOR_JS)}).default;
(async () => {
  const agent = new ResourceAiAgent({
    env: process.env,
    tmpDir: process.env.TEST_TMP,
    healthPort: 0,
    healthHost: "127.0.0.1",
    createExecutor: (options) => new UnavailableExecutor(options),
  });
  await agent.start();
  const port = agent.getHealthServer().address().port;
  // Its own http.Agent: the readiness probe never goes through a proxy.
  const ready = await new Promise((resolve) => {
    http
      .get({ host: "127.0.0.1", port, path: "/status/ready", agent: new http.Agent() }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", (err) => resolve(String(err)));
  });
  const deadline = Date.now() + 30000;
  while (!agent.getSession().getIdentity() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const registered = Boolean(agent.getSession().getIdentity());
  await agent.shutdown("test");
  process.stdout.write("RESULT " + JSON.stringify({ ready, registered }) + "\\n");
  process.exit(0);
})().catch((err) => {
  process.stdout.write("RESULT " + JSON.stringify({ error: String((err && err.stack) || err) }) + "\\n");
  process.exit(3);
});
`;

interface AgentChildRun {
  code: number | null;
  output: string;
  result: { ready?: number; registered?: boolean; error?: string } | null;
}

describe("the agent's own start-up", () => {
  let oneuptime: FakeOneUptime;
  let proxy: TestProxy;
  let scratchDir: string;
  let agentScript: string;

  before(async (): Promise<void> => {
    scratchDir = makeTempDir("agent-proxy-start-");
    agentScript = path.join(scratchDir, "agent-child.js");
    fs.writeFileSync(agentScript, AGENT_CHILD_SCRIPT);
    oneuptime = new FakeOneUptime();
    await oneuptime.start();
    proxy = new TestProxy();
    await proxy.start();
  });

  after(async (): Promise<void> => {
    await oneuptime.stop();
    await proxy.stop();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  function runAgent(env: Record<string, string>): Promise<AgentChildRun> {
    const jobTmp: string = fs.mkdtempSync(path.join(scratchDir, "jobs-"));

    return new Promise<AgentChildRun>(
      (resolve: (run: AgentChildRun) => void): void => {
        const child: ReturnType<typeof spawn> = spawn(
          process.execPath,
          [agentScript],
          {
            // Exactly what the container would have: no NODE_USE_ENV_PROXY.
            env: {
              PATH: process.env["PATH"] || "",
              ONEUPTIME_URL: oneuptime.url,
              ONEUPTIME_SERVICE_TOKEN: "ingestion-key-1",
              ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "docker",
              DOCKER_HOST_NAME: "web-host-1",
              APP_VERSION: "14.0.8",
              TEST_TMP: jobTmp,
              ...env,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output: string = "";
        child.stdout!.on("data", (chunk: Buffer): void => {
          output += chunk.toString("utf8");
        });
        child.stderr!.on("data", (chunk: Buffer): void => {
          output += chunk.toString("utf8");
        });
        child.on("close", (code: number | null): void => {
          const line: string | undefined = output
            .split("\n")
            .find((candidate: string): boolean => {
              return candidate.startsWith("RESULT ");
            });
          resolve({
            code,
            output,
            result: line
              ? (JSON.parse(
                  line.slice("RESULT ".length),
                ) as AgentChildRun["result"])
              : null,
          });
        });
      },
    );
  }

  async function expectInvalidProxyIsHarmless(value: string): Promise<void> {
    oneuptime.reset();

    const run: AgentChildRun = await runAgent({
      HTTPS_PROXY: value,
      HTTP_PROXY: value,
    });

    assert.strictEqual(run.code, 0, run.output);
    assert.deepStrictEqual(
      run.result,
      { ready: 200, registered: true },
      run.output,
    );
    // Connected directly, and signed off on the way out.
    assert.strictEqual(oneuptime.requestsTo("/register").length, 1);
    assert.strictEqual(oneuptime.requestsTo("/disconnect").length, 1);
    assert.ok(!run.output.includes(SECRET), run.output);
    assert.ok(
      run.output.includes(
        HAS_SET_GLOBAL_PROXY
          ? "The proxy settings are not valid"
          : "cannot use it for fetch",
      ),
      run.output,
    );
  }

  // Node's own message for this one is the raw value, password included.
  test("an invalid proxy URL never stops the agent, and its password is never printed", async () => {
    await expectInvalidProxyIsHarmless(`http://user:${SECRET}@[bad:3128`);
  });

  test("a proxy URL without http:// (the classic typo) never stops the agent either", async () => {
    await expectInvalidProxyIsHarmless(`user:${SECRET}@proxy.corp:3128`);
  });

  test(
    "a valid proxy is switched on by the agent itself: it registers and signs off through it",
    { skip: NEEDS_SET_GLOBAL_PROXY },
    async () => {
      oneuptime.reset();
      proxy.hits.length = 0;

      const run: AgentChildRun = await runAgent({ HTTP_PROXY: proxy.url });

      assert.strictEqual(run.code, 0, run.output);
      assert.deepStrictEqual(
        run.result,
        { ready: 200, registered: true },
        run.output,
      );
      assert.ok(
        run.output.includes(
          "Connecting to OneUptime through the configured proxy",
        ),
        run.output,
      );
      const targets: Array<string> = proxy.hits.map((hit: ProxyHit): string => {
        return hit.target;
      });
      for (const route of ["/register", "/disconnect"]) {
        assert.ok(
          targets.some((target: string): boolean => {
            return target.endsWith(`/resource-ai-agent-ingest${route}`);
          }),
          `${route} went through the proxy: ${JSON.stringify(targets)}`,
        );
      }
      assert.strictEqual(oneuptime.requestsTo("/disconnect").length, 1);
    },
  );
});
