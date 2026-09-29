import { describe, expect, test } from "@jest/globals";
import http from "http";
import path from "path";
import {
  shouldSkipDashboardFallbackRoute,
  shouldSkipStatusPageDomainFallbackRoute,
} from "../../FeatureSet/Frontend/RouteReservations";
import {
  APP_DIR,
  REPO_ROOT,
  readSource,
  stripComments,
} from "./RouteReservationSource";

/*
 * Behavioural cover for the SPA fallbacks. Every other test in this area
 * reads source; this one issues real HTTP requests and asserts what comes
 * back, because the bug being guarded against is not "a prefix is missing
 * from a list" - it is "the caller received 200 text/html where it needed
 * JSON", and only a request demonstrates that.
 *
 * The predicates are the REAL ones, imported from FeatureSet/Frontend/
 * RouteReservations.ts. What has to be reconstructed here is the wiring:
 * Frontend/Index.ts cannot be imported (it calls Express.getExpressApp() at
 * module scope and pulls in database services), so this file rebuilds the
 * registration ORDER that App/Index.ts and Frontend/Index.ts produce. A
 * reconstruction can drift from the original, so the last describe block
 * pins the parts of the real source this replica is standing in for.
 *
 * express@4 is loaded from Common/node_modules deliberately. Common is where
 * Common/Server/Utils/Express lives and so is the express the server actually
 * resolves; App/node_modules has express 5 hoisted into it, which rejects
 * app.get("*") outright.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const express: any = require(
  path.join(REPO_ROOT, "Common", "node_modules", "express"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const PRIMARY_HOST: string = "oneuptime.example.com";

/* Mirrors normalizeHostname + getPrimaryHosts in FeatureSet/Frontend/Index.ts. */
const PRIMARY_HOSTS: Set<string> = new Set<string>([
  PRIMARY_HOST,
  "localhost",
  "ingress",
]);

function normalizeHostname(host: string): string {
  return (host.split(":")[0] || "").trim().toLowerCase();
}

interface BuildOptions {
  isBillingEnabled: boolean;
}

interface Reply {
  status: number;
  contentType: string;
  body: string;
}

/*
 * The real stack, in the real order:
 *   1. App/Index.ts mounts AppMetricsAPI on "/" BEFORE any feature set.
 *   2. FrontendRoutes.init() registers the custom-domain fallback, then the
 *      primary-host dashboard fallback. Both are app.get("*").
 *   3. The later feature sets mount their routers.
 *   4. App.addDefaultRoutes() terminates with a 404.
 */
function buildApp(options: BuildOptions): any {
  const app: any = express();

  const isPrimaryHostRequest: (req: any) => boolean = (req: any): boolean => {
    const host: string = normalizeHostname(String(req.headers.host || ""));

    if (!host) {
      return true;
    }

    return PRIMARY_HOSTS.has(host);
  };

  // 1. App-level metrics, registered before the feature sets.
  app.get("/metrics/queue-size", (_req: any, res: any): void => {
    res.status(200).json({ queueSize: 7 });
  });

  // 2a. registerCustomDomainFallback - first, and NOT billing gated.
  app.get("*", (req: any, res: any, next: any): void => {
    if (isPrimaryHostRequest(req)) {
      return next();
    }

    if (shouldSkipStatusPageDomainFallbackRoute(req.path)) {
      return next();
    }

    return res
      .status(200)
      .type("html")
      .send("<!doctype html><title>Status Page SPA</title>");
  });

  // 2b. registerDashboardFallbackForPrimaryHost - billing gated.
  app.get("*", (req: any, res: any, next: any): void => {
    if (options.isBillingEnabled) {
      return next();
    }

    if (!isPrimaryHostRequest(req)) {
      return next();
    }

    if (shouldSkipDashboardFallbackRoute(req.path)) {
      return next();
    }

    return res
      .status(200)
      .type("html")
      .send("<!doctype html><title>Dashboard SPA</title>");
  });

  // 3. Telemetry feature set, mounted after the fallbacks.
  const telemetryWriter: any = express.Router();
  telemetryWriter.get(
    "/metrics/telemetry-writer-shed-rate",
    (_req: any, res: any): void => {
      res.status(200).json({ shedCount: 42 });
    },
  );
  app.use("/", telemetryWriter);

  const incomingRequest: any = express.Router();
  incomingRequest.get(
    "/incoming-request/:secretkey",
    (_req: any, res: any): void => {
      res.status(200).json({ ok: true });
    },
  );
  incomingRequest.post(
    "/incoming-request/:secretkey",
    (_req: any, res: any): void => {
      res.status(200).json({ ok: "post" });
    },
  );
  app.use(["/incoming-request-ingest", "/"], incomingRequest);

  const serverMonitor: any = express.Router();
  serverMonitor.get(
    "/server-monitor/queue/size",
    (_req: any, res: any): void => {
      res.status(200).json({ size: 3 });
    },
  );
  app.use(["/server-monitor-ingest", "/"], serverMonitor);

  // 4. addDefaultRoutes.
  app.get("*", (_req: any, res: any): void => {
    res.status(404).json({ error: "Page not found" });
  });

  return app;
}

