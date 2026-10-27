import Express from "../../../Server/Utils/Express";
import ExpressRouterGate from "../../../Server/Utils/ExpressRouterGate";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
/*
 * Express 4's own Layer: every route and mount a path is tried against
 * (express ships no types for it).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const expressLayer: unknown = require("express/lib/router/layer");

/*
 * Express hands a request on to the next router with setImmediate, and
 * Common's jest environment (jsdom) does not expose it: lend it Node's own,
 * as MultipartFormData.test.ts does, so both apps below route as they do in
 * production.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * ExpressRouterGate passes a request straight by a router none of whose
 * routes can match the request's first path segment. Express 4 would set
 * up the router's dispatch for the request, read its URL again and try it
 * against every route pattern of the router before handing it on; with the
 * App's ~700 routers, most of them at /api, that was about 0.75 ms of CPU
 * for each API request.
 *
 * These hold:
 *
 *  - the segments a route path and a request URL start with, read as
 *    Express matches them (case, encoding, query strings, the URLs Express
 *    parses another way);
 *  - which routers can be gated: those made only of routes with a plain
 *    first segment;
 *  - EVERY request of a long list - each route of a model API router, each
 *    method, case and slash variant, encoded and malformed paths, query
 *    strings, absolute URLs, OPTIONS and HEAD, parameters with router.param
 *    callbacks, next("route"), next("router") and errors, nested routers,
 *    mergeParams, case-sensitive and strict routers, middleware and
 *    pattern routes - gets exactly the same answer (status, Allow and
 *    content type, and what the handler saw: params, baseUrl, originalUrl,
 *    url, route path) from an app of gated routers as from the same app of
 *    Express's own;
 *  - a route added after the first request is reached;
 *  - Express.getRouter() makes gated routers;
 *  - a request past hundreds of routers is tried against the routes of its
 *    own router only, and takes several times less time.
 */

type Method = "get" | "post" | "put" | "delete" | "patch";

interface Answer {
  status: number;
  allow: string | undefined;
  contentType: string | undefined;
  body: string;
}

// What a handler saw, as it answers.
function answer(label: string): express.RequestHandler {
  return (req: express.Request, res: express.Response): void => {
    res.json({
      handler: label,
      params: req.params,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      url: req.url,
      route: req.route?.path,
      method: req.method,
    });
  };
}

// A model's API router, as BaseAPI builds it.
function modelRouter(
  make: () => express.Router,
  path: string,
  label: string,
): express.Router {
  const router: express.Router = make();
  const routes: Array<[Method, string]> = [
    ["post", path],
    ["post", `${path}/get-list`],
    ["get", `${path}/get-list`],
    ["post", `${path}/count`],
    ["post", `${path}/:id/get-item`],
    ["get", `${path}/:id/get-item`],
    ["put", `${path}/:id`],
    ["post", `${path}/:id/update-item`],
    ["delete", `${path}/:id`],
    ["post", `${path}/:id/delete-item`],
  ];

  for (const [method, routePath] of routes) {
    router[method](routePath, answer(`${label} ${method} ${routePath}`));
  }

  return router;
}

const MODEL_PATHS: Array<string> = [
  "/monitor",
  "/monitor-status",
  "/incident",
  "/incident-state-timeline",
  "/Status-Page",
  "/alert2",
  "/sw.js",
  "/team_member",
  "/a~b",
  "/x",
];

