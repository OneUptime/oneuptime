import {
  getLegacyRedirectTarget,
  LegacyRedirect,
  LegacyRedirects,
  LegacyRedirectSections,
  redirectLegacyUrl,
} from "../Utils/LegacyRedirects";
import { getProductCompareSlugs } from "../Utils/ProductCompare";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";

/*
 * ADDRESSES EARLIER VERSIONS OF THE SITE PUBLISHED (Utils/LegacyRedirects).
 *
 * Each answered 404 until now. These hold the table to what it promises:
 * every retired address moves permanently to a page the site really serves,
 * matched the way Express matches every other route, and the middleware
 * only ever answers what no route and no file could.
 */

const HOME_FOLDER: string = path.join(__dirname, "..");

const routesSource: string = fs.readFileSync(
  path.join(HOME_FOLDER, "Routes.ts"),
  "utf-8",
);
const blogApiSource: string = fs.readFileSync(
  path.join(HOME_FOLDER, "API", "BlogAPI.ts"),
  "utf-8",
);

function registeredGetPaths(source: string): Array<string> {
  return Array.from(
    source.matchAll(/app\.get\(\s*"([^"]+)"/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const REGISTERED_PATHS: Array<string> = [
  ...registeredGetPaths(routesSource),
  ...registeredGetPaths(blogApiSource),
];

// The source of the route registered for `routePath`, up to the next route.
function bodyOfGetRoute(routePath: string): string | null {
  const match: RegExpExecArray | null = new RegExp(
    `app\\.get\\(\\s*"${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
  ).exec(routesSource);

  if (!match) {
    return null;
  }

  const rest: string = routesSource.slice(match.index + match[0].length);
  const nextRoute: number = rest.indexOf("app.get(");

  return nextRoute === -1 ? rest : rest.slice(0, nextRoute);
}

/*
 * The audit's list (finding 9, checked against the live site on 13 October
 * 2026), plus /product/uptime-monitoring and /files/iso-27018.pdf, which the
 * old sitemap listed beside them and which answered 404 the same way.
 */
const EXPECTED_REDIRECTS: Array<[string, string]> = [
  ["/product/api-monitoring", "/product/monitoring"],
  ["/product/uptime-monitoring", "/product/monitoring"],
  ["/product/server-monitoring", "/product/host"],
  ["/product/oncall-management", "/product/on-call"],
  ["/product/public-StatusPage", "/product/status-page"],
  ["/product/private-StatusPage", "/product/status-page"],
  ["/product/app-security", "/product/security-events"],
  ["/product/docker-container-security", "/product/security-events"],
  ["/table/pagerduty", "/compare/pagerduty"],
  ["/table/pingdom", "/compare/pingdom"],
  ["/table/statuspage.io", "/compare/statuspage.io"],
  ["/files/soc-3.pdf", "/legal/soc-3"],
  ["/files/pci.pdf", "/legal/pci"],
  ["/files/iso-27001.pdf", "/legal/iso-27001"],
  ["/files/iso-27017.pdf", "/legal/iso-27017"],
  ["/files/iso-27018.pdf", "/legal/iso-27018"],
  ["/enterprise/resources", "/enterprise/overview"],
  ["/pricing-1", "/pricing"],
  ["/pricing-14", "/pricing"],
  ["/rss", "/blog/rss.xml"],
  ["/customers", "/"],
];

const ALL_ENTRIES: Array<LegacyRedirect> = [
  ...LegacyRedirects,
  ...LegacyRedirectSections,
];

describe("the legacy address table", () => {
  test.each(EXPECTED_REDIRECTS)(
    "%s moves to %s",
    (from: string, to: string) => {
      expect(getLegacyRedirectTarget(from)).toBe(to);
    },
  );

  test("holds exactly the retired addresses, so adding or dropping one is deliberate", () => {
    expect(
      LegacyRedirects.map((redirect: LegacyRedirect): [string, string] => {
        return [redirect.from, redirect.to];
      }),
    ).toEqual(EXPECTED_REDIRECTS);
    expect(LegacyRedirectSections).toEqual([
      { from: "/enterprise/download-resource", to: "/enterprise/overview" },
    ]);
  });

  test("names each retired address once, whatever its letter case", () => {
    const keys: Array<string> = ALL_ENTRIES.map(
      (redirect: LegacyRedirect): string => {
        return redirect.from.toLowerCase();
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("never sends a visitor through two redirects", () => {
    for (const redirect of ALL_ENTRIES) {
      expect([redirect.to, getLegacyRedirectTarget(redirect.to)]).toEqual([
        redirect.to,
        null,
      ]);
      // ...nor to one of the site's own short aliases.
      const body: string | null = bodyOfGetRoute(redirect.to);

      if (body !== null) {
        expect([redirect.to, body.toLowerCase().includes("redirect")]).toEqual([
          redirect.to,
          false,
        ]);
      }
    }
  });

  test("every address is a path of its own, never the home page", () => {
    for (const redirect of ALL_ENTRIES) {
      expect(redirect.from).toMatch(/^\/[^/?#]/);
      expect(redirect.from).not.toMatch(/[?#]/);
      expect(redirect.from.endsWith("/")).toBe(false);
      expect(redirect.to).toMatch(/^\//);
    }
  });
});

describe("where the retired addresses go", () => {
  test.each(
    Array.from(
      new Set(
        ALL_ENTRIES.map((redirect: LegacyRedirect): string => {
          return redirect.to;
        }),
      ),
      (target: string): [string] => {
        return [target];
      },
    ),
  )("%s is a page the site serves", (target: string) => {
    const compare: RegExpMatchArray | null =
      target.match(/^\/compare\/([^/]+)$/);

    if (compare) {
      // Served by the /compare/:product route, for the products it knows.
      expect(REGISTERED_PATHS).toContain("/compare/:product");
      expect(getProductCompareSlugs()).toContain(compare[1]);
      return;
    }

    expect(REGISTERED_PATHS).toContain(target);
  });

  test("no retired address is still a route, which would answer before the table", () => {
    const registered: Set<string> = new Set(
      REGISTERED_PATHS.map((routePath: string): string => {
        return routePath.toLowerCase();
      }),
    );

    for (const redirect of LegacyRedirects) {
      expect([
        redirect.from,
        registered.has(redirect.from.toLowerCase()),
      ]).toEqual([redirect.from, false]);
    }

    for (const section of LegacyRedirectSections) {
      const sectionPath: string = section.from.toLowerCase();

      expect(
        REGISTERED_PATHS.filter((routePath: string): boolean => {
          const candidate: string = routePath.toLowerCase();

          return (
            candidate === sectionPath || candidate.startsWith(`${sectionPath}/`)
          );
        }),
      ).toEqual([]);
    }
  });

  test("no retired address is a file of the site's static folder, which is served first", () => {
    for (const redirect of ALL_ENTRIES) {
      expect([
        redirect.from,
        fs.existsSync(path.join(HOME_FOLDER, "Static", redirect.from)),
      ]).toEqual([redirect.from, false]);
    }
  });
});

describe("matching an address", () => {
  test.each([
    ["/Product/Public-StatusPage", "/product/status-page"],
    ["/product/public-statuspage", "/product/status-page"],
    ["/PRODUCT/PRIVATE-STATUSPAGE", "/product/status-page"],
    ["/Customers", "/"],
    ["/RSS", "/blog/rss.xml"],
    ["/Files/SOC-3.pdf", "/legal/soc-3"],
  ])(
    "ignores letter case, as Express does: %s",
    (requested: string, target: string) => {
      expect(getLegacyRedirectTarget(requested)).toBe(target);
    },
  );

  test.each([
    ["/customers/", "/"],
    ["/rss/", "/blog/rss.xml"],
    ["/product/api-monitoring/", "/product/monitoring"],
  ])(
    "allows one trailing slash, as Express does: %s",
    (requested: string, target: string) => {
      expect(getLegacyRedirectTarget(requested)).toBe(target);
    },
  );

  test.each([
    ["/enterprise/download-resource"],
    ["/enterprise/download-resource/"],
    ["/enterprise/download-resource/soc-2-type-ii-report"],
    ["/enterprise/download-resource/whitepaper/observability"],
    ["/Enterprise/Download-Resource/ISO-27001"],
  ])("takes the whole retired resources section: %s", (requested: string) => {
    expect(getLegacyRedirectTarget(requested)).toBe("/enterprise/overview");
  });

  test.each([
    ["/"],
    [""],
    ["/product/monitoring"],
    ["/product/status-page"],
    ["/product/api-monitoring/extra"],
    ["/product/api-monitoringx"],
    ["/table/pagerduty/extra"],
    ["/table/datadog"],
    ["/table"],
    ["/files/soc-2.pdf"],
    ["/files/soc-3.pdf.bak"],
    ["/files"],
    ["/pricing"],
    ["/pricing-2"],
    ["/pricing-140"],
    ["/rss.xml"],
    ["/blog/rss"],
    ["/customers-stories"],
    ["/customers//"],
    ["/enterprise"],
    ["/enterprise/resources/whitepaper"],
    ["/enterprise/download-resources"],
    ["/enterprise/download-resource-old"],
    ["/legal/soc-3"],
  ])("leaves every other address alone: %s", (requested: string) => {
    expect(getLegacyRedirectTarget(requested)).toBeNull();
  });
});

interface Outcome {
  redirectedWith: Array<unknown> | null;
  nextCalls: number;
}

function runMiddleware(method: string, url: string): Outcome {
  const outcome: Outcome = { redirectedWith: null, nextCalls: 0 };
  const separator: number = url.indexOf("?");

  const req: ExpressRequest = {
    method: method,
    path: separator === -1 ? url : url.slice(0, separator),
    originalUrl: url,
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    redirect: (...args: Array<unknown>): void => {
      outcome.redirectedWith = args;
    },
  } as unknown as ExpressResponse;

  const next: NextFunction = (): void => {
    outcome.nextCalls++;
  };

  redirectLegacyUrl(req, res, next);

  return outcome;
}

describe("redirectLegacyUrl", () => {
  test("moves a retired address permanently, keeping the query a paid click carries", () => {
    expect(
      runMiddleware(
        "GET",
        "/product/api-monitoring?gclid=EAIaIQobChMI&utm_source=google",
      ),
    ).toEqual({
      redirectedWith: [
        301,
        "/product/monitoring?gclid=EAIaIQobChMI&utm_source=google",
      ],
      nextCalls: 0,
    });
  });

  test.each(EXPECTED_REDIRECTS)(
    "GET %s answers 301 to %s",
    (from: string, to: string) => {
      expect(runMiddleware("GET", from)).toEqual({
        redirectedWith: [301, to],
        nextCalls: 0,
      });
    },
  );

  test("answers HEAD the way it answers GET", () => {
    expect(runMiddleware("HEAD", "/customers")).toEqual({
      redirectedWith: [301, "/"],
      nextCalls: 0,
    });
  });

  test.each([["POST"], ["PUT"], ["PATCH"], ["DELETE"], ["OPTIONS"]])(
    "hands a %s on untouched, as an app.get route would",
    (method: string) => {
      expect(runMiddleware(method, "/customers")).toEqual({
        redirectedWith: null,
        nextCalls: 1,
      });
    },
  );

  test("hands any other address on untouched", () => {
    for (const url of [
      "/",
      "/pricing?gclid=abc",
      "/no-such-page",
      "/js/x.js",
    ]) {
      expect([url, runMiddleware("GET", url)]).toEqual([
        url,
        { redirectedWith: null, nextCalls: 1 },
      ]);
    }
  });
});

describe("wiring in Routes.ts", () => {
  test("the table is consulted once, after the static files and before the not-found page", () => {
    const registration: string = "app.use(redirectLegacyUrl);";
    const at: number = routesSource.indexOf(registration);
    const staticFiles: number = routesSource.indexOf(
      "ExpressStatic(StaticPath",
    );
    const catchAll: number = routesSource.indexOf('app.get("/*"');

    expect(routesSource.split(registration)).toHaveLength(2);
    expect(staticFiles).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    // After every route, so it can never shadow a page...
    expect(at).toBeGreaterThan(
      routesSource.lastIndexOf("app.get(", catchAll - 1),
    );
    expect(at).toBeGreaterThan(staticFiles);
    // ...and before the page that says there is nothing here.
    expect(at).toBeLessThan(catchAll);
    expect(routesSource).toContain(
      'import { redirectLegacyUrl } from "./Utils/LegacyRedirects";',
    );
  });
});
