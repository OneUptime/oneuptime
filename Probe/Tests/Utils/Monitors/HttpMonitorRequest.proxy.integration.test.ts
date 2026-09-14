// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HttpMonitorRequest, {
  PinnedHttpProxyAgent,
  PinnedHttpsProxyAgent,
  PreparedHttpMonitorRequest,
} from "../../../Utils/Monitors/HttpMonitorRequest";
import ProxyConfig from "../../../Utils/ProxyConfig";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { AddressInfo } from "net";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as tls from "tls";

jest.setTimeout(30_000);

interface CertificateMaterial {
  workDir: string;
  caCertificate: string;
  serverCertificate: string;
  serverKey: string;
  clientCertificate: string;
  clientKey: string;
}

interface HttpObservation {
  host: string | undefined;
  path: string | undefined;
}

interface HttpsObservation extends HttpObservation {
  authorizedClient: boolean;
  clientCommonName: string | undefined;
  servername: string | false | null;
}

interface ResponseObservation {
  body: string;
  statusCode: number | undefined;
}

interface TrackedServer<TServer extends net.Server = net.Server> {
  server: TServer;
  sockets: Set<net.Socket>;
}

let certificates: CertificateMaterial;

beforeAll(() => {
  certificates = generateCertificateMaterial();
});