// One app: the routers OneUptime mounts, made by `make`.
function buildApp(make: () => express.Router): express.Application {
  const app: express.Application = express();

  for (const path of MODEL_PATHS) {
    app.use("/api", modelRouter(make, path, `model ${path}`));
  }

  // A router with a middleware of its own: it sees every request.
  const withMiddleware: express.Router = make();
  withMiddleware.use((req: express.Request, _res: express.Response, next) => {
    (req as unknown as { sawMiddleware: boolean }).sawMiddleware = true;
    next();
  });
  withMiddleware.get("/middleware/seen", answer("middleware seen"));
  app.use("/api", withMiddleware);

  // A route whose first segment is a parameter.
  const parameterFirst: express.Router = make();
  parameterFirst.get("/:projectId/settings", answer("parameter first"));
  app.use("/api", parameterFirst);

  // Patterns and regular expressions in the first segment.
  const patterns: express.Router = make();
  patterns.get("/file*", answer("file wildcard"));
  patterns.get("/opt(ional)?", answer("optional group"));
  patterns.get(/^\/regex-(\d+)$/, answer("regular expression"));
  patterns.get(["/array-one", "/array-two"], answer("array of paths"));
  patterns.get("/plus+", answer("plus"));
  app.use("/api", patterns);

  // router.param callbacks, next("route"), next("router") and errors.
  const flow: express.Router = make();
  flow.param("thing", (req: express.Request, _res, next, value: string) => {
    (req as unknown as { thing: string }).thing = value.toUpperCase();
    next();
  });
  flow.get(
    "/flow/:thing",
    (req: express.Request, _res: express.Response, next) => {
      if (req.params["thing"] === "skip") {
        return next("route");
      }

      if (req.params["thing"] === "leave") {
        return next("router");
      }

      if (req.params["thing"] === "fail") {
        return next(new Error("flow failed"));
      }

      return next();
    },
    (req: express.Request, res: express.Response) => {
      res.json({
        handler: "flow",
        thing: (req as unknown as { thing: string }).thing,
        params: req.params,
      });
    },
  );
  flow.get("/flow/:thing", answer("flow second route"));
  flow
    .route("/chained")
    .get(answer("chained get"))
    .post(answer("chained post"));
  flow.all("/everything", answer("all methods"));
  app.use("/api", flow);

  // A router mounted under another, on a path with a parameter.
  const inner: express.Router = make();
  inner.get("/inner/:id", answer("inner"));
  const outer: express.Router = express.Router({ mergeParams: true });
  outer.use("/nested/:tenant", inner);
  app.use("/api", outer);

  const merged: express.Router = express.Router({ mergeParams: true });
  const mergedInner: express.Router = make();
  mergedInner.get("/merged/:id", answer("merged inner"));
  merged.use("/", mergedInner);
  app.use("/api/:tenant", merged);

  // Case-sensitive and strict routers.
  const sensitive: express.Router = express.Router({ caseSensitive: true });
  sensitive.get("/Sensitive/path", answer("case sensitive"));
  app.use("/api", make === plainRouter ? sensitive : gateOf(sensitive));

  const strict: express.Router = express.Router({ strict: true });
  strict.get("/strict/path/", answer("strict"));
  app.use("/api", make === plainRouter ? strict : gateOf(strict));

  // Routers at other mounts, and the App's other prefixes.
  app.use("/identity", modelRouter(make, "/login", "identity"));
  app.use(modelRouter(make, "/otlp", "otlp"));

  // What answers when nothing matches, and errors.
  app.use((req: express.Request, res: express.Response) => {
    res.status(404).json({
      notFound: true,
      url: req.url,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      sawMiddleware: Boolean(
        (req as unknown as { sawMiddleware?: boolean }).sawMiddleware,
      ),
    });
  });
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({
        error: err.message,
        originalUrl: req.originalUrl,
        sawMiddleware: Boolean(
          (req as unknown as { sawMiddleware?: boolean }).sawMiddleware,
        ),
      });
    },
  );

  return app;
}

function plainRouter(): express.Router {
  return express.Router();
}

function gatedRouter(): express.Router {
  return ExpressRouterGate.gate(express.Router());
}

function gateOf(router: express.Router): express.Router {
  return ExpressRouterGate.gate(router);
}

