import {
  CommonContentFiles,
  DynamicClasses,
  HomeContentFiles,
  ReviewGlowColors,
  createMarketingTailwindConfig,
  extractMarkdownClassAttributes,
  getBlogContentFiles,
} from "../tailwind.config";
import {
  RuntimeBrowsers,
  TailwindInputCss,
  collapseCssWhitespace,
  countBlogPosts,
  describeBlog,
  minifyCssWhitespace,
  writeTailwindStylesheet,
} from "../Scripts/BuildTailwindCss";
import {
  TailwindStylesheet,
  TailwindStylesheetDirectory,
  TailwindStylesheetRoutePattern,
  findTailwindStylesheet,
  getTailwindStylesheetFileName,
  serveTailwindStylesheet,
} from "../Utils/TailwindStylesheet";
import ProductCompare, {
  getProductCompareSlugs,
} from "../Utils/ProductCompare";
import { ArchitectureTiers } from "../Utils/SelfHosted";
import {
  KITCHEN_SINK_MARKDOWN,
  VIEWS_ROOT,
  blogPostWith,
  cssBlocks,
  cssCoverage,
  gluedClassText,
  listFiles,
  renderView,
  tailwindCssFor,
} from "./Helpers/TailwindPages";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  createExpressApp,
} from "Common/Server/Utils/Express";
import BlogTag from "../Utils/BlogTag";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import { JSDOM } from "jsdom";
import { AddressInfo } from "net";
import os from "os";
import path from "path";

/*
 * How the marketing site gets its Tailwind CSS: built into one hashed file
 * (Scripts/BuildTailwindCss.ts), found and served by the server
 * (Utils/TailwindStylesheet.ts, Routes.ts), linked by every page
 * (head-basic.ejs, Partials/tailwind-stylesheet.ejs), and built by the image
 * (Dockerfile.tpl). Tests/TailwindBuild.test.ts holds what is in the file to
 * the pages.
 */

const HOME_ROOT: string = path.join(__dirname, "..");
const RUNTIME_SCRIPT: string = "/oneuptime-assets/tailwind/tailwind-3.4.5.js";
const STYLESHEET_HREF: string = "/css/tailwind.0123456789ab.css";

const temporaryDirectory: () => string = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), "home-tailwind-"));
};

describe("the stylesheet's file name", () => {
  test("is the first twelve hex digits of the SHA-256 of its content", () => {
    const css: string = ".flex{display:flex}";
    const hash: string = crypto.createHash("sha256").update(css).digest("hex");

    expect(getTailwindStylesheetFileName(css)).toBe(
      `tailwind.${hash.slice(0, 12)}.css`,
    );
  });

  test("changes with the content, and only with it", () => {
    expect(getTailwindStylesheetFileName("a{color:red}")).toBe(
      getTailwindStylesheetFileName("a{color:red}"),
    );
    expect(getTailwindStylesheetFileName("a{color:red}")).not.toBe(
      getTailwindStylesheetFileName("a{color:blue}"),
    );
  });
});

