import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  VSphereCertificateError,
  VSphereConnectTimeoutError,
  VSphereVerifyingAgent,
  describePeerCertificate,
  judgePeerCertificate,
  openVerifiedSocket,
} from "../../../Utils/VMware/VSphereTls";
import {
  VSphereRequestTimeoutError,
  VSphereResponseTooLargeError,
  createVSphereTransport,
} from "../../../Utils/VMware/VSphereHttp";
import {
  VSphereHttpResponse,
  VSphereTransport,
} from "../../../Utils/VMware/VSphereSoapClient";
import {
  TestCertificate,
  makeSelfSignedCertificate,
} from "./Helpers/TestCertificates";
import http from "http";
import https from "https";
import net from "net";
import tls, { PeerCertificate, TLSSocket } from "tls";

/*
 * The probe sends vCenter's password in its first request. These tests hold
 * the one rule that protects it: a request - any byte at all - reaches a
 * server only after its certificate passed, and a certificate passes when
 * it is publicly trusted for the host, or is exactly the one trusted for it.
 */

const vcenterCertificate: TestCertificate =
  makeSelfSignedCertificate("vcsa.example.com");
const otherCertificate: TestCertificate =
  makeSelfSignedCertificate("attacker.example.com");

interface RecordingServer {
  port: number;
  receivedBytes: () => number;
  requests: () => number;
  close: () => Promise<void>;
}

