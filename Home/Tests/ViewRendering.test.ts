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
  getClaimsMatrix,
  getClaimsNeedingReview,
} from "../Utils/Claims";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
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

  test("flags claims whose evidence is still under review", () => {
    expect(getClaimsNeedingReview().length).toBeGreaterThan(0);
    expect(html).toContain("Evidence under review");
  });

  test("links to the machine-readable matrix", () => {
    expect(html).toContain("/data/claims.json");
  });

  test("does not use retired claim language", () => {
    expect(html).not.toMatch(/99\.99\s*%\s*(?:uptime\s*)?SLA/i);
    expect(html).not.toMatch(/certified\s+compliant\s+with/i);
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
