jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import { setDefaultHeaders } from "../../../Server/Utils/StartServer";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import express from "express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import timers from "timers";

/*
 * AN HTTPS INSTALLATION TELLS BROWSERS TO COME BACK OVER HTTPS ONLY.
 *
 * Secure cookies keep a session off plain HTTP; Strict-Transport-Security
 * keeps the browser itself off it. A browser that has seen the header over
 * HTTPS turns every later http:// address of that host - typed, followed, or
 * injected by someone on the network - into https:// before it sends
 * anything, so neither the request nor a sign-in page served in its place
 * ever crosses the network in clear text.
 *
 * OneUptime's ingress never sent the header. Now every response the app
 * gives for the installation's own address (HOST) carries it when the
 * installation is served over HTTPS (HTTP_PROTOCOL=https): one year, or
 * HSTS_MAX_AGE_SECONDS. Never for a status page's or a dashboard's custom
 * domain - its owner decides whether it is HTTPS-only - and never for a
 * plain-HTTP installation, which has to stay reachable over HTTP.
 *
 * The header is set by StartServer's default headers, which every OneUptime
 * service runs before its routes; here they run in a real Express app with
 * `trust proxy` set as StartServer sets it, and each case is a real HTTP
 * request.
 */

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

type HstsEnv = {
  httpProtocol: string;
  host: string;
  hstsMaxAgeSeconds: number;
};

type HstsEnvGlobal = typeof globalThis & {
  __strictTransportSecurityEnv: HstsEnv;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const envGlobal: HstsEnvGlobal = globalThis as HstsEnvGlobal;

  envGlobal.__strictTransportSecurityEnv = {
    httpProtocol: "https://",
    host: "oneuptime.example.com",
    hstsMaxAgeSeconds: 31536000,
  };

  for (const [name, key] of [
    ["HttpProtocol", "httpProtocol"],
    ["Host", "host"],
    ["HstsMaxAgeSeconds", "hstsMaxAgeSeconds"],
  ] as Array<[string, keyof HstsEnv]>) {
    Object.defineProperty(mocked, name, {
      configurable: true,
      enumerable: true,
      get: (): unknown => {
        return envGlobal.__strictTransportSecurityEnv[key];
      },
    });
  }

  return mocked;
});

function setEnv(overrides: Partial<HstsEnv>): void {
  const envGlobal: HstsEnvGlobal = globalThis as HstsEnvGlobal;

  envGlobal.__strictTransportSecurityEnv = {
    ...envGlobal.__strictTransportSecurityEnv,
    ...overrides,
  };
}

const INSTALLATION_HOST: string = "oneuptime.example.com";

let server: http.Server;
let port: number = 0;

beforeAll(async () => {
  const app: express.Express = express();
  app.set("trust proxy", 1);
  app.use(setDefaultHeaders);

  app.get("/dashboard", (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).send("<html></html>");
  });

  app.get("/api/fails", (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(500).json({ error: "Server Error" });
  });

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  setEnv({
    httpProtocol: "https://",
    host: INSTALLATION_HOST,
    hstsMaxAgeSeconds: 31536000,
  });
});

