import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import tls, { PeerCertificate, TLSSocket } from "tls";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackCollectionReport,
  OpenStackConnectionTestReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { classifyOpenStackError } from "../../../Utils/OpenStack/OpenStackCollectionErrors";
import OpenStackCollector, {
  OpenStackCollectorDependencies,
  resolveOpenStackAddress,
} from "../../../Utils/OpenStack/OpenStackCollector";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import {
  OpenStackEndpointRefusedError,
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackRequestTimeoutError,
  OpenStackResponseTooLargeError,
  OpenStackTransportHandle,
  createOpenStackTransport,
} from "../../../Utils/OpenStack/OpenStackHttp";
import { DEFAULT_OPENSTACK_CLOCK } from "../../../Utils/OpenStack/OpenStackServiceClient";
import {
  OpenStackCertificateError,
  OpenStackConnectTimeoutError,
  judgeOpenStackCertificate,
  openVerifiedSocket,
} from "../../../Utils/OpenStack/OpenStackTls";
import {
  TestCertificate,
  makeSelfSignedCertificate,
} from "../VMware/Helpers/TestCertificates";
import {
  ReportedDatapoint,
  SECRET,
  collectionJob,
  connectionTestJob,
  createCollectorHarness,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  RECORDED_HOST,
  RecordedCloud,
  RecordedScene,
  createRecordedCloud,
  jsonAnswer,
  loadScene,
  recordedTokenBody,
} from "./Helpers/RecordedCloud";

/*
 * The first thing a probe sends a cloud is its secret, and everything after carries a token
 * as good as that secret. So these run over real sockets: a request, any byte at all,
 * reaches a server only after its certificate passed; each socket goes to the address the
 * probe checked, and to no other; and every way a connection can go wrong comes back as the
 * code and the sentence a person is shown.
 *
 * A host name here resolves nowhere. That a request reaches the server at all is what shows
 * the socket went to the pinned address and DNS was never asked.
 */

const HOST: string = "keystone.test";
const NOVA_HOST: string = "nova.test";

const CONNECT_TIMEOUT_IN_MS: number = 30_000;
const MAX_RESPONSE_BYTES: number = 1024 * 1024;

const keystoneCertificate: TestCertificate = makeSelfSignedCertificate(
  HOST,
  `DNS:${HOST}`,
);
const novaCertificate: TestCertificate = makeSelfSignedCertificate(
  NOVA_HOST,
  `DNS:${NOVA_HOST}`,
);
const otherCertificate: TestCertificate = makeSelfSignedCertificate(
  "attacker.test",
  "DNS:attacker.test",
);

const HEALTHY: RecordedScene = loadScene("hibiscus-ovn", "healthy");