describe("writeTailwindStylesheet", () => {
  let parent: string;

  beforeAll(() => {
    parent = temporaryDirectory();
  });

  afterAll(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test("writes the one file the server finds, by its hash", () => {
    const directory: string = path.join(parent, "tailwind");
    const written: TailwindStylesheet = writeTailwindStylesheet(
      ".a{color:red}",
      directory,
    );

    expect(written.fileName).toBe(
      getTailwindStylesheetFileName(".a{color:red}"),
    );
    expect(written.href).toBe(`/css/${written.fileName}`);
    expect(fs.readFileSync(written.filePath, "utf8")).toBe(".a{color:red}");
    expect(findTailwindStylesheet(directory)).toEqual(written);
  });

  test("replaces the previous build whole, and leaves nothing beside it", () => {
    const directory: string = path.join(parent, "tailwind");
    writeTailwindStylesheet(".a{color:red}", directory);
    fs.writeFileSync(path.join(directory, "stray.txt"), "left by hand");

    const written: TailwindStylesheet = writeTailwindStylesheet(
      ".a{color:blue}",
      directory,
    );

    expect(fs.readdirSync(directory)).toEqual([written.fileName]);
    expect(fs.readdirSync(parent)).toEqual(["tailwind"]);
  });
});

describe("findTailwindStylesheet", () => {
  test("defaults to build/tailwind in the package, where the build writes", () => {
    expect(TailwindStylesheetDirectory).toBe(
      path.join(HOME_ROOT, "build", "tailwind"),
    );
  });

  test("finds nothing where there is no build", () => {
    const directory: string = temporaryDirectory();

    expect(findTailwindStylesheet(path.join(directory, "missing"))).toBeNull();
    expect(findTailwindStylesheet(directory)).toBeNull();

    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("ignores files the build does not write", () => {
    const directory: string = temporaryDirectory();

    for (const name of [
      "tailwind.css",
      "tailwind.0123456789a.css",
      "tailwind.0123456789ABC.css",
      "tailwind.0123456789abc.css.map",
      "other.0123456789ab.css",
    ]) {
      fs.writeFileSync(path.join(directory, name), "");
    }

    expect(findTailwindStylesheet(directory)).toBeNull();

    fs.writeFileSync(path.join(directory, "tailwind.0123456789ab.css"), "");

    expect(findTailwindStylesheet(directory)).toEqual({
      fileName: "tailwind.0123456789ab.css",
      filePath: path.join(directory, "tailwind.0123456789ab.css"),
      href: "/css/tailwind.0123456789ab.css",
    });

    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("does not guess between two builds", () => {
    const directory: string = temporaryDirectory();
    fs.writeFileSync(path.join(directory, "tailwind.0123456789ab.css"), "");
    fs.writeFileSync(path.join(directory, "tailwind.ba9876543210.css"), "");

    expect(findTailwindStylesheet(directory)).toBeNull();

    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("serving the stylesheet", () => {
  interface Answer {
    status: number;
    contentType: string;
    cacheControl: string;
    body: string;
  }

  const CSS: string = ".flex{display:flex}";
  let directory: string;
  let stylesheet: TailwindStylesheet;
  let servers: Array<http.Server> = [];

  const start: (served: TailwindStylesheet | null) => Promise<number> = async (
    served: TailwindStylesheet | null,
  ): Promise<number> => {
    // Routes.ts's registration, and its catch-all not-found answer after it.
    const app: ExpressApplication = createExpressApp();
    app.get(TailwindStylesheetRoutePattern, serveTailwindStylesheet(served));
    app.use((_req: ExpressRequest, res: ExpressResponse) => {
      res.status(404).send("not found");
    });

    const server: http.Server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    return (server.address() as AddressInfo).port;
  };

  const request: (port: number, urlPath: string) => Promise<Answer> = (
    port: number,
    urlPath: string,
  ): Promise<Answer> => {
    return new Promise<Answer>(
      (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
        http
          .get(
            { host: "127.0.0.1", port: port, path: urlPath, agent: false },
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
                  body: body,
                });
              });
            },
          )
          .on("error", reject);
      },
    );
  };

  beforeAll(() => {
    directory = path.join(temporaryDirectory(), "tailwind");
    stylesheet = writeTailwindStylesheet(CSS, directory);
  });

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    }
    servers = [];
    fs.rmSync(path.dirname(directory), { recursive: true, force: true });
  });

  test("sends this build's stylesheet as CSS, cached for a year", async () => {
    const port: number = await start(stylesheet);
    const answer: Answer = await request(port, stylesheet.href);

    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe("text/css; charset=UTF-8");
    expect(answer.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(answer.body).toBe(CSS);
  });

  test("answers another build's URL with this stylesheet, but never to be kept", async () => {
    /*
     * A page from the other side of a rolling deploy: styled for this view,
     * and not cached under a URL that names another build.
     */
    const port: number = await start(stylesheet);
    const answer: Answer = await request(
      port,
      "/css/tailwind.ba9876543210.css",
    );

    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe("text/css; charset=UTF-8");
    expect(answer.cacheControl).toBe("no-store");
    expect(answer.body).toBe(CSS);
  });

  test("leaves every other URL to the routes after it", async () => {
    const port: number = await start(stylesheet);

    for (const urlPath of [
      "/css/tailwind.css",
      "/css/tailwind.0123456789AB.css",
      "/css/tailwind.0123456789ab.css.map",
      `/css/x/${stylesheet.fileName}`,
    ]) {
      expect([urlPath, (await request(port, urlPath)).status]).toEqual([
        urlPath,
        404,
      ]);
    }
  });

  test("serves nothing without a build", async () => {
    const port: number = await start(null);

    expect((await request(port, stylesheet.href)).status).toBe(404);
  });

  test("is a 404, not an error, if the file goes away under the server", async () => {
    const gone: TailwindStylesheet = {
      ...stylesheet,
      filePath: path.join(directory, "deleted.css"),
    };
    const port: number = await start(gone);

    expect((await request(port, stylesheet.href)).status).toBe(404);
  });
});

describe("Routes.ts", () => {
  const routes: string = fs.readFileSync(
    path.join(HOME_ROOT, "Routes.ts"),
    "utf8",
  );

  test("hands every page the stylesheet's URL through app.locals", () => {
    /*
     * app.locals, not res.locals: API/BlogAPI.ts registers the blog's
     * routes before Routes.ts's middleware, so they never see res.locals.
     */
    expect(routes).toContain('app.locals["tailwindStylesheetHref"]');
  });

  test("registers the stylesheet's route before its catch-all", () => {
    const route: number = routes.search(
      /app\.get\(\s*TailwindStylesheetRoutePattern,/,
    );

    expect(route).toBeGreaterThan(0);
    expect(route).toBeLessThan(routes.indexOf('app.get("/*"'));
    expect(route).toBeLessThan(routes.indexOf("ExpressStatic(StaticPath"));
  });
});

describe("collapseCssWhitespace", () => {
  test.each([
    ["  a   b \n c  ", "a b c"],
    ["rgb(0 0 0 / 0.1)", "rgb(0 0 0 / 0.1)"],
    ['"Apple  Color\tEmoji", sans', '"Apple  Color\tEmoji", sans'],
    ["'a \\' b'  c", "'a \\' b' c"],
    // An escaped space and a hex escape's terminating space are kept.
    [".a\\ b  .c", ".a\\ b .c"],
    [".\\31 0", ".\\31 0"],
  ])("%j -> %j", (input: string, output: string) => {
    expect(collapseCssWhitespace(input)).toBe(output);
  });
});

describe("minifyCssWhitespace", () => {
  test("takes out comments and whitespace, keeps the license comment", () => {
    const css: string = [
      "/*! tailwindcss v3.4.5 | MIT License */",
      "/* a note */",
      "*,",
      "::before {",
      "  box-sizing: border-box; /* 1 */",
      "  --tw-content: '';",
      "}",
      "@media (min-width: 640px) {",
      "  .sm\\:flex {",
      "    display: flex !important;",
      "  }",
      "}",
    ].join("\n");

    expect(minifyCssWhitespace(css)).toBe(
      "/*! tailwindcss v3.4.5 | MIT License*/*,::before{box-sizing:border-box;--tw-content:''}@media (min-width: 640px){.sm\\:flex{display:flex!important}}",
    );
  });

  test("changes nothing but whitespace in what Tailwind writes", async () => {
    // Preflight, defaults, variants, arbitrary values, keyframes, screens.
    const css: string = await tailwindCssFor([
      "flex",
      "container",
      "animate-spin",
      "hover:bg-gray-50",
      "sm:text-lg",
      "max-md:hidden",
      "lg:grid-cols-3",
      "bg-[linear-gradient(to_right,#f4f4f5_1px,transparent_1px)]",
      "[mask-image:radial-gradient(ellipse_55%_45%_at_50%_0%,#000_60%,transparent_105%)]",
      "space-x-10",
      "group-hover:translate-x-0.5",
      "backdrop-blur",
      "select-none",
      "tracking-[-0.035em]",
      "text-[#6264A7]",
      "marker:text-gray-400",
    ]);
    const minified: string = minifyCssWhitespace(css);

    expect(minified.length).toBeLessThan(css.length);
    expect(cssBlocks(minified)).toEqual(cssBlocks(css));
  }, 300000);
});

describe("cssCoverage, the comparison the build is held to", () => {
  test("finds a declaration the whole does not have", () => {
    expect(
      cssCoverage(".a{color:red}.b{color:blue}", ".b{color:blue}").missing,
    ).toEqual([" | .a | color:red"]);
  });

  test("finds two rules the whole has the other way round", () => {
    /*
     * For an element with both classes, .b wins in `part` and .a in
     * `whole`.
     */
    expect(
      cssCoverage(".a{color:red}.b{color:blue}", ".b{color:blue}.a{color:red}")
        .outOfOrder,
    ).toEqual([" | .b (after  | .a)"]);
  });

  test("tells a rule inside a media query from the same rule outside it", () => {
    expect(
      cssCoverage("@media (min-width: 640px){.a{color:red}}", ".a{color:red}")
        .missing,
    ).toEqual(["@media (min-width: 640px) | .a | color:red"]);
  });

  test("reads past whitespace, comments and how selectors are grouped", () => {
    expect(
      cssCoverage(
        "/* note */ .a , .b {\n  color : red ;\n}",
        ".b{color:red}.a{color:red}.c{color:green}",
      ),
    ).toEqual({ missing: [], outOfOrder: [] });
  });
});

describe("extractMarkdownClassAttributes", () => {
  test("reads every class attribute of a post", () => {
    expect(
      extractMarkdownClassAttributes(
        [
          '<div class="p-4  rounded-lg">',
          "<span class='text-sm'>x</span>",
          '<Card className="mt-2 p-4" />',
          "```html",
          '<p class="font-mono">in a sample</p>',
          "```",
        ].join("\n"),
      ),
    ).toEqual(["p-4", "rounded-lg", "text-sm", "mt-2", "font-mono"]);
  });

  test("reads nothing from a post without one", () => {
    expect(extractMarkdownClassAttributes("A post about classes.")).toEqual([]);
    expect(extractMarkdownClassAttributes("# A post")).toEqual([]);
  });
});

describe("the Tailwind config", () => {
  test("is the runtime's: Tailwind's default theme, no plugins", () => {
    const config: ReturnType<typeof createMarketingTailwindConfig> =
      createMarketingTailwindConfig();

    expect(config.theme).toEqual({});
    expect(config.plugins).toEqual([]);
    expect(config.presets).toBeUndefined();
    expect(config.prefix).toBeUndefined();
    expect(config.important).toBeUndefined();
    expect(config.darkMode).toBeUndefined();
  });

  test("reads the views, the client scripts, the Utils, the blog renderer and the posts", () => {
    const config: ReturnType<typeof createMarketingTailwindConfig> =
      createMarketingTailwindConfig({ blogRoot: "/srv/blog" });
    const files: Array<unknown> = (config.content as { files: Array<unknown> })
      .files;

    expect(files).toEqual([
      ...HomeContentFiles,
      ...CommonContentFiles,
      "/srv/blog/posts/*/*.md",
    ]);
    expect(getBlogContentFiles("/usr/src/blog")).toEqual([
      "/usr/src/blog/posts/*/*.md",
    ]);
    expect(HomeContentFiles).toEqual([
      path.join(HOME_ROOT, "Views", "**", "*.ejs"),
      path.join(HOME_ROOT, "Static", "js", "**", "*.js"),
      path.join(HOME_ROOT, "Utils", "**", "*.ts"),
      path.join(HOME_ROOT, "API", "**", "*.ts"),
      path.join(HOME_ROOT, "Routes.ts"),
    ]);

    for (const file of CommonContentFiles) {
      expect([file, fs.existsSync(file)]).toEqual([file, true]);
    }
  });

  test("defaults the blog to where the image clones it", () => {
    const files: Array<unknown> = (
      createMarketingTailwindConfig().content as { files: Array<unknown> }
    ).files;

    expect(files).toContain("/usr/src/blog/posts/*/*.md");
  });
});

describe("the Tailwind version", () => {
  test("is the runtime's, pinned exactly", () => {
    const packageJson: { devDependencies: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(HOME_ROOT, "package.json"), "utf8"),
    );
    const installed: { version: string } = JSON.parse(
      fs.readFileSync(
        path.join(HOME_ROOT, "node_modules", "tailwindcss", "package.json"),
        "utf8",
      ),
    );
    const runtime: string = path.join(
      HOME_ROOT,
      "..",
      "Common",
      "Server",
      "Static",
      "Vendor",
      "tailwind",
      "tailwind-3.4.5.js",
    );

    expect(packageJson.devDependencies["tailwindcss"]).toBe("3.4.5");
    expect(installed.version).toBe("3.4.5");
    // The runtime the pages fall back to, and that the build reproduces.
    expect(fs.existsSync(runtime)).toBe(true);
    expect(
      fs.readFileSync(path.join(VIEWS_ROOT, "head-basic.ejs"), "utf8"),
    ).toContain(RUNTIME_SCRIPT);
  });

  test("prefixes for the browsers the runtime prefixed for", () => {
    expect(RuntimeBrowsers).toEqual([
      "and_chr 114",
      "and_uc 15.5",
      "chrome 114",
      "chrome 113",
      "chrome 109",
      "edge 114",
      "firefox 114",
      "ios_saf 16.5",
      "ios_saf 16.4",
      "ios_saf 16.3",
      "ios_saf 16.1",
      "opera 99",
      "safari 16.5",
      "samsung 21",
    ]);
    expect(TailwindInputCss).toBe(
      "@tailwind base;@tailwind components;@tailwind utilities;",
    );
  });
});

describe("classes assembled from a variable", () => {
  /*
   * Tailwind finds a class in a file only if the file spells it out. These
   * are every place a template glues an EJS tag's output to class text, each
   * looked at: the Tailwind ones are in DynamicClasses, the rest are the
   * page's own classes. A new one fails here until it has been looked at too.
   */
  const REVIEWED: Record<string, Array<string>> = {
    // review-glow-* is the partial's own (reviews.ejs's <style>).
    "Partials/review.ejs": [
      "review-glow-<%= color %>",
      "hover:ring-<%= color %>-200",
    ],
    "product-compare.ejs": [
      "lg:grid-cols-<%= productConfig.competitorPricingTiers.length >= 4 ? '4' : productConfig.competitorPricingTiers.length %>",
    ],
    "self-hosted.ejs": [
      "bg-<%= tier.accent %>-50",
      "text-<%= tier.accent %>-600",
      "ring-<%= tier.accent %>-100",
    ],
  };

  test("control: what counts as glued", () => {
    expect(
      gluedClassText(
        [
          `<div class="p-4 bg-<%= color %>-50 <%= extra %> <% if (on) { %>ring-1<% } %>">`,
          `<a class='<%- size -%>-x' href="#a-<%= id %>">`,
        ].join("\n"),
      ),
    ).toEqual(["bg-<%= color %>-50", "<%- size -%>-x"]);
  });

  test("are only the ones that have been looked at", () => {
    const found: Record<string, Array<string>> = {};

    for (const file of listFiles(VIEWS_ROOT, ".ejs")) {
      const glued: Array<string> = gluedClassText(
        fs.readFileSync(file, "utf8"),
      );

      if (glued.length > 0) {
        found[path.relative(VIEWS_ROOT, file).split(path.sep).join("/")] =
          glued;
      }
    }

    expect(found).toEqual(REVIEWED);
  });

  test("self-hosted.ejs: every tier's accent", () => {
    expect(ArchitectureTiers.length).toBeGreaterThan(0);

    for (const tier of ArchitectureTiers) {
      expect(DynamicClasses).toEqual(
        expect.arrayContaining([
          `bg-${tier.accent}-50`,
          `text-${tier.accent}-600`,
          `ring-${tier.accent}-100`,
        ]),
      );
    }
  });

  test("product-compare.ejs: every product's column count", () => {
    for (const slug of getProductCompareSlugs()) {
      const tiers: number = (ProductCompare(slug).competitorPricingTiers || [])
        .length;

      if (tiers > 0) {
        expect([
          slug,
          DynamicClasses.includes(`lg:grid-cols-${Math.min(tiers, 4)}`),
        ]).toEqual([slug, true]);
      }
    }
  });

  test("review.ejs: every colour reviews.ejs hands a review", () => {
    const reviews: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "Partials", "reviews.ejs"),
      "utf8",
    );
    const handed: Set<string> = new Set<string>();

    for (const list of reviews.matchAll(/const colors\d+ = \[([^\]]*)\]/g)) {
      for (const color of (list[1] || "").matchAll(/'([a-z]+)'/g)) {
        handed.add(color[1]!);
      }
    }

    expect(handed.size).toBeGreaterThan(0);
    expect(Array.from(handed).sort()).toEqual(ReviewGlowColors.slice().sort());

    for (const color of ReviewGlowColors) {
      expect(DynamicClasses).toContain(`hover:ring-${color}-200`);
    }
  });
});

