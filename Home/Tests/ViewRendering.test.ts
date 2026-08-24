import {
  ArchitectureTier,
  AvailabilityControls,
  DeploymentModel,
  DeploymentModels,
  ResilienceControl,
  SelfHostedFaq,
  SelfHostedFaqs,
  SizingTier,
  SizingTiers,
  SupportBoundaries,
  SupportTierRow,
  getSelfHostedContent,
} from "../Utils/SelfHosted";
import {
  Claim,
  ClaimStatusDefinition,
  ClaimStatuses,
  Claims,
  getClaim,
  getClaimStatus,
  getClaimsMatrix,
  getClaimsNeedingReview,
} from "../Utils/Claims";
import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * Render the real templates. Unit tests over the data model cannot tell you
 * that a template renders at all, that its loops are wired to the right
 * fields, or that a section did not silently disappear during an edit.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

type RenderFunction = (
  templateFileName: string,
  locals: Record<string, unknown>,
) => Promise<string>;

const render: RenderFunction = async (
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> => {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
};

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

describe("self-hosted.ejs", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await render("self-hosted.ejs", {
      support: false,
      enableGoogleTagManager: false,
      footerCards: true,
      cta: false,
      blackLogo: false,
      requestDemoCta: true,
      selfHosted: getSelfHostedContent(),
      seo: seoFor("/enterprise/self-hosted"),
      homeUrl: HOME_URL,
    });
  });

  test("renders a complete page", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(10000);
  });

  test("carries the canonical title and description", () => {
    expect(html).toContain("Self-Hosted OneUptime");
    expect(html).toContain("https://oneuptime.com/enterprise/self-hosted");
  });

  test("renders every section the issue asked for", () => {
    for (const sectionId of [
      "deployment-models",
      "reference-architecture",
      "requirements",
      "availability",
      "upgrades",
      "air-gapped",
      "hardened-images",
      "data-residency",
      "responsibilities",
      "support",
      "architecture-assessment",
      "faq",
    ]) {
      expect(html).toContain(`id="${sectionId}"`);
    }
  });

  test("renders every deployment model with its highlights", () => {
    for (const model of DeploymentModels) {
      expect(html).toContain(model.name);
      expect(html).toContain(model.infrastructure);
      for (const highlight of model.highlights) {
        expect(html).toContain(escapeForHtml(highlight));
      }
    }
  });

  test("marks Kubernetes as the recommended deployment", () => {
    expect(html).toContain("Recommended");

    const kubernetes: DeploymentModel = DeploymentModels.find(
      (model: DeploymentModel) => {
        return model.key === "kubernetes";
      },
    )!;
    expect(html).toContain(kubernetes.tagline);
  });

  test("renders every architecture tier and component", () => {
    for (const tier of getSelfHostedContent()
      .architectureTiers as Array<ArchitectureTier>) {
      expect(html).toContain(`>${tier.name}</h3>`);
      for (const component of tier.components) {
        expect(html).toContain(escapeForHtml(component.name));
        expect(html).toContain(escapeForHtml(component.scaling));
      }
    }
  });

  test("renders the sizing table", () => {
    for (const tier of SizingTiers as Array<SizingTier>) {
      expect(html).toContain(tier.name);
      expect(html).toContain(escapeForHtml(tier.nodes));
    }
  });

  test("renders the availability controls with their chart settings", () => {
    for (const control of AvailabilityControls as Array<ResilienceControl>) {
      expect(html).toContain(control.title);
      expect(html).toContain(escapeForHtml(control.setting));
    }
  });

  test("renders both support tiers including what is NOT included", () => {
    for (const tier of SupportBoundaries as Array<SupportTierRow>) {
      expect(html).toContain(tier.name);
      for (const excluded of tier.excluded) {
        expect(html).toContain(escapeForHtml(excluded));
      }
    }
    expect(html).toContain("Not included");
  });

  test("renders the FAQ", () => {
    for (const faq of SelfHostedFaqs as Array<SelfHostedFaq>) {
      expect(html).toContain(escapeForHtml(faq.question));
    }
  });

  test("offers the architecture assessment as the primary conversion path", () => {
    expect(html).toContain("Book an architecture assessment");
    expect(html).toContain('href="/enterprise/demo"');
    expect(html).toContain("enterprise@oneuptime.com");
  });

  test("keeps wide content inside horizontally scrollable containers", () => {
    // Tables must never make the page body scroll sideways on a phone.
    const tableCount: number = (html.match(/<table/g) || []).length;
    const scrollContainerCount: number = (html.match(/sh-scroll/g) || [])
      .length;

    expect(tableCount).toBeGreaterThanOrEqual(3);
    expect(scrollContainerCount).toBeGreaterThanOrEqual(tableCount);
  });

  test("does not use retired claim language", () => {
    expect(html).not.toMatch(/99\.99\s*%\s*(?:uptime\s*)?SLA/i);
    expect(html).not.toMatch(/guaranteed\s+response/i);
  });

  test("states plainly that self-hosted uptime is the customer's", () => {
    expect(html).toContain("does not extend to infrastructure you operate");
  });
});

