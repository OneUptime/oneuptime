import PageSEOConfig, {
  ComparePageTitles,
  PageSEOData,
  getPageSEO,
} from "../Utils/PageSEO";
import ProductCompare, {
  Product,
  getProductCompareSlugs,
} from "../Utils/ProductCompare";
import Pricing, { PricingPlan, PricingPlans } from "../Utils/Pricing";
import { Claim, Claims, getClaim } from "../Utils/Claims";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * THE TITLES AND DESCRIPTIONS A SEARCH RESULT SHOWS.
 *
 * Search Console, October 2026: all thirty legal and compliance pages were
 * titled "OneUptime | Legal Center" with one generic description, so a buyer
 * searching "oneuptime soc 2" or "oneuptime dpa" saw thirty identical lines.
 * /pricing, 62,542 impressions at a 1.4% click-through rate, was titled
 * "OneUptime | One Complete Observability platform." Thirty product and
 * comparison titles ran past what a result shows: /compare/better-uptime's
 * was 84 characters, cut off before the part that sold the page.
 *
 * Utils/PageSEO.ts already held a title and description for most of these
 * pages, but only the social cards read them: every template hard-coded its
 * own <title> and meta description. These tests hold the templates to the
 * register and the register to what fits in a search result.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

/*
 * Search results cut a title off at about 600 pixels, which is 55 to 65
 * characters of ordinary text. 60 keeps the whole line, brand included.
 */
const TITLE_LIMIT: number = 60;

// What a result shows of a description before it is cut off.
const DESCRIPTION_LIMIT: number = 160;

const BRAND_SUFFIX: string = " | OneUptime";

/*
 * Words the claims matrix (Utils/Claims.ts) governs: "certified" belongs
 * only to the standards that certify OneUptime, it holds no FedRAMP
 * designation (its authorization is in progress), and the SLA makes no
 * guarantee.
 */
const CERTIFICATION: RegExp = /certif/i;
const FEDRAMP_DESIGNATION: RegExp =
  /\bFedRAMP (?:Ready|Authorized|Certified)\b/i;
const GUARANTEE: RegExp = /guarantee/i;

const routesSource: string = fs.readFileSync(
  path.join(__dirname, "..", "Routes.ts"),
  "utf-8",
);

type SEOForTemplate = PageSEOData & { fullCanonicalUrl: string };

interface RenderedElement {
  attributes: string;
  body: string;
}

