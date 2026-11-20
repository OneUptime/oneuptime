import { afterEach, beforeEach } from "@jest/globals";
import { execFileSync } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net, { AddressInfo } from "net";
import os from "os";
import path from "path";
import tls from "tls";

/*
 * HTTPS SERVERS WITH CERTIFICATES NOBODY TRUSTS, AND AN OUTBOUND PROXY THAT
 * TUNNELS TO THEM, ON THIS MACHINE (issue #10277).
 *
 * The suites that hold a Runbook HTTP step's certificate settings to what
 * they say send real requests to real servers here:
 *
 *   - generateTestCertificates() makes, with openssl, a private CA and a
 *     certificate it signed for a host name, two certificates that host name
 *     signed itself (of two keys), and one an outbound proxy named
 *     "localhost" signed itself. They are made when the suite starts, as the
 *     probe's SSL suites make theirs: a checked-in certificate that is valid
 *     today is an expired one next year, and the suite would fail on a date.
 *   - LocalHttpsServer answers on loopback with one of them, and records
 *     every request that reached it. A request refused at the handshake
 *     never does: `isUntouched` says nothing was sent.
 *   - TunnellingProxy is an http:// or https:// outbound proxy that opens a
 *     CONNECT tunnel to the server a test routes the asked-for host to (the
 *     host names here resolve nowhere real), and records every CONNECT.
 *   - trustAsDefaultCa() has the process trust a certificate as one of its
 *     default CAs, as NODE_EXTRA_CA_CERTS would, until the test ends.
 */

export interface TestCertificate {
  certificate: string;
  key: string;
}

export interface TestCertificates {
  // A private CA's certificate, and one it signed for the host name.
  caCertificate: string;
  caSigned: TestCertificate;
  // Two certificates the host name signed itself, of two keys.
  selfSigned: TestCertificate;
  otherSelfSigned: TestCertificate;
  // What an https:// proxy named "localhost" answers with: self-signed.
  proxy: TestCertificate;
  // Where they were written: removed by removeTestCertificates().
  workDir: string;
}

function openssl(args: Array<string>, cwd: string): void {
  execFileSync("openssl", args, { cwd: cwd, stdio: "pipe" });
}

// An EC key: quicker to make than RSA, and any TLS client takes it.
const NEW_KEY: Array<string> = [
  "-newkey",
  "ec",
  "-pkeyopt",
  "ec_paramgen_curve:prime256v1",
  "-nodes",
];

function selfSigned(data: {
  workDir: string;
  name: string;
  subjectAltName: string;
}): TestCertificate {
  openssl(
    [
      "req",
      "-x509",
      ...NEW_KEY,
      "-keyout",
      `${data.name}.key`,
      "-out",
      `${data.name}.crt`,
      "-days",
      "2",
      "-subj",
      `/CN=${data.name}`,
      "-addext",
      `subjectAltName=${data.subjectAltName}`,
    ],
    data.workDir,
  );

  return {
    certificate: fs.readFileSync(
      path.join(data.workDir, `${data.name}.crt`),
      "utf8",
    ),
    key: fs.readFileSync(path.join(data.workDir, `${data.name}.key`), "utf8"),
  };
}

export function generateTestCertificates(hostName: string): TestCertificates {
  const workDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-self-signed-https-"),
  );

  // The private CA.
  openssl(
    [
      "req",
      "-x509",
      ...NEW_KEY,
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "2",
      "-subj",
      "/CN=OneUptime Test CA",
    ],
    workDir,
  );

  // A certificate the CA signed for the host name.
  openssl(
    [
      "req",
      ...NEW_KEY,
      "-keyout",
      "ca-signed.key",
      "-out",
      "ca-signed.csr",
      "-subj",
      `/CN=${hostName}`,
    ],
    workDir,
  );
  fs.writeFileSync(
    path.join(workDir, "ca-signed.ext"),
    `subjectAltName=DNS:${hostName}\nbasicConstraints=CA:FALSE\n`,
  );
  openssl(
    [
      "x509",
      "-req",
      "-in",
      "ca-signed.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "ca-signed.crt",
      "-days",
      "2",
      "-extfile",
      "ca-signed.ext",
    ],
    workDir,
  );

  return {
    caCertificate: fs.readFileSync(path.join(workDir, "ca.crt"), "utf8"),
    caSigned: {
      certificate: fs.readFileSync(path.join(workDir, "ca-signed.crt"), "utf8"),
      key: fs.readFileSync(path.join(workDir, "ca-signed.key"), "utf8"),
    },
    selfSigned: selfSigned({
      workDir,
      name: "self-signed",
      subjectAltName: `DNS:${hostName}`,
    }),
    otherSelfSigned: selfSigned({
      workDir,
      name: "other-self-signed",
      subjectAltName: `DNS:${hostName}`,
    }),
    proxy: selfSigned({
      workDir,
      name: "proxy",
      subjectAltName: "DNS:localhost,IP:127.0.0.1",
    }),
    workDir,
  };
}

export function removeTestCertificates(
  certificates: TestCertificates | undefined,
): void {
  if (certificates) {
    fs.rmSync(certificates.workDir, { recursive: true, force: true });
  }
}

export interface SeenHttpsRequest {
  method: string;
  url: string;
  host: string;
}

// An HTTPS server on loopback, answering with the certificate it is given.
export class LocalHttpsServer {
  public readonly host: string;
  public port: number = 0;
  public requests: Array<SeenHttpsRequest> = [];
  public readonly name: string;

  private readonly server: https.Server;