describe("trust.ejs with the claims matrix", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await render("trust.ejs", {
      footerCards: true,
      support: false,
      enableGoogleTagManager: false,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      claimStatuses: ClaimStatuses,
      claimsMatrix: getClaimsMatrix(),
      claimsUnderReviewCount: getClaimsNeedingReview().length,
      seo: seoFor("/trust"),
      homeUrl: HOME_URL,
    });
  });

  test("renders a complete page with the claims section", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="claims"');
    expect(html).toContain("Governed claims");
  });

  test("publishes the definition of every status word", () => {
    for (const status of ClaimStatuses as Array<ClaimStatusDefinition>) {
      expect(html).toContain(status.label);
      expect(html).toContain(escapeForHtml(status.definition));
    }
  });

  test("renders every claim with its statement, qualifier and evidence", () => {
    for (const claim of Claims as Array<Claim>) {
      expect(html).toContain(escapeForHtml(claim.subject));
      expect(html).toContain(escapeForHtml(claim.statement));
      expect(html).toContain(escapeForHtml(claim.qualifier));
      expect(html).toContain(escapeForHtml(claim.evidence));
    }
  });

  test("gives every category its own anchor", () => {
    for (const group of getClaimsMatrix()) {
      expect(html).toContain(`id="claims-${group.category.key}"`);
    }
  });

  test("reports that every published claim has confirmed evidence", () => {
    expect(getClaimsNeedingReview()).toHaveLength(0);
    expect(html).toContain(
      "every published claim has had its evidence confirmed",
    );
    expect(html).not.toContain("Evidence under review");
  });

  /*
   * The certification cards at the top of the page and the matrix below them
   * are written in different places. If they ever disagree about a status word,
   * the page argues with itself — which is the exact failure this work fixes.
   */
  test.each([
    ["SOC 2 Type II", "compliance-soc2"],
    ["ISO/IEC 27001", "compliance-iso-27001"],
    ["ISO/IEC 27017", "compliance-iso-27017"],
    ["ISO/IEC 27018", "compliance-iso-27018"],
    ["GDPR", "compliance-gdpr"],
    ["CCPA", "compliance-ccpa"],
    ["HIPAA", "compliance-hipaa"],
    ["PCI DSS", "compliance-pci"],
    ["FedRAMP", "compliance-fedramp"],
    ["CSA STAR", "compliance-csa-star"],
    ["VPAT (Accessibility)", "compliance-accessibility"],
  ])(
    "the %s card badge matches its governed status",
    (cardTitle: string, claimId: string) => {
      const claim: Claim = getClaim(claimId)!;
      const expectedLabel: string = getClaimStatus(claim.status).label;

      expect(badgeLabelForCard(html, cardTitle)).toBe(expectedLabel);
    },
  );

  test("links to the machine-readable matrix", () => {
    expect(html).toContain("/data/claims.json");
  });

  test("does not use retired claim language", () => {
    expect(html).not.toMatch(/99\.99\s*%\s*(?:uptime\s*)?SLA/i);
    expect(html).not.toMatch(/certified\s+compliant\s+with/i);
  });
});

/*
 * The review mechanism has to work in both directions: an unconfirmed claim
 * must be visibly flagged, and an empty queue must say so. The live matrix only
 * ever exercises one of those, so render the partial against fixtures.
 */