// Every request the two apps are held to.
function requestsToCompare(): Array<{ method: string; path: string }> {
  const paths: Array<string> = [];

  for (const model of MODEL_PATHS) {
    for (const suffix of [
      "",
      "/",
      "/get-list",
      "/get-list/",
      "/count",
      "/abc-123/get-item",
      "/abc-123",
      "/abc-123/update-item",
      "/abc-123/delete-item",
      "/abc-123/unknown",
      "/get-list?limit=10&skip=0",
      "/%61bc/get-item",
      "/abc%2F123/get-item",
      "/%E0%A4%A/get-item",
    ]) {
      paths.push(`/api${model}${suffix}`);
      paths.push(`/api${model.toUpperCase()}${suffix}`);
    }

    // The first segment encoded, cut short or run on.
    paths.push(`/api/%6D${model.slice(2)}/get-list`);
    paths.push(`/api${model.slice(0, -1)}/get-list`);
    paths.push(`/api${model}s/get-list`);
    paths.push(`/api${model}.json/get-list`);
  }

  paths.push(
    "/api",
    "/api/",
    "/api//monitor/get-list",
    "/api/monitor//get-list",
    "/api/nothing-here",
    "/api/nothing-here/get-list",
    "/api/middleware/seen",
    "/api/middleware/unseen",
    "/api/project-42/settings",
    "/api/monitor/settings",
    "/api/filename.txt",
    "/api/file",
    "/api/opt",
    "/api/optional",
    "/api/regex-42",
    "/api/regex-x",
    "/api/array-one",
    "/api/array-two",
    "/api/array-three",
    "/api/plus",
    "/api/plusss",
    "/api/flow/value",
    "/api/flow/skip",
    "/api/flow/leave",
    "/api/flow/fail",
    "/api/flow/%E0%A4%A",
    "/api/chained",
    "/api/everything",
    "/api/nested/t1/inner/i1",
    "/api/nested/t1/inner",
    "/api/t1/merged/i1",
    "/api/T1/MERGED/I1",
    "/api/Sensitive/path",
    "/api/sensitive/path",
    "/api/strict/path/",
    "/api/strict/path",
    "/identity/login",
    "/identity/login/get-list",
    "/identity/monitor/get-list",
    "/otlp",
    "/otlp/get-list",
    "/api/otlp/get-list",
    "/",
    "/nothing",
    "http://example.com/api/monitor/get-list",
    "http://example.com/api/nothing-here",
    "/api/monitor/get-list#fragment",
    "/api/nothing-here#fragment",
    "/api/monitor\t/get-list",
    "/api/mon itor/get-list",
  );

  const requests: Array<{ method: string; path: string }> = [];

  for (const path of paths) {
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ]) {
      requests.push({ method, path });
    }
  }

  return requests;
}

function send(
  port: number,
  agent: http.Agent,
  method: string,
  path: string,
): Promise<Answer> {
  return new Promise((resolve: (answer: Answer) => void, reject) => {
    let request: http.ClientRequest;

    try {
      request = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: path,
          method: method,
          agent: agent,
          insecureHTTPParser: true,
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
              allow: response.headers["allow"] as string | undefined,
              contentType: response.headers["content-type"] as
                | string
                | undefined,
              body: body,
            });
          });
        },
      );
    } catch (error) {
      // A path Node itself refuses to send: the same for both apps.
      resolve({
        status: -1,
        allow: undefined,
        contentType: undefined,
        body: (error as Error).message,
      });
      return;
    }

    request.on("error", reject);
    request.end();
  });
}