afterAll(() => {
  fs.rmSync(certificates.workDir, { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("HttpMonitorRequest pinned proxy integration", () => {
  test("keeps a network-path-looking HTTP origin path on the pinned authority at a real proxy", async () => {
    const intendedRequests: Array<HttpObservation> = [];
    const decoyRequests: Array<HttpObservation> = [];
    const proxyRequestUrls: Array<string> = [];
    const proxyDestinations: Array<"intended" | "decoy"> = [];
    const proxyUpstreamSockets: Set<net.Socket> = new Set<net.Socket>();

    const intended: TrackedServer<http.Server> = trackServer(
      http.createServer(
        (
          request: http.IncomingMessage,
          response: http.ServerResponse,
        ): void => {
          intendedRequests.push({
            host: request.headers.host,
            path: request.url,
          });
          response.writeHead(200, { Connection: "close" });
          response.end("intended-http-target");
        },
      ),
    );
    const decoy: TrackedServer<http.Server> = trackServer(
      http.createServer(
        (
          request: http.IncomingMessage,
          response: http.ServerResponse,
        ): void => {
          decoyRequests.push({
            host: request.headers.host,
            path: request.url,
          });
          response.writeHead(200, { Connection: "close" });
          response.end("decoy-http-target");
        },
      ),
    );

    let intendedPort: number = 0;
    let decoyPort: number = 0;
    let proxy: TrackedServer<http.Server> | undefined;
    let requestAgent: http.Agent | undefined;

    try {
      [intendedPort, decoyPort] = await Promise.all([
        listen(intended.server),
        listen(decoy.server),
      ]);

      proxy = trackServer(
        http.createServer(
          (
            request: http.IncomingMessage,
            response: http.ServerResponse,
          ): void => {
            const absoluteRequestUrl: string = request.url || "";
            proxyRequestUrls.push(absoluteRequestUrl);

            let parsed: globalThis.URL;
            try {
              parsed = new globalThis.URL(absoluteRequestUrl);
            } catch {
              response.writeHead(400, { Connection: "close" });
              response.end("invalid proxy request URL");
              return;
            }

            const usesPinnedAuthority: boolean =
              parsed.hostname === "127.0.0.1" &&
              Number(parsed.port) === intendedPort;
            const destination: "intended" | "decoy" = usesPinnedAuthority
              ? "intended"
              : "decoy";
            proxyDestinations.push(destination);

            const upstreamRequest: http.ClientRequest = http.request(
              {
                hostname: "127.0.0.1",
                port: usesPinnedAuthority ? intendedPort : decoyPort,
                method: request.method,
                path: `${parsed.pathname}${parsed.search}`,
                headers: {
                  Connection: "close",
                  Host: request.headers.host || "",
                },
              },
              (upstreamResponse: http.IncomingMessage): void => {
                response.writeHead(upstreamResponse.statusCode || 502, {
                  Connection: "close",
                });
                upstreamResponse.pipe(response);
              },
            );

            trackClientRequestSocket(upstreamRequest, proxyUpstreamSockets);
            upstreamRequest.once("error", (error: Error): void => {
              if (!response.headersSent) {
                response.writeHead(502, { Connection: "close" });
              }
              response.end(error.message);
            });
            request.pipe(upstreamRequest);
          },
        ),
      );
      const proxyPort: number = await listen(proxy.server);

      const logicalHost: string = "intended-http-monitor.example.com";
      const attackerHost: string = "attacker-proxy-target.example.com";
      const maliciousPath: string = `//${attackerHost}:${decoyPort}/latest/meta-data`;
      const rawUrl: string = `http://${logicalHost}:${intendedPort}${maliciousPath}`;
      const rawParsedUrl: globalThis.URL = new globalThis.URL(rawUrl);

      const guard: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
        .mockImplementation(async (value: string) => {
          return {
            url: new globalThis.URL(value),
            addresses: [{ address: "127.0.0.1", family: 4 }],
          };
        });
      jest
        .spyOn(ProxyConfig, "getHttpProxyAgent")
        .mockReturnValue(new http.Agent() as never);
      jest
        .spyOn(ProxyConfig, "getHttpProxyUrl")
        .mockReturnValue(`http://127.0.0.1:${proxyPort}`);
      jest.spyOn(ProxyConfig, "getHttpsProxyAgent").mockReturnValue(null);

      const prepared: PreparedHttpMonitorRequest =
        await HttpMonitorRequest.prepare(rawUrl);
      requestAgent = prepared.httpAgent;
      const pinnedUrl: globalThis.URL = new globalThis.URL(
        prepared.url.toString(),
      );

      expect(prepared.httpAgent).toBeInstanceOf(PinnedHttpProxyAgent);
      expect(rawParsedUrl.pathname).toBe(maliciousPath);

      /*
       * Common's URL value normalizes repeated path separators. Supplying the
       * original WHATWG path here tests the proxy agent's own security
       * boundary instead of accidentally relying on that unrelated behavior.
       */
      const result: ResponseObservation = await requestHttp({
        hostname: pinnedUrl.hostname,
        port: Number(pinnedUrl.port),
        method: "GET",
        path: `${rawParsedUrl.pathname}${rawParsedUrl.search}`,
        headers: prepared.headers,
        agent: prepared.httpAgent,
      });

      expect(guard).toHaveBeenCalledWith(
        rawUrl,
        expect.objectContaining({ blockPrivateAddresses: true }),
      );
      expect(result).toEqual({
        body: "intended-http-target",
        statusCode: 200,
      });
      expect(proxyRequestUrls).toEqual([
        `http://127.0.0.1:${intendedPort}${maliciousPath}`,
      ]);
      expect(proxyDestinations).toEqual(["intended"]);
      expect(intendedRequests).toEqual([
        {
          host: `${logicalHost}:${intendedPort}`,
          path: maliciousPath,
        },
      ]);
      expect(decoyRequests).toEqual([]);
    } finally {
      requestAgent?.destroy();
      for (const socket of proxyUpstreamSockets) {
        socket.destroy();
      }
      await Promise.all([
        proxy ? closeServer(proxy) : Promise.resolve(),
        closeServer(intended),
        closeServer(decoy),
      ]);
    }
  });

  test("CONNECTs to the pinned IP while preserving HTTPS SNI and mTLS for only the intended target", async () => {
    const intendedRequests: Array<HttpsObservation> = [];
    const decoyRequests: Array<HttpsObservation> = [];
    const connectAuthorities: Array<string> = [];
    const proxyDestinations: Array<"intended" | "decoy"> = [];
    const proxyUpstreamSockets: Set<net.Socket> = new Set<net.Socket>();
    let intendedSecureConnections: number = 0;
    let decoySecureConnections: number = 0;

    const tlsServerOptions: https.ServerOptions = {
      key: certificates.serverKey,
      cert: certificates.serverCertificate,
      ca: certificates.caCertificate,
      requestCert: true,
      rejectUnauthorized: true,
    };
    const recordHttpsRequest: (
      observations: Array<HttpsObservation>,
      body: string,
    ) => (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ) => void = (
      observations: Array<HttpsObservation>,
      body: string,
    ): ((
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ) => void) => {
      return (
        request: http.IncomingMessage,
        response: http.ServerResponse,
      ): void => {
        const socket: tls.TLSSocket = request.socket as tls.TLSSocket;
        const peerCertificate: tls.PeerCertificate =
          socket.getPeerCertificate();
        const commonName: string | string[] | undefined =
          peerCertificate.subject?.CN;

        observations.push({
          host: request.headers.host,
          path: request.url,
          servername: socket.servername,
          authorizedClient: socket.authorized,
          clientCommonName: Array.isArray(commonName)
            ? commonName.join(",")
            : commonName,
        });
        response.writeHead(200, { Connection: "close" });
        response.end(body);
      };
    };

    const intended: TrackedServer<https.Server> = trackServer(
      https.createServer(
        tlsServerOptions,
        recordHttpsRequest(intendedRequests, "intended-https-target"),
      ),
    );
    intended.server.on("secureConnection", (): void => {
      intendedSecureConnections++;
    });
    const decoy: TrackedServer<https.Server> = trackServer(
      https.createServer(
        tlsServerOptions,
        recordHttpsRequest(decoyRequests, "decoy-https-target"),
      ),
    );
    decoy.server.on("secureConnection", (): void => {
      decoySecureConnections++;
    });

    let intendedPort: number = 0;
    let decoyPort: number = 0;
    let proxy: TrackedServer<http.Server> | undefined;
    let requestAgent: https.Agent | undefined;

    try {
      [intendedPort, decoyPort] = await Promise.all([
        listen(intended.server),
        listen(decoy.server),
      ]);

      proxy = trackServer(
        http.createServer(
          (
            _request: http.IncomingMessage,
            response: http.ServerResponse,
          ): void => {
            response.writeHead(405, { Connection: "close" });
            response.end("CONNECT required");
          },
        ),
      );
      proxy.server.on(
        "connect",
        (
          request: http.IncomingMessage,
          clientSocket: net.Socket,
          head: Buffer,
        ): void => {
          const authority: string = request.url || "";
          connectAuthorities.push(authority);

          let parsedAuthority: globalThis.URL;
          try {
            parsedAuthority = new globalThis.URL(`http://${authority}`);
          } catch {
            clientSocket.end(
              "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
            );
            return;
          }

          const usesPinnedAuthority: boolean =
            parsedAuthority.hostname === "127.0.0.1" &&
            Number(parsedAuthority.port) === intendedPort;
          const destination: "intended" | "decoy" = usesPinnedAuthority
            ? "intended"
            : "decoy";
          proxyDestinations.push(destination);

          const upstreamSocket: net.Socket = net.connect({
            host: "127.0.0.1",
            port: usesPinnedAuthority ? intendedPort : decoyPort,
          });
          proxyUpstreamSockets.add(upstreamSocket);
          upstreamSocket.once("close", (): void => {
            proxyUpstreamSockets.delete(upstreamSocket);
          });
          upstreamSocket.once("connect", (): void => {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length > 0) {
              upstreamSocket.write(head);
            }
            clientSocket.pipe(upstreamSocket);
            upstreamSocket.pipe(clientSocket);
          });
          upstreamSocket.once("error", (): void => {
            if (!clientSocket.destroyed) {
              clientSocket.end(
                "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n",
              );
            }
          });
          clientSocket.once("error", (): void => {
            upstreamSocket.destroy();
          });
        },
      );
      const proxyPort: number = await listen(proxy.server);

      const logicalHost: string = "intended-https-monitor.example.com";
      const rawUrl: string = `https://${logicalHost}:${intendedPort}/health`;
      const guard: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
        .mockImplementation(async (value: string) => {
          return {
            url: new globalThis.URL(value),
            addresses: [{ address: "127.0.0.1", family: 4 }],
          };
        });
      jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
      jest
        .spyOn(ProxyConfig, "getHttpsProxyAgent")
        .mockReturnValue(new https.Agent() as never);
      jest
        .spyOn(ProxyConfig, "getHttpsProxyUrl")
        .mockReturnValue(`http://127.0.0.1:${proxyPort}`);

      const prepared: PreparedHttpMonitorRequest =
        await HttpMonitorRequest.prepare(rawUrl, {
          tls: {
            allowSelfSignedCertificates: true,
            tlsClientCertificate: certificates.clientCertificate,
            tlsClientKey: certificates.clientKey,
          },
        });
      requestAgent = prepared.httpsAgent;
      const pinnedUrl: globalThis.URL = new globalThis.URL(
        prepared.url.toString(),
      );

      expect(prepared.httpsAgent).toBeInstanceOf(PinnedHttpsProxyAgent);
      const result: ResponseObservation = await requestHttps({
        hostname: pinnedUrl.hostname,
        port: Number(pinnedUrl.port),
        method: "GET",
        path: `${pinnedUrl.pathname}${pinnedUrl.search}`,
        headers: prepared.headers,
        agent: prepared.httpsAgent,
      });

      expect(guard).toHaveBeenCalledWith(
        rawUrl,
        expect.objectContaining({ blockPrivateAddresses: true }),
      );
      expect(result).toEqual({
        body: "intended-https-target",
        statusCode: 200,
      });
      expect(connectAuthorities).toEqual([`127.0.0.1:${intendedPort}`]);
      expect(proxyDestinations).toEqual(["intended"]);
      expect(intendedSecureConnections).toBe(1);
      expect(intendedRequests).toEqual([
        {
          host: `${logicalHost}:${intendedPort}`,
          path: "/health",
          servername: logicalHost,
          authorizedClient: true,
          clientCommonName: "monitor-client",
        },
      ]);
      expect(decoySecureConnections).toBe(0);
      expect(decoyRequests).toEqual([]);
    } finally {
      requestAgent?.destroy();
      for (const socket of proxyUpstreamSockets) {
        socket.destroy();
      }
      await Promise.all([
        proxy ? closeServer(proxy) : Promise.resolve(),
        closeServer(intended),
        closeServer(decoy),
      ]);
    }
  });
});

function generateCertificateMaterial(): CertificateMaterial {
  const workDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-http-monitor-proxy-"),
  );
  const opensslConfigPath: string = path.join(workDir, "openssl.cnf");

  fs.writeFileSync(
    opensslConfigPath,
    [
      "[req]",
      "distinguished_name = req_distinguished_name",
      "prompt = no",
      "[req_distinguished_name]",
      "CN = oneuptime-proxy-integration-test",
      "[v3_server]",
      "subjectAltName = DNS:intended-https-monitor.example.com",
      "extendedKeyUsage = serverAuth",
      "[v3_client]",
      "extendedKeyUsage = clientAuth",
    ].join("\n"),
  );

  const openssl: (argumentsList: Array<string>) => void = (
    argumentsList: Array<string>,
  ): void => {
    execFileSync("openssl", argumentsList, { stdio: "pipe" });
  };
  const caKeyPath: string = path.join(workDir, "ca.key");
  const caCertificatePath: string = path.join(workDir, "ca.crt");
  openssl(["genrsa", "-out", caKeyPath, "2048"]);
  openssl([
    "req",
    "-x509",
    "-new",
    "-key",
    caKeyPath,
    "-out",
    caCertificatePath,
    "-days",
    "2",
    "-subj",
    "/CN=oneuptime-proxy-integration-ca",
  ]);

  const issueCertificate: (
    name: string,
    commonName: string,
    extension: "v3_server" | "v3_client",
  ) => { certificatePath: string; keyPath: string } = (
    name: string,
    commonName: string,
    extension: "v3_server" | "v3_client",
  ): { certificatePath: string; keyPath: string } => {
    const keyPath: string = path.join(workDir, `${name}.key`);
    const requestPath: string = path.join(workDir, `${name}.csr`);
    const certificatePath: string = path.join(workDir, `${name}.crt`);
    openssl(["genrsa", "-out", keyPath, "2048"]);
    openssl([
      "req",
      "-new",
      "-key",
      keyPath,
      "-out",
      requestPath,
      "-subj",
      `/CN=${commonName}`,
    ]);
    openssl([
      "x509",
      "-req",
      "-in",
      requestPath,
      "-CA",
      caCertificatePath,
      "-CAkey",
      caKeyPath,
      "-CAcreateserial",
      "-out",
      certificatePath,
      "-days",
      "2",
      "-extfile",
      opensslConfigPath,
      "-extensions",
      extension,
    ]);
    return { certificatePath, keyPath };
  };

  const server: { certificatePath: string; keyPath: string } = issueCertificate(
    "server",
    "intended-https-monitor.example.com",
    "v3_server",
  );
  const client: { certificatePath: string; keyPath: string } = issueCertificate(
    "client",
    "monitor-client",
    "v3_client",
  );

  return {
    workDir,
    caCertificate: fs.readFileSync(caCertificatePath, "utf8"),
    serverCertificate: fs.readFileSync(server.certificatePath, "utf8"),
    serverKey: fs.readFileSync(server.keyPath, "utf8"),
    clientCertificate: fs.readFileSync(client.certificatePath, "utf8"),
    clientKey: fs.readFileSync(client.keyPath, "utf8"),
  };
}

function trackServer<TServer extends net.Server>(
  server: TServer,
): TrackedServer<TServer> {
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  server.on("connection", (socket: net.Socket): void => {
    sockets.add(socket);
    socket.once("close", (): void => {
      sockets.delete(socket);
    });
  });
  return { server, sockets };
}

async function listen(server: net.Server): Promise<number> {
  return await new Promise<number>(
    (resolve: (port: number) => void, reject: (error: Error) => void) => {
      const onError: (error: Error) => void = (error: Error): void => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening: () => void = (): void => {
        server.removeListener("error", onError);
        const address: AddressInfo | string | null = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Expected a TCP test server address."));
          return;
        }
        resolve(address.port);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    },
  );
}

async function closeServer(tracked: TrackedServer): Promise<void> {
  const closeAllConnections: (() => void) | undefined = (
    tracked.server as net.Server & { closeAllConnections?: () => void }
  ).closeAllConnections;
  closeAllConnections?.call(tracked.server);
  for (const socket of tracked.sockets) {
    socket.destroy();
  }
  if (!tracked.server.listening) {
    return;
  }
  await new Promise<void>((resolve: () => void) => {
    tracked.server.close((): void => {
      resolve();
    });
  });
}

function trackClientRequestSocket(
  request: http.ClientRequest,
  sockets: Set<net.Socket>,
): void {
  request.once("socket", (socket: net.Socket): void => {
    sockets.add(socket);
    socket.once("close", (): void => {
      sockets.delete(socket);
    });
  });
}

async function requestHttp(
  options: http.RequestOptions,
): Promise<ResponseObservation> {
  return await requestWith(http.request, options);
}

async function requestHttps(
  options: https.RequestOptions,
): Promise<ResponseObservation> {
  return await requestWith(https.request, options);
}

async function requestWith(
  request: (
    options: http.RequestOptions,
    callback: (response: http.IncomingMessage) => void,
  ) => http.ClientRequest,
  options: http.RequestOptions,
): Promise<ResponseObservation> {
  return await new Promise<ResponseObservation>(
    (
      resolve: (value: ResponseObservation) => void,
      reject: (error: Error) => void,
    ) => {
      let clientSocket: net.Socket | undefined;
      let socketClosed: boolean = false;
      let settledResponse: ResponseObservation | undefined;
      const resolveAfterSocketClose: () => void = (): void => {
        if (settledResponse && (!clientSocket || socketClosed)) {
          resolve(settledResponse);
        }
      };
      const clientRequest: http.ClientRequest = request(
        options,
        (response: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer | string): void => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.once("end", (): void => {
            settledResponse = {
              body: Buffer.concat(chunks).toString("utf8"),
              statusCode: response.statusCode,
            };
            resolveAfterSocketClose();
          });
          response.once("error", reject);
        },
      );
      clientRequest.once("socket", (socket: net.Socket): void => {
        clientSocket = socket;
        socket.once("close", (): void => {
          socketClosed = true;
          resolveAfterSocketClose();
        });
      });
      clientRequest.once("error", reject);
      clientRequest.end();
    },
  );
}
