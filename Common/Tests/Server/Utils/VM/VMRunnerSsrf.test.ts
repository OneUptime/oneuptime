import VMRunner from "../../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";
import dns from "dns";
import http from "http";
import https from "https";
import { AddressInfo } from "net";
import { gzipSync } from "zlib";

/*
 * Common's jsdom resolver selects Axios's browser bundle. VMRunner is a
 * server-only utility, so use Axios's Node bundle here; otherwise forcing the
 * `http` adapter below only finds a browser-build placeholder and the stream
 * and socket tests never reach production transport code.
 */
jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

/*
 * GHSA-v5xh-rw9h-77fv fixed the API workflow components, but the Custom
 * JavaScript component hands user-authored code the HOST process's axios
 * (VMRunner bridges it into the isolate as `_axiosRef`), and the component docs
 * say "you can use axios module". That is the same SSRF with more capability:
 * arbitrary method, headers and body, with the response marshalled back to the
 * author. Guarding only the API components would have been theatre.
 *
 * These tests drive the REAL isolate, so they prove the guard from the position
 * an attacker actually occupies - inside the sandbox - rather than by calling a
 * helper directly. Nothing here needs a network: every assertion is that the
 * request was refused before a socket was opened.
 */

jest.setTimeout(60000);

interface SandboxPrivateNetworkOptions {
  allowPrivateNetworkRequests?: boolean | undefined;
  privateNetworkAccessIsAllowed?: boolean | undefined;
}

interface RunningLoopbackServer {
  port: number;
  requestCount: () => number;
  close: () => Promise<void>;
}

type LoopbackRequestHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => void;

type ValidationLookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

interface SocketLookupSpy {
  mockImplementation: (
    implementation: (...args: Array<unknown>) => void,
  ) => unknown;
}

async function startLoopbackServer(
  handler: LoopbackRequestHandler = (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.end("loopback sentinel");
  },
): Promise<RunningLoopbackServer> {
  let receivedRequests: number = 0;
  const server: http.Server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      receivedRequests += 1;
      handler(request, response);
    },
  );

  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void): void => {
      const onError: (error: Error) => void = (error: Error): void => {
        reject(error);
      };
      server.once("error", onError);
      server.listen(0, "127.0.0.1", (): void => {
        server.off("error", onError);
        resolve();
      });
    },
  );

  const address: AddressInfo = server.address() as AddressInfo;

  return {
    port: address.port,
    requestCount: (): number => {
      return receivedRequests;
    },
    close: async (): Promise<void> => {
      await new Promise<void>(
        (resolve: () => void, reject: (error: Error) => void): void => {
          server.close((error?: Error): void => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
          server.closeAllConnections();
        },
      );
    },
  };
}

async function runInSandbox(
  code: string,
  privateNetworkOptions: SandboxPrivateNetworkOptions = {},
): Promise<ReturnResult> {
  return VMRunner.runCodeInSandbox({
    code,
    options: { timeout: 15000, ...privateNetworkOptions },
  });
}

/*
 * The sandbox surfaces a rejected request as a thrown error. Either the promise
 * rejects or the returned result carries the message - accept both, and assert
 * on the SSRF wording so a mere "connection refused" cannot pass for a block.
 */
async function errorFromSandbox(
  code: string,
  privateNetworkOptions: SandboxPrivateNetworkOptions = {},
): Promise<string> {
  try {
    const result: ReturnResult = await runInSandbox(
      code,
      privateNetworkOptions,
    );
    if (result.scriptError) {
      return result.scriptError.message;
    }
    return JSON.stringify(result.returnValue ?? result.logMessages ?? "");
  } catch (err) {
    return (err as Error).message || String(err);
  }
}

const REFUSAL: RegExp =
  /not allowed|private, loopback, or link-local|absolute http|could not be resolved/i;

const ALLOW_PRIVATE_NETWORK_WEBHOOKS_ENV: string =
  "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV: string =
  "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const originalAllowPrivateNetworkWebhooks: string | undefined =
  process.env[ALLOW_PRIVATE_NETWORK_WEBHOOKS_ENV];