function listen(server: net.Server): Promise<number> {
  return new Promise<number>((resolve: (port: number) => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface RealServer {
  port: number;
  requests: Array<ReceivedRequest>;
  connections: () => number;
  close: () => Promise<void>;
}

// An HTTPS server that writes down every request and every connection it was given.
async function startServer(
  certificate: TestCertificate,
  answer: (
    request: ReceivedRequest,
    response: http.ServerResponse,
  ) => void | OpenStackHttpResponse | Promise<OpenStackHttpResponse | void>,
): Promise<RealServer> {
  const requests: Array<ReceivedRequest> = [];
  let connections: number = 0;

  const server: https.Server = https.createServer(
    { key: certificate.key, cert: certificate.cert },
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      const chunks: Array<Buffer> = [];

      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      request.on("end", () => {
        const received: ReceivedRequest = {
          method: request.method || "",
          url: request.url || "",
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };

        requests.push(received);

        void Promise.resolve(answer(received, response)).then(
          (result: OpenStackHttpResponse | void) => {
            if (result) {
              response.writeHead(
                result.status,
                result.headers as http.OutgoingHttpHeaders,
              );
              response.end(result.body);
            }
          },
        );
      });
    },
  );

  server.on("secureConnection", () => {
    connections++;
  });

  const port: number = await listen(server);

  return {
    port: port,
    requests: requests,
    connections: (): number => {
      return connections;
    },
    close: (): Promise<void> => {
      server.closeAllConnections();
      return close(server);
    },
  };
}

function peer(data: Partial<PeerCertificate>): PeerCertificate {
  return {
    subject: { CN: HOST },
    issuer: { CN: "A CA" },
    valid_from: "Oct 10 00:00:00 2026 GMT",
    valid_to: "Oct 10 00:00:00 2028 GMT",
    fingerprint256: keystoneCertificate.fingerprint256,
    subjectaltname: `DNS:${HOST}`,
    ...data,
  } as unknown as PeerCertificate;
}

describe("the verdict on a certificate", () => {
  const judge: (
    data: Partial<Parameters<typeof judgeOpenStackCertificate>[0]>,
  ) => OpenStackCertificateError | null = (
    data: Partial<Parameters<typeof judgeOpenStackCertificate>[0]>,
  ): OpenStackCertificateError | null => {
    return judgeOpenStackCertificate({
      authorized: false,
      authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
      certificate: peer({}),
      trustedFingerprints: [],
      host: HOST,
      port: 5000,
      ...data,
    });
  };

  test("publicly trusted for this host, with nothing pinned: used", () => {
    expect(judge({ authorized: true, authorizationError: null })).toBeNull();
  });

  test("not trusted, with nothing pinned: refused, saying which host showed what", () => {
    const verdict: OpenStackCertificateError | null = judge({});

    expect(verdict?.kind).toBe("untrusted");
    expect(verdict?.presentedCertificate).toMatchObject({
      fingerprint256: keystoneCertificate.fingerprint256,
      subject: `CN=${HOST}`,
      issuer: "CN=A CA",
      verificationError: "SELF_SIGNED_CERT_IN_CHAIN",
      host: HOST,
      port: 5000,
    });
    expect(verdict?.message).toContain(`${HOST}:5000`);
    expect(verdict?.message).toContain("Nothing was sent");
    expect(verdict?.message).toContain(keystoneCertificate.fingerprint256);
  });

  test("pinned: used, though no authority signed it", () => {
    expect(
      judge({ trustedFingerprints: [keystoneCertificate.fingerprint256] }),
    ).toBeNull();
  });

  test("a pin however it was typed", () => {
    expect(
      judge({
        trustedFingerprints: [
          keystoneCertificate.fingerprint256.toLowerCase().split(":").join(""),
        ],
      }),
    ).toBeNull();
  });

  test("one of several pins, because a cloud is many hosts", () => {
    expect(
      judge({
        trustedFingerprints: [
          otherCertificate.fingerprint256,
          keystoneCertificate.fingerprint256,
        ],
      }),
    ).toBeNull();
  });

  test("a pin is exact: anything else is refused, a publicly trusted one included", () => {
    const verdict: OpenStackCertificateError | null = judge({
      authorized: true,
      authorizationError: null,
      trustedFingerprints: [otherCertificate.fingerprint256],
    });

    expect(verdict?.kind).toBe("changed");
    expect(verdict?.message).toContain("Nothing was sent");
    expect(verdict?.message).toContain("trust it");
    expect(verdict?.presentedCertificate.verificationError).toBeUndefined();
  });

  test.each([
    ["none", null],
    ["one with no fingerprint", peer({ fingerprint256: "" })],
  ])("%s: refused", (_name: string, certificate: PeerCertificate | null) => {
    const verdict: OpenStackCertificateError | null = judge({
      certificate: certificate,
      authorizationError: null,
    });

    expect(verdict?.kind).toBe("untrusted");
    expect(verdict?.message).toBe(`${HOST}:5000 presented no certificate.`);
    expect(verdict?.presentedCertificate.verificationError).toBe(
      "no certificate",
    );
  });
});

describe("a socket to a real TLS server", () => {
  let server: tls.Server;
  let port: number;
  let receivedBytes: number = 0;
  let connections: number = 0;
  const serverNames: Array<string | false> = [];

  beforeAll(async () => {
    server = tls.createServer(
      { key: keystoneCertificate.key, cert: keystoneCertificate.cert },
      (socket: TLSSocket) => {
        connections++;
        serverNames.push(socket.servername as string | false);

        socket.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
        });

        socket.on("error", () => {
          // The client hanging up after its check is what should happen.
        });
      },
    );

    port = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  function open(
    overrides: Partial<Parameters<typeof openVerifiedSocket>[0]> = {},
  ): Promise<TLSSocket> {
    return openVerifiedSocket({
      host: HOST,
      port: port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprints: [],
      connectTimeoutInMs: CONNECT_TIMEOUT_IN_MS,
      ...overrides,
    });
  }

  function failure(
    overrides: Partial<Parameters<typeof openVerifiedSocket>[0]> = {},
  ): Promise<Error> {
    return open(overrides).then(
      (socket: TLSSocket): Error => {
        socket.destroy();
        throw new Error("It connected.");
      },
      (error: Error): Error => {
        return error;
      },
    );
  }

  test("self-signed and not pinned: refused before a byte is written", async () => {
    const before: number = receivedBytes;
    const error: Error = await failure();

    expect(error).toBeInstanceOf(OpenStackCertificateError);
    expect((error as OpenStackCertificateError).kind).toBe("untrusted");
    expect(
      (error as OpenStackCertificateError).presentedCertificate,
    ).toMatchObject({
      fingerprint256: keystoneCertificate.fingerprint256,
      isSelfSigned: true,
      host: HOST,
      port: port,
    });
    expect(receivedBytes).toBe(before);
  });

  test("pinned: handed over, encrypted", async () => {
    const socket: TLSSocket = await open({
      trustedFingerprints: [keystoneCertificate.fingerprint256],
    });

    expect(socket.encrypted).toBe(true);
    socket.destroy();
  });

  test("another certificate than the pinned one: a machine in the middle reads nothing", async () => {
    const before: number = receivedBytes;
    const error: Error = await failure({
      trustedFingerprints: [otherCertificate.fingerprint256],
    });

    expect((error as OpenStackCertificateError).kind).toBe("changed");
    expect(receivedBytes).toBe(before);
  });

  // The client can be done with its handshake before the server has been told of its own.
  async function nextServerName(
    overrides: Partial<Parameters<typeof openVerifiedSocket>[0]>,
  ): Promise<string | false | undefined> {
    const before: number = serverNames.length;
    const socket: TLSSocket = await open({
      trustedFingerprints: [keystoneCertificate.fingerprint256],
      ...overrides,
    });

    while (serverNames.length === before) {
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
    }

    socket.destroy();

    return serverNames[serverNames.length - 1];
  }

  test("a host name is sent as SNI, and an address is not", async () => {
    await expect(nextServerName({})).resolves.toBe(HOST);
    await expect(nextServerName({ host: "192.0.2.10" })).resolves.toBe(false);
  });

  test("the next checked address, when one does not answer", async () => {
    const socket: TLSSocket = await open({
      // Nothing listens on this port on the IPv6 loopback, if the machine even has one.
      pinnedAddresses: ["::1", "127.0.0.1"],
      trustedFingerprints: [keystoneCertificate.fingerprint256],
    });

    expect(socket.encrypted).toBe(true);
    socket.destroy();
  });

  test("a certificate's verdict is about the API, so no other address is tried", async () => {
    const before: number = connections;

    await failure({ pinnedAddresses: ["127.0.0.1", "127.0.0.1"] });

    // The handshake is what counts here, and the second one never began.
    expect(connections - before).toBeLessThanOrEqual(1);
  });

  test("no addresses at all", async () => {
    const error: Error = await failure({ pinnedAddresses: [] });

    expect(error.message).toBe(`${HOST} has no address to connect to.`);
  });
});

describe("connections that do not become one", () => {
  test("nothing listening: its code survives, and is a sentence", async () => {
    const closed: net.Server = net.createServer();
    const port: number = await listen(closed);

    await close(closed);

    const error: unknown = await openVerifiedSocket({
      host: HOST,
      port: port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprints: [],
      connectTimeoutInMs: CONNECT_TIMEOUT_IN_MS,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect((error as { code: string }).code).toBe("ECONNREFUSED");
    expect(
      classifyOpenStackError(error, { host: HOST, port: port }),
    ).toMatchObject({
      code: OpenStackCollectionErrorCode.ConnectionRefused,
      message: `${HOST}:${port} refused the connection: nothing listens on port ${port} there.`,
    });
  });

  test("a server that takes the connection and never speaks TLS times out", async () => {
    const sockets: Array<net.Socket> = [];
    const silent: net.Server = net.createServer((socket: net.Socket) => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.resume();
    });
    const port: number = await listen(silent);

    const error: unknown = await openVerifiedSocket({
      host: HOST,
      port: port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprints: [],
      connectTimeoutInMs: 200,
    }).catch((caught: unknown) => {
      return caught;
    });

    for (const socket of sockets) {
      socket.destroy();
    }

    await close(silent);

    expect(error).toBeInstanceOf(OpenStackConnectTimeoutError);
    expect(classifyOpenStackError(error, { host: HOST, port: port }).code).toBe(
      OpenStackCollectionErrorCode.ConnectionTimedOut,
    );
  });

  test("a port that speaks plain HTTP is a failed handshake, and says to check the port", async () => {
    const plain: http.Server = http.createServer(
      (_request: http.IncomingMessage, response: http.ServerResponse) => {
        response.end("hello");
      },
    );
    const port: number = await listen(plain);

    const error: unknown = await openVerifiedSocket({
      host: HOST,
      port: port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprints: [],
      connectTimeoutInMs: CONNECT_TIMEOUT_IN_MS,
    }).catch((caught: unknown) => {
      return caught;
    });

    plain.closeAllConnections();
    await close(plain);

    const classified: ReturnType<typeof classifyOpenStackError> =
      classifyOpenStackError(error, { host: HOST, port: port });

    expect(classified.code).toBe(OpenStackCollectionErrorCode.TlsFailed);
    expect(classified.message).toContain(
      "Check that the address points at an HTTPS port",
    );
  });
});

describe("the transport", () => {
  let handles: Array<OpenStackTransportHandle> = [];
  let servers: Array<RealServer> = [];

  afterEach(async () => {
    for (const handle of handles) {
      handle.close();
    }

    await Promise.all(
      servers.map((server: RealServer) => {
        return server.close();
      }),
    );

    handles = [];
    servers = [];
  });

  async function serving(
    answer: Parameters<typeof startServer>[1],
    certificate: TestCertificate = keystoneCertificate,
  ): Promise<RealServer> {
    const server: RealServer = await startServer(certificate, answer);
    servers.push(server);
    return server;
  }

  const resolved: Array<string> = [];

  function transport(
    overrides: Partial<Parameters<typeof createOpenStackTransport>[0]> = {},
  ): OpenStackTransportHandle {
    resolved.length = 0;

    const handle: OpenStackTransportHandle = createOpenStackTransport({
      trustedFingerprints: [keystoneCertificate.fingerprint256],
      resolve: async (url: string): Promise<Array<string>> => {
        resolved.push(url);
        return ["127.0.0.1"];
      },
      connectTimeoutInMs: CONNECT_TIMEOUT_IN_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      ...overrides,
    });

    handles.push(handle);

    return handle;
  }

  function get(url: string): OpenStackHttpRequest {
    return {
      method: "GET",
      url: url,
      headers: { Accept: "application/json" },
      timeoutInMs: 30_000,
    };
  }

  test("asks what was asked, by the name in the URL, on the checked address", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(200, { ok: true }, { "x-custom": "yes" });
    });

    const response: OpenStackHttpResponse = await transport().transport(
      get(`https://${HOST}:${server.port}/v3/projects?limit=10&marker=a`),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(response.headers["x-custom"]).toBe("yes");

    expect(server.requests[0]).toMatchObject({
      method: "GET",
      url: "/v3/projects?limit=10&marker=a",
    });
    expect(server.requests[0]?.headers["host"]).toBe(`${HOST}:${server.port}`);
    // The size limit below has to mean what it says.
    expect(server.requests[0]?.headers["accept-encoding"]).toBe("identity");
  });

  test("a login's body arrives whole, with its length", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(201, {});
    });

    await transport().transport({
      method: "POST",
      url: `https://${HOST}:${server.port}/v3/auth/tokens`,
      headers: { "Content-Type": "application/json" },
      body: '{"auth":"äöü"}',
      timeoutInMs: 30_000,
    });

    expect(server.requests[0]?.body).toBe('{"auth":"äöü"}');
    expect(server.requests[0]?.headers["content-length"]).toBe(
      String(Buffer.byteLength('{"auth":"äöü"}')),
    );
  });

  test("an IPv6 host is spoken to by its address", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(200, {});
    });

    const response: OpenStackHttpResponse = await transport().transport(
      get(`https://[2001:db8::1]:${server.port}/`),
    );

    expect(response.status).toBe(200);
    expect(server.requests[0]?.headers["host"]).toBe(
      `[2001:db8::1]:${server.port}`,
    );
  });

  test("each host's addresses are checked once, however many requests", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(200, {});
    });
    const { transport: send } = transport();

    await send(get(`https://${HOST}:${server.port}/a`));
    await send(get(`https://${HOST}:${server.port}/b`));
    await send(get(`https://${HOST}:${server.port}/c`));

    expect(resolved).toEqual([`https://${HOST}:${server.port}`]);
  });

  test("another host is checked for itself", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(200, {});
    });
    const { transport: send } = transport({
      trustedFingerprints: [keystoneCertificate.fingerprint256],
    });

    await send(get(`https://${HOST}:${server.port}/a`));
    await send(get(`https://${NOVA_HOST}:${server.port}/a`));

    expect(resolved).toEqual([
      `https://${HOST}:${server.port}`,
      `https://${NOVA_HOST}:${server.port}`,
    ]);
  });

  test("a verified socket is reused, so a collection is not a handshake per request", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(200, {});
    });
    const { transport: send } = transport();

    await send(get(`https://${HOST}:${server.port}/a`));
    await send(get(`https://${HOST}:${server.port}/b`));

    expect(server.requests).toHaveLength(2);
    expect(server.connections()).toBe(1);
  });

  test("closing it ends every connection, and nothing is reused from one collection to the next", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(200, {});
    });

    const first: OpenStackTransportHandle = transport();
    await first.transport(get(`https://${HOST}:${server.port}/a`));
    first.close();

    const second: OpenStackTransportHandle = transport();
    await second.transport(get(`https://${HOST}:${server.port}/a`));

    expect(server.connections()).toBe(2);
  });

  test.each([
    ["plain HTTP", "http://keystone.test:5000/v3", "insecure"],
    ["loopback", "https://127.0.0.1:5000/v3", "forbidden"],
    ["localhost", "https://localhost:5000/v3", "forbidden"],
    ["the metadata address", "https://169.254.169.254/latest", "forbidden"],
    ["a user in the URL", "https://me:pw@keystone.test/v3", "invalid"],
    ["not a URL", "not a url", "invalid"],
  ])(
    "%s is refused before anything else happens",
    async (_name: string, url: string, kind: string) => {
      const error: unknown = await transport()
        .transport(get(url))
        .catch((caught: unknown) => {
          return caught;
        });

      expect(error).toBeInstanceOf(OpenStackEndpointRefusedError);
      expect((error as OpenStackEndpointRefusedError).kind).toBe(kind);
      expect(resolved).toEqual([]);
    },
  );

  test("a redirect is not followed, because a token would follow it", async () => {
    const attacker: RealServer = await serving(() => {
      return jsonAnswer(200, { stolen: true });
    });
    const server: RealServer = await serving(() => {
      return {
        status: 302,
        headers: { location: `https://${HOST}:${attacker.port}/steal` },
        body: "",
      };
    });

    const response: OpenStackHttpResponse = await transport().transport({
      ...get(`https://${HOST}:${server.port}/v3/projects`),
      headers: { "X-Auth-Token": "a-token" },
    });

    expect(response.status).toBe(302);
    expect(attacker.requests).toEqual([]);
  });

  test("an answer larger than OpenStack ever sends is cut off, not read into memory", async () => {
    const server: RealServer = await serving(
      (_request: ReceivedRequest, response: http.ServerResponse) => {
        response.writeHead(200);
        response.write(Buffer.alloc(MAX_RESPONSE_BYTES + 1));
      },
    );

    await expect(
      transport().transport(get(`https://${HOST}:${server.port}/`)),
    ).rejects.toBeInstanceOf(OpenStackResponseTooLargeError);
  });

  test("an answer that never comes is given up on, in words", async () => {
    const server: RealServer = await serving(() => {
      // Takes the request, and says nothing.
    });

    const error: unknown = await transport()
      .transport({
        ...get(`https://${HOST}:${server.port}/slow`),
        timeoutInMs: 100,
      })
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(OpenStackRequestTimeoutError);
    expect(
      classifyOpenStackError(error, { host: HOST, port: server.port }).code,
    ).toBe(OpenStackCollectionErrorCode.TimedOut);
  });

  test("an answer cut off halfway is a failure, and not half an answer", async () => {
    const server: RealServer = await serving(
      (_request: ReceivedRequest, response: http.ServerResponse) => {
        response.writeHead(200, { "content-length": "1000" });
        response.write("{");

        setTimeout(() => {
          response.socket?.destroy();
        }, 10);
      },
    );

    const error: unknown = await transport()
      .transport(get(`https://${HOST}:${server.port}/`))
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as { code?: string }).code).toBe("ECONNRESET");
    expect(
      classifyOpenStackError(error, { host: HOST, port: server.port }).code,
    ).toBe(OpenStackCollectionErrorCode.ConnectionFailed);
  });

  test("a host that will not resolve is asked once a collection, not once a request", async () => {
    let asked: number = 0;

    const { transport: send } = transport({
      resolve: async (): Promise<Array<string>> => {
        asked++;
        throw new Error("OpenStack address could not be reached.");
      },
    });

    await expect(send(get(`https://${HOST}/a`))).rejects.toThrow(
      "OpenStack address could not be reached.",
    );
    await expect(send(get(`https://${HOST}/b`))).rejects.toThrow(
      "OpenStack address could not be reached.",
    );

    expect(asked).toBe(1);
  });

  test("the secret never reaches a certificate that was not trusted", async () => {
    const server: RealServer = await serving(() => {
      return jsonAnswer(201, {});
    }, otherCertificate);

    await expect(
      transport().transport({
        method: "POST",
        url: `https://${HOST}:${server.port}/v3/auth/tokens`,
        headers: {},
        body: JSON.stringify({ secret: SECRET }),
        timeoutInMs: 30_000,
      }),
    ).rejects.toBeInstanceOf(OpenStackCertificateError);

    expect(server.requests).toEqual([]);
  });
});