function seoFor(pagePath: string): SEOForTemplate {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function render(
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
}

/*
 * A template's <head>: the page body holds inline SVG icons, and an SVG's
 * <title> is its accessible name, not the document's.
 */
function headOf(source: string): string {
  const headEnd: number = source.indexOf("</head>");

  return headEnd === -1 ? source : source.slice(0, headEnd);
}

// Every path Routes.ts registers with app.get("..."), in order, once each.
function routePaths(): Array<string> {
  return [
    ...new Set<string>(
      [...routesSource.matchAll(/app\.get\(\s*"([^"]+)"/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  ];
}

/*
 * The source of the first app.get( declaration of a path, up to the next
 * one: the handler Express runs. Substring scanning rather than one big
 * regex, as in Routes.test.ts.
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

function elementsIn(html: string, tag: string): Array<RenderedElement> {
  return [
    ...html.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi"),
    ),
  ].map((match: RegExpMatchArray): RenderedElement => {
    return { attributes: match[1]!, body: match[2]! };
  });
}

function openingTags(html: string, tag: string): Array<string> {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
}

function attributeValue(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];
}

// The content of every <meta> whose name or property is `name`.
function metaContents(html: string, name: string): Array<string> {
  return openingTags(html, "meta")
    .filter((meta: string): boolean => {
      return (
        attributeValue(meta, "name") === name ||
        attributeValue(meta, "property") === name
      );
    })
    .map((meta: string): string => {
      return attributeValue(meta, "content") || "";
    });
}

function canonicalUrlsIn(html: string): Array<string> {
  return openingTags(html, "link")
    .filter((link: string): boolean => {
      return attributeValue(link, "rel") === "canonical";
    })
    .map((link: string): string => {
      return attributeValue(link, "href") || "";
    });
}

/*
 * EJS escapes `<%= %>` output, so assertions against rendered HTML compare
 * against the escaped form of the source string.
 */
function escapeForHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
}

/*
 * The head a search engine reads: one <title> and one meta description, the
 * page's own, and the same title in its social card and canonical URL.
 */
function expectHeadFrom(html: string, seo: SEOForTemplate): void {
  const titles: Array<RenderedElement> = elementsIn(html, "title");

  expect([seo.canonicalPath, titles.length]).toEqual([seo.canonicalPath, 1]);
  expect(titles[0]!.body).toBe(escapeForHtml(seo.title));
  expect(metaContents(html, "description")).toEqual([
    escapeForHtml(seo.description),
  ]);
  expect(metaContents(html, "og:title")).toEqual([escapeForHtml(seo.title)]);
  expect(metaContents(html, "og:description")).toEqual([
    escapeForHtml(seo.description),
  ]);
  expect(canonicalUrlsIn(html)).toEqual([seo.fullCanonicalUrl]);
}

// Every page the site describes: the register, plus every comparison page.
const comparePaths: Array<string> = getProductCompareSlugs().map(
  (slug: string): string => {
    return `/compare/${slug}`;
  },
);

const allPages: Array<[string, PageSEOData]> = [
  ...Object.entries(PageSEOConfig),
  ...comparePaths.map((comparePath: string): [string, PageSEOData] => {
    return [comparePath, getPageSEO(comparePath)];
  }),
];

const legalPaths: Array<string> = [
  ...new Set<string>(
    [...routesSource.matchAll(/app\.get\(\s*"(\/legal\/[^"]+)"/g)].map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  ),
].sort();

// What /legal and every legal page used to be titled.
const OLD_LEGAL_TITLE: string = "OneUptime | Legal Center";

describe("every title fits in a search result", () => {
  test("the walk covers the register and every comparison page", () => {
    // An empty walk would pass every assertion below without checking a thing.
    expect(allPages.length).toBeGreaterThan(110);
    expect(comparePaths.length).toBe(getProductCompareSlugs().length);
  });

  test.each(allPages)(
    "%s has a title of at most 60 characters",
    (_pagePath: string, seo: PageSEOData) => {
      expect([seo.title, seo.title.length <= TITLE_LIMIT]).toEqual([
        seo.title,
        true,
      ]);
    },
  );

  test.each(allPages)(
    "%s has no stray whitespace in its title or description",
    (_pagePath: string, seo: PageSEOData) => {
      for (const text of [seo.title, seo.description]) {
        expect(text).toBe(text.trim());
        expect(text).not.toMatch(/\s{2}/);
      }
    },
  );

  test.each(allPages)(
    "%s names the brand once, at the end",
    (pagePath: string, seo: PageSEOData) => {
      expect(seo.title.split("OneUptime").length - 1).toBe(1);

      // The homepage leads with the brand: it is the brand's own result.
      if (pagePath === "/") {
        expect(seo.title).toMatch(/^OneUptime \| /);
        return;
      }

      expect(seo.title.endsWith(BRAND_SUFFIX)).toBe(true);
    },
  );

  test("no two pages share a title", () => {
    const pagesByTitle: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const [pagePath, seo] of allPages) {
      pagesByTitle.set(seo.title, [
        ...(pagesByTitle.get(seo.title) || []),
        pagePath,
      ]);
    }

    expect(
      [...pagesByTitle.values()].filter((pagePaths: Array<string>) => {
        return pagePaths.length > 1;
      }),
    ).toEqual([]);
  });

  test("no two pages share a description", () => {
    const pagesByDescription: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const [pagePath, seo] of allPages) {
      pagesByDescription.set(seo.description, [
        ...(pagesByDescription.get(seo.description) || []),
        pagePath,
      ]);
    }

    expect(
      [...pagesByDescription.values()].filter((pagePaths: Array<string>) => {
        return pagePaths.length > 1;
      }),
    ).toEqual([]);
  });

  test("the titles made up for paths outside the register fit too", () => {
    for (const pagePath of [
      "/a-page-nobody-registered",
      "/compare/a-tool-with-no-comparison",
      "/legal/a-document-nobody-wrote",
    ]) {
      const title: string = getPageSEO(pagePath).title;

      expect([title, title.length <= TITLE_LIMIT]).toEqual([title, true]);
    }
  });

  test("every title a template still writes itself fits too", () => {
    /*
     * Pages outside the register (not-found, server-error) keep a literal
     * <title>. Anything written with EJS comes from the register, which the
     * tests above hold to the limit. The blog's templates title themselves
     * from its posts and are tested with the blog.
     */
    const literalTitles: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== "Blog") {
            walk(fullPath);
          }
        } else if (entry.name.endsWith(".ejs")) {
          for (const title of elementsIn(
            headOf(fs.readFileSync(fullPath, "utf8")),
            "title",
          )) {
            if (!title.body.includes("<%")) {
              literalTitles.push(title.body.trim());
            }
          }
        }
      }
    };

    walk(VIEWS_ROOT);

    expect(literalTitles).toContain("OneUptime | Page not found");
    for (const title of literalTitles) {
      expect([title, title.length <= TITLE_LIMIT]).toEqual([title, true]);
    }
  });
});