function request(
  app: any,
  host: string,
  requestPath: string,
  method: string = "GET",
): Promise<Reply> {
  return new Promise((resolve: (reply: Reply) => void): void => {
    const server: http.Server = app.listen(0, (): void => {
      const address: any = server.address();

      const req: http.ClientRequest = http.request(
        {
          port: address.port,
          path: requestPath,
          method: method,
          headers: { host: host },
        },
        (res: http.IncomingMessage): void => {
          let body: string = "";
          res.on("data", (chunk: Buffer): void => {
            body += chunk.toString();
          });
          res.on("end", (): void => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              contentType: String(res.headers["content-type"] || ""),
              body: body,
            });
          });
        },
      );

      req.end();
    });
  });
}

/* The Host a KEDA metrics-api scaler uses: a Kubernetes service name. */
const KEDA_HOST: string = "oneuptime-telemetry-writer:3600";
const CUSTOM_DOMAIN: string = "status.acme.com";
const SHED_RATE: string = "/metrics/telemetry-writer-shed-rate";

describe("the KEDA shed-rate endpoint, which is what #2986's bug class broke here", () => {
  test("answers JSON on a Kubernetes-service Host, self-hosted", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      KEDA_HOST,
      SHED_RATE,
    );

    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("application/json");
    expect(JSON.parse(reply.body)).toEqual({ shedCount: 42 });
  });

  test("answers JSON on a Kubernetes-service Host with billing enabled too", async () => {
    /*
     * The case the dashboard list alone would not have covered. The
     * custom-domain fallback is registered first and has no billing gate, so
     * on OneUptime Cloud it - not the dashboard fallback - is what answers an
     * internal request. This is why /metrics had to go on BOTH lists.
     */
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: true }),
      KEDA_HOST,
      SHED_RATE,
    );

    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("application/json");
    expect(JSON.parse(reply.body).shedCount).toBe(42);
  });

  test("answers JSON on the primary host", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      PRIMARY_HOST,
      SHED_RATE,
    );

    expect(reply.contentType).toContain("application/json");
  });

  test("HEAD is not swallowed either", async () => {
    /*
     * Express serves HEAD from GET handlers, so the fallbacks shadow HEAD by
     * the same mechanism. A HEAD that came back as text/html would mean the
     * SPA answered.
     */
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      KEDA_HOST,
      SHED_RATE,
      "HEAD",
    );

    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("application/json");
  });

  test("regression: the same request WITHOUT the reservation gets SPA HTML", async () => {
    /*
     * The negative control. Without it, every assertion above would still
     * pass if the fallbacks were simply not wired up, and this file would be
     * proving nothing. Same app, same request, one prefix removed.
     */
    const app: any = express();

    app.get("*", (req: any, res: any, next: any): void => {
      const host: string = normalizeHostname(String(req.headers.host || ""));

      if (PRIMARY_HOSTS.has(host)) {
        return next();
      }

      // The pre-fix list: no /metrics entry.
      if (
        ["/status-page-api", "/rss"].some((p: string) => {
          return req.path === p || req.path.startsWith(`${p}/`);
        })
      ) {
        return next();
      }

      return res
        .status(200)
        .type("html")
        .send("<!doctype html><title>SPA</title>");
    });

    const router: any = express.Router();
    router.get(SHED_RATE, (_req: any, res: any): void => {
      res.status(200).json({ shedCount: 42 });
    });
    app.use("/", router);

    const reply: Reply = await request(app, KEDA_HOST, SHED_RATE);

    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("text/html");
    expect(reply.body).toContain("SPA");
  });
});