async function strictTransportSecurity(data: {
  host: string;
  path?: string;
  forwardedProto?: string;
}): Promise<{ status: number; header: string | undefined }> {
  const headers: Record<string, string> = { Host: data.host };

  if (data.forwardedProto) {
    headers["X-Forwarded-Proto"] = data.forwardedProto;
  }

  return new Promise<{ status: number; header: string | undefined }>(
    (
      resolve: (value: { status: number; header: string | undefined }) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port,
          path: data.path || "/dashboard",
          method: "GET",
          headers,
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            const value: string | Array<string> | undefined =
              response.headers["strict-transport-security"];

            resolve({
              status: response.statusCode || 0,
              header: Array.isArray(value) ? value.join(", ") : value,
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

describe("an HTTPS installation's own address", () => {
  test("tells browsers to stay on HTTPS for a year", async () => {
    const answer: { status: number; header: string | undefined } =
      await strictTransportSecurity({
        host: INSTALLATION_HOST,
        forwardedProto: "https",
      });

    expect(answer.status).toBe(200);
    expect(answer.header).toBe("max-age=31536000");
  });

  test("whatever scheme the hop into the ingress used: a browser only takes the header over HTTPS", async () => {
    for (const forwardedProto of ["http", "https", undefined]) {
      const answer: { status: number; header: string | undefined } =
        await strictTransportSecurity({
          host: `${INSTALLATION_HOST}:443`,
          ...(forwardedProto ? { forwardedProto } : {}),
        });

      expect(answer.header).toBe("max-age=31536000");
    }
  });

  test("on an error response too", async () => {
    const answer: { status: number; header: string | undefined } =
      await strictTransportSecurity({
        host: INSTALLATION_HOST,
        path: "/api/fails",
      });

    expect(answer.status).toBe(500);
    expect(answer.header).toBe("max-age=31536000");
  });

  test("for as long as HSTS_MAX_AGE_SECONDS says, and 0 tells browsers to forget it", async () => {
    setEnv({ hstsMaxAgeSeconds: 0 });

    expect(
      (await strictTransportSecurity({ host: INSTALLATION_HOST })).header,
    ).toBe("max-age=0");

    setEnv({ hstsMaxAgeSeconds: 600 });

    expect(
      (await strictTransportSecurity({ host: INSTALLATION_HOST })).header,
    ).toBe("max-age=600");
  });
});

describe("no Strict-Transport-Security", () => {
  test("for a status page's or a dashboard's custom domain, even over HTTPS", async () => {
    for (const host of ["status.customer.com", "dashboard.customer.com"]) {
      const answer: { status: number; header: string | undefined } =
        await strictTransportSecurity({ host, forwardedProto: "https" });

      expect(answer.status).toBe(200);
      expect(answer.header).toBeUndefined();
    }
  });

  test("for a plain-HTTP installation, even when a proxy in front says https", async () => {
    setEnv({ httpProtocol: "http://" });

    for (const forwardedProto of ["http", "https"]) {
      const answer: { status: number; header: string | undefined } =
        await strictTransportSecurity({
          host: INSTALLATION_HOST,
          forwardedProto,
        });

      expect(answer.header).toBeUndefined();
    }
  });

  test("for another name the server answers to, such as its IP address", async () => {
    const answer: { status: number; header: string | undefined } =
      await strictTransportSecurity({ host: "10.0.0.5" });

    expect(answer.header).toBeUndefined();
  });

  test("when HOST is localhost: a year of HTTPS-only localhost would break every local server on that machine", async () => {
    for (const host of ["localhost", "oneuptime.localhost"]) {
      setEnv({ host });

      const answer: { status: number; header: string | undefined } =
        await strictTransportSecurity({
          host: `${host}:8443`,
          forwardedProto: "https",
        });

      expect(answer.status).toBe(200);
      expect(answer.header).toBeUndefined();
    }
  });

  test("when HOST is an IP address, which browsers never pin", async () => {
    setEnv({ host: "203.0.113.10" });

    const answer: { status: number; header: string | undefined } =
      await strictTransportSecurity({
        host: "203.0.113.10",
        forwardedProto: "https",
      });

    expect(answer.header).toBeUndefined();
  });
});

describe("every OneUptime service sends it", () => {
  test("StartServer runs the default headers before any route", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Utils/StartServer.ts"),
      "utf8",
    );

    const defaultHeadersAt: number = source.indexOf(
      "app.use(setDefaultHeaders);",
    );

    expect(defaultHeadersAt).toBeGreaterThan(-1);
    // The routes of every service are added by init, after this point.
    expect(source.indexOf("const init:")).toBeGreaterThan(defaultHeadersAt);
    expect(source).toContain(
      "RequestTransport.getStrictTransportSecurity(req)",
    );
  });
});