describe("every routed template writes its head from PageSEO", () => {
  const renderedTemplates: Array<string> = [
    ...new Set<string>(
      [
        ...routesSource.matchAll(/res\.render\(`\$\{ViewsPath\}\/([^`]+)`/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1]!.endsWith(".ejs") ? match[1]! : `${match[1]!}.ejs`;
      }),
    ),
  ].sort();

  test("the route table names the templates to check", () => {
    expect(renderedTemplates.length).toBeGreaterThan(55);
    for (const template of [
      "legal.ejs",
      "pricing.ejs",
      "product-compare.ejs",
      "compare-index.ejs",
      "solutions/incident-response.ejs",
    ]) {
      expect(renderedTemplates).toContain(template);
    }
  });

  test.each(renderedTemplates)(
    "%s writes its <title> and meta description from seo",
    (template: string) => {
      const source: string = headOf(
        fs.readFileSync(path.join(VIEWS_ROOT, template), "utf8"),
      );

      expect(
        elementsIn(source, "title").map((title: RenderedElement): string => {
          return title.body;
        }),
      ).toEqual(["<%= seo.title %>"]);
      expect(source.split('name="description"').length - 1).toBe(1);
      expect(
        source.match(/<meta name="description" content="[^"]*">/g),
      ).toEqual(['<meta name="description" content="<%= seo.description %>">']);
    },
  );

  test("every route that renders a page hands it that page's SEO entry", () => {
    /*
     * Without its own entry a page renders with whatever the request
     * middleware derived from the request path, which for /Legal/DPA or
     * /legal/dpa/ is a made-up title and a canonical URL of its own.
     */
    const pageRoutes: Array<string> = [];

    for (const route of routePaths()) {
      const body: string = bodyOfGetRoute(route)!;

      if (!body.includes("res.render(")) {
        continue;
      }

      pageRoutes.push(route);

      if (route === "/compare/:product") {
        expect(body).toMatch(/getSEOForPath\(\s*`\/compare\/\$\{/);
        continue;
      }

      if (route === "/integrations/opentelemetry/:framework") {
        expect(body).toMatch(
          /getSEOForPath\(\s*`\/integrations\/opentelemetry\/\$\{slug\}`/,
        );
        continue;
      }

      expect([
        route,
        new RegExp(`getSEOForPath\\(\\s*"${escapeRegExp(route)}"`).test(body),
      ]).toEqual([route, true]);
    }

    expect(pageRoutes).toContain("/pricing");
    expect(pageRoutes).toContain("/legal/dpa");
    expect(pageRoutes.length).toBeGreaterThan(80);
  });
});