describe("#2986's heartbeat path", () => {
  test("the rewritten heartbeat GET reaches the ingest router on the primary host", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      PRIMARY_HOST,
      "/incoming-request/some-secret-key",
    );

    expect(reply.contentType).toContain("application/json");
    expect(JSON.parse(reply.body)).toEqual({ ok: true });
  });

  test("and on a custom domain", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      CUSTOM_DOMAIN,
      "/incoming-request/some-secret-key",
    );

    expect(reply.contentType).toContain("application/json");
  });

  test("POST was never affected, because the fallbacks are GET-only", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      CUSTOM_DOMAIN,
      "/incoming-request/some-secret-key",
      "POST",
    );

    expect(reply.contentType).toContain("application/json");
    expect(JSON.parse(reply.body)).toEqual({ ok: "post" });
  });
});

describe("prefix-alias reservations", () => {
  test('"/server-monitor" does not cover "/server-monitor-ingest/..." - both are reserved', async () => {
    /*
     * The gap the derived guard found: the predicate matches a prefix exactly
     * or followed by "/", so the shorter spelling never covered the longer
     * mount. Both spellings are in the list; this proves it end to end.
     */
    for (const requestPath of [
      "/server-monitor/queue/size",
      "/server-monitor-ingest/server-monitor/queue/size",
    ]) {
      const reply: Reply = await request(
        buildApp({ isBillingEnabled: false }),
        CUSTOM_DOMAIN,
        requestPath,
      );

      expect(reply.contentType).toContain("application/json");
      expect(JSON.parse(reply.body)).toEqual({ size: 3 });
    }
  });
});

describe("what reserving does NOT change", () => {
  test("a status page deep link still renders the status page SPA", async () => {
    for (const requestPath of [
      "/",
      "/incidents",
      "/announcements/abc",
      "/scheduled-events",
      "/subscribe/email",
    ]) {
      const reply: Reply = await request(
        buildApp({ isBillingEnabled: false }),
        CUSTOM_DOMAIN,
        requestPath,
      );

      expect(reply.status).toBe(200);
      expect(reply.contentType).toContain("text/html");
      expect(reply.body).toContain("Status Page SPA");
    }
  });

  test("a dashboard deep link still renders the dashboard SPA when billing is off", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      PRIMARY_HOST,
      "/dashboard/some/deep/link",
    );

    expect(reply.contentType).toContain("text/html");
    expect(reply.body).toContain("Dashboard SPA");
  });

  test("a reserved prefix with no matching route 404s rather than answering 200 HTML", async () => {
    /*
     * The cost of reserving. An honest 404 is the worst case, which is what
     * makes adding a prefix safe.
     */
    for (const requestPath of [
      "/metrics/no-such-metric",
      "/probe/nothing-here",
      "/monitor/nothing-here",
    ]) {
      for (const host of [PRIMARY_HOST, CUSTOM_DOMAIN, KEDA_HOST]) {
        const reply: Reply = await request(
          buildApp({ isBillingEnabled: false }),
          host,
          requestPath,
        );

        expect({ requestPath, host, status: reply.status }).toEqual({
          requestPath,
          host,
          status: 404,
        });
        expect(reply.contentType).toContain("application/json");
      }
    }
  });

  test("/metrics/queue-size still works - it is answered before the fallbacks", async () => {
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      KEDA_HOST,
      "/metrics/queue-size",
    );

    expect(JSON.parse(reply.body)).toEqual({ queueSize: 7 });
  });
});

