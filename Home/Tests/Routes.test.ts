import { REDIRECT_PATHS, isRedirectPath } from "../Utils/Sitemap";
import PageSEOConfig, { PageSEOData } from "../Utils/PageSEO";
import fs from "fs";
import path from "path";

/*
 * Route wiring. Booting the real Express app here would drag in the blog job
 * and the database config, so these read the route table out of Routes.ts —
 * enough to catch the failure that opened this work: a commercially important
 * URL quietly returning 404 because nobody registered it.
 */

const routesSource: string = fs.readFileSync(
  path.join(__dirname, "..", "Routes.ts"),
  "utf-8",
);

/*
 * Locate a route declaration and return the source that follows it, up to the
 * next `app.get(`. Substring scanning rather than one big regex: the route
 * table is thousands of lines, and a backtracking pattern over it is a hang
 * waiting to happen.
 */
function bodyOfGetRoute(routePath: string): string | null {
  const declaration: string = `"${routePath}"`;
  let searchFrom: number = 0;

  while (searchFrom < routesSource.length) {
    const declarationIndex: number = routesSource.indexOf(
      declaration,
      searchFrom,
    );

    if (declarationIndex === -1) {
      return null;
    }

    // The declaration must be the first argument of an app.get( call.
    const preceding: string = routesSource
      .slice(Math.max(0, declarationIndex - 40), declarationIndex)
      .trim();

    if (preceding.endsWith("app.get(")) {
      const rest: string = routesSource.slice(
        declarationIndex + declaration.length,
      );
      const nextRouteIndex: number = rest.indexOf("app.get(");
      return nextRouteIndex === -1 ? rest : rest.slice(0, nextRouteIndex);
    }

    searchFrom = declarationIndex + declaration.length;
  }

  return null;
}

function hasGetRoute(routePath: string): boolean {
  return bodyOfGetRoute(routePath) !== null;
}

function redirectTargetOf(routePath: string): string | null {
  const body: string | null = bodyOfGetRoute(routePath);

  if (!body) {
    return null;
  }

  const match: RegExpMatchArray | null = body.match(
    /(?:res\.redirect\((?:301,\s*)?|redirectPreservingQuery\(\s*req,\s*res,\s*)"([^"]+)"/,
  );

  return match ? match[1]! : null;
}

/*
 * Both call shapes are recognised because the internal marketing redirects now
 * go through redirectPreservingQuery — which carries the status as a trailing
 * argument rather than a leading one — while the external install.sh routes
 * still call res.redirect directly.
 */
const PERMANENT_REDIRECT: RegExp =
  /res\.redirect\(301,|redirectPreservingQuery\([^)]*,\s*301\)/;

function redirectsPermanently(routePath: string): boolean {
  const body: string | null = bodyOfGetRoute(routePath);
  return Boolean(body && PERMANENT_REDIRECT.test(body));
}

describe("Self-hosted routes", () => {
  test("the canonical self-hosted page is registered", () => {
    expect(hasGetRoute("/enterprise/self-hosted")).toBe(true);
    expect(routesSource).toContain(`${"${ViewsPath}"}/self-hosted.ejs`);
  });

  test("the page is rendered with the self-hosted content model", () => {
    expect(routesSource).toContain("selfHosted: getSelfHostedContent()");
  });

  test.each([["/self-hosted"], ["/self-hosting"], ["/on-premise"]])(
    "%s permanently redirects to the canonical page",
    (routePath: string) => {
      expect(hasGetRoute(routePath)).toBe(true);
      expect(redirectTargetOf(routePath)).toBe("/enterprise/self-hosted");
    },
  );

  test("the short self-hosted URLs redirect permanently, not temporarily", () => {
    for (const routePath of ["/self-hosted", "/self-hosting", "/on-premise"]) {
      expect(redirectsPermanently(routePath)).toBe(true);
    }
  });
});

describe("Trust center routes", () => {
  test("/trust renders the claims matrix data", () => {
    expect(hasGetRoute("/trust")).toBe(true);
    expect(routesSource).toContain("claimsMatrix: getClaimsMatrix()");
    expect(routesSource).toContain("claimStatuses: ClaimStatuses");
    expect(routesSource).toContain(
      "claimsUnderReviewCount: getClaimsNeedingReview().length",
    );
  });

  test.each([["/security"], ["/security-center"], ["/trust-center"]])(
    "%s redirects to the canonical trust center",
    (routePath: string) => {
      expect(hasGetRoute(routePath)).toBe(true);
      expect(redirectTargetOf(routePath)).toBe("/trust");
    },
  );

  test("the claims matrix is served as JSON for machines", () => {
    expect(hasGetRoute("/data/claims.json")).toBe(true);
    expect(routesSource).toContain("statuses: ClaimStatuses");
  });
});