describe("legal and compliance pages", () => {
  test("the route table registers every legal document once", () => {
    const declarations: Array<string> = [
      ...routesSource.matchAll(/app\.get\(\s*"(\/legal\/[^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(legalPaths.length).toBe(29);
    expect(declarations.sort()).toEqual(legalPaths);
  });

  test.each(legalPaths)(
    "%s has its own entry in the register",
    (legalPath: string) => {
      const seo: PageSEOData | undefined = PageSEOConfig[legalPath];

      expect(seo).toBeDefined();
      expect(seo!.canonicalPath).toBe(legalPath);
      expect(seo!.pageType).toBe("legal");
      expect(seo!.title).not.toBe(OLD_LEGAL_TITLE);
      expect(seo!.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    },
  );

  test("every legal entry in the register is a routed page", () => {
    const registered: Array<string> = Object.keys(PageSEOConfig)
      .filter((pagePath: string): boolean => {
        return PageSEOConfig[pagePath]!.pageType === "legal";
      })
      .sort();

    expect(registered).toEqual(legalPaths);
  });

  test("no two legal pages share a title or a description", () => {
    const titles: Array<string> = legalPaths.map((legalPath: string) => {
      return PageSEOConfig[legalPath]!.title;
    });
    const descriptions: Array<string> = legalPaths.map((legalPath: string) => {
      return PageSEOConfig[legalPath]!.description;
    });

    expect(new Set(titles).size).toBe(legalPaths.length);
    expect(new Set(descriptions).size).toBe(legalPaths.length);
  });

  test("buyers' searches find the document they named", () => {
    expect(PageSEOConfig["/legal/soc-2"]!.title).toMatch(/^SOC 2\b/);
    expect(PageSEOConfig["/legal/dpa"]!.title).toMatch(
      /^Data Processing Agreement \(DPA\)/,
    );
    expect(PageSEOConfig["/legal/subprocessors"]!.title).toMatch(
      /^Subprocessors\b/,
    );
    expect(PageSEOConfig["/legal/hipaa"]!.title).toMatch(/^HIPAA\b/);
    expect(PageSEOConfig["/legal/gdpr"]!.title).toMatch(/^GDPR\b/);
  });

  test.each(legalPaths)(
    "%s walks Home > its own document",
    (legalPath: string) => {
      // /legal redirects to /legal/terms (Routes.test.ts), so no trail uses it.
      expect(
        PageSEOConfig[legalPath]!.breadcrumbs.map(
          (crumb: { url: string }): string => {
            return crumb.url;
          },
        ),
      ).toEqual(["/", legalPath]);
    },
  );

  test.each(legalPaths)(
    "%s renders its own title and description",
    async (legalPath: string) => {
      const section: string = legalPath.replace("/legal/", "");
      const seo: SEOForTemplate = seoFor(legalPath);

      // Exactly the locals Routes.ts hands legal.ejs, plus homeUrl.
      const html: string = await render("legal.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section,
        requestDemoCta: false,
        seo,
        homeUrl: HOME_URL,
      });

      expectHeadFrom(html, seo);
      expect(html).not.toContain(`<title>${OLD_LEGAL_TITLE}</title>`);
    },
  );
});

describe("legal copy says what the claims matrix says, no more", () => {
  const legalClaims: Array<Claim> = Claims.filter((claim: Claim): boolean => {
    return (
      claim.category === "compliance" &&
      claim.sourceUrl.startsWith("/legal/") &&
      Boolean(PageSEOConfig[claim.sourceUrl])
    );
  });

  test("the compliance claims point at legal pages", () => {
    expect(legalClaims.length).toBeGreaterThan(10);
  });

  test.each(
    legalClaims.map((claim: Claim): [string, Claim] => {
      return [claim.sourceUrl, claim];
    }),
  )(
    "%s calls nothing certified that the matrix does not",
    (_sourceUrl: string, claim: Claim) => {
      const seo: PageSEOData = PageSEOConfig[claim.sourceUrl]!;
      const copy: string = `${seo.title} ${seo.description}`;

      if (claim.status !== "certified") {
        expect([claim.id, CERTIFICATION.test(copy)]).toEqual([claim.id, false]);
      }
    },
  );

  test("FedRAMP is described as in progress, not authorized", () => {
    expect(getClaim("compliance-fedramp")!.status).toBe("in-progress");

    const fedramp: PageSEOData = PageSEOConfig["/legal/fedramp"]!;

    expect(fedramp.description).toMatch(/in progress/);
    expect(fedramp.description).toMatch(/not yet/);
    expect(`${fedramp.title} ${fedramp.description}`).not.toMatch(
      FEDRAMP_DESIGNATION,
    );
  });

  test("no page's title or description calls OneUptime FedRAMP ready or authorized", () => {
    for (const [pagePath, seo] of allPages) {
      expect([
        pagePath,
        FEDRAMP_DESIGNATION.test(`${seo.title} ${seo.description}`),
      ]).toEqual([pagePath, false]);
    }
  });

  test("the GxP pages describe support for validation, not a certificate", () => {
    for (const gxpPath of [
      "/legal/21-cfr-part-11",
      "/legal/gamp-5",
      "/legal/annex-11",
      "/legal/gxp-cloud",
    ]) {
      const seo: PageSEOData = PageSEOConfig[gxpPath]!;

      expect([
        gxpPath,
        CERTIFICATION.test(`${seo.title} ${seo.description}`),
      ]).toEqual([gxpPath, false]);
    }
  });

  test("no description promises a guarantee the SLA does not give", () => {
    for (const [pagePath, seo] of allPages) {
      expect([pagePath, GUARANTEE.test(seo.description)]).toEqual([
        pagePath,
        false,
      ]);
    }
  });
});

describe("the pricing page", () => {
  const seo: PageSEOData = PageSEOConfig["/pricing"]!;
  const growth: PricingPlan = PricingPlans.find((plan: PricingPlan) => {
    return plan.key === "growth";
  })!;
  const free: PricingPlan = PricingPlans.find((plan: PricingPlan) => {
    return plan.key === "free";
  })!;

  test("is titled as a pricing page", () => {
    expect(seo.title).toMatch(/^Pricing\b/);
    expect(seo.title).not.toMatch(/Complete Observability platform/i);
  });

  test("quotes the free plan and the Growth price the pricing table shows", () => {
    expect(free.monthlyPricePerUser).toBe("$0");
    expect(seo.title).toContain("Free Plan");
    expect(seo.title).toContain(`From ${growth.monthlyPricePerUser}/User`);
    expect(seo.description).toContain(
      `paid plans from ${growth.monthlyPricePerUser} per user per month`,
    );
  });

  test("quotes the telemetry rate the page and pricing.json publish", () => {
    const rate: string | undefined = routesSource.match(
      /telemetryIngestPricePerGB: "([^"]+)"/,
    )?.[1];

    expect(rate).toBe("$0.10");
    expect(seo.description).toContain(`${rate} per GB ingested`);
  });

  test("keeps its description within what a result shows", () => {
    expect(seo.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  });

  test("renders that title and description", async () => {
    // The locals Routes.ts hands pricing.ejs, plus homeUrl.
    const html: string = await render("pricing.ejs", {
      pricing: Pricing,
      enableGoogleTagManager: false,
      seo: seoFor("/pricing"),
      homeUrl: HOME_URL,
    });

    expectHeadFrom(html, seoFor("/pricing"));
    expect(html).not.toContain("One Complete Observability platform.");
  });
});

describe("the comparison pages", () => {
  const slugs: Array<string> = getProductCompareSlugs();

  // "Better Stack (Better Uptime)" -> "betterstackbetteruptime"
  const squeezed: (text: string) => string = (text: string): string => {
    return text.toLowerCase().replace(/[^a-z0-9]/g, "");
  };

  test("every comparison has a title of its own, and no title is left over", () => {
    expect(Object.keys(ComparePageTitles).sort()).toEqual([...slugs].sort());
  });

  test.each(slugs)(
    "%s leads with the competitor's name and the word buyers search",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      const title: string = getPageSEO(`/compare/${slug}`).title;
      const searchedName: string | undefined =
        title.match(/^(.+?) Alternative\b/)?.[1];

      expect(searchedName).toBeDefined();
      expect([slug, squeezed(product.productName)]).toEqual([
        slug,
        expect.stringContaining(squeezed(searchedName!)),
      ]);
    },
  );

  test.each(slugs)(
    "%s describes the comparison with the competitor's real name",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      const seo: PageSEOData = getPageSEO(`/compare/${slug}`);

      expect(
        seo.description.startsWith(`${product.productName} vs OneUptime`),
      ).toBe(true);
      expect(seo.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
      expect(seo.breadcrumbs[seo.breadcrumbs.length - 1]).toEqual({
        name: `vs ${product.productName}`,
        url: `/compare/${slug}`,
      });
    },
  );

  test("Better Stack's page is no longer cut off", () => {
    const title: string = getPageSEO("/compare/better-uptime").title;

    expect(title).toBe("Better Uptime Alternative (Better Stack) | OneUptime");
    expect(title.length).toBeLessThanOrEqual(TITLE_LIMIT);
  });

  test("a title nobody wrote still leads with the search and fits", () => {
    const seo: PageSEOData = getPageSEO("/compare/some-new-tool");

    expect(seo.title).toBe("Some New Tool Alternative | OneUptime");
    expect(seo.canonicalPath).toBe("/compare/some-new-tool");
  });

  test("an inherited object key is not read as a comparison", () => {
    const seo: PageSEOData = getPageSEO("/compare/constructor");

    expect(seo.title).toBe("Constructor Alternative | OneUptime");
  });

  test.each(["better-uptime", "pagerduty", "statuspage.io", "newrelic"])(
    "%s renders the register's title and description",
    async (slug: string) => {
      const seo: SEOForTemplate = seoFor(`/compare/${slug}`);

      // Exactly the locals Routes.ts hands the template, plus homeUrl.
      const html: string = await render("product-compare.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        productConfig: ProductCompare(slug),
        onlyShowCompareTable: false,
        seo,
        homeUrl: HOME_URL,
      });

      expectHeadFrom(html, seo);
      expect(html).not.toContain("2026 Comparison");
    },
  );

  test("the comparison index renders the register's title and description", async () => {
    const seo: SEOForTemplate = seoFor("/compare");
    const html: string = await render("compare-index.ejs", {
      support: false,
      enableGoogleTagManager: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      compareGroups: [],
      compareCount: slugs.length,
      seo,
      homeUrl: HOME_URL,
    });

    expectHeadFrom(html, seo);
  });
});

