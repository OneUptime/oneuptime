import { StaticPath, ViewsPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
  createExpressApp,
} from "Common/Server/Utils/Express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

/*
 * STATIC/JS HOLDS THE SCRIPTS HOME'S PAGES LOAD, AND NOTHING ELSE.
 *
 * Routes.ts serves Static/ at the site root with a year-long cache, so every
 * file in Static/js is a public URL - /js/<file> - whether or not a page
 * loads it. A script no page loads is code that never runs but can still be
 * requested, and code scanning still reads it.
 *
 * Static/js/default.js was such a script. It came with the first commit in
 * 2019, a third-party marketing site's navigation, cookie banner and
 * analytics script copied in with the first pages. The pages stopped loading
 * it in January 2023 - head.ejs dropped its script tag in 83d5765ab8, and
 * 2383a1db58 removed the resources page and the route that served the file -
 * but the file stayed, and code scanning reported two js/xss-through-dom
 * alerts in it, 1764 and 1765: its stylesheet and script loaders took a URL
 * out of the page's text. It was deleted, which closes both the next time
 * code scanning analyses master.
 *
 * These tests read every text file of the package - templates, code, static
 * pages, styles and SVG images - except its tests, dependencies and build
 * output, and find the scripts the files load by their URL: "/js/<file>",
 * not inside a longer URL or path. They hold that:
 *
 *   - every such URL names a file in Static/js, so a script is not deleted
 *     while a page still loads it;
 *   - every file in Static/js is loaded by one of them, except the older
 *     files LEGACY_SCRIPTS lists, and that list only shrinks;
 *   - default.js stays deleted: no file, no reference, and a request for its
 *     URL gets the not-found page.
 */

/*
 * NotFoundUtil renders from Config's ViewsPath, the folder the Docker image
 * puts the views in. The server tests below run the package's own folders.
 */
jest.mock("../Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path");
  const homeFolder: string = nodePath.join(__dirname, "..");

  return {
    ...jest.requireActual("../Utils/Config"),
    ViewsPath: nodePath.join(homeFolder, "Views"),
    StaticPath: nodePath.join(homeFolder, "Static"),
  };
});

const HOME_FOLDER: string = path.join(__dirname, "..");
const STATIC_FOLDER: string = path.join(HOME_FOLDER, "Static");
const SCRIPTS_FOLDER: string = path.join(STATIC_FOLDER, "js");
const HOME_URL: string = "https://oneuptime.com";
const YEAR_LONG_CACHE: string = "public,max-age=31536000,immutable";

// The deleted script, by its name in Static/js.
const DELETED_SCRIPT: string = "default.js";

/*
 * Scripts no page loads that were in Static/js before this guard: dead code
 * too, served but never run, left for a change that deletes them. The list
 * only shrinks. Delete a file and its entry, or take the entry off when a
 * page starts loading the file; never add one - load a new script from the
 * page that needs it instead.
 */
const LEGACY_SCRIPTS: Array<string> = [
  "animate.js",
  "crm.js",
  "demo.js",
  "getCookies.js",
  "home.js",
  "resources.js",
  "stickyfill.js",
  "switch.js",
  "switchUrl.js",
];

// The scripts the books page loads, the ones the scan has to find.
const BOOKS_PAGE_SCRIPTS: Array<string> = [
  "book-reader-core.js",
  "book-reader.js",
  "books.js",
];

// Folders that are not the package's own code: dependencies, builds, tests.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "Tests",
]);

/*
 * Files that can name a script's URL: templates, code, pages, styles, images
 * that carry markup, and data.
 */
const SOURCE_FILE: RegExp =
  /\.(?:ejs|ts|js|mjs|cjs|html|htm|css|svg|json|xml)$/;

/*
 * A script's URL on the site: "/js/" and a file name ending in ".js". No URL
 * or path character comes just before it, so "https://cdn.example.com/js/x.js"
 * and "Static/js/x.js" are not read as one, and none just after it, so
 * "/js/x.json" and "/js/x.js.map" are not either; a query string such as
 * "?v=..." may follow.
 */
const SCRIPT_URL: RegExp =
  /(?<![\w.~%:/-])\/js\/((?:[\w-]+\/)*[\w.-]+\.js)(?![\w.-])/g;

