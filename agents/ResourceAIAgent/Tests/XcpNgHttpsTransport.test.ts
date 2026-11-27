import { recordingLogger, testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import tls from "tls";
import { after, before, describe, test } from "node:test";
import XcpNgExecutor, {
  CERTIFICATE_NAMES_NO_ADDRESS,
  XoHttpRequest,
  XoHttpResponse,
  XoTransportError,
  xoHttpsTransport,
} from "../Executors/XcpNgExecutor";
import {
  ExecResult,
  PrepareResult,
  PreparedCommand,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { TEST_RESOURCE_ID } from "./Helpers/FakeOneUptime";
import {
  FIX_TOKEN,
  FakeXenOrchestra,
  READ_TOKEN,
} from "./Helpers/FakeXenOrchestra";
import { PROD_POOL, VM_APP_02, XoObject } from "./Helpers/XenOrchestraLab";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { tokenizeResourceCommand } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The real HTTPS transport (node's https module) against local TLS servers,
 * the fake Xen Orchestra among them, with certificates made by openssl in
 * the shapes a Xen Orchestra really has:
 *
 *   - one from a CA (Let's Encrypt or a company CA), naming its name and
 *     address in its subjectAltName, which the XCP-ng Agent's install.sh
 *     trusts through the CA in xo-ca.pem;
 *   - one naming its name only, reached by address: XO_TLS_SERVER_NAME;
 *   - the one Xen Orchestra makes for itself when it has none (autoCert,
 *     @xen-orchestra/self-signed: `openssl req -batch -new -x509 -nodes
 *     -newkey rsa:2048`), which names no address at all, pinned as
 *     xo-ca.pem - and still refused, as the collector refuses it;
 *   - one from another CA.
 *
 * What is checked is what reaches the server and what comes back: the
 * cookie and nothing else carrying a token, verification against xo-ca.pem
 * alone and by subjectAltName alone, SNI, no redirect followed, the answer
 * cap, the time budget, and that neither the global agent nor a proxy in
 * the environment is ever used. Skipped where openssl is missing.
 */

const certDir: string = makeTempDir("agent-xcp-ng-tls-");

function openssl(args: Array<string>): boolean {
  const result: SpawnSyncReturns<Buffer> = spawnSync("openssl", args, {
    stdio: "ignore",
    cwd: certDir,
  });

  return result.status === 0;
}

function file(name: string): string {
  return path.join(certDir, name);
}

function signedBy(ca: string, name: string, subjectAltName: string): boolean {
  fs.writeFileSync(file(`${name}.ext`), `subjectAltName=${subjectAltName}\n`);

  return (
    openssl([
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      file(`${name}.key`),
      "-out",
      file(`${name}.csr`),
      "-subj",
      "/CN=xo.lab.example",
    ]) &&
    openssl([
      "x509",
      "-req",
      "-in",
      file(`${name}.csr`),
      "-CA",
      file(`${ca}.pem`),
      "-CAkey",
      file(`${ca}.key`),
      "-CAcreateserial",
      "-out",
      file(`${name}.pem`),
      "-days",
      "1",
      "-extfile",
      file(`${name}.ext`),
    ])
  );
}

function makeCa(name: string): boolean {
  return openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    file(`${name}.key`),
    "-out",
    file(`${name}.pem`),
    "-days",
    "1",
    "-subj",
    `/CN=${name}`,
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
}

const HAVE_CERTIFICATES: boolean =
  makeCa("lab-ca") &&
  makeCa("other-ca") &&
  signedBy("lab-ca", "xo", "DNS:xo.lab.example,IP:127.0.0.1") &&
  signedBy("lab-ca", "xo-name-only", "DNS:xo.lab.example") &&
  signedBy("other-ca", "xo-other-ca", "DNS:xo.lab.example,IP:127.0.0.1") &&
  // Exactly @xen-orchestra/self-signed's genSelfSignedCert.
  openssl([
    "req",
    "-batch",
    "-new",
    "-x509",
    "-days",
    "1",
    "-nodes",
    "-newkey",
    "rsa:2048",
    "-keyout",
    file("autocert.key"),
    "-out",
    file("autocert.pem"),
  ]) &&
  /*
   * The self-signed certificate the XCP-ng Agent's README has you make on
   * Xen Orchestra's machine instead, naming its address, which install.sh
   * pins (XO_TLS_FINGERPRINT): xo-ca.pem then holds this certificate itself.
   */
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=xo.lab.example",
    "-addext",
    "subjectAltName=DNS:xo.lab.example,IP:127.0.0.1",
    "-keyout",
    file("xo-self-signed.key"),
    "-out",
    file("xo-self-signed.pem"),
  ]);

const NEEDS_CERTIFICATES: string | false = HAVE_CERTIFICATES
  ? false
  : "openssl is not available to make test certificates";

after((): void => {
  fs.rmSync(certDir, { recursive: true, force: true });
});

function read(name: string): string {
  return fs.readFileSync(file(name), "utf8");
}

interface TlsServer {
  port: number;
  servernames: Array<string | false | null>;
  close: () => Promise<void>;
}

async function startTlsServer(
  certName: string,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<TlsServer> {
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  const servernames: Array<string | false | null> = [];
  const server: https.Server = https.createServer(
    { cert: read(`${certName}.pem`), key: read(`${certName}.key`) },
    handler,
  );

  server.on("secureConnection", (socket: tls.TLSSocket): void => {
    servernames.push(socket.servername);
  });
  server.on("connection", (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on("close", (): void => {
      sockets.delete(socket);
    });
  });

  const port: number = await new Promise<number>(
    (resolve: (port: number) => void): void => {
      server.listen(0, "127.0.0.1", (): void => {
        resolve((server.address() as net.AddressInfo).port);
      });
    },
  );

  return {
    port,
    servernames,
    close: (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy();
      }

      return new Promise<void>((resolve: () => void): void => {
        server.close((): void => {
          resolve();
        });
      });
    },
  };
}

function request(
  port: number,
  overrides: Partial<XoHttpRequest> = {},
): XoHttpRequest {
  return {
    method: "GET",
    hostname: "127.0.0.1",
    port,
    path: "/rest/v0/pools?fields=name_label",
    headers: {
      Cookie: `authenticationToken=${READ_TOKEN}`,
      Accept: "application/json",
    },
    body: null,
    ca: HAVE_CERTIFICATES ? read("lab-ca.pem") : "",
    tlsServerName: "127.0.0.1",
    timeoutInMs: 5_000,
    maxResponseBytes: 1024 * 1024,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<XoTransportError> {
  try {
    await promise;
  } catch (err: unknown) {
    assert.ok(err instanceof XoTransportError, String(err));
    return err;
  }

  throw new Error("the request did not fail");
}

describe("the HTTPS transport", { skip: NEEDS_CERTIFICATES }, () => {
  let fake: FakeXenOrchestra;
  let server: { port: number; close: () => Promise<void> };

  before(async (): Promise<void> => {
    fake = new FakeXenOrchestra();
    server = await fake.listen({ cert: read("xo.pem"), key: read("xo.key") });
  });

  after(async (): Promise<void> => {
    await server.close();
  });

  test("a certificate from the CA in xo-ca.pem, naming the address: answered", async () => {
    const response: XoHttpResponse = await xoHttpsTransport(
      request(server.port),
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.truncated, false);
    assert.deepStrictEqual(JSON.parse(response.body), [
      { name_label: "Production", href: `/rest/v0/pools/${PROD_POOL}` },
      {
        name_label: "",
        href: "/rest/v0/pools/2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1",
      },
    ]);
    assert.strictEqual(fake.requests.at(-1)!.token, "read");
    assert.strictEqual(
      fake.requests.at(-1)!.headers["authorization"],
      undefined,
    );
  });

  test("a POST carries its JSON body and its length", async () => {
    const response: XoHttpResponse = await xoHttpsTransport(
      request(server.port, {
        method: "POST",
        path: `/rest/v0/vms/${VM_APP_02}/actions/start`,
        headers: {
          Cookie: `authenticationToken=${FIX_TOKEN}`,
          "Content-Type": "application/json",
          "Content-Length": "2",
        },
        body: "{}",
      }),
    );

    assert.strictEqual(response.statusCode, 202);
    assert.match(String(response.location), /^\/rest\/v0\/tasks\/0mt/);
    assert.strictEqual(fake.requests.at(-1)!.body, "{}");
    assert.strictEqual(fake.requests.at(-1)!.token, "fix");
  });

  test("the address the certificate does not name is refused, the name it names is checked by SNI", async () => {
    const nameOnly: TlsServer = await startTlsServer(
      "xo-name-only",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      },
    );

    try {
      const refused: XoTransportError = await failure(
        xoHttpsTransport(request(nameOnly.port)),
      );

      assert.strictEqual(refused.kind, "tls");
      assert.strictEqual(refused.code, "ERR_TLS_CERT_ALTNAME_INVALID");

      const answered: XoHttpResponse = await xoHttpsTransport(
        request(nameOnly.port, { tlsServerName: "xo.lab.example" }),
      );

      assert.strictEqual(answered.statusCode, 200);
      assert.ok(nameOnly.servernames.includes("xo.lab.example"));
    } finally {
      await nameOnly.close();
    }
  });

  test("an address is never sent as SNI (RFC 6066), and is checked against the certificate's IP entries", async () => {
    const byAddress: TlsServer = await startTlsServer(
      "xo",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.end("[]");
      },
    );

    try {
      const answered: XoHttpResponse = await xoHttpsTransport(
        request(byAddress.port, { tlsServerName: "127.0.0.1" }),
      );

      assert.strictEqual(answered.statusCode, 200);
      assert.strictEqual(byAddress.servernames.length, 1);
      assert.notStrictEqual(typeof byAddress.servernames[0], "string");
    } finally {
      await byAddress.close();
    }
  });

  test("Xen Orchestra's own certificate is refused even pinned, and says why", async () => {
    const autocert: TlsServer = await startTlsServer(
      "autocert",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.end("[]");
      },
    );

    try {
      for (const tlsServerName of [
        "127.0.0.1",
        "xo.lab.example",
        "localhost",
      ]) {
        const refused: XoTransportError = await failure(
          xoHttpsTransport(
            request(autocert.port, { ca: read("autocert.pem"), tlsServerName }),
          ),
        );

        assert.strictEqual(refused.kind, "tls");
        assert.ok(
          refused.message.includes(CERTIFICATE_NAMES_NO_ADDRESS),
          refused.message,
        );
      }
    } finally {
      await autocert.close();
    }
  });

  test("a certificate from another CA is refused before anything is sent", async () => {
    const other: TlsServer = await startTlsServer(
      "xo-other-ca",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.end("should never be asked");
      },
    );

    try {
      const refused: XoTransportError = await failure(
        xoHttpsTransport(request(other.port)),
      );

      assert.strictEqual(refused.kind, "tls");
      assert.strictEqual(refused.mayHaveBeenSent, false);
    } finally {
      await other.close();
    }
  });

  test("a self-signed certificate naming its address, pinned as xo-ca.pem: answered, and by that certificate alone", async () => {
    const selfSigned: TlsServer = await startTlsServer(
      "xo-self-signed",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      },
    );

    try {
      const pinned: XoHttpResponse = await xoHttpsTransport(
        request(selfSigned.port, { ca: read("xo-self-signed.pem") }),
      );

      assert.strictEqual(pinned.statusCode, 200);

      // The CA the agent was not given is no reason to trust it.
      const refused: XoTransportError = await failure(
        xoHttpsTransport(request(selfSigned.port)),
      );

      assert.strictEqual(refused.kind, "tls");
      assert.strictEqual(refused.mayHaveBeenSent, false);
    } finally {
      await selfSigned.close();
    }
  });

  test("a redirect is answered, never followed", async () => {
    let asked: number = 0;
    const redirecting: TlsServer = await startTlsServer(
      "xo",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        asked++;
        res.writeHead(302, { Location: "https://127.0.0.1:1/login" });
        res.end();
      },
    );

    try {
      const response: XoHttpResponse = await xoHttpsTransport(
        request(redirecting.port),
      );

      assert.strictEqual(response.statusCode, 302);
      assert.strictEqual(response.location, "https://127.0.0.1:1/login");
      assert.strictEqual(asked, 1);
    } finally {
      await redirecting.close();
    }
  });

  test("an answer over the cap is cut and says so", async () => {
    const big: TlsServer = await startTlsServer(
      "xo",
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(`[${'"x",'.repeat(100_000)}"x"]`);
      },
    );

    try {
      const response: XoHttpResponse = await xoHttpsTransport(
        request(big.port, { maxResponseBytes: 1000 }),
      );

      assert.strictEqual(response.truncated, true);
      assert.strictEqual(Buffer.byteLength(response.body, "utf8"), 1000);
    } finally {
      await big.close();
    }
  });

  test("no answer in time: a timeout, which may have been sent", async () => {
    const silent: TlsServer = await startTlsServer("xo", (): void => {
      // Never answers.
    });

    try {
      const timedOut: XoTransportError = await failure(
        xoHttpsTransport(request(silent.port, { timeoutInMs: 300 })),
      );

      assert.strictEqual(timedOut.kind, "timeout");
      assert.strictEqual(timedOut.mayHaveBeenSent, true);
    } finally {
      await silent.close();
    }
  });

  test("a closed port: no connection, never sent", async () => {
    const closed: net.Server = net.createServer();
    const port: number = await new Promise<number>(
      (resolve: (port: number) => void): void => {
        closed.listen(0, "127.0.0.1", (): void => {
          resolve((closed.address() as net.AddressInfo).port);
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      closed.close((): void => {
        resolve();
      });
    });

    const refused: XoTransportError = await failure(
      xoHttpsTransport(request(port)),
    );

    assert.strictEqual(refused.kind, "connect");
    assert.strictEqual(refused.code, "ECONNREFUSED");
    assert.strictEqual(refused.mayHaveBeenSent, false);
  });

  test("a port that does not speak TLS is a TLS failure, never sent", async () => {
    const plain: http.Server = http.createServer(
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        res.end("plain");
      },
    );
    const port: number = await new Promise<number>(
      (resolve: (port: number) => void): void => {
        plain.listen(0, "127.0.0.1", (): void => {
          resolve((plain.address() as net.AddressInfo).port);
        });
      },
    );

    try {
      const refused: XoTransportError = await failure(
        xoHttpsTransport(request(port)),
      );

      assert.notStrictEqual(refused.kind, "timeout");
      assert.strictEqual(refused.mayHaveBeenSent, false);
    } finally {
      await new Promise<void>((resolve: () => void): void => {
        plain.close((): void => {
          resolve();
        });
      });
    }
  });

  test("a proxy in the environment is never used", async () => {
    const saved: Record<string, string | undefined> = {
      HTTPS_PROXY: process.env["HTTPS_PROXY"],
      https_proxy: process.env["https_proxy"],
    };

    process.env["HTTPS_PROXY"] = "http://127.0.0.1:1";
    process.env["https_proxy"] = "http://127.0.0.1:1";

    try {
      const response: XoHttpResponse = await xoHttpsTransport(
        request(server.port),
      );

      assert.strictEqual(response.statusCode, 200);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});

describe(
  "the executor over HTTPS, end to end",
  { skip: NEEDS_CERTIFICATES },
  () => {
    let fake: FakeXenOrchestra;
    let server: { port: number; close: () => Promise<void> };
    let caFile: string;

    before(async (): Promise<void> => {
      fake = new FakeXenOrchestra();
      server = await fake.listen({ cert: read("xo.pem"), key: read("xo.key") });
      caFile = file("xo-ca.pem");
      // What install.sh writes when Xen Orchestra's certificate is from a CA.
      fs.writeFileSync(caFile, read("lab-ca.pem"));
    });

    after(async (): Promise<void> => {
      await server.close();
    });

    function executor(overrides: Record<string, string> = {}): XcpNgExecutor {
      const env: Record<string, string> = {
        ONEUPTIME_AI_AGENT_RESOURCE_TYPE: "xcp-ng",
        DOCKER_HOST_NAME: "",
        XCP_NG_POOL_ID: PROD_POOL,
        XO_SCHEME: "https",
        XO_ADDRESS: `127.0.0.1:${server.port}`,
        ONEUPTIME_AI_XO_READ_TOKEN: READ_TOKEN,
        ONEUPTIME_AI_XO_CA_FILE: caFile,
        ...overrides,
      };

      return new XcpNgExecutor(
        {
          config: testConfig("https://oneuptime.example.com", env),
          env,
          tmpDir: certDir,
          logger: recordingLogger(),
        },
        { pollIntervalMs: 20 },
      );
    }

    async function run(
      target: XcpNgExecutor,
      command: string,
      origin: string = "AiInvestigation",
    ): Promise<ExecResult> {
      const argv: Array<string> = tokenizeResourceCommand(command).argv || [];
      const prepared: PrepareResult = target.prepare({
        payload: {
          resourceType: AiResourceType.XcpNgPool,
          resourceId: TEST_RESOURCE_ID,
          resourceIdentifier: PROD_POOL,
          program: argv[0],
          args: argv.slice(1),
          displayCommand: command,
          tier: ResourceCommandPolicy.evaluateArgv({
            resourceType: AiResourceType.XcpNgPool,
            argv,
          }).tier,
        },
        origin,
        timeoutInMs: 30_000,
        agentResourceId: TEST_RESOURCE_ID,
      });

      assert.strictEqual(prepared.refusal, null, String(prepared.refusal));
      return (prepared as PreparedCommand).run();
    }

    test("an investigation's read, through TLS, scoped to the pool", async () => {
      const result: ExecResult = await run(
        executor(),
        "xo-cli rest get vms fields=name_label,power_state filter=power_state:Halted",
      );

      assert.strictEqual(result.success, true, String(result.errorMessage));
      assert.match(result.output, /app-02/);
      assert.doesNotMatch(result.output, /lab-vm-01/);
    });

    test("a fix, through TLS: the change with the fix token, its task followed, the VM running", async () => {
      const result: ExecResult = await run(
        executor({
          ONEUPTIME_AI_ALLOW_WRITES: "true",
          ONEUPTIME_AI_XO_WRITE_TOKEN: FIX_TOKEN,
        }),
        `xo-cli rest post vms/${VM_APP_02}/actions/start`,
        "AiRemediation",
      );

      assert.strictEqual(result.success, true, String(result.errorMessage));
      assert.match(result.output, /power_state: Running/);
      assert.strictEqual(
        (fake.find("vms", VM_APP_02) as XoObject)["power_state"],
        "Running",
      );
    });

    test("the posture, through TLS", async () => {
      const probe: ResourcePostureProbe = await executor().probePosture();

      assert.strictEqual(probe.reachable, true, String(probe.reachError));
      assert.strictEqual(probe.toolVersion, "XCP-ng 8.3.0");
    });

    test("Xen Orchestra's own certificate, pinned: the posture says how to replace it", async () => {
      const autocert: TlsServer = await startTlsServer(
        "autocert",
        (_req: http.IncomingMessage, res: http.ServerResponse): void => {
          res.end("[]");
        },
      );
      const pinned: string = file("pinned-autocert.pem");

      fs.writeFileSync(pinned, read("autocert.pem"));

      try {
        const probe: ResourcePostureProbe = await executor({
          XO_ADDRESS: `127.0.0.1:${autocert.port}`,
          ONEUPTIME_AI_XO_CA_FILE: pinned,
        }).probePosture();

        assert.strictEqual(probe.reachable, false);
        assert.match(
          String(probe.reachError),
          /no TLS client can check it, pinned or not/,
        );
      } finally {
        await autocert.close();
      }
    });
  },
);