describe("pages whose copy moved into the register", () => {
  const solutionAndIndustryPages: Array<[string, string]> = [
    ...fs.readdirSync(path.join(VIEWS_ROOT, "solutions")),
    ...fs.readdirSync(path.join(VIEWS_ROOT, "industries")),
  ]
    .filter((fileName: string): boolean => {
      return fileName.endsWith(".ejs");
    })
    .map((fileName: string): [string, string] => {
      const directory: string = fs.existsSync(
        path.join(VIEWS_ROOT, "solutions", fileName),
      )
        ? "solutions"
        : "industries";

      return [
        `${directory}/${fileName}`,
        `/${directory}/${path.basename(fileName, ".ejs")}`,
      ];
    });

  test("every solution and industry page has its own entry", () => {
    expect(solutionAndIndustryPages.length).toBeGreaterThanOrEqual(14);

    for (const [, pagePath] of solutionAndIndustryPages) {
      expect([pagePath, PageSEOConfig[pagePath]?.canonicalPath]).toEqual([
        pagePath,
        pagePath,
      ]);
    }
  });

  test.each(solutionAndIndustryPages)(
    "%s renders its own title and description",
    async (template: string, pagePath: string) => {
      const seo: SEOForTemplate = seoFor(pagePath);

      // Exactly the locals Routes.ts hands these templates, plus homeUrl.
      const html: string = await render(template, {
        enableGoogleTagManager: false,
        seo,
        homeUrl: HOME_URL,
      });

      expectHeadFrom(html, seo);
    },
  );

  test.each([
    ["kubernetes.ejs", "/product/kubernetes"],
    ["on-call.ejs", "/product/on-call"],
    ["network-monitoring.ejs", "/product/network-monitoring"],
    ["support.ejs", "/support"],
  ])(
    "%s renders its own title and description",
    async (template: string, pagePath: string) => {
      const seo: SEOForTemplate = seoFor(pagePath);
      const html: string = await render(template, {
        enableGoogleTagManager: false,
        seo,
        homeUrl: HOME_URL,
      });

      expectHeadFrom(html, seo);
    },
  );

  test("about.ejs renders its own title and description", async () => {
    const seo: SEOForTemplate = seoFor("/about");
    const html: string = await render("about.ejs", {
      contributors: [],
      enableGoogleTagManager: false,
      seo,
      homeUrl: HOME_URL,
    });

    expectHeadFrom(html, seo);
  });

  test("the enterprise overview keeps the governed description its template carried", () => {
    expect(PageSEOConfig["/enterprise/overview"]!.description).toContain(
      "SOC 2 Type II attested",
    );
    expect(PageSEOConfig["/enterprise/overview"]!.description).toContain(
      "99.95% uptime target on Enterprise plans",
    );
  });
});