// The text of the alerts' loaders: a list of URLs read out of the page.
const DELETED_LOADER_CONFIG: string = "strut_files";

// The path of a route Routes.ts registers by a string.
const ROUTE_PATH: RegExp = /app\.(?:get|use|all)\(\s*"([^"]*)"/g;

const NOT_FOUND_TITLE: string = "<title>OneUptime | Page not found</title>";

// A file of the package, by its path from the package folder.
interface SourceFile {
  name: string;
  text: string;
}

// Every file of the package the scan reads, by its path from the package.
function readSourceFiles(folder: string): Array<SourceFile> {
  const files: Array<SourceFile> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) {
        files.push(...readSourceFiles(fullPath));
      }
      continue;
    }

    if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      files.push({
        name: path.relative(HOME_FOLDER, fullPath).split(path.sep).join("/"),
        text: fs.readFileSync(fullPath, "utf8"),
      });
    }
  }

  return files.sort((first: SourceFile, second: SourceFile): number => {
    return first.name.localeCompare(second.name);
  });
}

// The scripts a text loads, by their path under Static/js.
function scriptsNamedIn(text: string): Array<string> {
  return Array.from(text.matchAll(SCRIPT_URL), (match: RegExpMatchArray) => {
    return match[1]!;
  });
}

// Every file in Static/js, by its path under it.
function scriptsInFolder(folder: string, prefix: string = ""): Array<string> {
  const scripts: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      scripts.push(
        ...scriptsInFolder(
          path.join(folder, entry.name),
          `${prefix}${entry.name}/`,
        ),
      );
    } else if (entry.isFile()) {
      scripts.push(`${prefix}${entry.name}`);
    }
  }

  return scripts.sort();
}

const SOURCE_FILES: Array<SourceFile> = readSourceFiles(HOME_FOLDER);
const SCRIPTS: Array<string> = scriptsInFolder(SCRIPTS_FOLDER);

/*
 * For each script a file of the package loads, the files that load it. A
 * script that names its own URL does not load itself.
 */
const LOADED_BY: Map<string, Array<string>> = new Map<string, Array<string>>();

for (const file of SOURCE_FILES) {
  for (const script of scriptsNamedIn(file.text)) {
    if (file.name === `Static/js/${script}`) {
      continue;
    }

    const loaders: Array<string> = LOADED_BY.get(script) || [];

    if (!loaders.includes(file.name)) {
      loaders.push(file.name);
    }

    LOADED_BY.set(script, loaders);
  }
}

function loadersOf(script: string): Array<string> {
  return LOADED_BY.get(script) || [];
}

describe("reading a script's URL", () => {
  test.each([
    ['<script src="/js/books.js" defer></script>', ["books.js"]],
    ["coreJs: '/js/book-reader-core.js',", ["book-reader-core.js"]],
    [
      'versionedStaticPath("/js/book-reader.js", staticRoot)',
      ["book-reader.js"],
    ],
    ["/js/books.js?v=0123456789ab", ["books.js"]],
    ["(/js/a.js) and `/js/b.js`", ["a.js", "b.js"]],
    ["/js/vendor/chart.js", ["vendor/chart.js"]],
    ["/js/x.js", ["x.js"]],
  ])(
    "reads %s as a script the site loads",
    (text: string, scripts: Array<string>) => {
      expect(scriptsNamedIn(text)).toEqual(scripts);
    },
  );

  test.each([
    ["https://cdn.example.com/js/x.js"],
    ["//cdn.example.com/js/x.js"],
    ["/dashboard/assets/js/x.js"],
    ["packages/Home/Static/js/x.js"],
    ["../js/x.js"],
    ["/js/x.json"],
    ["/js/x.js.map"],
    ["/js/x.jsx"],
    ["/css/x.css"],
  ])("does not read %s as one", (text: string) => {
    expect(scriptsNamedIn(text)).toEqual([]);
  });
});

