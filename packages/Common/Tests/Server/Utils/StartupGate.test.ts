import StartupGate from "../../../Server/Utils/StartupGate";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
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
import express from "express";
import http from "http";
import { AddressInfo } from "net";

/*
 * Issue #2825: while the App mounts its routes, a request used to find no
 * route and get Express's bare 404 - which an OpenTelemetry collector drops
 * its batch on instead of retrying. Until the App opens the gate, it answers
 * 503 with Retry-After, which collectors retry; the status routes, mounted
 * before the gate, keep answering.
 *
 * A real Express app on an ephemeral port, laid out the way StartServer lays
 * out the App: status routes, then the gate, then everything mounted later.
 */

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function send(data: {
  port: number;
  method: string;
  path: string;
  accept?: string;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          method: data.method,
          path: data.path,
          headers: data.accept ? { accept: data.accept } : {},
        },
        (response: http.IncomingMessage) => {
          let body: string = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body,
            });
          });
        },
      );
      request.on("error", reject);
      request.end();
    },
  );
}

describe("StartupGate over HTTP", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app: express.Express = express();

    // Mounted before the gate, like StatusAPI is.
    app.get("/status/live", (_req: express.Request, res: express.Response) => {
      res.json({ status: "ok" });
    });

    app.use(StartupGate.middleware);

    // Mounted after it, like every feature set's routes.
    app.post("/otlp/v1/metrics", (_req: express.Request, res: express.Response) => {
      res.status(200).json({});
    });
    app.get("/dashboard", (_req: express.Request, res: express.Response) => {
      res.send("<html>dashboard</html>");
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
    StartupGate.reset();
  });

  afterEach(() => {
    StartupGate.reset();
    jest.restoreAllMocks();
  });

  test("while starting, an OTLP batch gets 503 with Retry-After, not a 404 a collector would drop it on", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/otlp/v1/metrics",
    });

    expect(result.status).toBe(503);
    expect(result.headers["retry-after"]).toBe("5");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(result.body)).toEqual({
      error: "OneUptime is starting. Please try again in a few seconds.",
    });
  });

  test("while starting, a path no route will ever serve also gets 503, not a 404", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/v1/traces",
    });

    expect(result.status).toBe(503);
  });

  test("while starting, a browser gets a page that reloads itself", async () => {
    const result: HttpResult = await send({
      port,
      method: "GET",
      path: "/dashboard",
      accept: "text/html,application/xhtml+xml",
    });

    expect(result.status).toBe(503);
    expect(result.headers["content-type"]).toContain("text/html");
    expect(result.body).toContain('<meta http-equiv="refresh" content="5">');
    expect(result.body).toContain(
      "OneUptime is starting. Please try again in a few seconds.",
    );
  });

  test("the status routes mounted before the gate answer throughout", async () => {
    const result: HttpResult = await send({
      port,
      method: "GET",
      path: "/status/live",
    });

    expect(result.status).toBe(200);
  });

  test("once open, every route answers as usual", async () => {
    StartupGate.open();

    expect(
      (await send({ port, method: "POST", path: "/otlp/v1/metrics" })).status,
    ).toBe(200);
    expect(
      (
        await send({
          port,
          method: "GET",
          path: "/dashboard",
          accept: "text/html",
        })
      ).body,
    ).toBe("<html>dashboard</html>");
    // An unknown path is the app's own business again.
    expect(
      (await send({ port, method: "POST", path: "/v1/traces" })).status,
    ).toBe(404);
  });
});

describe("StartupGate", () => {
  afterEach(() => {
    StartupGate.reset();
    jest.restoreAllMocks();
  });

  test("starts closed and stays open once opened", () => {
    expect(StartupGate.isOpen()).toBe(false);
    StartupGate.open();
    expect(StartupGate.isOpen()).toBe(true);
    StartupGate.open();
    expect(StartupGate.isOpen()).toBe(true);
  });

  test("readiness fails while starting, and passes once open", () => {
    expect(() => {
      StartupGate.assertOpen();
    }).toThrow(ServiceUnavailableException);

    StartupGate.open();

    expect(() => {
      StartupGate.assertOpen();
    }).not.toThrow();
  });

  test("says the name the installation goes by", () => {
    jest.spyOn(ProductBrandingText, "getProductName").mockReturnValue("Acme");
    expect(StartupGate.getStartingMessage()).toBe(
      "Acme is starting. Please try again in a few seconds.",
    );
  });

  test("the page escapes what it shows", () => {
    const page: string = StartupGate.buildStartingPage(
      '<script>alert("x")</script> & co',
    );
    expect(page).not.toContain("<script>");
    expect(page).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co",
    );
  });

  test("Retry-After is short enough for a collector's next attempt", () => {
    expect(StartupGate.RETRY_AFTER_SECONDS).toBeGreaterThan(0);
    expect(StartupGate.RETRY_AFTER_SECONDS).toBeLessThanOrEqual(30);
  });
});