describe("host classification decides which fallback answers", () => {
  test.each([
    ["localhost", "primary"],
    ["localhost:3002", "primary"],
    ["ingress", "primary"],
    [PRIMARY_HOST, "primary"],
    [`${PRIMARY_HOST}:443`, "primary"],
    [PRIMARY_HOST.toUpperCase(), "primary"],
    [CUSTOM_DOMAIN, "custom"],
    [KEDA_HOST, "custom"],
    ["oneuptime-worker", "custom"],
  ])("%s is treated as a %s host", async (host: string, kind: string) => {
    /*
     * Asserted through an unreserved path, where the two fallbacks give
     * visibly different answers.
     */
    const reply: Reply = await request(
      buildApp({ isBillingEnabled: false }),
      host,
      "/unreserved-path-for-host-detection",
    );

    expect(reply.body).toContain(
      kind === "primary" ? "Dashboard SPA" : "Status Page SPA",
    );
  });

  test("billing enabled disables the dashboard fallback but not the custom-domain one", async () => {
    const app: any = buildApp({ isBillingEnabled: true });

    const primary: Reply = await request(
      app,
      PRIMARY_HOST,
      "/unreserved-path-for-host-detection",
    );
    expect(primary.status).toBe(404);

    const custom: Reply = await request(
      app,
      CUSTOM_DOMAIN,
      "/unreserved-path-for-host-detection",
    );
    expect(custom.status).toBe(200);
    expect(custom.body).toContain("Status Page SPA");
  });
});

describe("the replica above still matches the real Frontend/Index.ts", () => {
  const FRONTEND: string = stripComments(
    readSource(APP_DIR, "FeatureSet", "Frontend", "Index.ts"),
  );

  test("both fallbacks are registered, custom-domain first", () => {
    const custom: number = FRONTEND.indexOf("registerCustomDomainFallback()");
    const dashboard: number = FRONTEND.indexOf(
      "registerDashboardFallbackForPrimaryHost()",
    );

    expect(custom).toBeGreaterThan(-1);
    expect(dashboard).toBeGreaterThan(-1);
    expect(custom).toBeLessThan(dashboard);
  });

  test("the custom-domain fallback consults the status-page list and is not billing gated", () => {
    const body: string = FRONTEND.slice(
      FRONTEND.indexOf("const registerCustomDomainFallback"),
      FRONTEND.indexOf("const registerDashboardFallbackForPrimaryHost"),
    );

    expect(body.length).toBeGreaterThan(100);
    expect(body).toContain("shouldSkipStatusPageDomainFallbackRoute(req.path)");
    expect(body).not.toContain("IsBillingEnabled");
  });

  test("the dashboard fallback consults the dashboard list and IS billing gated", () => {
    const start: number = FRONTEND.indexOf(
      "const registerDashboardFallbackForPrimaryHost",
    );
    const body: string = FRONTEND.slice(start, start + 900);

    expect(body).toContain("shouldSkipDashboardFallbackRoute(req.path)");
    expect(body).toContain("IsBillingEnabled");
  });

  test("both fallbacks are GET catch-alls on the shared express app", () => {
    expect(FRONTEND).toContain('app.get(\n    "*"');
  });

  test("the predicates the replica imports are the ones Frontend actually calls", () => {
    expect(FRONTEND).toContain('from "./RouteReservations"');
    expect(FRONTEND).toContain("shouldSkipDashboardFallbackRoute");
    expect(FRONTEND).toContain("shouldSkipStatusPageDomainFallbackRoute");
  });

  test("PRIMARY_HOSTS here matches getPrimaryHosts in the real source", () => {
    const start: number = FRONTEND.indexOf("const getPrimaryHosts");
    const body: string = FRONTEND.slice(start, start + 500);

    expect(body).toContain('process.env["HOST"]');
    expect(body).toContain('"localhost"');
    expect(body).toContain('"ingress"');
    expect(PRIMARY_HOSTS.has("localhost")).toBe(true);
    expect(PRIMARY_HOSTS.has("ingress")).toBe(true);
  });

  test("hostname normalisation still strips the port and lowercases", () => {
    const start: number = FRONTEND.indexOf("const normalizeHostname");
    const body: string = FRONTEND.slice(start, start + 400);

    expect(body).toContain('host.split(":")');
    expect(body).toContain("toLowerCase()");
  });
});