describe("head-basic.ejs and the end of <head>", () => {
  const renderNotFound: (locals: Record<string, unknown>) => Promise<string> = (
    locals: Record<string, unknown>,
  ): Promise<string> => {
    // NotFoundUtil.renderNotFound's locals.
    return renderView("not-found.ejs", {
      footerCards: false,
      support: false,
      cta: false,
      blackLogo: false,
      requestDemoCta: false,
      ...locals,
    });
  };

  describe("with a build", () => {
    let html: string;
    let head: HTMLHeadElement;

    beforeAll(async () => {
      html = await renderNotFound({ tailwindStylesheetHref: STYLESHEET_HREF });
      head = new JSDOM(html).window.document.head;
    });

    test("no longer loads the Tailwind runtime", () => {
      expect(html).not.toContain(RUNTIME_SCRIPT);
      expect(html).not.toContain("tailwind-3.4.5");
      expect(head.querySelectorAll("script[src*='tailwind']")).toHaveLength(0);
    });

    test("links the built stylesheet, once, as the last thing in <head>", () => {
      const links: Array<HTMLLinkElement> = Array.from(
        head.querySelectorAll("link[rel='stylesheet']"),
      ).filter((link: Element): boolean => {
        return link.getAttribute("href") === STYLESHEET_HREF;
      }) as Array<HTMLLinkElement>;

      expect(links).toHaveLength(1);
      // Where the runtime put its <style>: after every other style in <head>.
      expect(head.lastElementChild).toBe(links[0]);
    });

    test("preloads it near the top of <head>, before any style", () => {
      const preload: Element | null = head.querySelector(
        `link[rel='preload'][href='${STYLESHEET_HREF}']`,
      );

      expect(preload).not.toBeNull();
      expect(preload!.getAttribute("as")).toBe("style");

      const elements: Array<Element> = Array.from(head.children);
      const firstStyle: number = elements.findIndex(
        (element: Element): boolean => {
          return element.tagName === "STYLE";
        },
      );

      expect(elements.indexOf(preload!)).toBeLessThan(firstStyle);
    });

    test("keeps the critical CSS", () => {
      expect(html).toContain("Critical CSS to prevent layout shift");
      expect(html).toContain(".max-md\\:hidden { display: none; }");
    });
  });

  describe("without a build (npm run dev)", () => {
    let html: string;

    beforeAll(async () => {
      html = await renderNotFound({});
    });

    test("loads the runtime, as it always did", () => {
      expect(html).toContain(`<script src="${RUNTIME_SCRIPT}"></script>`);
      expect(html).toContain(
        `<link rel="preload" href="${RUNTIME_SCRIPT}" as="script">`,
      );
    });

    test("and links no stylesheet", () => {
      expect(html).not.toContain("/css/tailwind.");
      expect(
        new JSDOM(html).window.document.querySelectorAll(
          "link[href*='/css/tailwind']",
        ),
      ).toHaveLength(0);
    });
  });

  test("a blog post links it last in <head> too", async () => {
    const htmlBody: string = await Markdown.convertToHTML(
      KITCHEN_SINK_MARKDOWN,
      MarkdownContentType.Blog,
    );
    const html: string = await renderView(path.join("Blog", "Post.ejs"), {
      support: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      blogPost: blogPostWith(htmlBody),
      blogTagPath: BlogTag.getPagePathOfTag,
      enableGoogleTagManager: false,
      seo: { fullCanonicalUrl: "https://oneuptime.com/blog/post/x/view" },
      tailwindStylesheetHref: STYLESHEET_HREF,
    });
    const head: HTMLHeadElement = new JSDOM(html).window.document.head;

    expect(head.lastElementChild!.outerHTML).toBe(
      `<link rel="stylesheet" href="${STYLESHEET_HREF}">`,
    );
    expect(html).not.toContain(RUNTIME_SCRIPT);
  }, 300000);

  test("every page with a <head> ends it with the stylesheet", () => {
    /*
     * Without the include a page would have neither the runtime nor the
     * stylesheet in production - unstyled. Not every page can be rendered
     * here, so this reads the templates: the include is the last thing
     * before </head>, in every one.
     */
    const pages: Array<string> = listFiles(VIEWS_ROOT, ".ejs").filter(
      (file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes("</head>");
      },
    );

    expect(pages.length).toBeGreaterThan(60);

    const missing: Array<string> = pages.filter((file: string): boolean => {
      const lines: Array<string> = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line: string): boolean => {
          return line.trim().length > 0;
        });
      const close: number = lines.indexOf("</head>");
      const relative: string = path.relative(
        path.dirname(file),
        path.join(VIEWS_ROOT, "Partials", "tailwind-stylesheet"),
      );
      const include: string = `<%- include('${relative.startsWith(".") ? relative : `./${relative}`}') -%>`;

      return close < 1 || lines[close - 1]!.trim() !== include;
    });

    expect(missing).toEqual([]);
  });

  test("and only there", () => {
    const including: Array<string> = listFiles(VIEWS_ROOT, ".ejs").filter(
      (file: string): boolean => {
        return fs
          .readFileSync(file, "utf8")
          .includes("Partials/tailwind-stylesheet");
      },
    );

    for (const file of including) {
      expect(
        fs.readFileSync(file, "utf8").split("Partials/tailwind-stylesheet")
          .length - 1,
      ).toBe(1);
    }
  });
});