const originalPrivateNetworkWebhookAllowlist: string | undefined =
  process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV];
const originalAxiosAdapter: typeof axios.defaults.adapter =
  axios.defaults.adapter;

beforeAll(() => {
  /*
   * Common's default Jest environment is jsdom, where Axios selects XHR and
   * CORS blocks the loopback fixtures before VMRunner's Node transport runs.
   * Production VMRunner runs in Node, so force Axios's Node adapter for this
   * server-side integration suite.
   */
  axios.defaults.adapter = "http";
});

beforeEach(() => {
  delete process.env[ALLOW_PRIVATE_NETWORK_WEBHOOKS_ENV];
  delete process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV];
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (originalAxiosAdapter === undefined) {
    delete axios.defaults.adapter;
  } else {
    axios.defaults.adapter = originalAxiosAdapter;
  }

  const restore: (key: string, value: string | undefined) => void = (
    key: string,
    value: string | undefined,
  ): void => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  restore(
    ALLOW_PRIVATE_NETWORK_WEBHOOKS_ENV,
    originalAllowPrivateNetworkWebhooks,
  );
  restore(
    PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV,
    originalPrivateNetworkWebhookAllowlist,
  );
});

describe("VMRunner sandbox axios bridge — SSRF guard", () => {
  const internalTargets: Array<[string, string]> = [
    ["AWS metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
    [
      "AWS metadata credentials path",
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    ],
    ["GCP metadata by name", "http://metadata.google.internal/"],
    ["loopback", "http://127.0.0.1:8080/"],
    ["localhost", "http://localhost:9200/_cluster/health"],
    ["RFC-1918", "http://10.0.0.5/internal"],
    ["IPv6 loopback", "http://[::1]:5432/"],
    ["IPv4-mapped metadata endpoint", "http://[::ffff:169.254.169.254]/"],
  ];

  test.each(internalTargets)(
    "refuses axios.get to the %s",
    async (_label: string, url: string) => {
      const message: string = await errorFromSandbox(
        `return await axios.get(${JSON.stringify(url)});`,
      );
      expect(message).toMatch(REFUSAL);
    },
  );

  test.each(internalTargets)(
    "refuses axios.post to the %s",
    async (_label: string, url: string) => {
      const message: string = await errorFromSandbox(
        `return await axios.post(${JSON.stringify(url)}, { a: 1 });`,
      );
      expect(message).toMatch(REFUSAL);
    },
  );

  test("refuses axios.request, where the URL lives in the config", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.request({ method: 'get', url: 'http://169.254.169.254/latest/meta-data/' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("refuses a target assembled from baseURL and a relative path", async () => {
    // The positional url is harmless on its own; baseURL is where it goes.
    const message: string = await errorFromSandbox(
      `return await axios.get('/latest/meta-data/', { baseURL: 'http://169.254.169.254' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("refuses a baseURL-only request()", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.request({ method: 'get', baseURL: 'http://127.0.0.1:8080', url: '/admin' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test.each(["head", "options", "put", "patch", "delete"])(
    "refuses axios.%s to an internal address",
    async (method: string) => {
      const call: string =
        method === "put" || method === "patch"
          ? `axios.${method}('http://169.254.169.254/', {})`
          : `axios.${method}('http://169.254.169.254/')`;
      const message: string = await errorFromSandbox(`return await ${call};`);
      expect(message).toMatch(REFUSAL);
    },
  );

  test("refuses a non-http scheme", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.get('file:///etc/passwd');`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("refuses a relative URL with no baseURL rather than guessing", async () => {
    const message: string = await errorFromSandbox(
      `return await axios.get('/latest/meta-data/');`,
    );
    expect(message).toMatch(REFUSAL);
  });

  /*
   * A proxy or a unix socket steers the connection somewhere the validated URL
   * never named — /var/run/docker.sock being the memorable one — so the guard
   * disables or strips them rather than trusting the URL alone.
   */
  test("a proxy in the config cannot steer a public URL at an internal host", async () => {
    /*
     * A public IP literal (no DNS) with a 1ms timeout, so this settles offline
     * and instantly. The point is only that the metadata endpoint named in
     * `proxy` is never what gets dialled.
     */
    const message: string = await errorFromSandbox(
      `try { return await axios.get('http://8.8.8.8/', { timeout: 1, proxy: { host: '169.254.169.254', port: 80 } }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(/169\.254\.169\.254/);
  });

  test("an environment proxy cannot become an unvalidated connection path", async () => {
    const originalHttpProxy: string | undefined = process.env["HTTP_PROXY"];
    const originalHttpsProxy: string | undefined = process.env["HTTPS_PROXY"];

    process.env["HTTP_PROXY"] = "http://169.254.169.254:80";
    process.env["HTTPS_PROXY"] = "http://169.254.169.254:80";

    try {
      const message: string = await errorFromSandbox(
        `try { return await axios.get('http://8.8.8.8/', { timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
      );
      expect(message).not.toMatch(/169\.254\.169\.254/);
    } finally {
      if (originalHttpProxy === undefined) {
        delete process.env["HTTP_PROXY"];
      } else {
        process.env["HTTP_PROXY"] = originalHttpProxy;
      }

      if (originalHttpsProxy === undefined) {
        delete process.env["HTTPS_PROXY"];
      } else {
        process.env["HTTPS_PROXY"] = originalHttpsProxy;
      }
    }
  });

  test("still lets an ordinary public URL past the guard", async () => {
    /*
     * 8.8.8.8 is never actually reached - the 1ms timeout sees to that. The
     * assertion is that the failure is a TRANSPORT failure, not the SSRF guard,
     * i.e. the block above is not simply refusing everything.
     */
    const message: string = await errorFromSandbox(
      `try { return await axios.get('http://8.8.8.8/', { timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(REFUSAL);
  });
});

describe("VMRunner sandbox axios bridge — pinned canonical dispatch", () => {
  async function expectNoLoopbackRequest(
    buildCode: (port: number) => string,
  ): Promise<void> {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer();

    try {
      const result: ReturnResult = await runInSandbox(
        buildCode(loopbackServer.port),
      );

      expect(result.returnValue).not.toBe("loopback sentinel");
      expect(loopbackServer.requestCount()).toBe(0);
    } finally {
      await loopbackServer.close();
    }
  }

  test("pins the address from validation instead of performing a second DNS lookup", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer();
    const validationLookupSpy: ValidationLookupSpy = jest.spyOn(
      dns.promises,
      "lookup",
    ) as unknown as ValidationLookupSpy;
    validationLookupSpy.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);

    const socketLookupSpy: SocketLookupSpy = jest.spyOn(
      dns,
      "lookup",
    ) as unknown as SocketLookupSpy;
    socketLookupSpy.mockImplementation((...args: Array<unknown>): void => {
      const lookupOptions: { all?: boolean } | undefined =
        args.length > 2 && typeof args[1] === "object"
          ? (args[1] as { all?: boolean })
          : undefined;
      const callback: (
        error: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void = args[args.length - 1] as (
        error: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void;

      queueMicrotask((): void => {
        if (lookupOptions?.all) {
          callback(null, [{ address: "127.0.0.1", family: 4 }]);
          return;
        }
        callback(null, "127.0.0.1", 4);
      });
    });

    try {
      const result: ReturnResult = await runInSandbox(`
        try {
          const response = await axios.get(
            'http://rebind.invalid:${loopbackServer.port}/secret',
            {
              timeout: 100,
              httpVersion: 2,
              http2Options: { sessionTimeout: 10000 }
            }
          );
          return response.data;
        } catch (error) {
          return 'transport failed: ' + error.message;
        }
      `);

      expect(result.returnValue).not.toBe("loopback sentinel");
      expect(validationLookupSpy).toHaveBeenCalledTimes(1);
      expect(socketLookupSpy).not.toHaveBeenCalled();
      expect(loopbackServer.requestCount()).toBe(0);
    } finally {
      await loopbackServer.close();
    }
  });

  test("drops destination-steering fields from a serialized HTTP Agent", async () => {
    await expectNoLoopbackRequest((port: number): string => {
      return `
        try {
          const response = await axios.get(
            'http://8.8.8.8:${port}/approved',
            {
              timeout: 100,
              httpAgent: new http.Agent({
                host: '127.0.0.1',
                port: ${port},
                keepAlive: true
              })
            }
          );
          return response.data;
        } catch (error) {
          return 'transport failed: ' + error.message;
        }
      `;
    });
  });

  test("preserves TLS-only servername while replacing the HTTPS agent transport", async () => {
    process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV] = "127.0.0.1";
    let observedServername: string | undefined;
    jest
      .spyOn(https.Agent.prototype, "createConnection")
      .mockImplementation(((options: {
        servername?: string | undefined;
      }): never => {
        observedServername = options.servername;
        throw new Error("TLS connection sentinel");
      }) as never);

    const result: ReturnResult = await runInSandbox(
      `
        try {
          await axios.get('https://127.0.0.1/sni', {
            httpsAgent: new https.Agent({
              rejectUnauthorized: false,
              servername: 'tenant.internal.example'
            })
          });
          return 'unexpected success';
        } catch (error) {
          return error.message;
        }
      `,
      {
        allowPrivateNetworkRequests: true,
      },
    );

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toMatch(/TLS connection sentinel/i);
    expect(observedServername).toBe("tenant.internal.example");
  });

  test("an empty positional URL wins over config.url and resolves to baseURL", async () => {
    process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV] = "127.0.0.1";
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end(request.url);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get('', {
            url: 'http://169.254.169.254/ignored',
            baseURL: 'http://127.0.0.1:${loopbackServer.port}/from-base-url'
          });
          return response.data;
        `,
        {
          allowPrivateNetworkRequests: true,
        },
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("/from-base-url");
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("allowAbsoluteUrls false combines baseURL with a direct-method absolute URL", async () => {
    process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV] = "127.0.0.1";
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end(request.url);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get(
            'http://169.254.169.254/metadata',
            {
              baseURL: 'http://127.0.0.1:${loopbackServer.port}/base',
              allowAbsoluteUrls: false
            }
          );
          return response.data;
        `,
        {
          allowPrivateNetworkRequests: true,
        },
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("/base/http://169.254.169.254/metadata");
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("allowAbsoluteUrls false combines baseURL with request().url", async () => {
    process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV] = "127.0.0.1";
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end(request.url);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.request({
            method: 'get',
            url: 'http://169.254.169.254/metadata',
            baseURL: 'http://127.0.0.1:${loopbackServer.port}/base',
            allowAbsoluteUrls: false
          });
          return response.data;
        `,
        {
          allowPrivateNetworkRequests: true,
        },
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("/base/http://169.254.169.254/metadata");
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });
});

describe("VMRunner sandbox axios bridge — private network policy", () => {
  const rfc1918Request: string = `
    try {
      await axios.get('http://10.0.0.5/internal', { timeout: 1 });
      return 'request reached transport';
    } catch (error) {
      return 'request failed: ' + error.message;
    }
  `;

  const incompletePolicies: Array<[string, SandboxPrivateNetworkOptions]> = [
    ["neither flag", {}],
    ["eligibility only", { allowPrivateNetworkRequests: true }],
    ["trusted policy only", { privateNetworkAccessIsAllowed: true }],
    [
      "a false trusted policy",
      {
        allowPrivateNetworkRequests: true,
        privateNetworkAccessIsAllowed: false,
      },
    ],
  ];

  test.each(incompletePolicies)(
    "refuses RFC1918 with %s",
    async (
      _label: string,
      policy: SandboxPrivateNetworkOptions,
    ): Promise<void> => {
      const message: string = await errorFromSandbox(rfc1918Request, policy);

      expect(message).toMatch(REFUSAL);
    },
  );

  test("allows RFC1918 past the guard only when both flags are true", async () => {
    const message: string = await errorFromSandbox(rfc1918Request, {
      allowPrivateNetworkRequests: true,
      privateNetworkAccessIsAllowed: true,
    });

    expect(message).not.toMatch(REFUSAL);
  });

  test("an unaware workflow caller retains webhook-config behavior", async () => {
    process.env[ALLOW_PRIVATE_NETWORK_WEBHOOKS_ENV] = "true";

    const message: string = await errorFromSandbox(rfc1918Request, {
      allowPrivateNetworkRequests: true,
    });

    expect(message).not.toMatch(REFUSAL);
  });

  const alwaysForbiddenTargets: Array<[string, string]> = [
    ["link-local metadata", "http://169.254.169.254/latest/meta-data/"],
    ["Alibaba metadata", "http://100.100.100.200/latest/meta-data/"],
    ["Azure WireServer", "http://168.63.129.16/machine/?comp=goalstate"],
    ["Oracle Cloud metadata", "http://192.0.0.192/opc/v2/instance/"],
    ["AWS IPv6 services", "http://[fd00:ec2::254]/latest/meta-data/"],
    ["Google IPv6 metadata", "http://[fd20:ce::254]/computeMetadata/v1/"],
    ["RFC 8215 translation", "http://[64:ff9b:1::1]/"],
    ["legacy SIIT translation", "http://[0:0:0:0:ffff:0:7f00:1]/"],
  ];

  test.each(alwaysForbiddenTargets)(
    "still refuses %s when both private-network flags are true",
    async (_label: string, url: string): Promise<void> => {
      const message: string = await errorFromSandbox(
        `return await axios.get(${JSON.stringify(url)});`,
        {
          allowPrivateNetworkRequests: true,
          privateNetworkAccessIsAllowed: true,
        },
      );

      expect(message).toMatch(REFUSAL);
    },
  );
});

describe("VMRunner sandbox axios bridge — bounded host I/O", () => {
  const allowLoopbackForWorkflow: SandboxPrivateNetworkOptions = {
    allowPrivateNetworkRequests: true,
  };

  beforeEach(() => {
    process.env[PRIVATE_NETWORK_WEBHOOK_ALLOWLIST_ENV] = "127.0.0.1";
  });

  test("counts decompressed response bytes and destroys an oversized gzip stream", async () => {
    const expandedBody: Buffer = Buffer.alloc(10 * 1024 * 1024 + 1, "a");
    const compressedBody: Buffer = gzipSync(expandedBody);
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "content-encoding": "gzip",
          "content-length": compressedBody.length,
          "content-type": "text/plain",
        });
        response.end(compressedBody);
      },
    );

    try {
      const message: string = await errorFromSandbox(
        `return await axios.get('http://127.0.0.1:${loopbackServer.port}/gzip');`,
        allowLoopbackForWorkflow,
      );

      expect(message).toMatch(/exceeded the allowed size/i);
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("shares one cumulative response-byte budget across sandbox requests", async () => {
    const responseBody: Buffer = Buffer.alloc(6 * 1024 * 1024, "a");
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "content-length": responseBody.length,
          "content-type": "text/plain",
        });
        response.end(responseBody);
      },
    );

    try {
      const message: string = await errorFromSandbox(
        `
          await axios.get('http://127.0.0.1:${loopbackServer.port}/first');
          return await axios.get('http://127.0.0.1:${loopbackServer.port}/second');
        `,
        allowLoopbackForWorkflow,
      );

      expect(message).toMatch(/exceeded the allowed size/i);
      expect(loopbackServer.requestCount()).toBe(2);
    } finally {
      await loopbackServer.close();
    }
  });

  test("rejects an oversized serialized request before host parsing or socket I/O", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer();

    try {
      const result: ReturnResult = await runInSandbox(
        `
          try {
            await axios.post(
              'http://127.0.0.1:${loopbackServer.port}/upload',
              { payload: 'x'.repeat(10 * 1024 * 1024 + 1) }
            );
            return 'request sent';
          } catch (error) {
            return 'request refused: ' + error.message;
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.returnValue).toMatch(/request refused:/i);
      expect(result.returnValue).toMatch(
        /request body exceeded|maxbodylength|larger than|max body/i,
      );
      expect(loopbackServer.requestCount()).toBe(0);
    } finally {
      await loopbackServer.close();
    }
  });

  test("caps cumulative serialized request bytes across one sandbox execution", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        request.resume();
        request.on("end", (): void => {
          response.setHeader("content-type", "application/json");
          response.end('{"ok":true}');
        });
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const body = { payload: 'x'.repeat(6 * 1024 * 1024) };
          await axios.post(
            'http://127.0.0.1:${loopbackServer.port}/first',
            body
          );
          try {
            await axios.post(
              'http://127.0.0.1:${loopbackServer.port}/second',
              body
            );
            return 'second request sent';
          } catch (error) {
            return 'second request refused: ' + error.message;
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatch(/cumulative request size/i);
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("returns arraybuffer data without decimal-array serialization amplification", async () => {
    const binaryBody: Buffer = Buffer.from([0, 255, 1, 254]);
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "content-length": binaryBody.length,
          "content-type": "application/octet-stream",
        });
        response.end(binaryBody);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/binary',
            { responseType: 'arraybuffer' }
          );
          return {
            type: response.data.constructor.name,
            length: response.data.length,
            bytes: Array.from(response.data)
          };
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        type: "Uint8Array",
        length: 4,
        bytes: [0, 255, 1, 254],
      });
    } finally {
      await loopbackServer.close();
    }
  });

  test("caps base64 arraybuffer serialization and keeps its raw bytes charged", async () => {
    const binaryBody: Buffer = Buffer.alloc(8 * 1024 * 1024, 255);
    const followUpBody: Buffer = Buffer.alloc(3 * 1024 * 1024, "a");
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        const body: Buffer =
          request.url === "/binary" ? binaryBody : followUpBody;
        response.writeHead(200, {
          "content-length": body.length,
          "content-type": "application/octet-stream",
        });
        response.end(body);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          let firstError = '';
          try {
            await axios.get(
              'http://127.0.0.1:${loopbackServer.port}/binary',
              { responseType: 'arraybuffer' }
            );
          } catch (error) {
            firstError = error.message;
          }

          try {
            await axios.get(
              'http://127.0.0.1:${loopbackServer.port}/follow-up'
            );
            return 'follow-up unexpectedly succeeded';
          } catch (error) {
            return firstError + ' | ' + error.message;
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatch(
        /remote response exceeded the allowed serialized size/i,
      );
      expect(result.returnValue).toMatch(/remote response exceeded/i);
      expect(loopbackServer.requestCount()).toBe(2);
    } finally {
      await loopbackServer.close();
    }
  });

  test("base64-bridges control-heavy text before decoding it in the isolate", async () => {
    const controlBody: Buffer = Buffer.alloc(7 * 1024 * 1024, 0);
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "content-length": controlBody.length,
          "content-type": "text/plain",
        });
        response.end(controlBody);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/control-text',
            { responseType: 'text' }
          );
          return {
            length: response.data.length,
            firstCodePoint: response.data.charCodeAt(0),
            lastCodePoint: response.data.charCodeAt(response.data.length - 1)
          };
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        length: 7 * 1024 * 1024,
        firstCodePoint: 0,
        lastCodePoint: 0,
      });
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("preserves responseEncoding while decoding response bytes inside the isolate", async () => {
    const latin1Body: Buffer = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end(latin1Body);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/latin1',
            { responseType: 'text', responseEncoding: 'latin1' }
          );
          return response.data;
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("café");
    } finally {
      await loopbackServer.close();
    }
  });

  test("strips a UTF-8 BOM before default JSON parsing and text delivery", async () => {
    const bomJsonBody: Buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"ok":true}', "utf8"),
    ]);
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end(bomJsonBody);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const defaultResponse = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/default'
          );
          const textResponse = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/text',
            { responseType: 'text', responseEncoding: 'utf8' }
          );
          return {
            defaultData: defaultResponse.data,
            textData: textResponse.data,
            firstTextCodePoint: textResponse.data.charCodeAt(0)
          };
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        defaultData: { ok: true },
        textData: '{"ok":true}',
        firstTextCodePoint: 123,
      });
    } finally {
      await loopbackServer.close();
    }
  });

  test("honors transitional forcedJSONParsing false", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.end('{"ok":true}');
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/forced-off',
            { transitional: { forcedJSONParsing: false } }
          );
          return {
            type: typeof response.data,
            data: response.data
          };
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        type: "string",
        data: '{"ok":true}',
      });
    } finally {
      await loopbackServer.close();
    }
  });

  test("honors strict JSON parsing and retains Axios error response context", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, { "x-response-sentinel": "strict-json" });
        response.end("not-json");
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          try {
            await axios.get(
              'http://127.0.0.1:${loopbackServer.port}/strict-json',
              {
                responseType: 'json',
                transitional: { silentJSONParsing: false }
              }
            );
            return 'unexpected success';
          } catch (error) {
            return {
              isAxiosError: axios.isAxiosError(error),
              name: error.name,
              code: error.code,
              status: error.response.status,
              header: error.response.headers['x-response-sentinel'],
              configMethod: error.config.method,
              configUrl: error.config.url,
              sameConfigUrl:
                error.config.url === error.response.config.url,
              hasRequest: Boolean(error.request),
              hasResponseRequest: Boolean(error.response.request),
              data: error.response.data
            };
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatchObject({
        isAxiosError: true,
        name: "SyntaxError",
        code: "ERR_BAD_RESPONSE",
        status: 200,
        header: "strict-json",
        configMethod: "get",
        configUrl: `http://127.0.0.1:${loopbackServer.port}/strict-json`,
        sameConfigUrl: true,
        hasRequest: true,
        hasResponseRequest: true,
        data: "not-json",
      });
    } finally {
      await loopbackServer.close();
    }
  });

  test("preserves a stricter caller maxContentLength and wraps its stream failure", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "content-length": "4",
          "x-response-sentinel": "content-limit",
        });
        response.end("four");
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          try {
            await axios.get(
              'http://127.0.0.1:${loopbackServer.port}/content-limit',
              { maxContentLength: 3 }
            );
            return 'unexpected success';
          } catch (error) {
            return {
              message: error.message,
              isAxiosError: axios.isAxiosError(error),
              status: error.response.status,
              header: error.response.headers['x-response-sentinel'],
              configLimit: error.config.maxContentLength,
              responseConfigLimit: error.response.config.maxContentLength,
              hasRequest: Boolean(error.request),
              hasResponseRequest: Boolean(error.response.request)
            };
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatchObject({
        message: expect.stringMatching(/exceeded the allowed size/i),
        isAxiosError: true,
        status: 200,
        header: "content-limit",
        configLimit: 3,
        responseConfigLimit: 3,
        hasRequest: true,
        hasResponseRequest: true,
      });
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("preserves a stricter caller maxBodyLength", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer();

    try {
      const result: ReturnResult = await runInSandbox(
        `
          try {
            await axios.post(
              'http://127.0.0.1:${loopbackServer.port}/body-limit',
              'four',
              { maxBodyLength: 3 }
            );
            return 'unexpected success';
          } catch (error) {
            return error.message;
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatch(/maxBodyLength/i);
      expect(loopbackServer.requestCount()).toBe(0);
    } finally {
      await loopbackServer.close();
    }
  });

  test("wraps a mid-body stream failure with Axios response context", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, {
          "content-length": "100",
          "x-response-sentinel": "mid-body",
        });
        response.write("partial body");
        response.flushHeaders();
        setTimeout((): void => {
          response.destroy();
        }, 10);
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          try {
            await axios.get(
              'http://127.0.0.1:${loopbackServer.port}/mid-body'
            );
            return 'unexpected success';
          } catch (error) {
            return {
              isAxiosError: axios.isAxiosError(error),
              status: error.response.status,
              header: error.response.headers['x-response-sentinel'],
              configMethod: error.config.method,
              configUrl: error.config.url,
              sameConfigUrl:
                error.config.url === error.response.config.url,
              hasRequest: Boolean(error.request),
              hasResponseRequest: Boolean(error.response.request),
              boundedData: error.response.data
            };
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toMatchObject({
        isAxiosError: true,
        status: 200,
        header: "mid-body",
        configMethod: "get",
        configUrl: `http://127.0.0.1:${loopbackServer.port}/mid-body`,
        sameConfigUrl: true,
        hasRequest: true,
        hasResponseRequest: true,
        boundedData: "",
      });
      expect(loopbackServer.requestCount()).toBe(1);
    } finally {
      await loopbackServer.close();
    }
  });

  test("preserves Axios's silent invalid-JSON response behavior", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("not-json");
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          const response = await axios.get(
            'http://127.0.0.1:${loopbackServer.port}/invalid-json',
            { responseType: 'json' }
          );
          return response.data;
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toBe("not-json");
    } finally {
      await loopbackServer.close();
    }
  });

  test("decodes and parses a bounded Axios error response inside the isolate", async () => {
    const loopbackServer: RunningLoopbackServer = await startLoopbackServer(
      (_request: http.IncomingMessage, response: http.ServerResponse): void => {
        response.writeHead(418, { "content-type": "application/json" });
        response.end('{"error":"teapot"}');
      },
    );

    try {
      const result: ReturnResult = await runInSandbox(
        `
          try {
            await axios.get(
              'http://127.0.0.1:${loopbackServer.port}/error'
            );
            return 'unexpected success';
          } catch (error) {
            return {
              status: error.response.status,
              data: error.response.data
            };
          }
        `,
        allowLoopbackForWorkflow,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        status: 418,
        data: { error: "teapot" },
      });
    } finally {
      await loopbackServer.close();
    }
  });
});

