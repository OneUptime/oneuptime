import dns from "dns";
import http, {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from "http";
import https from "https";
import net, { AddressInfo } from "net";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import SyntheticEgressProxy from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticEgressProxy";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import { approveOnLoopback } from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import SelfSignedCertificate from "../MonitorTypes/SslTestCertificates";

/*
 * Where a synthetic script's axios, http and https facades send a request.
 *
 * Every one goes through the check's egress proxy (SyntheticEgressProxy,
 * GHSA-9rx7-vwfj-whp7), which asks the egress guard about the host and then
 * goes through the operator's outbound proxy - the check's config.proxy, the
 * one the browser goes through - apart from the hosts NO_PROXY names, which
 * it reaches directly. Either way it connects only to the address the guard
 * approved: the outbound proxy is asked for that address, never the name.
 */

jest.setTimeout(120_000);

interface RequestObservation {
  readonly headers: IncomingHttpHeaders;
  readonly method: string | undefined;
  readonly url: string | undefined;
}

const PUBLIC_ADDRESS: string = "93.184.215.14";

describe("SyntheticRuntime proxy contract", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("routes axios, http and https through the egress proxy to the outbound proxy, for the approved address", async () => {
    const proxyRequests: RequestObservation[] = [];
    const connectAuthorities: string[] = [];
    const httpsTargetRequests: RequestObservation[] = [];
    const sockets: Set<net.Socket> = new Set<net.Socket>();
    const httpsTargetServer: https.Server = https.createServer(
      {
        cert: SelfSignedCertificate.cert,
        key: SelfSignedCertificate.key,
      },
      (request: IncomingMessage, response: ServerResponse): void => {
        httpsTargetRequests.push({
          headers: request.headers,
          method: request.method,
          url: request.url,
        });
        response.end("must not be reached: the certificate is not trusted");
      },
    );
    await listen(httpsTargetServer);
    const httpsTargetPort: number = (httpsTargetServer.address() as AddressInfo)
      .port;

    const proxyServer: Server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        proxyRequests.push({
          headers: request.headers,
          method: request.method,
          url: request.url,
        });
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          Connection: "close",
        });
        response.end(
          JSON.stringify({
            facade: request.headers["x-synthetic-facade"],
            proxyObservedUrl: request.url,
            proxyObservedHost: request.headers.host,
          }),
        );
      },
    );
    proxyServer.on(
      "connect",
      (request: IncomingMessage, clientSocket: net.Socket): void => {
        connectAuthorities.push(request.url || "");
        sockets.add(clientSocket);
        const upstream: net.Socket = net.connect({
          host: "127.0.0.1",
          port: httpsTargetPort,
        });
        sockets.add(upstream);
        upstream.once("connect", (): void => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        });
        upstream.on("error", (): void => {
          clientSocket.destroy();
        });
        clientSocket.on("error", (): void => {
          upstream.destroy();
        });
      },
    );
    await listen(proxyServer);

    jest.spyOn(dns.promises, "lookup").mockImplementation((async (
      hostname: string,
    ) => {
      if (hostname.endsWith(".synthetic.test")) {
        return [{ address: PUBLIC_ADDRESS, family: 4 }];
      }
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: "ENOTFOUND",
      });
    }) as never);

    const egress: SyntheticEgressProxy = new SyntheticEgressProxy({
      upstreamProxy: { server: getServerUrl(proxyServer) },
    });
    await egress.start();

    try {
      const result: SandboxExecutionResult = await run(
        `
          const readWithNodeFacade = (client, url, facade) =>
            new Promise((resolve, reject) => {
              const request = client.get(
                url,
                { headers: { "x-synthetic-facade": facade } },
                (response) => {
                  const chunks = [];
                  response.on("data", (chunk) => chunks.push(chunk));
                  response.on("end", () => {
                    resolve(JSON.parse(Buffer.concat(chunks).toString()));
                  });
                }
              );
              request.on("error", (error) => resolve("error: " + error.message));
            });

          const axiosResponse = await axios.get(
            "http://axios.synthetic.test/from-axios",
            { headers: { "x-synthetic-facade": "axios" } }
          );
          const httpResponse = await readWithNodeFacade(
            http,
            "http://http.synthetic.test/from-http",
            "http"
          );
          const httpsResponse = await readWithNodeFacade(
            https,
            "https://https.synthetic.test/from-https",
            "https"
          );

          return { data: {
            axios: axiosResponse.data,
            http: httpResponse,
            https: httpsResponse,
          } };
        `,
        egress,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          axios: {
            facade: "axios",
            proxyObservedUrl: `http://${PUBLIC_ADDRESS}:80/from-axios`,
            proxyObservedHost: "axios.synthetic.test",
          },
          http: {
            facade: "http",
            proxyObservedUrl: `http://${PUBLIC_ADDRESS}:80/from-http`,
            proxyObservedHost: "http.synthetic.test",
          },
          // The tunnel was made; the target's certificate is not trusted.
          https: expect.stringMatching(/^error: .*certificate/i),
        },
      });
      expect(
        proxyRequests.map((seen: RequestObservation) => {
          return seen.url;
        }),
      ).toEqual([
        `http://${PUBLIC_ADDRESS}:80/from-axios`,
        `http://${PUBLIC_ADDRESS}:80/from-http`,
      ]);
      expect(connectAuthorities).toEqual([`${PUBLIC_ADDRESS}:443`]);
      expect(httpsTargetRequests).toEqual([]);
    } finally {
      await egress.close();
      for (const socket of sockets) {
        socket.destroy();
      }
      await Promise.all([
        closeServer(proxyServer),
        closeServer(httpsTargetServer),
      ]);
    }
  });

  test("goes directly to a host NO_PROXY names, without touching the outbound proxy", async () => {
    const proxyRequests: RequestObservation[] = [];
    const targetRequests: RequestObservation[] = [];
    const proxyServer: Server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        proxyRequests.push({
          headers: request.headers,
          method: request.method,
          url: request.url,
        });
        response.writeHead(502, { Connection: "close" });
        response.end("request must bypass this proxy");
      },
    );
    const targetServer: Server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        targetRequests.push({
          headers: request.headers,
          method: request.method,
          url: request.url,
        });
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          Connection: "close",
        });
        response.end(
          JSON.stringify({
            facade: request.headers["x-synthetic-facade"],
            directPath: request.url,
          }),
        );
      },
    );
    await Promise.all([listen(proxyServer), listen(targetServer)]);
    const targetPort: number = (targetServer.address() as AddressInfo).port;
    // The guard approves this name at the test server, as it would a public host.
    approveOnLoopback({ "intranet.synthetic.test": ["127.0.0.1"] });

    const egress: SyntheticEgressProxy = new SyntheticEgressProxy({
      upstreamProxy: {
        server: getServerUrl(proxyServer),
        bypass: "synthetic-runtime.oneuptime.invalid,.synthetic.test",
      },
    });
    await egress.start();

    try {
      const result: SandboxExecutionResult = await run(
        `
          const readWithHttp = (url) => new Promise((resolve, reject) => {
            const request = http.get(
              url,
              { headers: { "x-synthetic-facade": "http" } },
              (response) => {
                const chunks = [];
                response.on("data", (chunk) => chunks.push(chunk));
                response.on("end", () => {
                  resolve(JSON.parse(Buffer.concat(chunks).toString()));
                });
              }
            );
            request.on("error", reject);
          });

          const axiosResponse = await axios.get(
            "http://intranet.synthetic.test:${targetPort}/from-axios",
            { headers: { "x-synthetic-facade": "axios" } }
          );
          const httpResponse = await readWithHttp(
            "http://intranet.synthetic.test:${targetPort}/from-http"
          );
          return { data: {
            axios: axiosResponse.data,
            http: httpResponse,
          } };
        `,
        egress,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          axios: { facade: "axios", directPath: "/from-axios" },
          http: { facade: "http", directPath: "/from-http" },
        },
      });
      expect(proxyRequests).toEqual([]);
      expect(targetRequests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: "/from-axios",
          headers: expect.objectContaining({
            host: `intranet.synthetic.test:${targetPort}`,
            "x-synthetic-facade": "axios",
          }),
        }),
        expect.objectContaining({
          method: "GET",
          url: "/from-http",
          headers: expect.objectContaining({
            "x-synthetic-facade": "http",
          }),
        }),
      ]);
    } finally {
      await egress.close();
      await Promise.all([closeServer(proxyServer), closeServer(targetServer)]);
    }
  });

  test("refuses loopback though NO_PROXY names it, and the environment's proxy is never used", async () => {
    let targetHits: number = 0;
    let environmentProxyHits: number = 0;
    const targetServer: Server = http.createServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        targetHits++;
        response.end("loopback-sentinel");
      },
    );
    const environmentProxy: Server = http.createServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        environmentProxyHits++;
        response.end("environment proxy");
      },
    );
    await Promise.all([listen(targetServer), listen(environmentProxy)]);
    const targetUrl: string = getServerUrl(targetServer);
    const saved: Record<string, string | undefined> = {
      HTTP_PROXY: process.env["HTTP_PROXY"],
      http_proxy: process.env["http_proxy"],
      NO_PROXY: process.env["NO_PROXY"],
      no_proxy: process.env["no_proxy"],
    };
    process.env["HTTP_PROXY"] = getServerUrl(environmentProxy);
    process.env["http_proxy"] = getServerUrl(environmentProxy);
    process.env["NO_PROXY"] = "127.0.0.1";
    process.env["no_proxy"] = "127.0.0.1";

    const egress: SyntheticEgressProxy = new SyntheticEgressProxy({
      upstreamProxy: {
        server: getServerUrl(environmentProxy),
        bypass: "127.0.0.1,localhost",
      },
    });
    await egress.start();

    try {
      const result: SandboxExecutionResult = await run(
        `
          try {
            await axios.get(${JSON.stringify(`${targetUrl}/secret`)});
            return { data: "reached" };
          } catch (error) {
            return { data: error.message };
          }
        `,
        egress,
      );

      expect(result.returnValue).toEqual({
        data: "Monitor target host 127.0.0.1 is not allowed: loopback address.",
      });
      expect(targetHits).toBe(0);
      expect(environmentProxyHits).toBe(0);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      await egress.close();
      await Promise.all([
        closeServer(targetServer),
        closeServer(environmentProxy),
      ]);
    }
  });

  async function run(
    code: string,
    egress: SyntheticEgressProxy,
  ): Promise<SandboxExecutionResult> {
    const browserContext: BrowserContext = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    const page: Page = await browserContext.newPage();

    try {
      return await WorkerController.execute({
        browserContext,
        page,
        code,
        browserType: "Chromium",
        screenSizeType: "Desktop",
        args: {},
        timeoutInMs: 10_000,
        egress,
      });
    } finally {
      await browserContext.close();
    }
  }
});

function getServerUrl(server: Server): string {
  const address: AddressInfo | string | null = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to use a TCP address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", (): void => {
        server.removeListener("error", reject);
        resolve();
      });
    },
  );
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    server.close((): void => {
      resolve();
    });
  });
}
