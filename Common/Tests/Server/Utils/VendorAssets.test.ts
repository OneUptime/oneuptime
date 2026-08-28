import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import path from "path";
import http, { IncomingMessage, Server, createServer } from "http";
import { AddressInfo } from "net";
import { createExpressApp } from "../../../Server/Utils/Express";
import mountVendorAssets, {
  BrandAssetsPath,
  MountVendorAssetsFunction,
  OneUptimeLogoUrl,
  VendorAssetsPath,
  VendorAssetsRoute,
  getMermaidDistPath,
} from "../../../Server/Utils/VendorAssets";

type GenericSendBody = (body: string) => void;

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

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

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
    app.get("/*", (_request: unknown, response: { send: GenericSendBody }) => {
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

    test("is the only copy in the tree", () => {
      /*
       * Each of the five frontends used to commit its own byte-identical copy
       * of this 684 KB file. They now get it copied in at build time from the
       * one here, so a committed copy reappearing means someone has re-created
       * the drift - two builds of Tailwind on one deployment, where a class
       * renders in the dashboard and silently does nothing in the docs.
       *
       * Checked against git rather than the filesystem, because the build
       * output is expected to be sitting there in a working tree that has run
       * one; it is gitignored.
       */
      const tracked: string = childProcess
        .execFileSync("git", ["ls-files", "--", "*tailwind-3.4.5.js"], {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
        })
        .trim();

      expect(tracked.split("\n").filter(Boolean)).toEqual([
        "Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
      ]);
    });
  });

  describe("the frontend build's copy of tailwind", () => {
    /*
     * The SPAs keep loading it from their own origin - /dashboard/assets/js/...
     * - rather than through the shared mount. Their index.ejs is unchanged and
     * their URLs are unchanged; only where the bytes come from moved. Anything
     * else would have meant editing five index.ejs files and betting the
     * product's entire styling on getting all five right.
     */
    const esbuildConfig: string = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "UI", "esbuild-config.js"),
      "utf8",
    );

    test("runs for every service, on both build and watch", () => {
      /* Once in build(), once in watch(), plus the definition. */
      expect(esbuildConfig.match(/copyTailwindAsset\(/g)?.length).toBe(3);
    });

    test("reads it from the one vendored copy", () => {
      expect(esbuildConfig).toContain('"Static"');
      expect(esbuildConfig).toContain('"Vendor"');
      expect(esbuildConfig).toContain(
        'TAILWIND_FILENAME = "tailwind-3.4.5.js"',
      );
    });

    test("writes it to the path each index.ejs asks for", () => {
      expect(esbuildConfig).toContain('"assets/js"');

      const appRoot: string = path.join(REPOSITORY_ROOT, "App", "FeatureSet");

      for (const [service, routePrefix] of [
        ["Dashboard", "dashboard"],
        ["Accounts", "accounts"],
        ["AdminDashboard", "admin"],
        ["StatusPage", "status-page"],
        ["PublicDashboard", "public-dashboard"],
      ]) {
        const indexView: string = fs.readFileSync(
          path.join(appRoot, service as string, "views", "index.ejs"),
          "utf8",
        );

        expect([
          service,
          indexView.includes(`/${routePrefix}/assets/js/tailwind-3.4.5.js`),
        ]).toEqual([service, true]);
      }
    });

    test("is gitignored, so the build output cannot be committed back", () => {
      const gitignore: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, ".gitignore"),
        "utf8",
      );

      expect(gitignore).toContain("**/public/assets/js/tailwind-3.4.5.js");
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

  describe("brand images", () => {
    /*
     * https://github.com/OneUptime/oneuptime/issues/3457 - the on-call
     * acknowledge page and the SSO message page render out of the App
     * container and asked for /img/3-transparent.svg, which only the Home
     * container serves. nginx sends "/" to App on every install with billing
     * off, so the logo 404'd and the page showed a broken image.
     */
    test("resolves to a directory that ships with Common", () => {
      expect(fs.existsSync(BrandAssetsPath)).toBe(true);
      expect(fs.statSync(BrandAssetsPath).isDirectory()).toBe(true);
      expect(
        BrandAssetsPath.endsWith(path.join("Server", "Static", "Brand")),
      ).toBe(true);
    });

    test("the logo URL is under the prefix every service mounts", () => {
      expect(OneUptimeLogoUrl).toBe(
        "/oneuptime-assets/brand/oneuptime-logo.svg",
      );
      expect(OneUptimeLogoUrl.startsWith(`${VendorAssetsRoute}/`)).toBe(true);
    });

    test("serves the OneUptime logo as an SVG", async () => {
      const asset: AssetResponse = await getAsset(OneUptimeLogoUrl);

      expect(asset.status).toBe(200);
      expect(asset.contentType).toContain("image/svg+xml");
      expect(asset.text).toContain("<svg");
      expect(asset.body.byteLength).toBeGreaterThan(1000);
    });

    test("does not answer with the index page", () => {
      /*
       * The failure mode that looks like success: a catch-all mounted ahead of
       * the asset route hands back HTML with a 200, and an <img> pointed at it
       * still renders broken.
       */
      return getAsset(OneUptimeLogoUrl).then((asset: AssetResponse) => {
        expect(asset.text).not.toBe(INDEX_PAGE);
        expect(asset.contentType).not.toContain("text/html");
      });
    });

    test("is byte-identical to the copy the frontends and Home already ship", () => {
      /*
       * Three copies of one file is not ideal, but a logo that silently drifts
       * between the marketing site and the acknowledge page is worse. This is
       * the test that says so.
       */
      const served: Buffer = fs.readFileSync(
        path.join(BrandAssetsPath, "oneuptime-logo.svg"),
      );

      const copies: Array<string> = [
        path.join(
          REPOSITORY_ROOT,
          "Common",
          "UI",
          "Images",
          "logos",
          "OneUptimeSVG",
          "3-transparent.svg",
        ),
        path.join(
          REPOSITORY_ROOT,
          "Home",
          "Static",
          "img",
          "3-transparent.svg",
        ),
      ];

      let compared: number = 0;

      for (const copy of copies) {
        if (!fs.existsSync(copy)) {
          continue;
        }

        compared++;
        expect(fs.readFileSync(copy).equals(served)).toBe(true);
      }

      expect(compared).toBe(copies.length);
    });

    test("revalidates rather than caching for a year", async () => {
      /*
       * The filename carries no version, unlike tailwind's, so a rebrand must
       * not be stuck behind a year-old cache entry.
       */
      const asset: AssetResponse = await getAsset(OneUptimeLogoUrl);

      expect(asset.cacheControl).toContain("max-age=3600");
    });

    test("a brand file that does not exist is a 404, not a page", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/brand/no-such-logo.svg",
      );

      expect(asset.status).toBe(404);
      expect(asset.text).not.toBe(INDEX_PAGE);
    });

    test("a path that escapes the brand directory is refused", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/brand/../../package.json",
      );

      expect(asset.text).not.toContain("@oneuptime/common");
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
       * publishes. The browser asks for two of them; the rest is refused.
       */
      for (const notCode of [
        "mermaid.d.ts",
        "mermaid.min.js.map",
        "config.type.d.ts",
      ]) {
        const asset: AssetResponse = await getAsset(
          `/oneuptime-assets/mermaid/${notCode}`,
        );

        expect([notCode, asset.status]).toEqual([notCode, 404]);
      }
    });
  });

  describe("caching", () => {
    test("marks the version-named assets immutable", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
      );

      expect(asset.cacheControl).toContain("max-age=31536000");
    });

    test("keeps the year on mermaid's content-hashed chunks", async () => {
      const chunkDirectory: string = path.join(
        getMermaidDistPath() as string,
        "chunks",
        "mermaid.esm.min",
      );

      const chunk: string = fs
        .readdirSync(chunkDirectory)
        .find((file: string): boolean => {
          return file.endsWith(".mjs");
        }) as string;

      const asset: AssetResponse = await getAsset(
        `/oneuptime-assets/mermaid/chunks/mermaid.esm.min/${chunk}`,
      );

      expect(asset.status).toBe(200);
      expect(asset.cacheControl).toContain("max-age=31536000");
    });

    test("does not give mermaid's stable entrypoints a year", async () => {
      /*
       * mermaid.esm.min.mjs keeps its name across releases while every chunk it
       * imports is content-hashed. Cached for a year, a visitor who came back
       * after a mermaid bump would keep replaying an entrypoint that asks for
       * chunk filenames the upgrade deleted - and every docs diagram would stay
       * broken for that one person until the entry aged out.
       */
      for (const entrypoint of ["mermaid.esm.min.mjs", "mermaid.min.js"]) {
        const asset: AssetResponse = await getAsset(
          `/oneuptime-assets/mermaid/${entrypoint}`,
        );

        expect([entrypoint, asset.status]).toEqual([entrypoint, 200]);
        expect([
          entrypoint,
          asset.cacheControl.includes("max-age=31536000"),
        ]).toEqual([entrypoint, false]);
        expect([entrypoint, asset.cacheControl]).toEqual([
          entrypoint,
          "public, max-age=3600",
        ]);
      }
    });
  });

  describe("anything the mount does not have", () => {
    /*
     * These three all used to fall through to whatever was registered next.
     * In the App container that is the dashboard's SPA catch-all, which answers
     * HTTP 200 with text/html - so a missing stylesheet came back as a page, a
     * <script> handed HTML fired onload rather than onerror, and the docs' lazy
     * grammar loader counted it as a success. A 404 is the whole point.
     */
    test("a grammar that was never vendored is a 404, not the index page", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/highlight/languages/no-such-grammar.min.js",
      );

      expect(asset.status).toBe(404);
      expect(asset.text).not.toBe(INDEX_PAGE);
    });

    test("a directory is a 404 rather than a listing or the index page", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/highlight/languages/",
      );

      expect(asset.status).toBe(404);
      expect(asset.text).not.toBe(INDEX_PAGE);
    });

    test("the bare mount point is a 404", async () => {
      const asset: AssetResponse = await getAsset("/oneuptime-assets/");

      expect(asset.status).toBe(404);
      expect(asset.text).not.toBe(INDEX_PAGE);
    });

    test("a path that escapes the vendor directory is refused", async () => {
      const asset: AssetResponse = await getAsset(
        "/oneuptime-assets/../../package.json",
      );

      expect(asset.text).not.toContain("@oneuptime/common");
    });
  });
});