/*
 * The "is this already an absolute URL?" decision is what tells the guard
 * whether to fold in baseURL before validating, so it has to be scheme
 * case-insensitive and slash-tolerant — otherwise HTTP:// (uppercase) or a
 * baseURL with stray slashes could be mis-classified and skip the check.
 */
describe("VMRunner sandbox axios bridge — URL absolutization", () => {
  test("an uppercase scheme is still recognised as absolute and its host checked", async () => {
    // HTTP:// (uppercase) must not slip past the loopback block.
    const message: string = await errorFromSandbox(
      `return await axios.get('HTTP://127.0.0.1:8080/admin');`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("a mixed-case scheme on a public host passes the guard, failing only at transport", async () => {
    const message: string = await errorFromSandbox(
      `try { return await axios.get('HtTpS://8.8.8.8/', { timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(REFUSAL);
  });

  test("stray slashes joining baseURL and a relative path do not evade the block", async () => {
    // baseURL trailing slashes + a leading-slash relative path, internal host.
    const message: string = await errorFromSandbox(
      `return await axios.get('//latest/meta-data/', { baseURL: 'http://169.254.169.254//' });`,
    );
    expect(message).toMatch(REFUSAL);
  });

  test("a baseURL + relative path resolving to a public host clears the guard", async () => {
    const message: string = await errorFromSandbox(
      `try { return await axios.get('/path', { baseURL: 'http://8.8.8.8', timeout: 1 }); } catch (e) { return 'threw: ' + e.message; }`,
    );
    expect(message).not.toMatch(REFUSAL);
  });

  test.each([
    ["protocol-relative", "//169.254.169.254/metadata"],
    ["non-HTTP scheme", "file:///etc/passwd"],
  ])(
    "treats an Axios-absolute %s URL as absolute before rejecting its final scheme",
    async (_label: string, requestedUrl: string): Promise<void> => {
      const loopbackServer: RunningLoopbackServer = await startLoopbackServer();

      try {
        const message: string = await errorFromSandbox(
          `return await axios.get(${JSON.stringify(requestedUrl)}, {
            baseURL: 'http://127.0.0.1:${loopbackServer.port}/must-not-run'
          });`,
          {
            allowPrivateNetworkRequests: true,
            privateNetworkAccessIsAllowed: true,
          },
        );

        expect(message).toMatch(/absolute http or https/i);
        expect(loopbackServer.requestCount()).toBe(0);
      } finally {
        await loopbackServer.close();
      }
    },
  );
});