  public constructor(data: {
    host: string;
    name: string;
    certificate: TestCertificate;
  }) {
    this.host = data.host;
    this.name = data.name;
    this.server = https.createServer(
      { cert: data.certificate.certificate, key: data.certificate.key },
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        this.requests.push({
          method: request.method || "",
          url: request.url || "",
          host: request.headers["host"] || "",
        });

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ answeredBy: this.name }));
      },
    );
    // A client that refuses the certificate drops the connection: not news.
    this.server.on("tlsClientError", () => {
      return undefined;
    });
  }

  // Whether any request reached it: none does past a refused certificate.
  public get isUntouched(): boolean {
    return this.requests.length === 0;
  }

  public async listen(): Promise<void> {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        this.server.once("error", reject);
        this.server.listen(0, this.host, () => {
          this.server.removeListener("error", reject);
          resolve();
        });
      },
    );

    this.port = (this.server.address() as AddressInfo).port;
  }

  public async stop(): Promise<void> {
    this.server.closeAllConnections();

    await new Promise<void>((resolve: () => void) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

export interface TunnelEnd {
  host: string;
  port: number;
}

/*
 * An outbound proxy on loopback, over http:// or, given a certificate,
 * https://. It opens a CONNECT tunnel to the end `route` names for the
 * asked-for "host:port", and refuses any other with 403.
 */
export class TunnellingProxy {
  public readonly host: string = "127.0.0.1";
  public port: number = 0;
  // Every CONNECT it was asked for, as "host:port".
  public connects: Array<string> = [];

  private readonly server: http.Server | https.Server;
  private readonly sockets: Set<net.Socket> = new Set<net.Socket>();

  public constructor(data: {
    route: (authority: string) => TunnelEnd | null;
    certificate?: TestCertificate | undefined;
  }) {
    const refuseRequests: http.RequestListener = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(502);
      response.end();
    };

    this.server = data.certificate
      ? https.createServer(
          {
            cert: data.certificate.certificate,
            key: data.certificate.key,
          },
          refuseRequests,
        )
      : http.createServer(refuseRequests);

    this.server.on("tlsClientError", () => {
      return undefined;
    });

    this.server.on(
      "connect",
      (request: http.IncomingMessage, socket: net.Socket) => {
        const authority: string = request.url || "";
        this.connects.push(authority);
        this.sockets.add(socket);
        socket.on("error", () => {
          return undefined;
        });

        const end: TunnelEnd | null = data.route(authority);

        if (!end) {
          socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
          return;
        }

        const upstream: net.Socket = net.connect(end.port, end.host, () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.pipe(socket);
          socket.pipe(upstream);
        });

        this.sockets.add(upstream);
        upstream.on("error", () => {
          socket.destroy();
        });
        socket.on("close", () => {
          upstream.destroy();
        });
      },
    );
  }

  public get url(): string {
    return `${this.server instanceof https.Server ? "https" : "http"}://localhost:${this.port}`;
  }

  public async listen(): Promise<void> {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        this.server.once("error", reject);
        this.server.listen(0, this.host, () => {
          this.server.removeListener("error", reject);
          resolve();
        });
      },
    );

    this.port = (this.server.address() as AddressInfo).port;
  }

  public async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();
    this.server.closeAllConnections();

    await new Promise<void>((resolve: () => void) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

/*
 * Servers and proxies a suite starts, each stopped after the test that
 * started it. Call from the top of a test file.
 */
export function useSelfSignedHttps(): {
  serve: (data: {
    host?: string | undefined;
    name?: string | undefined;
    certificate: TestCertificate;
  }) => Promise<LocalHttpsServer>;
  proxy: (data: {
    route: (authority: string) => TunnelEnd | null;
    certificate?: TestCertificate | undefined;
  }) => Promise<TunnellingProxy>;
} {
  const started: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    while (started.length > 0) {
      await started.pop()!.stop();
    }
  });

  return {
    serve: async (data: {
      host?: string | undefined;
      name?: string | undefined;
      certificate: TestCertificate;
    }): Promise<LocalHttpsServer> => {
      const server: LocalHttpsServer = new LocalHttpsServer({
        host: data.host || "127.0.0.1",
        name: data.name || "target",
        certificate: data.certificate,
      });

      await server.listen();
      started.push(server);

      return server;
    },
    proxy: async (data: {
      route: (authority: string) => TunnelEnd | null;
      certificate?: TestCertificate | undefined;
    }): Promise<TunnellingProxy> => {
      const proxy: TunnellingProxy = new TunnellingProxy(data);

      await proxy.listen();
      started.push(proxy);

      return proxy;
    },
  };
}

/*
 * Has the process trust `certificate` as one of its default CAs, beside the
 * ones it trusts already, as NODE_EXTRA_CA_CERTS would: an https:// proxy
 * whose certificate the operator's machines trust. Call the function it
 * returns to put the defaults back; useDefaultCaRestored() does it after
 * every test.
 */
export function trustAsDefaultCa(certificate: string): () => void {
  const saved: Array<string> = tls.getCACertificates("default");

  tls.setDefaultCACertificates([...saved, certificate]);

  return (): void => {
    tls.setDefaultCACertificates(saved);
  };
}

// The process's default CAs, as each test found them, put back after it.
export function useDefaultCaRestored(): void {
  let saved: Array<string> = [];

  beforeEach(() => {
    saved = tls.getCACertificates("default");
  });

  afterEach(() => {
    tls.setDefaultCACertificates(saved);
  });
}