describe("the image", () => {
  const template: string = fs.readFileSync(
    path.join(HOME_ROOT, "Dockerfile.tpl"),
    "utf8",
  );
  const DEVELOPMENT: string = '{{ if eq .Env.ENVIRONMENT "development" }}';
  const developmentAt: number = template.indexOf(DEVELOPMENT);
  const elseAt: number = template.indexOf("{{ else }}", developmentAt);
  const endAt: number = template.indexOf("{{ end }}", elseAt);
  const development: string = template.slice(developmentAt, elseAt);
  const production: string = template.slice(elseAt, endAt);
  const BUILD: string = "RUN npm run build:css -- --require-blog";
  const CLONE: string =
    "RUN cd /usr/src && git clone https://github.com/oneuptime/blog";

  test("builds the stylesheet in production, once", () => {
    expect(developmentAt).toBeGreaterThan(0);
    expect(production.split(BUILD).length - 1).toBe(1);
    expect(template.split("build:css").length - 1).toBe(1);
  });

  test("after the sources are in, and after the blog is cloned", () => {
    const sources: number = production.indexOf(
      "COPY --chown=1000:1000 ./packages/Home /usr/src/app",
    );

    expect(sources).toBeGreaterThan(0);
    expect(production.indexOf(CLONE)).toBeGreaterThan(sources);
    expect(production.indexOf(BUILD)).toBeGreaterThan(
      production.indexOf(CLONE),
    );
  });

  test("as node, into a build directory node owns", () => {
    const user: number = production.indexOf("USER node");
    const chown: number = production.indexOf(
      "RUN mkdir -p /usr/src/app/build && chown 1000:1000 /usr/src /usr/src/app/build",
    );

    expect(chown).toBeGreaterThan(production.indexOf("RUN npm run compile"));
    expect(user).toBeGreaterThan(chown);
    expect(production.indexOf(BUILD)).toBeGreaterThan(user);
  });

  test("and not in development, which loads the runtime", () => {
    expect(development).not.toContain("build:css");
    expect(development).toContain('CMD [ "npm", "run", "dev" ]');
  });

  test("npm run build:css runs the build script", () => {
    const packageJson: { scripts: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(HOME_ROOT, "package.json"), "utf8"),
    );

    expect(packageJson.scripts["build:css"]).toBe(
      "node -r ts-node/register/transpile-only Scripts/BuildTailwindCss.ts",
    );
  });

  test("the build fails without the blog when asked to", () => {
    const blog: string = temporaryDirectory();

    expect(countBlogPosts(path.join(blog, "missing"))).toBeNull();
    expect(countBlogPosts(blog)).toBeNull();
    expect(() => {
      return describeBlog(blog, true);
    }).toThrow(`No blog at ${blog}`);
    expect(describeBlog(blog, false)).toBe(
      `Building Tailwind CSS without the blog (nothing at ${blog}).`,
    );

    fs.mkdirSync(path.join(blog, "posts", "2026-10-13-a"), { recursive: true });
    fs.mkdirSync(path.join(blog, "posts", "2026-10-13-b"), { recursive: true });
    fs.writeFileSync(path.join(blog, "posts", "README.md"), "");

    expect(countBlogPosts(blog)).toBe(2);
    expect(describeBlog(blog, true)).toBe(
      `Building Tailwind CSS with 2 blog posts from ${blog}.`,
    );

    fs.rmSync(blog, { recursive: true, force: true });
  });
});
