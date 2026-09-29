import http, {
  IncomingHttpHeaders,
  IncomingMessage,
  Server,
  ServerResponse,
} from "http";
import https from "https";
import net, { AddressInfo } from "net";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import axios from "axios";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import SelfSignedCertificate from "../MonitorTypes/SslTestCertificates";

jest.setTimeout(120_000);

interface RequestObservation {
  readonly headers: IncomingHttpHeaders;
  readonly method: string | undefined;
  readonly url: string | undefined;
}

const SCOPED_ENVIRONMENT_KEYS: ReadonlyArray<string> = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
];

describe("SyntheticRuntime proxy contract", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("routes axios, http, and https facades through the broker's proxy-aware request path", async () => {
    const proxyRequests: RequestObservation[] = [];
    const httpsTargetRequests: RequestObservation[] = [];
    const connectAuthorities: string[] = [];
    const proxyClientSockets: Set<net.Socket> = new Set<net.Socket>();
    const proxyUpstreamSockets: Set<net.Socket> = new Set<net.Socket>();
    const httpsTargetSockets: Set<net.Socket> = new Set<net.Socket>();
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
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          Connection: "close",
        });
        response.end(
          JSON.stringify({
            facade: request.headers["x-synthetic-facade"],
            proxyObservedUrl: `https://${request.headers.host}${request.url}`,
          }),
        );
      },
    );
    httpsTargetServer.on("connection", (socket: net.Socket): void => {
      httpsTargetSockets.add(socket);
      socket.once("close", (): void => {
        httpsTargetSockets.delete(socket);
      });
    });
    await listen(httpsTargetServer);
    const httpsTargetAddress: AddressInfo | string | null =
      httpsTargetServer.address();
    if (!httpsTargetAddress || typeof httpsTargetAddress === "string") {
      throw new Error("Expected the HTTPS target to use a TCP address.");
    }

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
          }),
        );
      },
    );
    proxyServer.on(
      "connect",
      (
        request: IncomingMessage,
        clientSocket: net.Socket,
        head: Buffer,
      ): void => {
        connectAuthorities.push(request.url || "");
        proxyClientSockets.add(clientSocket);
        clientSocket.once("close", (): void => {
          proxyClientSockets.delete(clientSocket);
        });
        const upstreamSocket: net.Socket = net.connect({
          host: "127.0.0.1",
          port: httpsTargetAddress.port,
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
    await listen(proxyServer);
    const proxyUrl: string = getServerUrl(proxyServer);
    const originalHttpsAgent: unknown = axios.defaults.httpsAgent;
    const trustedHttpsAgent: https.Agent = new https.Agent({
      ca: SelfSignedCertificate.cert,
    });
    axios.defaults.httpsAgent = trustedHttpsAgent;

    try {
      const result: SandboxExecutionResult = await withProxyEnvironment(
        {
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          NO_PROXY: "",
          http_proxy: proxyUrl,
          https_proxy: proxyUrl,
          no_proxy: "",
        },
        async (): Promise<SandboxExecutionResult> => {
          return run(`
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
                request.on("error", reject);
              });

            const axiosResponse = await axios.get(
              "http://axios.synthetic.invalid/from-axios",
              { headers: { "x-synthetic-facade": "axios" } }
            );
            const httpResponse = await readWithNodeFacade(
              http,
              "http://http.synthetic.invalid/from-http",
              "http"
            );
            const httpsResponse = await readWithNodeFacade(
              https,
              "https://localhost/from-https",
              "https"
            );

            return { data: {
              axios: axiosResponse.data,
              http: httpResponse,
              https: httpsResponse,
            } };
          `);
        },
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          axios: {
            facade: "axios",
            proxyObservedUrl: "http://axios.synthetic.invalid/from-axios",
          },
          http: {
            facade: "http",
            proxyObservedUrl: "http://http.synthetic.invalid/from-http",
          },
          https: {
            facade: "https",
            proxyObservedUrl: "https://localhost/from-https",
          },
        },
      });
      expect(proxyRequests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: "http://axios.synthetic.invalid/from-axios",
          headers: expect.objectContaining({
            "x-synthetic-facade": "axios",
          }),
        }),
        expect.objectContaining({
          method: "GET",
          url: "http://http.synthetic.invalid/from-http",
          headers: expect.objectContaining({
            "x-synthetic-facade": "http",
          }),
        }),
      ]);
      expect(connectAuthorities).toEqual(["localhost:443"]);
      expect(httpsTargetRequests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: "/from-https",
          headers: expect.objectContaining({
            host: "localhost",
            "x-synthetic-facade": "https",
          }),
        }),
      ]);
    } finally {
      for (const socket of proxyClientSockets) {
        socket.destroy();
      }
      for (const socket of proxyUpstreamSockets) {
        socket.destroy();
      }
      for (const socket of httpsTargetSockets) {
        socket.destroy();
      }
      axios.defaults.httpsAgent = originalHttpsAgent;
      trustedHttpsAgent.destroy();
      await Promise.all([
        closeServer(proxyServer),
        closeServer(httpsTargetServer),
      ]);
    }
  });

  test("honors NO_PROXY for brokered requests without touching the proxy", async () => {
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
    const proxyUrl: string = getServerUrl(proxyServer);
    const targetUrl: string = getServerUrl(targetServer);

    try {
      const result: SandboxExecutionResult = await withProxyEnvironment(
        {
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          NO_PROXY: "127.0.0.1",
          http_proxy: proxyUrl,
          https_proxy: proxyUrl,
          no_proxy: "127.0.0.1",
        },
        async (): Promise<SandboxExecutionResult> => {
          return run(`
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
              ${JSON.stringify(`${targetUrl}/from-axios`)},
              { headers: { "x-synthetic-facade": "axios" } }
            );
            const httpResponse = await readWithHttp(
              ${JSON.stringify(`${targetUrl}/from-http`)}
            );
            return { data: {
              axios: axiosResponse.data,
              http: httpResponse,
            } };
          `);
        },
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
      await Promise.all([closeServer(proxyServer), closeServer(targetServer)]);
    }
  });

  async function run(code: string): Promise<SandboxExecutionResult> {
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
      });
    } finally {
      await browserContext.close();
    }
  }
});

async function withProxyEnvironment<Result>(
  values: Readonly<Record<string, string>>,
  operation: () => Promise<Result>,
): Promise<Result> {
  const originalValues: Readonly<Record<string, string | undefined>> =
    Object.fromEntries(
      SCOPED_ENVIRONMENT_KEYS.map(
        (key: string): [string, string | undefined] => {
          return [key, process.env[key]];
        },
      ),
    );

  for (const key of SCOPED_ENVIRONMENT_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  try {
    return await operation();
  } finally {
    for (const key of SCOPED_ENVIRONMENT_KEYS) {
      restoreEnvironment(key, originalValues[key]);
    }
  }
}

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
  await new Promise<void>((resolve: () => void) => {
    server.close((): void => {
      resolve();
    });
  });
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