describe("claims-matrix.ejs review states", () => {
  const baseClaim: Claim = {
    id: "fixture-claim",
    category: "compliance",
    subject: "Fixture Framework",
    status: "certified",
    scope: "cloud",
    statement: "Fixture statement about a framework.",
    qualifier: "Fixture qualifier that must travel with it.",
    evidence: "Fixture certificate on request.",
    sourceUrl: "/legal/security",
  };

  type RenderMatrixFunction = (
    claims: Array<Claim>,
    underReviewCount: number,
  ) => Promise<string>;

  const renderMatrix: RenderMatrixFunction = async (
    claims: Array<Claim>,
    underReviewCount: number,
  ): Promise<string> => {
    return render("Partials/claims-matrix.ejs", {
      claimStatuses: ClaimStatuses,
      claimsMatrix: [
        {
          category: {
            key: "compliance",
            name: "Compliance",
            description: "Fixture category.",
            governingDocument: "Security at OneUptime",
            governingDocumentUrl: "/legal/security",
          },
          claims,
        },
      ],
      claimsUnderReviewCount: underReviewCount,
    });
  };

  test("an unconfirmed claim renders the review badge and its reviewer note", async () => {
    const html: string = await renderMatrix(
      [
        {
          ...baseClaim,
          reviewRequired: true,
          reviewNote: "Confirm the certificate number before an RFP response.",
        },
      ],
      1,
    );

    expect(html).toContain("Evidence under review");
    expect(html).toContain(
      "Confirm the certificate number before an RFP response.",
    );
    expect(html).toContain("1</strong>");
    expect(html).toContain("claim is");
  });

  test("a confirmed claim renders no review badge", async () => {
    const html: string = await renderMatrix([baseClaim], 0);

    expect(html).not.toContain("Evidence under review");
    expect(html).toContain(
      "every published claim has had its evidence confirmed",
    );
  });

  test("the pending count is pluralised", async () => {
    const html: string = await renderMatrix(
      [
        { ...baseClaim, reviewRequired: true, reviewNote: "Confirm this one." },
        {
          ...baseClaim,
          id: "fixture-claim-2",
          reviewRequired: true,
          reviewNote: "Confirm that one.",
        },
      ],
      2,
    );

    expect(html).toContain("2</strong>");
    expect(html).toContain("claims are");
  });

  test("every status in the vocabulary renders a distinct badge colour", async () => {
    const html: string = await renderMatrix(
      ClaimStatuses.map((status: ClaimStatusDefinition, index: number) => {
        return {
          ...baseClaim,
          id: `fixture-${status.key}`,
          subject: `Fixture ${index}`,
          status: status.key,
        };
      }),
      0,
    );

    for (const status of ClaimStatuses) {
      /*
       * The label and its colour have to appear together, or two statuses
       * could render in the same colour and the legend would stop meaning
       * anything.
       */
      const badge: RegExp = new RegExp(
        `bg-${status.color}-50[^"]*"[\\s\\S]{0,400}?${status.label}`,
      );

      expect(html).toMatch(badge);
    }

    const colours: Array<string> = ClaimStatuses.map(
      (status: ClaimStatusDefinition) => {
        return status.color;
      },
    );
    expect(new Set(colours).size).toBe(colours.length);
  });
});

/*
 * Industry and solution pages are mostly grids of links into the product
 * catalogue, and a wrong one is invisible until somebody clicks it:
 * /product/uptime-monitoring reads right, but the canonical path is
 * /product/monitoring. Every page in these two directories is rendered by
 * Routes.ts with the same two locals, so walk the directories instead of
 * naming the pages — the next page added is then checked the day it lands.
 */

type LinkedPage = [templateFileName: string, pagePath: string];

function pagesUnder(directory: string): Array<LinkedPage> {
  return fs
    .readdirSync(path.join(VIEWS_ROOT, directory))
    .filter((fileName: string): boolean => {
      return fileName.endsWith(".ejs");
    })
    .map((fileName: string): LinkedPage => {
      return [
        `${directory}/${fileName}`,
        `/${directory}/${path.basename(fileName, ".ejs")}`,
      ];
    });
}

const LINKED_PAGE_DIRECTORIES: Array<string> = ["industries", "solutions"];

const LINKED_PAGES: Array<LinkedPage> = LINKED_PAGE_DIRECTORIES.flatMap(
  (directory: string): Array<LinkedPage> => {
    return pagesUnder(directory);
  },
);

/*
 * Paths that a page links to and that PageSEO.ts is the register for. Anything
 * outside these namespaces — /docs, /pricing, /enterprise — is routed and
 * documented elsewhere, so a missing SEO entry there proves nothing.
 */
const CATALOGUE_NAMESPACES: Array<string> = [
  "/product/",
  "/tool/",
  "/solutions/",
  "/industries/",
];