describe("Sitemap hygiene", () => {
  test("every redirect-only path is excluded from the sitemap", () => {
    for (const routePath of [
      "/self-hosted",
      "/self-hosting",
      "/on-premise",
      "/security",
      "/security-center",
      "/trust-center",
    ]) {
      expect(isRedirectPath(routePath)).toBe(true);
    }
  });

  test("canonical pages are not excluded", () => {
    for (const routePath of [
      "/enterprise/self-hosted",
      "/trust",
      "/pricing",
      "/enterprise/overview",
    ]) {
      expect(isRedirectPath(routePath)).toBe(false);
    }
  });

  test("pre-existing product redirects are excluded too", () => {
    // These were already redirects; they should not have been in the sitemap.
    expect(REDIRECT_PATHS.has("/status-page")).toBe(true);
    expect(REDIRECT_PATHS.has("/on-call")).toBe(true);
  });

  test("every excluded path is an actual redirect route", () => {
    for (const routePath of Array.from(REDIRECT_PATHS)) {
      expect(redirectTargetOf(routePath)).not.toBeNull();
    }
  });

  test("the self-hosted page is prioritised in the sitemap config", () => {
    const sitemapSource: string = fs.readFileSync(
      path.join(__dirname, "..", "Utils", "Sitemap.ts"),
      "utf-8",
    );

    expect(sitemapSource).toContain(
      '"/enterprise/self-hosted": { priority: 0.9, changefreq: "weekly" }',
    );
  });
});

describe("Security events product page", () => {
  /*
   * The page is only reachable because three separate registrations agree on
   * the same path: the route, the SEO entry (which is also what puts it in
   * llms.txt and products.json, via pageType "product"), and the sitemap
   * priority. Any one of them drifting leaves the page half-published.
   */
  test("the product page is registered and renders its own template", () => {
    expect(hasGetRoute("/product/security-events")).toBe(true);
    expect(routesSource).toContain(`${"${ViewsPath}"}/security-events`);
  });

  test("it is a canonical page, not a redirect", () => {
    expect(redirectTargetOf("/product/security-events")).toBeNull();
    expect(isRedirectPath("/product/security-events")).toBe(false);
  });

  test("it resolves SEO data typed as a product", () => {
    const seo: PageSEOData | undefined =
      PageSEOConfig["/product/security-events"];

    expect(seo).toBeDefined();
    expect(seo!.canonicalPath).toBe("/product/security-events");
    /*
     * getPagesByType("product") is what feeds /llms.txt, /llms-full.txt and
     * /data/products.json — a different pageType renders fine but is invisible
     * to every machine-readable index of the site.
     */
    expect(seo!.pageType).toBe("product");
  });

  test("it is prioritised in the sitemap config", () => {
    const sitemapSource: string = fs.readFileSync(
      path.join(__dirname, "..", "Utils", "Sitemap.ts"),
      "utf-8",
    );

    expect(sitemapSource).toContain(
      '"/product/security-events": { priority: 0.9, changefreq: "weekly" }',
    );
  });
});

describe("SEO registration", () => {
  test("both new canonical pages resolve their own SEO data", () => {
    for (const pagePath of ["/enterprise/self-hosted", "/trust"]) {
      const seo: PageSEOData | undefined = PageSEOConfig[pagePath];

      expect(seo).toBeDefined();
      expect(seo!.canonicalPath).toBe(pagePath);
      expect(seo!.title.length).toBeGreaterThan(10);
      expect(seo!.description.length).toBeGreaterThan(50);
    }
  });

  test("the trust center describes itself as the canonical claims source", () => {
    const seo: PageSEOData = PageSEOConfig["/trust"]!;

    expect(seo.description.toLowerCase()).toContain("claims matrix");
  });

  test("no two pages claim the same canonical path", () => {
    const canonicalPaths: Array<string> = Object.values(PageSEOConfig).map(
      (seo: PageSEOData) => {
        return seo.canonicalPath;
      },
    );

    expect(new Set(canonicalPaths).size).toBe(canonicalPaths.length);
  });
});