async function listen(app: express.Application): Promise<http.Server> {
  const server: http.Server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

describe("ExpressRouterGate", () => {
  describe("the first segment of a route path", () => {
    test.each([
      ["/monitor", "monitor"],
      ["/monitor/get-list", "monitor"],
      ["/Monitor-Status/:id/get-item", "monitor-status"],
      ["/sw.js", "sw.js"],
      ["/team_member/x", "team_member"],
      ["/a~b", "a~b"],
      ["/alert2/count", "alert2"],
    ])("%s starts with %s", (path: string, segment: string) => {
      expect(ExpressRouterGate.getRouteFirstSegment(path)).toBe(segment);
    });

    test.each([
      ["/"],
      [""],
      ["monitor"],
      ["//monitor"],
      ["/:id"],
      ["/:id/get-item"],
      ["/file*"],
      ["/*"],
      ["*"],
      ["/opt(ional)?"],
      ["/plus+"],
      ["/a.:format"],
      ["/x\\.y"],
      ["/a b"],
      ["/café"],
    ])("%s has no plain first segment", (path: string) => {
      expect(ExpressRouterGate.getRouteFirstSegment(path)).toBe(null);
    });

    test("neither has a pattern nor a list of paths", () => {
      expect(ExpressRouterGate.getRouteFirstSegment(/^\/monitor/)).toBe(null);
      expect(ExpressRouterGate.getRouteFirstSegment(["/a", "/b"])).toBe(null);
      expect(ExpressRouterGate.getRouteFirstSegment(undefined)).toBe(null);
    });
  });

  describe("the first segment of a request URL", () => {
    test.each([
      ["/monitor/get-list", "monitor"],
      ["/MONITOR/get-list", "monitor"],
      ["/monitor", "monitor"],
      ["/monitor/", "monitor"],
      ["/monitor?limit=10", "monitor"],
      ["/monitor/get-list?x=/y/z", "monitor"],
      ["/?a=b", ""],
      ["/", ""],
      ["//monitor", ""],
      ["/%6Donitor/get-list", "%6donitor"],
    ])("%s starts with %s", (url: string, segment: string) => {
      expect(ExpressRouterGate.getRequestFirstSegment(url)).toBe(segment);
    });

    test.each([
      ["http://example.com/monitor"],
      ["monitor"],
      [""],
      ["/monitor get"],
      ["/monitor\tx"],
      ["/monitor#x"],
      ["/mon itor"],
      ["/mon﻿itor"],
    ])("%s is left to Express", (url: string) => {
      expect(ExpressRouterGate.getRequestFirstSegment(url)).toBe(null);
    });
  });

  describe("which routers know their first segments", () => {
    test("a router of plain routes knows each", () => {
      const router: express.Router = modelRouter(
        plainRouter,
        "/monitor",
        "m",
      );
      router.get("/Other/x", answer("other"));

      expect(
        Array.from(
          ExpressRouterGate.getFirstSegments(
            (router as unknown as { stack: Array<never> }).stack,
          ) || [],
        ).sort(),
      ).toEqual(["monitor", "other"]);
    });

    test.each([
      [
        "a middleware",
        (router: express.Router): void => {
          router.use(answer("middleware"));
        },
      ],
      [
        "a middleware on a path",
        (router: express.Router): void => {
          router.use("/monitor", answer("middleware"));
        },
      ],
      [
        "a parameter first",
        (router: express.Router): void => {
          router.get("/:id", answer("parameter"));
        },
      ],
      [
        "a regular expression",
        (router: express.Router): void => {
          router.get(/x/, answer("pattern"));
        },
      ],
      [
        "a list of paths",
        (router: express.Router): void => {
          router.get(["/a", "/b"], answer("list"));
        },
      ],
    ])(
      "a router with %s cannot say",
      (_label: string, add: (router: express.Router) => void) => {
        const router: express.Router = modelRouter(
          plainRouter,
          "/monitor",
          "m",
        );
        add(router);

        expect(
          ExpressRouterGate.getFirstSegments(
            (router as unknown as { stack: Array<never> }).stack,
          ),
        ).toBe(null);
      },
    );
  });

  describe("an app of gated routers answers every request as Express's own", () => {
    let plain: http.Server;
    let gated: http.Server;
    let agent: http.Agent;

    beforeAll(async () => {
      plain = await listen(buildApp(plainRouter));
      gated = await listen(buildApp(gatedRouter));
      agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
    });

    afterAll(async () => {
      agent.destroy();
      await new Promise<void>((resolve: () => void) => {
        plain.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve: () => void) => {
        gated.close(() => {
          resolve();
        });
      });
    });

    test("for every request of the list", async () => {
      const requests: Array<{ method: string; path: string }> =
        requestsToCompare();
      const plainPort: number = (plain.address() as AddressInfo).port;
      const gatedPort: number = (gated.address() as AddressInfo).port;
      const differing: Array<string> = [];
      const statuses: Set<number> = new Set();
      const handlers: Set<string> = new Set();

      for (let start: number = 0; start < requests.length; start += 32) {
        const batch: Array<{ method: string; path: string }> = requests.slice(
          start,
          start + 32,
        );

        await Promise.all(
          batch.map(
            async (request: { method: string; path: string }): Promise<void> => {
              const fromPlain: Answer = await send(
                plainPort,
                agent,
                request.method,
                request.path,
              );
              const fromGated: Answer = await send(
                gatedPort,
                agent,
                request.method,
                request.path,
              );

              statuses.add(fromPlain.status);

              try {
                handlers.add(
                  String(
                    (JSON.parse(fromPlain.body) as { handler?: string })
                      .handler,
                  ),
                );
              } catch {
                // Not JSON: HEAD, an OPTIONS answer, Express's own errors.
              }

              if (JSON.stringify(fromGated) !== JSON.stringify(fromPlain)) {
                differing.push(
                  `${request.method} ${request.path}: ${JSON.stringify(fromGated)} instead of ${JSON.stringify(fromPlain)}`,
                );
              }
            },
          ),
        );
      }

      expect(differing.slice(0, 5)).toEqual([]);
      expect(requests.length).toBeGreaterThan(2000);
      // The list reaches routes, 404s, OPTIONS answers and errors.
      expect(Array.from(statuses).sort()).toEqual(
        expect.arrayContaining([200, 404, 500]),
      );
      expect(handlers.size).toBeGreaterThan(60);
    });
  });

  test("a route added after the first request is reached", async () => {
    const app: express.Application = express();
    const router: express.Router = gatedRouter();
    router.get("/early", answer("early"));
    app.use("/api", router);
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).send("none");
    });

    const server: http.Server = await listen(app);
    const agent: http.Agent = new http.Agent({ keepAlive: false });
    const port: number = (server.address() as AddressInfo).port;

    try {
      expect((await send(port, agent, "GET", "/api/early")).status).toBe(200);
      expect((await send(port, agent, "GET", "/api/late")).status).toBe(404);

      router.get("/late", answer("late"));

      const late: Answer = await send(port, agent, "GET", "/api/late");

      expect(late.status).toBe(200);
      expect(JSON.parse(late.body).handler).toBe("late");
    } finally {
      agent.destroy();
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  test("Express.getRouter() makes gated routers, once", () => {
    const router: express.Router = Express.getRouter();

    expect(ExpressRouterGate.isGated(router)).toBe(true);
    expect(ExpressRouterGate.isGated(express.Router())).toBe(false);

    const handle: unknown = (router as unknown as { handle: unknown }).handle;

    ExpressRouterGate.gate(router);
    expect((router as unknown as { handle: unknown }).handle).toBe(handle);
  });

  describe("a request past hundreds of routers", () => {
    const ROUTERS: number = 400;

    function bigApp(make: () => express.Router): express.Application {
      const app: express.Application = express();

      for (let index: number = 0; index < ROUTERS; index++) {
        app.use("/api", modelRouter(make, `/model-${index}`, `model ${index}`));
      }

      return app;
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("is tried against its own router's routes, not every route of every router", async () => {
      /*
       * Every route and mount Express tries a path against is a Layer
       * whose match() runs the layer's pattern: count those calls for one
       * request to the last router.
       */
      const layerPrototype: { match: (path: string) => boolean } = (
        expressLayer as unknown as {
          prototype: { match: (path: string) => boolean };
        }
      ).prototype;
      const tries: Record<string, number> = {};

      for (const [label, make] of [
        ["plain", plainRouter],
        ["gated", gatedRouter],
      ] as Array<[string, () => express.Router]>) {
        const server: http.Server = await listen(bigApp(make));
        const agent: http.Agent = new http.Agent({ keepAlive: true });
        const port: number = (server.address() as AddressInfo).port;
        const match: (path: string) => boolean = layerPrototype.match;
        let counted: number = 0;

        layerPrototype.match = function (
          this: unknown,
          path: string,
        ): boolean {
          counted++;
          return match.call(this, path);
        };

        let reached: Answer;

        try {
          reached = await send(
            port,
            agent,
            "POST",
            `/api/model-${ROUTERS - 1}/get-list`,
          );
        } finally {
          layerPrototype.match = match;
        }

        tries[label] = counted;

        expect(reached.status).toBe(200);
        expect(JSON.parse(reached.body).handler).toBe(
          `model ${ROUTERS - 1} post /model-${ROUTERS - 1}/get-list`,
        );

        agent.destroy();
        await new Promise<void>((resolve: () => void) => {
          server.close(() => {
            resolve();
          });
        });
      }

      // Express's own: every mount, and the ten routes of every router.
      expect(tries["plain"]).toBeGreaterThanOrEqual((ROUTERS - 1) * 11);
      // Gated: every mount, and the routes of the router it is for.
      expect(tries["gated"]).toBeLessThan(ROUTERS + 20);
    });

    test("takes several times less time", async () => {
      const servers: Array<http.Server> = [];
      const timings: Record<string, number> = {};

      try {
        for (const [label, make] of [
          ["plain", plainRouter],
          ["gated", gatedRouter],
        ] as Array<[string, () => express.Router]>) {
          const server: http.Server = await listen(bigApp(make));
          servers.push(server);
          const agent: http.Agent = new http.Agent({
            keepAlive: true,
            maxSockets: 4,
          });
          const port: number = (server.address() as AddressInfo).port;

          // A batch of requests to the last router, timed as one run.
          const batch: () => Promise<number> = async (): Promise<number> => {
            const started: number = performance.now();

            for (let round: number = 0; round < 25; round++) {
              await Promise.all(
                [0, 1, 2, 3].map((): Promise<Answer> => {
                  return send(
                    port,
                    agent,
                    "POST",
                    `/api/model-${ROUTERS - 1}/count`,
                  );
                }),
              );
            }

            return performance.now() - started;
          };

          await batch();

          let fastest: number = Infinity;

          for (let attempt: number = 0; attempt < 3; attempt++) {
            fastest = Math.min(fastest, await batch());
          }

          timings[label] = fastest;
          agent.destroy();
        }
      } finally {
        for (const server of servers) {
          await new Promise<void>((resolve: () => void) => {
            server.close(() => {
              resolve();
            });
          });
        }
      }

      // Measured about four times faster; twice leaves room for a busy runner.
      expect(timings["gated"]! * 2).toBeLessThan(timings["plain"]!);
    });

    test("the gate's own check costs well under a microsecond a router", () => {
      const router: express.Router = modelRouter(gatedRouter, "/monitor", "m");
      const request: express.Request = {
        url: "/incident/get-list",
      } as express.Request;
      const checks: number = 200000;

      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          let passed: number = 0;

          for (let index: number = 0; index < checks; index++) {
            if (
              ExpressRouterGate.passesBy(
                router as unknown as Parameters<
                  typeof ExpressRouterGate.passesBy
                >[0],
                request,
              )
            ) {
              passed++;
            }
          }

          return passed;
        },
        limitInMs: 0,
      });

      expect(timed.result).toBe(checks);
      // 200,000 checks in well under 200 ms: under a microsecond each.
      expect(timed.inMs).toBeLessThan(200);
    });
  });
});
