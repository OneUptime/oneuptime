import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import {
  FRONTEND_STATIC_FOLDERS,
  getFrontendStaticFileRoutes,
  isFrontendStaticFilePath,
} from "../../FeatureSet/Frontend/RouteReservations";
import { APP_DIR, REPO_ROOT, readSource } from "./RouteReservationSource";

/*
 * A frontend's built files - the bundle under dist/, the assets under
 * assets/ - that are not on disk answer 404, never the frontend's page.
 *
 * A tab opened before a deploy asks for the content-hashed chunks of the
 * build it runs, which the new build no longer has. Answered with the page
 * at HTTP 200 (which nginx then marks cacheable for a year, as it does every
 * chunk), the browser got HTML for a script; answered 404, it is a file that
 * is gone - which the page's ChunkLoadRecovery moves onto the new version.
 * build.json, which says which build the server serves, is one of the
 * bundle's files and is served like them.
 *
 * Frontend/Index.ts cannot be imported (it boots half the server), so this
 * rebuilds registerFrontendApp's order with the real route helpers and the
 * same express the server resolves (Common's, as SpaFallbackBehaviour does),
 * and the last block pins the real source it stands in for.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const express: any = require(
  path.join(REPO_ROOT, "Common", "node_modules", "express"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

interface Reply {
  status: number;
  contentType: string;
  cacheControl: string;
  body: string;
}

let publicDirectory: string = "";

beforeAll(() => {
  publicDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-frontend-static-"),
  );
  fs.mkdirSync(path.join(publicDirectory, "dist"), { recursive: true });
  fs.mkdirSync(path.join(publicDirectory, "assets", "img"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(publicDirectory, "dist", "Index.js"),
    "import './chunk-NEWHASH1.js';\n",
  );
  fs.writeFileSync(
    path.join(publicDirectory, "dist", "chunk-NEWHASH1.js"),
    "export const x = 1;\n",
  );
  fs.writeFileSync(
    path.join(publicDirectory, "dist", "build.json"),
    JSON.stringify({ buildId: "14.0.90-b-0002" }),
  );
  fs.writeFileSync(
    path.join(publicDirectory, "assets", "img", "logo.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
  );
});

afterAll(() => {
  fs.rmSync(publicDirectory, { recursive: true, force: true });
});

// registerFrontendApp, in its order: static files, env.js, 404 for built files, the page.
function buildApp(routePrefix: string): any {
  const app: any = express();

  app.use(routePrefix, express.static(publicDirectory));

  app.get(`${routePrefix}/env.js`, (_req: any, res: any): void => {
    res.type("application/javascript").send("window.process = {};");
  });

  app.get(getFrontendStaticFileRoutes(routePrefix), (_req: any, res: any) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).type("text/plain").send("Not found");
  });

  app.get([routePrefix, `${routePrefix}/*`], (_req: any, res: any): void => {
    res
      .status(200)
      .type("html")
      .send("<!doctype html><title>Dashboard</title><div id=root></div>");
  });

  return app;
}

function request(app: any, requestPath: string): Promise<Reply> {
  return new Promise((resolve: (reply: Reply) => void): void => {
    const server: http.Server = app.listen(0, (): void => {
      const address: any = server.address();

      http
        .request(
          { port: address.port, path: requestPath, method: "GET" },
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
                cacheControl: String(res.headers["cache-control"] || ""),
                body: body,
              });
            });
          },
        )
        .end();
    });
  });
}

describe("the route helpers", () => {
  test("cover the bundle and the assets of a frontend", () => {
    expect(FRONTEND_STATIC_FOLDERS).toEqual(["dist", "assets"]);
    expect(getFrontendStaticFileRoutes("/dashboard")).toEqual([
      "/dashboard/dist/*",
      "/dashboard/assets/*",
    ]);
    expect(getFrontendStaticFileRoutes("/status-page")).toEqual([
      "/status-page/dist/*",
      "/status-page/assets/*",
    ]);
  });

  test.each<[string, boolean]>([
    ["/dashboard/dist/MonitorsRoutes-ABCDEFGH.js", true],
    ["/dashboard/dist/build.json", true],
    ["/dashboard/assets/img/logo.svg", true],
    ["/dashboard/monitors", false],
    ["/dashboard/distribution-lists", false],
    ["/dashboard/dist", false],
    ["/admin/dist/Index.js", false],
  ])("%s is a /dashboard built file: %p", (requestPath: string, expected) => {
    expect(isFrontendStaticFilePath("/dashboard", requestPath)).toBe(expected);
  });
});

describe("a frontend's built files, served", () => {
  const app: () => any = (): any => {
    return buildApp("/dashboard");
  };

  test("a chunk a deploy removed is a 404, never the page", async () => {
    const reply: Reply = await request(
      app(),
      "/dashboard/dist/MonitorsRoutes-OLDHASH1.js",
    );

    expect(reply.status).toBe(404);
    expect(reply.contentType).not.toContain("text/html");
    expect(reply.body).not.toContain("<div id=root>");
  });

  test("the 404 is never stored: on a rolling deploy the next server may have it", async () => {
    const reply: Reply = await request(
      app(),
      "/dashboard/dist/MonitorsRoutes-OLDHASH1.js",
    );

    expect(reply.cacheControl).toBe("no-store");
  });

  test("a missing asset is a 404 too", async () => {
    const reply: Reply = await request(app(), "/dashboard/assets/img/gone.png");

    expect(reply.status).toBe(404);
  });

  test("the files that are there are served as before", async () => {
    const entry: Reply = await request(app(), "/dashboard/dist/Index.js");
    const chunk: Reply = await request(
      app(),
      "/dashboard/dist/chunk-NEWHASH1.js",
    );
    const asset: Reply = await request(app(), "/dashboard/assets/img/logo.svg");

    expect([entry.status, chunk.status, asset.status]).toEqual([200, 200, 200]);
    expect(entry.contentType).toContain("javascript");
  });

  test("build.json is served from the bundle, as JSON naming the build", async () => {
    const reply: Reply = await request(app(), "/dashboard/dist/build.json");

    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("application/json");
    expect(JSON.parse(reply.body)).toEqual({ buildId: "14.0.90-b-0002" });
  });

  test("the frontend's pages are still the page, a path that only starts like a folder included", async () => {
    for (const pagePath of [
      "/dashboard/project/monitors",
      "/dashboard/distribution-lists",
    ]) {
      const reply: Reply = await request(app(), pagePath);

      expect([pagePath, reply.status, reply.body]).toEqual([
        pagePath,
        200,
        expect.stringContaining("<div id=root>"),
      ]);
    }
  });

  test("env.js is unaffected", async () => {
    const reply: Reply = await request(app(), "/dashboard/env.js");

    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("javascript");
  });
});

describe("the real registerFrontendApp", () => {
  const source: string = readSource(
    APP_DIR,
    "FeatureSet",
    "Frontend",
    "Index.ts",
  );

  const start: number = source.indexOf(
    "const registerFrontendApp: (frontendConfig: FrontendConfig) => void",
  );
  const end: number = source.indexOf("const isDashboardDomain", start);
  const body: string = source.slice(start, end);

  test("is where the replica above says it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  test("answers missing built files 404, after env.js and before the page", () => {
    const envAt: number = body.indexOf("/env.js`");
    const notFoundAt: number = body.indexOf(
      "getFrontendStaticFileRoutes(frontendConfig.routePrefix)",
    );
    const pageAt: number = body.indexOf(
      "[frontendConfig.routePrefix, `${frontendConfig.routePrefix}/*`]",
    );

    expect(envAt).toBeGreaterThan(-1);
    expect(notFoundAt).toBeGreaterThan(envAt);
    expect(pageAt).toBeGreaterThan(notFoundAt);

    const handler: string = body.slice(notFoundAt, pageAt);

    expect(handler).toContain('res.setHeader("Cache-Control", "no-store")');
    expect(handler).toContain('res.status(404).type("text/plain")');
    // Only for the frontend's own hosts, like every other route of it.
    expect(handler).toContain(
      "frontendConfig.primaryHostOnly && !isPrimaryHostRequest(req)",
    );
  });

  test("the standalone frontend servers answer the same way", () => {
    const standalone: string = readSource(
      REPO_ROOT,
      "Common",
      "Server",
      "Utils",
      "StartServer.ts",
    );

    expect(standalone).toContain(
      "[`/${appName}/dist/*`, `/${appName}/assets/*`]",
    );
    expect(standalone).toContain('res.status(404).send("Not found")');
  });
});
