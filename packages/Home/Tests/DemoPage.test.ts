import { DEMO_PAGE_PATH, DEMO_SHORT_PATHS } from "../Utils/DemoPage";
import { AIR_GAPPED_SHORT_PATHS } from "../Utils/AirGapped";
import {
  LegacyRedirect,
  LegacyRedirects,
  LegacyRedirectSections,
  getLegacyRedirectTarget,
} from "../Utils/LegacyRedirects";
import PageSEOConfig, { PageSEOData, getPageSEO } from "../Utils/PageSEO";
import { REDIRECT_PATHS, isRedirectPath } from "../Utils/Sitemap";
import {
  generateLlmsFullTxt,
  generateLlmsTxt,
  generatePageMarkdown,
  generateProductsJson,
} from "../Utils/AIDiscovery";
import Reviews from "../Utils/Reviews";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * ONEUPTIME.COM/DEMO, AND EVERY OTHER WAY TO THE DEMO PAGE.
 *
 * oneuptime.com/demo answered 404, and so did every other way people write
 * it. Those addresses (Utils/DemoPage.ts) now move permanently to the demo
 * page, /enterprise/demo. These hold the list to the routes that answer it,
 * keep the addresses out of the sitemap and out of every canonical tag, and
 * read every link to the demo page the repository writes - Home's pages and
 * data, the docs in every language, the Dashboard, the Admin Dashboard, the
 * emails and the shared components - to check each one names the page
 * itself.
 *
 * RouteResponses.test.ts asks the real route table over HTTP what each
 * address answers; the ingress suite (packages/Nginx) checks that nginx
 * sends each one to Home at all.
 */

const HOME: string = path.join(__dirname, "..");
const REPOSITORY: string = path.join(HOME, "..", "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const HOME_URL: string = "https://oneuptime.com";

const routesSource: string = fs.readFileSync(
  path.join(HOME, "Routes.ts"),
  "utf-8",
);
const blogApiSource: string = fs.readFileSync(
  path.join(HOME, "API", "BlogAPI.ts"),
  "utf-8",
);
const sitemapSource: string = fs.readFileSync(
  path.join(HOME, "Utils", "Sitemap.ts"),
  "utf-8",
);

// What every short address's route does, and nothing else.
const PERMANENT_REDIRECT_TO_THE_PAGE: string =
  'redirectPreservingQuery(req, res, "/enterprise/demo", 301);';

// Every path Routes.ts registers a GET route on, as written.
const GET_ROUTE_PATH: RegExp = /app\.get\(\s*"([^"]+)"/g;

// The path an app.get( call starting here registers.
const GET_ROUTE_PATH_HERE: RegExp = /^app\.get\(\s*"([^"]+)"/;

const SEGMENT_WORD: RegExp = /^[a-z-]+$/;

// The two settings that would make Express match paths more strictly.
const ROUTER_MATCHING_SETTING: RegExp =
  /strict routing|case sensitive routing|caseSensitive/i;

const registeredGetPaths: Array<string> = Array.from(
  routesSource.matchAll(GET_ROUTE_PATH),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
);

/*
 * Where the route for `routePath` is declared, on one line or with its path
 * on a line of its own, as Prettier lays it out.
 */
function declarationIndexOf(routePath: string): number {
  const inline: number = routesSource.indexOf(`app.get("${routePath}"`);

  if (inline !== -1) {
    return inline;
  }

  return routesSource.indexOf(`app.get(\n      "${routePath}",`);
}

/*
 * The source of the route registered for `routePath`, up to the next
 * app.get(: indexOf rather than one regex over thousands of lines.
 */
function bodyOfGetRoute(routePath: string): string | null {
  const start: number = declarationIndexOf(routePath);

  if (start === -1) {
    return null;
  }

  const next: number = routesSource.indexOf("app.get(", start + 1);

  return routesSource.slice(start, next === -1 ? undefined : next);
}