function catalogueLinksIn(html: string): Array<string> {
  const hrefs: Set<string> = new Set<string>(
    [...html.matchAll(/href="(\/[^"#]*)"/g)].map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  );

  return [...hrefs].filter((href: string): boolean => {
    return CATALOGUE_NAMESPACES.some((namespace: string): boolean => {
      return href.startsWith(namespace);
    });
  });
}

/*
 * Read only the page's own <main>: links in the shared nav, footer and CTA are
 * not any one page's problem, and they have their own tests.
 */
function pageBodyOf(html: string): string {
  const start: number = html.indexOf("<main");
  const end: number = html.indexOf("</main>");

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return html.slice(start, end);
}

describe("industry and solution pages", () => {
  const rendered: Map<string, string> = new Map<string, string>();

  beforeAll(async () => {
    for (const [templateFileName, pagePath] of LINKED_PAGES) {
      /*
       * Exactly the locals Routes.ts hands these templates, plus homeUrl, which
       * request middleware puts on res.locals rather than passing per render.
       */
      rendered.set(
        templateFileName,
        await render(templateFileName, {
          enableGoogleTagManager: false,
          seo: seoFor(pagePath),
          homeUrl: HOME_URL,
        }),
      );
    }
  });

  test("both directories are walked", () => {
    // An empty walk would pass every assertion below without checking a thing.
    expect(LINKED_PAGES.length).toBeGreaterThanOrEqual(14);
  });

  test.each(LINKED_PAGES)(
    "%s renders a complete page",
    (templateFileName: string) => {
      const html: string = rendered.get(templateFileName)!;

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
      expect(html.length).toBeGreaterThan(10000);
    },
  );

  test.each(LINKED_PAGES)(
    "%s links only to catalogue pages that exist",
    (templateFileName: string) => {
      for (const href of catalogueLinksIn(
        pageBodyOf(rendered.get(templateFileName)!),
      )) {
        expect(PageSEOConfig[href]?.canonicalPath).toBe(href);
      }
    },
  );

  /*
   * Four of these pages link nowhere into the catalogue, so a per-page floor
   * would fail on them. Assert the scan over all of them instead: without
   * this, a regex that stopped matching would quietly turn every check above
   * into a pass.
   */
  test("the scan finds catalogue links to check", () => {
    const found: Set<string> = new Set<string>(
      LINKED_PAGES.flatMap(([templateFileName]: LinkedPage): Array<string> => {
        return catalogueLinksIn(pageBodyOf(rendered.get(templateFileName)!));
      }),
    );

    expect(found.size).toBeGreaterThanOrEqual(10);
  });
});

describe("aligned marketing pages still render", () => {
  test("enterprise-overview.ejs renders with governed uptime language", async () => {
    const html: string = await render("enterprise-overview.ejs", {
      support: false,
      enableGoogleTagManager: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: true,
      reviewsList1: [],
      reviewsList2: [],
      reviewsList3: [],
      seo: seoFor("/enterprise/overview"),
      homeUrl: HOME_URL,
    });

    expect(html).toContain("99.95%");
    expect(html).not.toMatch(/99\.99\s*%\s*(?:uptime\s*)?SLA/i);
    expect(html).toContain("/legal/sla");
  });

  test("demo.ejs renders and routes self-hosting buyers to the new page", async () => {
    const html: string = await render("demo.ejs", {
      support: false,
      enableGoogleTagManager: false,
      footerCards: false,
      cta: false,
      blackLogo: true,
      requestDemoCta: false,
      reviewsList1: [],
      reviewsList2: [],
      reviewsList3: [],
      seo: seoFor("/enterprise/demo"),
      homeUrl: HOME_URL,
    });

    expect(html).toContain("/enterprise/self-hosted");
    expect(html).not.toMatch(/15\s*minutes?\s+for\s+critical/i);
  });

  test("the navigation and footer surface the new pages", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });
    const footer: string = await render("footer.ejs", {
      footerCards: false,
      cta: false,
      homeUrl: HOME_URL,
    });

    expect(nav).toContain('href="/enterprise/self-hosted"');
    expect(nav).toContain('href="/trust"');
    expect(footer).toContain('href="/enterprise/self-hosted"');
    expect(footer).toContain('href="/trust"');
  });
});

/*
 * Read the status pill out of a certification card. The badge sits just above
 * the card's heading, so walk back from the heading to the nearest pill.
 */
function badgeLabelForCard(html: string, cardTitle: string): string | null {
  const headingIndex: number = html.indexOf(`>${cardTitle}</h3>`);

  if (headingIndex === -1) {
    return null;
  }

  const preceding: string = html.slice(0, headingIndex);
  const badges: RegExpMatchArray | null = preceding.match(
    /rounded-full ring-1 ring-[a-z]+-200\/60">([^<]+)<\/span>/g,
  );

  if (!badges || badges.length === 0) {
    return null;
  }

  const lastBadge: string = badges[badges.length - 1]!;
  const label: RegExpMatchArray | null = lastBadge.match(/">([^<]+)<\/span>$/);

  return label ? label[1]!.trim() : null;
}

/*
 * EJS escapes `<%= %>` output, so assertions against rendered HTML have to
 * compare against the escaped form of the source string.
 */
function escapeForHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
}
