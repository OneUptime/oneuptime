import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import http, { IncomingMessage, Server, createServer } from "http";
import { AddressInfo } from "net";
import { createExpressApp } from "../../../Server/Utils/Express";
import mountVendorAssets, {
  VendorAssetsPath,
  VendorAssetsRoute,
  getMermaidDistPath,
} from "../../../Server/Utils/VendorAssets";

/*
 * These run against a real Express app on a real socket rather than against a
 * mocked app.use(). The bug this whole change exists to fix is a URL that
 * resolves to nothing at runtime - a test that only checks which middleware
 * got registered would pass with the files missing, the route mistyped, or a
 * catch-all mounted ahead of it, which is every way this can actually break.
 *
 * Requests go through node:http rather than fetch because Common's Jest
 * environment is jsdom, which supplies no fetch.
 */

interface AssetResponse {
  status: number;
  contentType: string;
  cacheControl: string;
  body: Buffer;
  text: string;
}

const INDEX_PAGE: string = "<html>index</html>";

describe("vendored browser assets", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app: ReturnType<typeof createExpressApp> = createExpressApp();

    mountVendorAssets(app);

    /*
     * The catch-all every frontend service registers, so the tests below prove
     * the asset mount answers first rather than falling through to an index
     * page - a 200 full of HTML is the failure mode that looks like success.
     */
    app.get("/*", (_request: unknown, response: { send: GenericSend }) => {
      return response.send(INDEX_PAGE);
    });

    server = createServer(app);

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

  type GenericSend = (body: string) => void;

  type GetAsset = (urlPath: string) => Promise<AssetResponse>;

  const getAsset: GetAsset = (urlPath: string): Promise<AssetResponse> => {
    return new Promise<AssetResponse>(
      (
        resolve: (value: AssetResponse) => void,
        reject: (reason: Error) => void,
      ) => {
        const request: http.ClientRequest = http.get(
          { host: "127.0.0.1", port, path: urlPath },
          (message: IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            message.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });

            message.on("end", () => {
              const body: Buffer = Buffer.concat(chunks);

              resolve({
                status: message.statusCode || 0,
                contentType: String(message.headers["content-type"] || ""),
                cacheControl: String(message.headers["cache-control"] || ""),
                body,
                text: body.toString("utf8"),
              });
            });
          },
        );

        request.on("error", reject);
      },
    );
  };

  describe("mount point", () => {
    test("is the path the views hard-code", () => {
      /*
       * Changing this constant without changing every .ejs that references it
       * breaks every server-rendered page at once, so it is pinned literally.
       */
      expect(VendorAssetsRoute).toBe("/oneuptime-assets");
    });

    test("resolves to a directory that ships with Common", () => {
      expect(fs.existsSync(VendorAssetsPath)).toBe(true);
      expect(fs.statSync(VendorAssetsPath).isDirectory()).toBe(true);
      expect(
        VendorAssetsPath.endsWith(path.join("Server", "Static", "Vendor")),
      ).toBe(true);
    });
  });

  describe("tailwind", () => {
    test("serves the Play CDN build", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
      );

      expect(asset.status).toBe(200);
      expect(asset.contentType).toContain("javascript");
      expect(asset.body.byteLength).toBeGreaterThan(100000);
    });

    test("is byte-identical to the copy each frontend already ships", () => {
      /*
       * The five SPAs vendored this file long before the server-rendered pages
       * did. Two builds of Tailwind on one deployment would mean a class that
       * renders in the dashboard and silently does nothing in the docs.
       */
      const vendored: Buffer = fs.readFileSync(
        path.join(VendorAssetsPath, "tailwind", "tailwind-3.4.5.js"),
      );

      const appRoot: string = path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
      );

      let compared: number = 0;

      for (const service of [
        "Dashboard",
        "Accounts",
        "AdminDashboard",
        "StatusPage",
        "PublicDashboard",
      ]) {
        const frontendCopy: string = path.join(
          appRoot,
          "FeatureSet",
          service,
          "public",
          "assets",
          "js",
          "tailwind-3.4.5.js",
        );

        if (!fs.existsSync(frontendCopy)) {
          continue;
        }

        compared++;
        expect([
          service,
          fs.readFileSync(frontendCopy).equals(vendored),
        ]).toEqual([service, true]);
      }

      expect(compared).toBe(5);
    });
  });

  describe("highlight.js", () => {
    test("serves the core bundle", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/highlight/highlight.min.js",
      );

      expect(asset.status).toBe(200);
      expect(asset.contentType).toContain("javascript");
      /* The global the view scripts call highlightAll() on. */
      expect(asset.text).toContain("hljs");
    });

    for (const style of ["vs2015", "github-dark"]) {
      test(`serves the ${style} theme`, async () => {
        const asset: AssetResponse = await getAsset(
          `/oneuptime-assets/highlight/styles/${style}.min.css`,
        );

        expect(asset.status).toBe(200);
        expect(asset.contentType).toContain("text/css");
        expect(asset.text).toContain(".hljs");
      });
    }

    test("ships every grammar the API reference loads eagerly", async () => {
      /*
       * These are <script> tags in the API reference head, not a lazy map, so a
       * missing file is a 404 on every page of the reference.
       */
      const eager: Array<string> = [
        "python",
        "go",
        "java",
        "csharp",
        "php",
        "ruby",
        "rust",
        "powershell",
        "bash",
        "json",
        "javascript",
        "typescript",
      ];

      for (const language of eager) {
        const asset: AssetResponse = await getAsset(
          `/oneuptime-assets/highlight/languages/${language}.min.js`,
        );

        expect([language, asset.status]).toEqual([language, 200]);
      }
    });

    test("does not ship an hcl grammar, because highlight.js has none", () => {
      /*
       * Guards the langMap edit in the docs head: re-adding 'hcl' would put
       * back a request that 404s. If highlight.js ever ships one, this test is
       * the place that says so.
       */
      expect(
        fs.existsSync(
          path.join(VendorAssetsPath, "highlight", "languages", "hcl.min.js"),
        ),
      ).toBe(false);
    });
  });

  describe("fonts", () => {
    test("serves Inter as a woff2", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/fonts/InterVariable.woff2",
      );

      expect(asset.status).toBe(200);
      expect(asset.contentType).toContain("font/woff2");
      expect(asset.body.byteLength).toBeGreaterThan(1000);
    });

    test("is byte-identical to the copies the docs and reference already ship", () => {
      const vendored: Buffer = fs.readFileSync(
        path.join(VendorAssetsPath, "fonts", "InterVariable.woff2"),
      );

      const appRoot: string = path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
      );

      let compared: number = 0;

      for (const service of ["Docs", "APIReference"]) {
        const copy: string = path.join(
          appRoot,
          "FeatureSet",
          service,
          "Static",
          "fonts",
          "InterVariable.woff2",
        );

        if (!fs.existsSync(copy)) {
          continue;
        }

        compared++;
        expect([service, fs.readFileSync(copy).equals(vendored)]).toEqual([
          service,
          true,
        ]);
      }

      expect(compared).toBe(2);
    });
  });

  describe("mermaid", () => {
    test("resolves out of node_modules rather than a committed copy", () => {
      const mermaidDistPath: string | null = getMermaidDistPath();

      expect(mermaidDistPath).not.toBeNull();
      expect(fs.existsSync(mermaidDistPath as string)).toBe(true);
      expect(
        fs.existsSync(
          path.join(VendorAssetsPath, "mermaid", "mermaid.esm.min.mjs"),
        ),
      ).toBe(false);
    });

    test("serves the ES module entrypoint the docs import", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/mermaid/mermaid.esm.min.mjs",
      );

      expect(asset.status).toBe(200);
      expect(asset.text).toContain("import");
    });

    test("serves the lazily-imported diagram chunks the entrypoint pulls in", async () => {
      /*
       * The entrypoint is 26 KB; every diagram type it can draw is a separate
       * import resolved relative to it. Serving only the entrypoint would have
       * looked fine right up until a page contained an actual diagram.
       */
      const chunkDirectory: string = path.join(
        getMermaidDistPath() as string,
        "chunks",
        "mermaid.esm.min",
      );

      expect(fs.existsSync(chunkDirectory)).toBe(true);

      const chunk: string | undefined = fs
        .readdirSync(chunkDirectory)
        .find((file: string): boolean => {
          return file.endsWith(".mjs");
        });

      expect(chunk).toBeDefined();

      const asset: AssetResponse = await getAsset(
        `/oneuptime-assets/mermaid/chunks/mermaid.esm.min/${chunk}`,
      );

      expect(asset.status).toBe(200);
    });

    test("serves the UMD bundle the blog loads", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/mermaid/mermaid.min.js",
      );

      expect(asset.status).toBe(200);
      expect(asset.contentType).toContain("javascript");
    });

    test("does not serve the type definitions, sourcemaps or docs beside it", async () => {
      /*
       * dist/ is 65 MB of build outputs for every module format mermaid
       * publishes. The browser asks for two of them; the rest falls through to
       * the catch-all rather than being handed out.
       */
      for (const notCode of [
        "mermaid.d.ts",
        "mermaid.min.js.map",
        "config.type.d.ts",
      ]) {
        const asset: AssetResponse = await getAsset(
          `/oneuptime-assets/mermaid/${notCode}`,
        );

        expect([notCode, asset.text]).toEqual([notCode, INDEX_PAGE]);
      }
    });
  });

  describe("caching", () => {
    test("marks assets immutable enough to survive a page-to-page navigation", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
      );

      expect(asset.cacheControl).toContain("max-age=31536000");
    });
  });

  describe("directory listing", () => {
    test("is off", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/highlight/languages/",
      );

      /* Falls through to the catch-all instead of enumerating the directory. */
      expect(asset.text).toBe(INDEX_PAGE);
    });
  });

  describe("a path that does not exist", () => {
    test("falls through rather than erroring", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/highlight/languages/no-such-grammar.min.js",
      );

      expect(asset.text).toBe(INDEX_PAGE);
    });
  });
});