// Each path whose route moves people to the demo page, in the route table.
function routesRedirectingToThePage(): Array<string> {
  const paths: Array<string> = [];
  let from: number = routesSource.indexOf(PERMANENT_REDIRECT_TO_THE_PAGE);

  while (from !== -1) {
    const declaration: number = routesSource.lastIndexOf("app.get(", from);
    const match: RegExpMatchArray | null = routesSource
      .slice(declaration)
      .match(GET_ROUTE_PATH_HERE);

    expect(match).not.toBeNull();
    paths.push(match![1]!);

    from = routesSource.indexOf(
      PERMANENT_REDIRECT_TO_THE_PAGE,
      from + PERMANENT_REDIRECT_TO_THE_PAGE.length,
    );
  }

  return paths;
}

/*
 * ---------------------------------------------------------------------------
 * Telling a link to the demo page from any other.
 * ---------------------------------------------------------------------------
 */

// An address on oneuptime.com, written out in full.
const ONEUPTIME_ADDRESS: RegExp =
  /https?:\/\/(?:www\.)?oneuptime\.com(\/[^\s"'`<>()[\]{}\\,|]*)?/gi;

/*
 * An address on the site written from its root, the way Home's pages and
 * data write their links: in quotes, in a Markdown link, right after a tag
 * or after a template's ${baseUrl}.
 */
const SITE_ADDRESS: RegExp =
  /(?<=["'`(>}])\/[A-Za-z0-9][^\s"'`<>()[\]{}\\,|]*/g;

// Sentence punctuation after an address in prose ("... at https://oneuptime.com/enterprise/demo.").
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?]+$/;

/*
 * The address's path, as Express compares it with a route: letter case
 * does not matter, nor does one trailing slash.
 */
function pathOf(address: string): string {
  const end: number = address.search(/[?#]/);
  const sitePath: string = (end === -1 ? address : address.slice(0, end))
    .toLowerCase()
    .trim();

  return sitePath.length > 1 && sitePath.endsWith("/")
    ? sitePath.slice(0, -1)
    : sitePath;
}

/*
 * Whether an address is meant for the demo page: the page itself or its
 * Markdown copy, one of its short addresses, or any other one word asking
 * for a demo at the site's root or under /enterprise - /demos,
 * /demo-request, /enterprise/book-a-demo - which would be a 404.
 */
function isDemoAddress(address: string): boolean {
  const sitePath: string = pathOf(address);

  if (
    sitePath === DEMO_PAGE_PATH ||
    sitePath === `${DEMO_PAGE_PATH}.md` ||
    DEMO_SHORT_PATHS.includes(sitePath)
  ) {
    return true;
  }

  const segments: Array<string> = sitePath.split("/").slice(1);
  const word: string = (segments[segments.length - 1] || "").replace(
    /\.md$/,
    "",
  );
  const atTheRootOrUnderEnterprise: boolean =
    segments.length === 1 ||
    (segments.length === 2 && segments[0] === "enterprise");

  return (
    atTheRootOrUnderEnterprise &&
    SEGMENT_WORD.test(word) &&
    word.includes("demo")
  );
}

/*
 * Whether a link to the demo page names the page itself, exactly as the
 * site's click tracking matches it (a[href="/enterprise/demo"] in
 * Views/head-basic.ejs): no short address, no other letter case, no
 * trailing slash. A query or a fragment may follow.
 */
function namesThePage(address: string): boolean {
  const end: number = address.search(/[?#]/);
  const sitePath: string = end === -1 ? address : address.slice(0, end);

  return sitePath === DEMO_PAGE_PATH || sitePath === `${DEMO_PAGE_PATH}.md`;
}

/*
 * Every address for the demo page in `text`: absolute oneuptime.com
 * addresses anywhere, and addresses from the site's root too where the
 * text is the site's own.
 */
function demoAddressesIn(
  text: string,
  options: { siteRelative: boolean },
): Array<string> {
  const addresses: Array<string> = [];

  for (const match of text.matchAll(ONEUPTIME_ADDRESS)) {
    addresses.push((match[1] || "/").replace(TRAILING_PUNCTUATION, ""));
  }

  if (options.siteRelative) {
    for (const match of text.matchAll(SITE_ADDRESS)) {
      addresses.push(match[0].replace(TRAILING_PUNCTUATION, ""));
    }
  }

  return addresses.filter(isDemoAddress);
}

// Text another package writes, and the addresses for the demo page in it.
const FULL_ADDRESSES: Array<[string, Array<string>]> = [
  ["https://oneuptime.com/enterprise/demo", ["/enterprise/demo"]],
  ["[contact us](https://oneuptime.com/enterprise/demo)", ["/enterprise/demo"]],
  [
    "Custom pricing - contact sales at https://oneuptime.com/enterprise/demo.",
    ["/enterprise/demo"],
  ],
  [
    '"https://oneuptime.com/enterprise/demo?utm_source=google&gclid=abc"',
    ["/enterprise/demo?utm_source=google&gclid=abc"],
  ],
  [
    "https://www.oneuptime.com/enterprise/demo#book-demo",
    ["/enterprise/demo#book-demo"],
  ],
  ["https://oneuptime.com/demo", ["/demo"]],
  ["https://oneuptime.com/demo/?utm_source=x", ["/demo/?utm_source=x"]],
  ["http://oneuptime.com/Request-A-Demo", ["/Request-A-Demo"]],
  ["https://oneuptime.com/contact-sales", ["/contact-sales"]],
  ["https://oneuptime.com/enterprise/demos", ["/enterprise/demos"]],
  ["https://oneuptime.com/demo-request", ["/demo-request"]],
  ["https://oneuptime.com/Enterprise/Demo", ["/Enterprise/Demo"]],
  ["https://oneuptime.com/enterprise/demo/", ["/enterprise/demo/"]],
  ["https://oneuptime.com/enterprise/demo.md", ["/enterprise/demo.md"]],
  [
    "Book at https://oneuptime.com/demo, or see https://oneuptime.com/pricing.",
    ["/demo"],
  ],
];

// Text another package writes, with no address for the demo page in it.
const NO_DEMO_ADDRESS: Array<[string]> = [
  ["https://oneuptime.com/pricing"],
  ["https://oneuptime.com/enterprise/overview"],
  ["https://oneuptime.com/docs/monitor/demo-project"],
  ["https://oneuptime.com/js/demo.js"],
  ["https://oneuptime.com"],
  ["https://cal.com/oneuptimehq/demo"],
  ["https://oneuptime.com.example.org/demo"],
  ["mailto:sales@oneuptime.com"],
  // Another app's own address, which only the site's text is read for.
  ['href="/enterprise/demo"'],
];

// The site's own text, and the addresses for the demo page in it.
const SITE_TEXT: Array<[string, Array<string>]> = [
  ['<a href="/enterprise/demo" class="x">', ["/enterprise/demo"]],
  ["{ href: '/enterprise/demo', label: 'Request Demo' }", ["/enterprise/demo"]],
  ['sourceUrl: "/enterprise/demo",', ["/enterprise/demo"]],
  [
    "- [Request a demo](${baseUrl}/enterprise/demo.md)",
    ["/enterprise/demo.md"],
  ],
  ["<%= homeUrl %>/enterprise/demo", ["/enterprise/demo"]],
  ['<a href="/demo">', ["/demo"]],
  ['<a href="/book-a-demo?ref=nav">', ["/book-a-demo?ref=nav"]],
  ['<a href="https://oneuptime.com/schedule-demo">', ["/schedule-demo"]],
  ['<a href="#book-demo">', []],
  ['<script src="/js/demo.js"></script>', []],
  ['<a href="/accounts/register">', []],
  ['"/usr/src/app/Views"', []],
];

// An address for the demo page, and whether it names the page itself.
const NAMES_THE_PAGE: Array<[string, boolean]> = [
  ["/enterprise/demo", true],
  ["/enterprise/demo?gclid=abc", true],
  ["/enterprise/demo#book-demo", true],
  ["/enterprise/demo.md", true],
  ["/enterprise/demo/", false],
  ["/Enterprise/Demo", false],
  ["/demo", false],
  ["/request-demo?utm_source=x", false],
  ["/enterprise/demos", false],
];

describe("telling a link to the demo page from any other", () => {
  test.each(FULL_ADDRESSES)(
    "finds the address for the demo page in %s",
    (text: string, expected: Array<string>) => {
      expect(demoAddressesIn(text, { siteRelative: false })).toEqual(expected);
    },
  );

  test.each(NO_DEMO_ADDRESS)(
    "finds no address for the demo page in %s, read as another package's text",
    (text: string) => {
      expect(demoAddressesIn(text, { siteRelative: false })).toEqual([]);
    },
  );

  test.each(SITE_TEXT)(
    "reads the site's own text for addresses from its root too: %s",
    (text: string, expected: Array<string>) => {
      expect(demoAddressesIn(text, { siteRelative: true })).toEqual(expected);
    },
  );

  test.each(NAMES_THE_PAGE)(
    "%s names the page itself: %s",
    (address: string, expected: boolean) => {
      expect(namesThePage(address)).toBe(expected);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The addresses.
 * ---------------------------------------------------------------------------
 */

describe("the demo page's short addresses", () => {
  test("lead to /enterprise/demo, the page every demo button opens", () => {
    expect(DEMO_PAGE_PATH).toBe("/enterprise/demo");
  });

  test("are the ones people type, so adding or dropping one is deliberate", () => {
    expect(DEMO_SHORT_PATHS).toEqual([
      "/demo",
      "/request-demo",
      "/request-a-demo",
      "/book-demo",
      "/book-a-demo",
      "/schedule-demo",
      "/schedule-a-demo",
      "/get-demo",
      "/get-a-demo",
      "/contact-sales",
      "/enterprise/request-demo",
    ]);
  });

  test("each is a lower-case path of whole words, with no trailing slash, query or fragment", () => {
    for (const shortPath of DEMO_SHORT_PATHS) {
      const segments: Array<string> = shortPath.split("/").slice(1);

      expect([
        shortPath,
        shortPath.startsWith("/"),
        segments.length > 0 &&
          segments.every((segment: string): boolean => {
            return (
              SEGMENT_WORD.test(segment) &&
              !segment.startsWith("-") &&
              !segment.endsWith("-") &&
              !segment.includes("--")
            );
          }),
      ]).toEqual([shortPath, true, true]);
    }
  });

  test("each is named once, and none is the page itself or another page's short address", () => {
    const lowerCased: Array<string> = DEMO_SHORT_PATHS.map(
      (shortPath: string): string => {
        return shortPath.toLowerCase();
      },
    );

    expect(new Set(lowerCased).size).toBe(DEMO_SHORT_PATHS.length);
    expect(lowerCased).not.toContain(DEMO_PAGE_PATH);

    for (const otherShortPath of AIR_GAPPED_SHORT_PATHS) {
      expect(lowerCased).not.toContain(otherShortPath.toLowerCase());
    }
  });

  test("none is an address the legacy table moves, and the table moves nothing to one", () => {
    for (const shortPath of DEMO_SHORT_PATHS) {
      expect([shortPath, getLegacyRedirectTarget(shortPath)]).toEqual([
        shortPath,
        null,
      ]);
    }

    for (const redirect of [...LegacyRedirects, ...LegacyRedirectSections]) {
      expect([
        redirect.to,
        DEMO_SHORT_PATHS.includes(redirect.to.toLowerCase()),
      ]).toEqual([redirect.to, false]);
    }

    expect(
      [...LegacyRedirects, ...LegacyRedirectSections].map(
        (redirect: LegacyRedirect): string => {
          return redirect.to;
        },
      ),
    ).not.toContain(DEMO_PAGE_PATH);
  });

  test("each is matched for what people type: every letter case, and one trailing slash", () => {
    /*
     * Express's defaults, which the server keeps: a route matches whatever
     * the letter case, and "/demo/" is "/demo". Turning on strict or
     * case-sensitive routing would leave "/Demo" and "/demo/" at the
     * not-found page. RouteResponses.test.ts asks both over HTTP, on an
     * app made the way the server makes it.
     */
    for (const file of [
      path.join(
        REPOSITORY,
        "packages",
        "Common",
        "Server",
        "Utils",
        "Express.ts",
      ),
      path.join(
        REPOSITORY,
        "packages",
        "Common",
        "Server",
        "Utils",
        "StartServer.ts",
      ),
      path.join(HOME, "Routes.ts"),
      path.join(HOME, "Index.ts"),
    ]) {
      expect([
        path.basename(file),
        ROUTER_MATCHING_SETTING.test(fs.readFileSync(file, "utf-8")),
      ]).toEqual([path.basename(file), false]);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * The routes.
 * ---------------------------------------------------------------------------
 */

describe("the routes that answer them", () => {
  test("the page is registered and renders its own template with its own SEO entry", () => {
    const body: string | null = bodyOfGetRoute(DEMO_PAGE_PATH);

    expect(body).not.toBeNull();
    expect(body).toContain("res.render(`${ViewsPath}/demo`");
    expect(body).toMatch(
      /getSEOForPath\(\s*"\/enterprise\/demo",\s*res\.locals/,
    );
    expect(body).not.toContain("redirectPreservingQuery(");
    expect(fs.existsSync(path.join(VIEWS_ROOT, "demo.ejs"))).toBe(true);
  });

  test.each(
    DEMO_SHORT_PATHS.map((shortPath: string): [string] => {
      return [shortPath];
    }),
  )(
    "%s is registered once, and only moves people permanently to the page, keeping the query",
    (shortPath: string) => {
      expect(
        registeredGetPaths.filter((registered: string): boolean => {
          return registered.toLowerCase() === shortPath;
        }),
      ).toEqual([shortPath]);

      const body: string = bodyOfGetRoute(shortPath)!;

      expect(body.split(PERMANENT_REDIRECT_TO_THE_PAGE)).toHaveLength(2);
      expect(body).toContain("(req: ExpressRequest, res: ExpressResponse)");
      expect(body).not.toContain("res.render(");
      expect(body).not.toContain("res.redirect(");
      expect(body).not.toContain("getSEOForPath(");
    },
  );

  test("every route that moves people to the page is one of the short addresses", () => {
    /*
     * The list and the routes cannot drift apart: an address registered
     * here and missing from the list would be in the sitemap (which skips
     * the list), and one in the list with no route would be a 404.
     */
    expect(routesRedirectingToThePage().sort()).toEqual(
      [...DEMO_SHORT_PATHS].sort(),
    );
  });

  test("each is registered before the not-found page, which would otherwise answer it", () => {
    const notFound: number = routesSource.indexOf('app.get("/*"');

    expect(notFound).toBeGreaterThan(-1);

    for (const shortPath of DEMO_SHORT_PATHS) {
      const declaration: number = declarationIndexOf(shortPath);

      expect([shortPath, declaration > -1, declaration < notFound]).toEqual([
        shortPath,
        true,
        true,
      ]);
    }
  });

  test("the blog registers none of them, so nothing answers first", () => {
    for (const shortPath of DEMO_SHORT_PATHS) {
      expect(blogApiSource).not.toContain(`"${shortPath}"`);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Search engines, and machines reading the site.
 * ---------------------------------------------------------------------------
 */

async function renderDemoPage(): Promise<string> {
  const seo: PageSEOData = getPageSEO(DEMO_PAGE_PATH);

  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, "demo.ejs"),
    {
      support: false,
      enableGoogleTagManager: false,
      footerCards: false,
      cta: false,
      blackLogo: true,
      requestDemoCta: false,
      ...Reviews,
      seo: { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` },
      homeUrl: HOME_URL,
    },
    { views: [VIEWS_ROOT] },
  )) as string;
}

describe("search engines and the sitemap", () => {
  test("the sitemap leaves every short address out, and lists the page", () => {
    for (const shortPath of DEMO_SHORT_PATHS) {
      expect([
        shortPath,
        REDIRECT_PATHS.has(shortPath),
        isRedirectPath(shortPath),
      ]).toEqual([shortPath, true, true]);
    }

    expect(isRedirectPath(DEMO_PAGE_PATH)).toBe(false);
    expect(sitemapSource).toContain(
      '"/enterprise/demo": { priority: 0.9, changefreq: "weekly" }',
    );
  });

  test("no page describes itself at a short address, and no breadcrumb leads through one", () => {
    for (const shortPath of DEMO_SHORT_PATHS) {
      expect([shortPath, PageSEOConfig[shortPath]]).toEqual([
        shortPath,
        undefined,
      ]);
    }

    for (const seo of Object.values(PageSEOConfig)) {
      for (const address of [
        seo.canonicalPath,
        ...seo.breadcrumbs.map((crumb: { url: string }): string => {
          return crumb.url;
        }),
      ]) {
        expect([
          seo.canonicalPath,
          address,
          DEMO_SHORT_PATHS.includes(address.toLowerCase()),
        ]).toEqual([seo.canonicalPath, address, false]);
      }
    }
  });

  test("the page's own entry names it as the canonical address, under Enterprise", () => {
    const seo: PageSEOData | undefined = PageSEOConfig[DEMO_PAGE_PATH];

    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe(DEMO_PAGE_PATH);
    expect(seo!.pageType).toBe("enterprise");
    expect(
      seo!.breadcrumbs.map((crumb: { url: string }): string => {
        return crumb.url;
      }),
    ).toEqual(["/", "/enterprise/overview", DEMO_PAGE_PATH]);
    expect(getPageSEO(DEMO_PAGE_PATH)).toBe(seo);
  });

  test("the rendered page has one canonical tag and one og:url, both naming the page", async () => {
    const document: Document = new JSDOM(await renderDemoPage()).window
      .document;

    expect(
      Array.from(document.querySelectorAll('link[rel="canonical"]')).map(
        (link: Element): string | null => {
          return link.getAttribute("href");
        },
      ),
    ).toEqual([`${HOME_URL}${DEMO_PAGE_PATH}`]);
    expect(
      Array.from(document.querySelectorAll('meta[property="og:url"]')).map(
        (meta: Element): string | null => {
          return meta.getAttribute("content");
        },
      ),
    ).toEqual([`${HOME_URL}${DEMO_PAGE_PATH}`]);
  });

  test("llms.txt, llms-full.txt, products.json and every page's Markdown copy name the page, never a short address", () => {
    const texts: Array<string> = [
      generateLlmsTxt(HOME_URL, []),
      generateLlmsFullTxt(HOME_URL, []),
      JSON.stringify(generateProductsJson(HOME_URL)),
      ...Object.values(PageSEOConfig).map((seo: PageSEOData): string => {
        return generatePageMarkdown(seo, HOME_URL);
      }),
    ];
    const addresses: Array<string> = texts.flatMap(
      (text: string): Array<string> => {
        return demoAddressesIn(text, { siteRelative: false });
      },
    );

    // llms.txt lists the page with the other ways to buy.
    expect(addresses.length).toBeGreaterThan(0);
    expect(
      addresses.filter((address: string): boolean => {
        return !namesThePage(address);
      }),
    ).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every link to the demo page the repository writes.
 * ---------------------------------------------------------------------------
 */

interface FoundLink {
  // The file, from the repository's root, "/"-separated.
  file: string;
  // The address as written: its path, query and fragment.
  address: string;
}

/*
 * The marketing site's own sources: its pages, the data they render, its
 * API and its scripts. Their links are written from the site's root too.
 * Routes.ts and Utils/DemoPage.ts are left out: they are where the short
 * addresses are registered and listed, which the tests above read.
 */
const SITE_SOURCES: Array<string> = [
  "packages/Home/Views",
  "packages/Home/Utils",
  "packages/Home/API",
  "packages/Home/Static/js",
];

const SITE_FILES_LEFT_OUT: Array<string> = ["packages/Home/Utils/DemoPage.ts"];

/*
 * Everything else that sends people to oneuptime.com: the docs in every
 * language, the Dashboard, the Admin Dashboard, Accounts, status pages and
 * emails (all in App's FeatureSet), the shared components and the text the
 * server writes (Common), the mobile app, the CLI, the Enterprise Edition
 * and the repository's own documents. Their root-relative links are their
 * own app's, so only full oneuptime.com addresses are read.
 */
const OTHER_SOURCES: Array<string> = [
  "packages/App/FeatureSet",
  "packages/Common",
  "packages/MobileApp/src",
  "packages/CLI",
  "Docs",
  "README.md",
];

// Not there when the community edition is tested on its own.
const OPTIONAL_SOURCES: Array<string> = ["ee"];

// Tests, dependencies and build output: nobody follows a link from them.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "tests",
  "test",
  "__tests__",
  ".git",
  ".expo",
  "coverage",
]);

// What links are written in.
const LINK_FILE: RegExp = /\.(?:ts|tsx|js|mjs|cjs|ejs|md|hbs|html|json|txt)$/;

function filesIn(folder: string): Array<string> {
  const files: Array<string> = [];
  const pending: Array<string> = [folder];

  while (pending.length > 0) {
    const current: string = pending.pop()!;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          pending.push(full);
        }
      } else if (entry.isFile() && LINK_FILE.test(entry.name)) {
        files.push(full);
      }
    }
  }

  return files;
}

function filesOf(source: string): Array<string> {
  const full: string = path.join(REPOSITORY, source);

  return fs.statSync(full).isDirectory() ? filesIn(full) : [full];
}

function linksIn(
  files: Array<string>,
  options: { siteRelative: boolean },
): Array<FoundLink> {
  const links: Array<FoundLink> = [];

  for (const file of files) {
    const relative: string = path
      .relative(REPOSITORY, file)
      .split(path.sep)
      .join("/");

    if (SITE_FILES_LEFT_OUT.includes(relative)) {
      continue;
    }

    for (const address of demoAddressesIn(
      fs.readFileSync(file, "utf-8"),
      options,
    )) {
      links.push({ file: relative, address: address });
    }
  }

  return links;
}

describe("every link to the demo page the repository writes", () => {
  let links: Array<FoundLink> = [];

  beforeAll(() => {
    for (const source of [...SITE_SOURCES, ...OTHER_SOURCES]) {
      // A source that moved would quietly leave its links unread.
      expect([source, fs.existsSync(path.join(REPOSITORY, source))]).toEqual([
        source,
        true,
      ]);
    }

    links = [
      ...linksIn(SITE_SOURCES.flatMap(filesOf), { siteRelative: true }),
      ...linksIn(
        [
          ...OTHER_SOURCES,
          ...OPTIONAL_SOURCES.filter((source: string): boolean => {
            return fs.existsSync(path.join(REPOSITORY, source));
          }),
        ].flatMap(filesOf),
        { siteRelative: false },
      ),
    ];
  }, 120 * 1000);

  test("names the page itself: never a short address, another spelling, or a page that is not there", () => {
    expect(
      links
        .filter((link: FoundLink): boolean => {
          return !namesThePage(link.address);
        })
        .map((link: FoundLink): string => {
          return `${link.file}: ${link.address}`;
        }),
    ).toEqual([]);
  });

  test.each([
    ["the marketing site's pages", "packages/Home/Views/"],
    ["the marketing site's data", "packages/Home/Utils/"],
    ["the docs", "packages/App/FeatureSet/Docs/Content/"],
    ["the Dashboard", "packages/App/FeatureSet/Dashboard/"],
    ["the Admin Dashboard", "packages/App/FeatureSet/AdminDashboard/"],
    ["the shared components", "packages/Common/UI/"],
  ])("reads the links of %s", (_area: string, folder: string) => {
    // Proof that the reading above reaches every place that links the page.
    expect(
      links.filter((link: FoundLink): boolean => {
        return link.file.startsWith(folder);
      }).length,
    ).toBeGreaterThan(0);
  });

  test("reads the docs in every language they are written in", () => {
    const languages: Array<string> = fs
      .readdirSync(
        path.join(
          REPOSITORY,
          "packages",
          "App",
          "FeatureSet",
          "Docs",
          "Content",
        ),
        { withFileTypes: true },
      )
      .filter((entry: fs.Dirent): boolean => {
        return entry.isDirectory();
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      });

    expect(languages.length).toBeGreaterThanOrEqual(17);

    for (const language of languages) {
      expect([
        language,
        links.some((link: FoundLink): boolean => {
          return link.file.startsWith(
            `packages/App/FeatureSet/Docs/Content/${language}/`,
          );
        }),
      ]).toEqual([language, true]);
    }
  });
});