/*
 * What a person is shown for each of them: the login, the answer and the sentence, on a real
 * connection from end to end. These are the failures the connection test promises to name.
 */
describe("every failure a connection test names", () => {
  let servers: Array<RealServer> = [];

  afterEach(async () => {
    jest.restoreAllMocks();

    await Promise.all(
      servers.map((server: RealServer) => {
        return server.close();
      }),
    );

    servers = [];
  });

  function dependencies(
    overrides: Partial<OpenStackCollectorDependencies> = {},
    connectTimeoutInMs: number = CONNECT_TIMEOUT_IN_MS,
  ): OpenStackCollectorDependencies {
    return {
      resolve: async (): Promise<Array<string>> => {
        return ["127.0.0.1"];
      },
      createTransport: (data: {
        trustedFingerprints: ReadonlyArray<string>;
        resolve: (url: string) => Promise<Array<string>>;
      }): OpenStackTransportHandle => {
        return createOpenStackTransport({
          trustedFingerprints: data.trustedFingerprints,
          resolve: data.resolve,
          connectTimeoutInMs: connectTimeoutInMs,
          maxResponseBytes: 64 * 1024 * 1024,
        });
      },
      clock: DEFAULT_OPENSTACK_CLOCK,
      memory: new OpenStackCollectorMemory(),
      scopeVersion: "test",
      ...overrides,
    };
  }

  /*
   * A real HTTPS server answering as the recording does, with a catalog that names it.
   * Anything the server's own `answer` wants instead goes first.
   */
  async function startRecordedCloud(data: {
    certificate?: TestCertificate;
    host?: string;
    answer?: (
      request: OpenStackHttpRequest,
    ) => OpenStackHttpResponse | undefined;
    catalogFor?: (port: number) => Array<JSONObject>;
  }): Promise<RealServer & { cloud: () => RecordedCloud; authUrl: string }> {
    let cloud: RecordedCloud | null = null;
    const host: string = data.host || HOST;

    const server: RealServer = await startServer(
      data.certificate || keystoneCertificate,
      (request: ReceivedRequest): Promise<OpenStackHttpResponse> => {
        return (cloud as RecordedCloud).transport({
          method: request.method as OpenStackHttpRequest["method"],
          url: `${RECORDED_HOST}${request.url}`,
          headers: {
            "X-Auth-Token": request.headers["x-auth-token"] as string,
            "OpenStack-API-Version": request.headers[
              "openstack-api-version"
            ] as string,
          },
          body: request.body,
          timeoutInMs: 1000,
        });
      },
    );

    servers.push(server);

    const catalog: Array<JSONObject> = data.catalogFor
      ? data.catalogFor(server.port)
      : (JSON.parse(
          JSON.stringify(
            (recordedTokenBody(HEALTHY)["token"] as JSONObject)["catalog"],
          )
            .split(RECORDED_HOST)
            .join(`https://${host}:${server.port}`),
        ) as Array<JSONObject>);

    cloud = createRecordedCloud(HEALTHY, {
      tokenOverrides: { catalog: catalog },
      answer: data.answer,
    });

    return {
      ...server,
      cloud: (): RecordedCloud => {
        return cloud as RecordedCloud;
      },
      authUrl: `https://${host}:${server.port}/identity`,
    };
  }

  test("a name DNS has never heard of", async () => {
    const lookup: unknown = jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(
        Object.assign(new Error("getaddrinfo ENOTFOUND no-such-cloud.test"), {
          code: "ENOTFOUND",
        }) as never,
      );

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: "https://no-such-cloud.test:5000" }),
      dependencies({ resolve: resolveOpenStackAddress }),
    );

    expect(lookup).toHaveBeenCalled();
    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.AddressNotFound,
      errorMessage:
        "The probe cannot find no-such-cloud.test in DNS. Check the spelling, or use an IP address.",
    });
  });

  test.each([
    ["the metadata address", "169.254.169.254"],
    ["loopback", "127.0.0.1"],
    ["the IPv6 loopback", "::1"],
  ])(
    "a name that resolves to %s is refused, not connected to",
    async (_name: string, address: string) => {
      jest
        .spyOn(dns.promises, "lookup")
        .mockResolvedValue([
          { address: address, family: address.includes(":") ? 6 : 4 },
        ] as never);

      const report: OpenStackConnectionTestReport =
        await OpenStackCollector.test(
          connectionTestJob({ authUrl: "https://sneaky.test:5000" }),
          dependencies({ resolve: resolveOpenStackAddress }),
        );

      expect(report.errorCode).toBe(
        OpenStackCollectionErrorCode.AddressNotAllowed,
      );
      expect(report.errorMessage).toContain(
        "loopback, link-local, cloud metadata",
      );
    },
  );

  test("the collection is held to the same guard", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      collectionJob({ authUrl: "https://sneaky.test:5000" }),
      dependencies({ resolve: resolveOpenStackAddress }),
    );

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.AddressNotAllowed,
    );
  });

  test("nothing listening on the port", async () => {
    const closed: net.Server = net.createServer();
    const port: number = await listen(closed);

    await close(closed);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: `https://${HOST}:${port}` }),
      dependencies(),
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.ConnectionRefused,
      errorMessage: `${HOST}:${port} refused the connection: nothing listens on port ${port} there.`,
    });
  });

  test("a firewall that drops it", async () => {
    const sockets: Array<net.Socket> = [];
    const silent: net.Server = net.createServer((socket: net.Socket) => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.resume();
    });
    const port: number = await listen(silent);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: `https://${HOST}:${port}` }),
      dependencies({}, 200),
    );

    for (const socket of sockets) {
      socket.destroy();
    }

    await close(silent);

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.ConnectionTimedOut,
    );
    expect(report.errorMessage).toContain(`TCP ${port}`);
  });

  test("a port that is not HTTPS", async () => {
    const plain: http.Server = http.createServer(
      (_request: http.IncomingMessage, response: http.ServerResponse) => {
        response.end("hello");
      },
    );
    const port: number = await listen(plain);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: `https://${HOST}:${port}` }),
      dependencies(),
    );

    plain.closeAllConnections();
    await close(plain);

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.TlsFailed);
    expect(report.errorMessage).toContain("an HTTPS port");
  });

  test("a certificate nobody trusts yet: nothing sent, and what it showed to decide on", async () => {
    const server: RealServer = await startServer(keystoneCertificate, () => {
      return jsonAnswer(201, {});
    });

    servers.push(server);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: `https://${HOST}:${server.port}` }),
      dependencies(),
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
      presentedCertificate: {
        fingerprint256: keystoneCertificate.fingerprint256,
        host: HOST,
        port: server.port,
        isSelfSigned: true,
      },
    });
    expect(report.errorMessage).toContain("trust it");
    expect(server.requests).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  test("a certificate that is not the one trusted: nothing sent, and which it was instead", async () => {
    const server: RealServer = await startServer(keystoneCertificate, () => {
      return jsonAnswer(201, {});
    });

    servers.push(server);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({
        authUrl: `https://${HOST}:${server.port}`,
        trustedCertificateFingerprints: [otherCertificate.fingerprint256],
      }),
      dependencies(),
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.CertificateChanged,
      presentedCertificate: {
        fingerprint256: keystoneCertificate.fingerprint256,
      },
    });
    expect(server.requests).toEqual([]);
  });

  test("the same in a collection: its report says so too, and it does not try again at once", async () => {
    const server: RealServer = await startServer(keystoneCertificate, () => {
      return jsonAnswer(201, {});
    });

    servers.push(server);

    const deps: OpenStackCollectorDependencies = dependencies();
    const job: ReturnType<typeof collectionJob> = collectionJob({
      authUrl: `https://${HOST}:${server.port}`,
      trustedCertificateFingerprints: [otherCertificate.fingerprint256],
    });

    const report: OpenStackCollectionReport = await OpenStackCollector.collect(
      job,
      deps,
    );

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.CertificateChanged,
    );
    expect(report.presentedCertificate?.fingerprint256).toBe(
      keystoneCertificate.fingerprint256,
    );

    const connections: number = server.connections();
    const next: OpenStackCollectionReport = await OpenStackCollector.collect(
      job,
      deps,
    );

    expect(server.connections()).toBe(connections);
    expect(next.presentedCertificate?.fingerprint256).toBe(
      keystoneCertificate.fingerprint256,
    );
  });

  test("the credential refused", async () => {
    const server: RealServer = await startServer(keystoneCertificate, () => {
      return { status: 401, headers: {}, body: "" };
    });

    servers.push(server);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({
        authUrl: `https://${HOST}:${server.port}`,
        trustedCertificateFingerprints: [keystoneCertificate.fingerprint256],
      }),
      dependencies(),
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
    });
    expect(report.errorMessage).toContain("application credential");
    // What it logged in with never comes back in anything a person reads.
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.body).toContain(SECRET);
  });

  test("the right password on the wrong project", async () => {
    const server: RealServer = await startServer(
      keystoneCertificate,
      (request: ReceivedRequest) => {
        const body: JSONObject = JSON.parse(request.body) as JSONObject;

        return (body["auth"] as JSONObject)["scope"] === "unscoped"
          ? jsonAnswer(201, { token: {} }, { "x-subject-token": "unscoped" })
          : { status: 401, headers: {}, body: "" };
      },
    );

    servers.push(server);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({
        authUrl: `https://${HOST}:${server.port}`,
        trustedCertificateFingerprints: [keystoneCertificate.fingerprint256],
        credential: {
          kind: "password",
          username: "monitor",
          userDomainName: "Default",
          password: SECRET,
          projectName: "monitoring",
          projectDomainName: "Default",
        },
      }),
      dependencies(),
    );

    expect(report.errorCode).toBe(
      OpenStackCollectionErrorCode.WrongProjectScope,
    );
    expect(report.errorMessage).toContain("project monitoring");
  });

  test("an address that is not Keystone", async () => {
    const server: RealServer = await startServer(keystoneCertificate, () => {
      return { status: 404, headers: {}, body: "<html>Not Found</html>" };
    });

    servers.push(server);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({
        authUrl: `https://${HOST}:${server.port}/nothing-here`,
        trustedCertificateFingerprints: [keystoneCertificate.fingerprint256],
      }),
      dependencies(),
    );

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.NotKeystone);
    expect(server.requests[0]?.url).toBe("/nothing-here/v3/auth/tokens");
  });

  test("Keystone unwell", async () => {
    const server: RealServer = await startServer(keystoneCertificate, () => {
      return jsonAnswer(503, { error: { message: "No database." } });
    });

    servers.push(server);

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({
        authUrl: `https://${HOST}:${server.port}`,
        trustedCertificateFingerprints: [keystoneCertificate.fingerprint256],
      }),
      dependencies(),
    );

    expect(report.errorCode).toBe(OpenStackCollectionErrorCode.KeystoneFailing);
    expect(report.errorMessage).toContain("No database.");
  });

  test.each([
    ["Keystone", "/identity/v3/", "identity", "projects"],
    ["Nova", "/compute/v2.1/", "compute", "services"],
    ["Placement", "/placement/", "placement", "resource providers"],
    ["Neutron", "/networking/", "network", "agents"],
    ["Cinder", "/volume/", "volume", "pools"],
    ["Glance", "/image/", "image", "images"],
  ])(
    "a missing permission on %s, over a real connection",
    async (_name: string, prefix: string, service: string, read: string) => {
      const server: RealServer & { authUrl: string } = await startRecordedCloud(
        {
          answer: (request: OpenStackHttpRequest) => {
            return request.method === "GET" &&
              new globalThis.URL(request.url).pathname.startsWith(prefix)
              ? jsonAnswer(403, { forbidden: { message: "Policy says no." } })
              : undefined;
          },
        },
      );

      const report: OpenStackConnectionTestReport =
        await OpenStackCollector.test(
          connectionTestJob({
            authUrl: server.authUrl,
            trustedCertificateFingerprints: [
              keystoneCertificate.fingerprint256,
            ],
          }),
          dependencies(),
        );

      expect(report.status).toBe("Succeeded");

      expect(
        report.summary?.reads.find(
          (candidate: { service: string; read: string }): boolean => {
            return candidate.service === service && candidate.read === read;
          },
        ),
      ).toMatchObject({ access: "Refused", reason: "HTTP 403" });
    },
    120_000,
  );

  test("a service on a host of its own, whose certificate is not one of those trusted", async () => {
    const nova: RealServer = await startServer(novaCertificate, () => {
      return jsonAnswer(200, {});
    });

    servers.push(nova);

    const keystone: RealServer & { authUrl: string } = await startRecordedCloud(
      {
        catalogFor: (port: number): Array<JSONObject> => {
          return [
            {
              type: "compute",
              name: "nova",
              endpoints: [
                {
                  url: `https://${NOVA_HOST}:${nova.port}/compute/v2.1`,
                  interface: "public",
                  region_id: "RegionOne",
                },
              ],
            },
            {
              type: "image",
              name: "glance",
              endpoints: [
                {
                  url: `https://${HOST}:${port}/image`,
                  interface: "public",
                  region_id: "RegionOne",
                },
              ],
            },
          ];
        },
      },
    );

    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({
        authUrl: keystone.authUrl,
        trustedCertificateFingerprints: [keystoneCertificate.fingerprint256],
      }),
      dependencies(),
    );

    expect(report).toMatchObject({
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.CertificateChanged,
      presentedCertificate: {
        fingerprint256: novaCertificate.fingerprint256,
        host: NOVA_HOST,
        port: nova.port,
      },
    });

    // No token went to it.
    expect(nova.requests).toEqual([]);

    // And what was read at Keystone and Glance is still there to see.
    expect(
      report.summary?.reads.find((read: { read: string }): boolean => {
        return read.read === "images";
      })?.access,
    ).toBe("ReadsEverything");
  });
});