describe("every service mounts the vendored assets", () => {
  /*
   * Read rather than executed: importing StartServer creates the app, wires
   * the common API and registers a shutdown handler. What matters here is only
   * that the mount happens, and that it happens early - a frontend service
   * answers "/*" with its index page, so a mount registered after that would
   * hand the browser HTML with a 200 for every stylesheet it asked for. That
   * is worse than a 404, because nothing logs it.
   */
  const startServerSource: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "Server",
      "Utils",
      "StartServer.ts",
    ),
    "utf8",
  );

  test("imports the mount from VendorAssets", () => {
    expect(startServerSource).toContain(
      'import mountVendorAssets from "./VendorAssets";',
    );
  });

  test("calls it during init", () => {
    expect(startServerSource).toContain("mountVendorAssets(app);");
  });

  test("calls it before the frontend static mount and the catch-all", () => {
    const mountIndex: number = startServerSource.indexOf(
      "mountVendorAssets(app);",
    );
    const frontendStaticIndex: number = startServerSource.indexOf(
      'ExpressStatic("/usr/src/app/public")',
    );
    const catchAllIndex: number = startServerSource.indexOf(
      '["/*", `/${appName}/*`]',
    );

    expect(mountIndex).toBeGreaterThan(-1);
    expect(frontendStaticIndex).toBeGreaterThan(-1);
    expect(catchAllIndex).toBeGreaterThan(-1);

    expect(mountIndex).toBeLessThan(frontendStaticIndex);
    expect(mountIndex).toBeLessThan(catchAllIndex);
  });
});