// A raw TLS server that counts every byte a client writes to it.
async function startTlsServer(
  certificate: TestCertificate,
): Promise<RecordingServer> {
  let bytes: number = 0;
  const server: tls.Server = tls.createServer(
    { key: certificate.key, cert: certificate.cert },
    (socket: TLSSocket) => {
      socket.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      socket.on("error", () => {
        // The client hanging up after its check is the expected outcome.
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    receivedBytes: (): number => {
      return bytes;
    },
    requests: (): number => {
      return 0;
    },
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

// An HTTPS server answering every request with `body`, counting requests.
async function startHttpsServer(
  certificate: TestCertificate,
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<RecordingServer> {
  let requests: number = 0;
  const server: https.Server = https.createServer(
    { key: certificate.key, cert: certificate.cert },
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      requests++;
      handler(request, response);
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  return {
    port: (server.address() as net.AddressInfo).port,
    receivedBytes: (): number => {
      return 0;
    },
    requests: (): number => {
      return requests;
    },
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function peer(data: Partial<PeerCertificate>): PeerCertificate {
  return {
    subject: { O: "VMware", CN: "vcsa.example.com" },
    issuer: { O: "VMware", CN: "CA" },
    valid_from: "Oct 10 00:00:00 2026 GMT",
    valid_to: "Oct 10 00:00:00 2028 GMT",
    fingerprint256:
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    subjectaltname: "DNS:vcsa.example.com",
    ...data,
  } as unknown as PeerCertificate;
}

describe("judgePeerCertificate", () => {
  const trustedFingerprint: string =
    "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

  test("a publicly trusted certificate for the host passes when nothing is pinned", () => {
    expect(
      judgePeerCertificate({
        authorized: true,
        authorizationError: null,
        certificate: peer({}),
        trustedFingerprint: null,
        host: "vcsa.example.com",
      }),
    ).toBeNull();
  });

  test("an untrusted certificate is refused with what it is", () => {
    const verdict: VSphereCertificateError | null = judgePeerCertificate({
      authorized: false,
      authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
      certificate: peer({}),
      trustedFingerprint: null,
      host: "vcsa.example.com",
    });

    expect(verdict?.kind).toBe("untrusted");
    expect(verdict?.presentedCertificate).toEqual({
      fingerprint256: trustedFingerprint,
      subject: "CN=vcsa.example.com, O=VMware",
      issuer: "CN=CA, O=VMware",
      validFrom: "2026-10-10T00:00:00.000Z",
      validTo: "2028-10-10T00:00:00.000Z",
      subjectAltName: "DNS:vcsa.example.com",
      isSelfSigned: false,
      verificationError: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    expect(verdict?.message).toContain("Nothing was sent");
    expect(verdict?.message).toContain(trustedFingerprint);
  });

  test("the pinned certificate passes even though no authority signed it", () => {
    expect(
      judgePeerCertificate({
        authorized: false,
        authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
        certificate: peer({}),
        trustedFingerprint: trustedFingerprint.toLowerCase().replace(/:/g, ""),
        host: "vcsa.example.com",
      }),
    ).toBeNull();
  });

  test("a pin is exact: any other certificate is refused, a publicly trusted one included", () => {
    const verdict: VSphereCertificateError | null = judgePeerCertificate({
      authorized: true,
      authorizationError: null,
      certificate: peer({
        fingerprint256:
          "11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF",
      }),
      trustedFingerprint: trustedFingerprint,
      host: "vcsa.example.com",
    });

    expect(verdict?.kind).toBe("changed");
    expect(verdict?.message).toContain("different certificate");
  });

  test("no certificate at all is refused", () => {
    expect(
      judgePeerCertificate({
        authorized: false,
        authorizationError: null,
        certificate: null,
        trustedFingerprint: null,
        host: "vcsa.example.com",
      })?.kind,
    ).toBe("untrusted");
  });

  test("describePeerCertificate marks a certificate that signed itself", () => {
    expect(
      describePeerCertificate(
        peer({
          subject: { CN: "vcsa" } as never,
          issuer: { CN: "vcsa" } as never,
        }),
        null,
      ).isSelfSigned,
    ).toBe(true);
  });
});

describe("openVerifiedSocket against a real TLS server", () => {
  let server: RecordingServer;

  beforeAll(async () => {
    server = await startTlsServer(vcenterCertificate);
  });

  afterAll(async () => {
    await server.close();
  });

  test("a self-signed certificate is refused before a single byte is written", async () => {
    const error: unknown = await openVerifiedSocket({
      host: "vcsa.example.com",
      port: server.port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprint: null,
      connectTimeoutInMs: 5000,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(VSphereCertificateError);
    expect((error as VSphereCertificateError).kind).toBe("untrusted");
    expect(
      (error as VSphereCertificateError).presentedCertificate.fingerprint256,
    ).toBe(vcenterCertificate.fingerprint256);
    expect(server.receivedBytes()).toBe(0);
  });

  test("the pinned certificate is accepted", async () => {
    const socket: TLSSocket = await openVerifiedSocket({
      host: "vcsa.example.com",
      port: server.port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprint: vcenterCertificate.fingerprint256,
      connectTimeoutInMs: 5000,
    });

    expect(socket.encrypted).toBe(true);
    socket.destroy();
  });

  test("another certificate than the pinned one is refused - a machine in the middle reads nothing", async () => {
    const error: unknown = await openVerifiedSocket({
      host: "vcsa.example.com",
      port: server.port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprint: otherCertificate.fingerprint256,
      connectTimeoutInMs: 5000,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect((error as VSphereCertificateError).kind).toBe("changed");
    expect(server.receivedBytes()).toBe(0);
  });

  test("tries the next validated address when one does not answer", async () => {
    const closed: net.Server = net.createServer();
    await new Promise<void>((resolve: () => void) => {
      closed.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const closedPort: number = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((resolve: () => void) => {
      closed.close(() => {
        resolve();
      });
    });

    // Nothing listens on closedPort any more: the same port on the next address is tried.
    const error: unknown = await openVerifiedSocket({
      host: "vcsa.example.com",
      port: closedPort,
      pinnedAddresses: ["127.0.0.1", "127.0.0.2"],
      trustedFingerprint: null,
      connectTimeoutInMs: 2000,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect((error as { code?: string }).code).toBe("ECONNREFUSED");
  });

  test("a server that never finishes the handshake times out", async () => {
    const silent: net.Server = net.createServer((socket: net.Socket) => {
      // Reads the hello and never answers it.
      socket.resume();
    });
    await new Promise<void>((resolve: () => void) => {
      silent.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const error: unknown = await openVerifiedSocket({
      host: "vcsa.example.com",
      port: (silent.address() as net.AddressInfo).port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprint: null,
      connectTimeoutInMs: 300,
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(VSphereConnectTimeoutError);

    await new Promise<void>((resolve: () => void) => {
      silent.close(() => {
        resolve();
      });
    });
  });
});

describe("createVSphereTransport through the verifying agent", () => {
  let server: RecordingServer;
  let lastHost: string | undefined;

  beforeAll(async () => {
    server = await startHttpsServer(
      vcenterCertificate,
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        lastHost = request.headers.host;

        if (request.url === "/slow") {
          return;
        }

        if (request.url === "/big") {
          response.writeHead(200);
          response.end("x".repeat(4096));
          return;
        }

        let body: string = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          response.writeHead(200, {
            "Set-Cookie": 'vmware_soap_session="abc"; Path=/',
          });
          response.end(`echo:${body}`);
        });
      },
    );
  });

  afterAll(async () => {
    await server.close();
  });

  function transportFor(
    trustedFingerprint: string | null,
    options: { requestTimeoutInMs?: number; maxResponseBytes?: number } = {},
  ): { transport: VSphereTransport; agent: VSphereVerifyingAgent } {
    const agent: VSphereVerifyingAgent = new VSphereVerifyingAgent({
      host: "vcsa.example.com",
      port: server.port,
      pinnedAddresses: ["127.0.0.1"],
      trustedFingerprint: trustedFingerprint,
      connectTimeoutInMs: 5000,
    });

    return {
      agent: agent,
      transport: createVSphereTransport({
        host: "vcsa.example.com",
        port: server.port,
        agent: agent,
        requestTimeoutInMs: options.requestTimeoutInMs || 5000,
        maxResponseBytes: options.maxResponseBytes || 1024 * 1024,
      }),
    };
  }

  test("a request goes out only on a verified socket", async () => {
    const before: number = server.requests();
    const untrusted: { transport: VSphereTransport; agent: VSphereVerifyingAgent } =
      transportFor(null);

    await expect(
      untrusted.transport({
        method: "POST",
        path: "/sdk",
        headers: {},
        body: "<password>secret</password>",
      }),
    ).rejects.toBeInstanceOf(VSphereCertificateError);
    expect(server.requests()).toBe(before);
    untrusted.agent.destroy();

    const pinned: { transport: VSphereTransport; agent: VSphereVerifyingAgent } =
      transportFor(vcenterCertificate.fingerprint256);
    const response: VSphereHttpResponse = await pinned.transport({
      method: "POST",
      path: "/sdk",
      headers: { "Content-Type": "text/xml" },
      body: "<hello/>",
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe("echo:<hello/>");
    expect(response.headers["set-cookie"]).toEqual([
      'vmware_soap_session="abc"; Path=/',
    ]);
    // The Host header names vCenter, not the address the socket is pinned to.
    expect(lastHost).toBe(`vcsa.example.com:${server.port}`);
    pinned.agent.destroy();
  });

  test("an answer larger than the probe reads is cut off", async () => {
    const pinned: { transport: VSphereTransport; agent: VSphereVerifyingAgent } =
      transportFor(vcenterCertificate.fingerprint256, { maxResponseBytes: 100 });

    await expect(
      pinned.transport({ method: "GET", path: "/big", headers: {} }),
    ).rejects.toBeInstanceOf(VSphereResponseTooLargeError);
    pinned.agent.destroy();
  });

  test("a request vCenter does not answer in time fails with a timeout", async () => {
    const pinned: { transport: VSphereTransport; agent: VSphereVerifyingAgent } =
      transportFor(vcenterCertificate.fingerprint256, { requestTimeoutInMs: 300 });

    await expect(
      pinned.transport({ method: "GET", path: "/slow", headers: {} }),
    ).rejects.toBeInstanceOf(VSphereRequestTimeoutError);
    pinned.agent.destroy();
  });
});