describe("Static/js holds the scripts Home's pages load", () => {
  test("the scan reads the package's views, server code and static files, and not its tests", () => {
    /*
     * Guards the guard: a scan that read nothing, or read the tests that name
     * these URLs, would pass whatever Static/js held.
     */
    const names: Array<string> = SOURCE_FILES.map((file: SourceFile) => {
      return file.name;
    });

    for (const name of [
      "Routes.ts",
      "Utils/StaticAssets.ts",
      "Views/books.ejs",
      "Views/head.ejs",
      "Static/js/books.js",
      "Static/css/books.css",
    ]) {
      expect(names).toContain(name);
    }
    expect(
      names.filter((name: string): boolean => {
        return (
          name.startsWith("Tests/") ||
          name.startsWith("node_modules/") ||
          name.startsWith("build/")
        );
      }),
    ).toEqual([]);
    expect(SCRIPTS.length).toBeGreaterThan(0);
  });

  test("it finds the books page's scripts where the page and its route name them", () => {
    for (const script of BOOKS_PAGE_SCRIPTS) {
      expect([script, loadersOf(script)]).toEqual([
        script,
        ["Utils/StaticAssets.ts", "Views/books.ejs"],
      ]);
    }
  });

  test("every script a file of the package loads is in Static/js", () => {
    const missing: Array<string> = [];

    for (const [script, loaders] of LOADED_BY) {
      if (!SCRIPTS.includes(script)) {
        missing.push(`/js/${script}, loaded by ${loaders.join(", ")}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("every script in Static/js is loaded by a page, or is a legacy script listed above", () => {
    const unloaded: Array<string> = SCRIPTS.filter(
      (script: string): boolean => {
        return (
          loadersOf(script).length === 0 && !LEGACY_SCRIPTS.includes(script)
        );
      },
    );

    // Load each one from the page that needs it, or delete it.
    expect(unloaded).toEqual([]);
  });

  test("each legacy script is still in Static/js and still loaded by nothing", () => {
    /*
     * The list only shrinks: a legacy script that was deleted, or that a page
     * now loads, comes off it here.
     */
    for (const script of LEGACY_SCRIPTS) {
      expect([script, SCRIPTS.includes(script), loadersOf(script)]).toEqual([
        script,
        true,
        [],
      ]);
    }
    expect([...LEGACY_SCRIPTS].sort()).toEqual(LEGACY_SCRIPTS);
    expect(new Set<string>(LEGACY_SCRIPTS).size).toBe(LEGACY_SCRIPTS.length);
  });
});

describe("default.js stays deleted", () => {
  test("Static/js has no default.js, and the legacy list does not name it", () => {
    expect(fs.existsSync(path.join(SCRIPTS_FOLDER, DELETED_SCRIPT))).toBe(
      false,
    );
    expect(
      LEGACY_SCRIPTS.filter((script: string): boolean => {
        return script === DELETED_SCRIPT;
      }),
    ).toEqual([]);
  });

  test("no file of the package loads /js/default.js", () => {
    expect(loadersOf(DELETED_SCRIPT)).toEqual([]);
  });

  test("its loaders are not back under another name", () => {
    /*
     * The alerts were on the code that read a list of stylesheet and script
     * URLs out of a "strut_files" element of the page and loaded them.
     */
    expect(
      SOURCE_FILES.filter((file: SourceFile): boolean => {
        return file.text.includes(DELETED_LOADER_CONFIG);
      }).map((file: SourceFile): string => {
        return file.name;
      }),
    ).toEqual([]);
  });
});

describe("how Home answers a request under /js/", () => {
  const routesSource: string = fs.readFileSync(
    path.join(HOME_FOLDER, "Routes.ts"),
    "utf8",
  );
  const staticMount: number = routesSource.indexOf("ExpressStatic(StaticPath");

  test("the image puts the package's Static folder where Config says the site's files are", () => {
    const dockerfile: string = fs.readFileSync(
      path.join(HOME_FOLDER, "Dockerfile.tpl"),
      "utf8",
    );
    const config: { StaticPath: string } =
      jest.requireActual("../Utils/Config");

    expect(dockerfile).toContain(
      "COPY --chown=1000:1000 ./packages/Home /usr/src/app\n",
    );
    expect(config.StaticPath).toBe("/usr/src/app/Static");
  });

  test("Routes.ts serves Static at the site root, once, cached for a year", () => {
    expect(routesSource.split("ExpressStatic(").length - 1).toBe(1);
    expect(staticMount).toBeGreaterThan(0);
    expect(
      routesSource.slice(0, staticMount).trimEnd().endsWith("app.use("),
    ).toBe(true);

    const mount: string = routesSource.slice(
      staticMount,
      routesSource.indexOf("app.get(", staticMount),
    );

    expect(mount).toContain(
      `res.setHeader("Cache-Control", "${YEAR_LONG_CACHE}");`,
    );
  });

  test("and answers what Static does not have with the not-found page, as its last route", () => {
    const afterMount: string = routesSource.slice(staticMount);
    const catchAll: number = afterMount.indexOf('app.get("/*"');

    expect(catchAll).toBeGreaterThan(0);
    expect(afterMount.indexOf("app.get(")).toBe(catchAll);
    expect(afterMount.slice(catchAll)).toContain(
      "return NotFoundUtil.renderNotFound(res);",
    );
    expect(afterMount.slice(catchAll + 1).indexOf("app.get(")).toBe(-1);
    expect(afterMount.slice(catchAll).indexOf("app.use(")).toBe(-1);
  });

  test("no route of Routes.ts claims a path under /js/", () => {
    const registered: Array<string> = Array.from(
      routesSource.matchAll(ROUTE_PATH),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(registered.length).toBeGreaterThan(50);
    expect(
      registered.filter((route: string): boolean => {
        return route === "/js" || route.startsWith("/js/");
      }),
    ).toEqual([]);
  });
});

describe("a request for a script", () => {
  interface Answer {
    status: number;
    contentType: string;
    cacheControl: string;
    contentLength: number;
    body: string;
  }

  let server: http.Server;
  let port: number = 0;

  /*
   * What Routes.ts does with a request it has no route for (the tests above
   * hold it to this): Static at the site root with the year-long cache, then
   * the not-found page. Its middleware sets homeUrl for every request first.
   */
  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();

    app.set("view engine", "ejs");
    app.use(
      (_req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        res.locals["homeUrl"] = HOME_URL;
        next();
      },
    );
    app.use(
      ExpressStatic(StaticPath, {
        setHeaders(res: ExpressResponse) {
          res.setHeader("Cache-Control", YEAR_LONG_CACHE);
        },
      }),
    );
    app.get("/*", (_req: ExpressRequest, res: ExpressResponse) => {
      return NotFoundUtil.renderNotFound(res);
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

  function request(method: "GET" | "HEAD", urlPath: string): Promise<Answer> {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        http
          .request(
            {
              method: method,
              host: "127.0.0.1",
              port: port,
              path: urlPath,
              agent: false,
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
                  contentType: String(response.headers["content-type"] || ""),
                  cacheControl: String(response.headers["cache-control"] || ""),
                  contentLength: Number(response.headers["content-length"]),
                  body: body,
                });
              });
            },
          )
          .on("error", reject)
          .end();
      },
    );
  }

  test("the server runs the package's own folders", () => {
    expect(StaticPath).toBe(STATIC_FOLDER);
    expect(ViewsPath).toBe(path.join(HOME_FOLDER, "Views"));
  });

  test("/js/default.js gets the not-found page, not a script", async () => {
    const answer: Answer = await request("GET", `/js/${DELETED_SCRIPT}`);

    expect(answer.status).toBe(404);
    expect(answer.contentType).toContain("text/html");
    expect(answer.cacheControl).not.toBe(YEAR_LONG_CACHE);
    expect(answer.body).toContain(NOT_FOUND_TITLE);
  });

  test("so does any other script Static/js does not have", async () => {
    const answer: Answer = await request("GET", "/js/no-such-script.js");

    expect(answer.status).toBe(404);
    expect(answer.body).toContain(NOT_FOUND_TITLE);
  });

  test.each(BOOKS_PAGE_SCRIPTS)(
    "/js/%s, which the books page loads, is still served, cached for a year",
    async (script: string) => {
      /*
       * HEAD, so the file is not streamed: a streamed file leaves an async
       * resource of on-finished's behind, which jest --detectOpenHandles
       * reports as an open handle.
       */
      const answer: Answer = await request("HEAD", `/js/${script}`);

      expect(answer.status).toBe(200);
      expect(answer.contentType).toContain("javascript");
      expect(answer.cacheControl).toBe(YEAR_LONG_CACHE);
      expect(answer.contentLength).toBe(
        fs.statSync(path.join(SCRIPTS_FOLDER, script)).size,
      );
    },
  );
});