describe("a whole collection over real TLS", () => {
  test("is the same as the recording's, with its token only on the wire it should be", async () => {
    let cloud: RecordedCloud | null = null;

    const server: RealServer = await startServer(
      keystoneCertificate,
      (request: ReceivedRequest): Promise<OpenStackHttpResponse> => {
        return (cloud as RecordedCloud).transport({
          method: request.method as OpenStackHttpRequest["method"],
          url: `${RECORDED_HOST}${request.url}`,
          headers: {
            "X-Auth-Token": request.headers["x-auth-token"] as string,
            "OpenStack-API-Version": request.headers[
              "openstack-api-version"
            ] as string,
          },
          body: request.body,
          timeoutInMs: 1000,
        });
      },
    );

    try {
      cloud = createRecordedCloud(HEALTHY, {
        tokenOverrides: {
          catalog: JSON.parse(
            JSON.stringify(
              (recordedTokenBody(HEALTHY)["token"] as JSONObject)["catalog"],
            )
              .split(RECORDED_HOST)
              .join(`https://${HOST}:${server.port}`),
          ) as JSONObject,
        },
      });

      const report: OpenStackCollectionReport =
        await OpenStackCollector.collect(
          collectionJob({
            authUrl: `https://${HOST}:${server.port}/identity`,
            trustedCertificateFingerprints: [
              keystoneCertificate.fingerprint256,
            ],
          }),
          {
            resolve: async (): Promise<Array<string>> => {
              return ["127.0.0.1"];
            },
            createTransport: (data: {
              trustedFingerprints: ReadonlyArray<string>;
              resolve: (url: string) => Promise<Array<string>>;
            }): OpenStackTransportHandle => {
              return createOpenStackTransport({
                trustedFingerprints: data.trustedFingerprints,
                resolve: data.resolve,
                connectTimeoutInMs: CONNECT_TIMEOUT_IN_MS,
                maxResponseBytes: 64 * 1024 * 1024,
              });
            },
            clock: DEFAULT_OPENSTACK_CLOCK,
            memory: new OpenStackCollectorMemory(),
            scopeVersion: "test",
          },
        );

      const scripted: OpenStackCollectionReport =
        await OpenStackCollector.collect(
          collectionJob(),
          createCollectorHarness({
            transport: createRecordedCloud(HEALTHY).transport,
          }).dependencies,
        );

      expect(report.status).toBe("Succeeded");

      const comparable: (
        collection: OpenStackCollectionReport,
      ) => Array<string> = (
        collection: OpenStackCollectionReport,
      ): Array<string> => {
        return datapointsOf(collection.resourceMetrics)
          .filter((point: ReportedDatapoint): boolean => {
            return point.metric !== "scrape_duration_seconds";
          })
          .map((point: ReportedDatapoint): string => {
            return JSON.stringify([point.metric, point.labels, point.value]);
          })
          .sort();
      };

      expect(comparable(report)).toEqual(comparable(scripted));

      // Keep-alive: services at the same time need a few sockets, and never one a request.
      expect(server.requests.length).toBeGreaterThan(20);
      expect(server.connections()).toBeLessThanOrEqual(6);

      // The one with a body is the login.
      const withSecret: Array<ReceivedRequest> = server.requests.filter(
        (request: ReceivedRequest): boolean => {
          return request.body.includes(SECRET);
        },
      );

      expect(
        withSecret.map((request: ReceivedRequest) => {
          return request.url;
        }),
      ).toEqual(["/identity/v3/auth/tokens"]);
    } finally {
      await server.close();
    }
  }, 120_000);
});