describe("when the vendored directory is missing from the image", () => {
  /*
   * The failure this guards is subtle: the early return that used to sit here
   * skipped the terminating 404 along with the static mount, so a build that
   * shipped without Common/Server/Static/Vendor answered every asset request
   * with the dashboard's index page at HTTP 200 - and looked, from the outside,
   * like it was working.
   */
  let server: Server;
  let port: number;

  beforeAll(async () => {
    jest.resetModules();

    jest.doMock("fs", () => {
      const actual: typeof fs = jest.requireActual("fs") as typeof fs;

      return {
        ...actual,
        existsSync: (candidate: string): boolean => {
          if (candidate === VendorAssetsPath) {
            return false;
          }

          return actual.existsSync(candidate);
        },
      };
    });

    /*
     * Re-imported after doMock so the module evaluates against the stubbed fs.
     * A dynamic import, not the static one at the top of the file - that
     * instance was built before the mock existed and still sees the real
     * directory.
     */
    const mountWithoutVendorDirectory: MountVendorAssetsFunction = (
      (await import("../../../Server/Utils/VendorAssets")) as {
        default: MountVendorAssetsFunction;
      }
    ).default;

    const app: ReturnType<typeof createExpressApp> = createExpressApp();

    mountWithoutVendorDirectory(app);

    app.get("/*", (_request: unknown, response: { send: GenericSendBody }) => {
      return response.send(INDEX_PAGE);
    });

    server = createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    jest.dontMock("fs");
    jest.resetModules();

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("still refuses the request rather than handing back a page", async () => {
    const status: number = await new Promise<number>(
      (resolve: (value: number) => void, reject: (reason: Error) => void) => {
        const request: http.ClientRequest = http.get(
          {
            host: "127.0.0.1",
            port,
            path: "/oneuptime-assets/tailwind/tailwind-3.4.5.js",
          },
          (message: IncomingMessage) => {
            message.resume();
            resolve(message.statusCode || 0);
          },
        );

        request.on("error", reject);
      },
    );

    expect(status).toBe(404);
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
