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
import {
  VMwareAlertTemplate,
  getAllVMwareAlertTemplates,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import {
  DatabaseAlertTemplateEntry,
  DatabaseAlertTemplateGroup,
  DatabaseEngineGroup,
  DatabasesPageContent,
  getDatabaseEngineGroupKey,
  getDatabasesPageContent,
} from "../Utils/Databases";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import {
  DatabaseAlertTemplate,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertTemplates,
} from "Common/Types/Monitor/DatabaseAlertTemplates";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import DatabaseServerDiscoverySource, {
  DATABASE_SERVER_DISCOVERY_SOURCES,
  getDatabaseServerDiscoverySourceLabel,
} from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  QueueAlertThresholdEntry,
  QueueAlertThresholdGroup,
  QueueSystemEntry,
  QueueSystemGroup,
  QueuesPageContent,
  getQueuesPageContent,
} from "../Utils/Queues";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
  getMessagingBrokerScope,
  getMessagingSystemDisplayName,
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MESSAGE_QUEUE_SERIES_TOTALS,
  MessageQueueAlertTemplate,
  MessageQueueSeriesTotalDefinition,
  formatMessageQueueThreshold,
  getMessageQueueAlertTemplateForMetric,
  getMessageQueueSourceWindowFloor,
  isMessageQueueMetricMonitorable,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";
import {
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import { buildMessageQueueIdentifier } from "Common/Types/MessageQueue/MessageQueueIdentity";
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
      "enterprise-edition",
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

  test("keeps the old #hardened-images anchor landing on the Enterprise Edition section", () => {
    const sectionStart: number = html.indexOf('id="enterprise-edition"');
    const legacyAnchor: number = html.indexOf('id="hardened-images"');
    const nextSection: number = html.indexOf('id="data-residency"');

    expect(sectionStart).toBeGreaterThan(-1);
    expect(legacyAnchor).toBeGreaterThan(sectionStart);
    expect(legacyAnchor).toBeLessThan(nextSection);
    expect(html).toContain('href="#enterprise-edition"');
    expect(html).not.toContain('href="#hardened-images"');
  });

  test("renders what the Enterprise Edition adds and the controls both editions share", () => {
    const content: ReturnType<typeof getSelfHostedContent> =
      getSelfHostedContent();

    expect(content.enterpriseEditionFeatures.length).toBeGreaterThan(0);
    expect(content.securityHardeningFeatures.length).toBeGreaterThan(0);

    for (const feature of [
      ...content.enterpriseEditionFeatures,
      ...content.securityHardeningFeatures,
    ]) {
      expect(html).toContain(escapeForHtml(feature));
    }

    expect(html).toContain("What the Enterprise");
    expect(html).toContain("Security controls in both editions");
    expect(html).toContain("OneUptime Enterprise License");
  });

  test("no longer claims the editions are identical or the images hardened", () => {
    expect(html).not.toMatch(/no feature gates/i);
    expect(html).not.toMatch(/hardened\s+(?:enterprise\s+)?images/i);
    expect(html).not.toContain("Both editions are the same product");
    expect(html).not.toContain("Community and Enterprise run the same product");
    expect(html).toContain("Open-source core");
  });

  test("puts single sign-on in every edition, in the hero and in the Enterprise Edition section", () => {
    expect(html).toContain("<span>SSO in every edition</span>");
    expect(html).toContain("<span>Enterprise SCIM &amp; audit logs</span>");
    expect(html).not.toContain("Enterprise SSO");

    const section: string = html
      .slice(
        html.indexOf('id="enterprise-edition"'),
        html.indexOf('id="data-residency"'),
      )
      .replace(/\s+/g, " ");
    const intro: string =
      "The Community Edition is the core platform under Apache 2.0, SAML and OpenID Connect single sign-on included.";

    expect(section).toContain(intro);
    // Past that sentence, nothing the section lists as Enterprise names single sign-on.
    expect(section.replace(intro, "")).not.toMatch(
      /\bSSO\b|single sign-on|\bSAML\b|\bOIDC\b|OpenID Connect/i,
    );
  });

  test("lists single sign-on among what the Community Edition includes", () => {
    const community: SupportTierRow = (
      SupportBoundaries as Array<SupportTierRow>
    ).find((tier: SupportTierRow) => {
      return tier.key === "community";
    })!;
    const singleSignOn: string | undefined = community.included.find(
      (item: string) => {
        return item.includes("single sign-on");
      },
    );

    expect(singleSignOn).toBeDefined();
    expect(html).toContain(`<span>${escapeForHtml(singleSignOn!)}</span>`);
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

  test("describes immediate hard deletion from the active database", () => {
    const deletionCopy: string =
      html.match(
        /Customer-initiated deletion<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/,
      )?.[1] || "";

    expect(deletionCopy).toContain(
      "Hard deletion from the active database is immediate.",
    );
    expect(deletionCopy).not.toMatch(/soft delete|30 days|95th percentile/i);
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

describe("security-events.ejs", () => {
  let html: string = "";

  beforeAll(async () => {
    /*
     * Exactly the locals Routes.ts hands the template, plus homeUrl, which the
     * request middleware puts on res.locals rather than passing per render.
     */
    html = await render("security-events.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/security-events"),
      homeUrl: HOME_URL,
    });
  });

  test("renders a complete page", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(10000);
  });

  test("the hardcoded head matches the SEO entry's canonical URL", () => {
    /*
     * head-basic.ejs never reads `seo`, so the <title> and meta description in
     * the template and the strings in PageSEO.ts are two separate places. Only
     * the canonical URL is generated, so that is what can be asserted here.
     */
    expect(html).toContain(
      '<link rel="canonical" href="https://oneuptime.com/product/security-events"',
    );
    expect(html).toContain("OneUptime | Security Events");
  });

  test("renders the sections the page is built around", () => {
    for (const heading of [
      "One endpoint in. Alerts and on-call out.",
      "One endpoint. Four dialects. Nothing dropped.",
      "Detections as code, written in Sigma",
      "A detection is an alert your team already knows how to handle",
      "When the rate is the story, not the event",
      "Straight about the scope",
    ]) {
      expect(html).toContain(heading);
    }
  });

  test("quotes the ingest endpoint and the telemetry rate accurately", () => {
    expect(html).toContain("/security-events/v1/ingest");
    expect(html).toContain("x-oneuptime-token");
    expect(html).toContain("$0.10 per GB");
  });

  test("cross-links the products a detection actually flows into", () => {
    for (const href of [
      "/product/on-call",
      "/product/incident-management",
      "/product/logs-management",
      "/docs/telemetry/security-events",
      "/docs/integrations/google-secops",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("every product link in the page body is a real canonical page", () => {
    /*
     * A product page is mostly outbound links, and a wrong one is invisible
     * until someone clicks it — /product/mcp-server looks right but the
     * canonical path is /tool/mcp-server. Scanned with the same helpers as the
     * industry and solution pages above, so there is one definition of what a
     * catalogue link is and what counts as the page's own body.
     */
    const productLinks: Array<string> = catalogueLinksIn(pageBodyOf(html));

    // The page should be linking out; an empty list means the regex broke.
    expect(productLinks.length).toBeGreaterThan(4);

    for (const href of productLinks) {
      expect(PageSEOConfig[href]?.canonicalPath).toBe(href);
    }
  });

  test("does not claim capabilities the detection engine does not have", () => {
    /*
     * Only the boolean Sigma core is supported, evaluation is scheduled rather
     * than streaming, and security-event monitors compare against static
     * thresholds — anomaly comparators are deliberately withheld for them.
     */
    expect(html).not.toMatch(/full sigma (spec|support)/i);
    expect(html).not.toMatch(/real[- ]time detection/i);
    expect(html).not.toMatch(/complete sigma/i);
  });

  test("states the limits rather than leaving a buyer to find them", () => {
    // Each of these is a real, code-level boundary of the product.
    expect(html).toContain("count()");
    expect(html).toContain("the floor is one minute");
    expect(html).toMatch(/UEBA and behaviou?ral baselining/);
  });

  test("claims threat intel the way the feature actually works", () => {
    /*
     * Threat intel shipped as bring-your-own STIX/TAXII feeds: the page
     * must claim the enrichment attributes and the customer-supplied
     * collections, and must no longer list threat intelligence under
     * "Not in the box" (the scope list still excludes UEBA/baselining
     * and bundled feed content).
     */
    expect(html).toContain("STIX/TAXII");
    expect(html).toContain("threat.*");
    expect(html).toContain("You bring the TAXII collections");
    expect(html).not.toContain("Threat intelligence enrichment, UEBA");
  });
});

describe("vmware.ejs", () => {
  let html: string = "";
  const seo: PageSEOData = PageSEOConfig["/product/vmware"]!;

  beforeAll(async () => {
    // Exactly the locals Routes.ts hands the template, plus homeUrl.
    html = await render("vmware.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/vmware"),
      homeUrl: HOME_URL,
    });
  });

  test("renders a complete page", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(10000);
  });

  test("the hardcoded head is identical to the SEO entry", () => {
    /*
     * The template hard-codes <title> and the meta description while
     * head-social.ejs renders the OG/canonical tags from `seo`. Search
     * engines see the first pair, social cards the second; they must agree
     * word for word or the page advertises itself two different ways.
     */
    expect(html).toContain(`<title>${seo.title}</title>`);
    expect(html).toContain(`content="${seo.description}"`);
    expect(html).toContain(
      '<link rel="canonical" href="https://oneuptime.com/product/vmware"',
    );
  });

  test("renders the sections the page is built around", () => {
    for (const heading of [
      "Your whole vSphere estate, one dashboard",
      "Every object in your vSphere inventory, monitored",
      "From signup to a monitored vCenter in 10 minutes",
      "The monitoring vSphere deserves, without the suite",
      "Twenty-three monitors, ready on day one",
      "Everything you need for vSphere operations",
      "A VMware dashboard in one click, or build your own",
      "vSphere alerts where your team already works",
      "Pay for data, or pay nothing and run it yourself",
      "Questions vSphere administrators ask",
    ]) {
      expect(html).toContain(heading);
    }
  });

  test("covers every vSphere object kind the agent inventories", () => {
    for (const kind of [
      "ESXi Hosts",
      "Virtual Machines",
      "Datastores",
      "Clusters & Datacenters",
      "Resource Pools",
      "vSAN",
    ]) {
      expect(html).toContain(`>${kind}</h3>`);
    }
  });

  test("describes how the agent actually works", () => {
    // One collector-only agent per vCenter, read-only user, no in-guest install.
    expect(html).toContain("One Agent Per vCenter");
    expect(html).toContain("Read-Only");
    expect(html).toContain(
      '<code class="text-sm bg-gray-100 px-1 py-0.5 rounded">vcenter</code> receiver',
    );
    expect(html).toContain("VCENTER_ENDPOINT");
    expect(html).toContain("Nothing installed on ESXi");
  });

  test("quotes every alert template the product ships, by its real name", () => {
    /*
     * The template list is the marketing page's most checkable claim. Every
     * name must be exactly the one in the Common catalog, and the catalog is
     * the source — so a renamed or added template fails here until the page
     * catches up. The count in the section heading is pinned too.
     */
    const templates: Array<VMwareAlertTemplate> = getAllVMwareAlertTemplates();

    expect(templates.length).toBe(23);
    for (const template of templates) {
      expect(html).toContain(`<span>${escapeForHtml(template.name)}</span>`);
    }
  });

  test("labels each template with its catalog severity", () => {
    for (const template of getAllVMwareAlertTemplates()) {
      const row: RegExp = new RegExp(
        `<span>${escapeForHtml(template.name)}</span><span[^>]*>${template.severity}</span>`,
      );
      expect(html).toMatch(row);
    }
  });

  test("never leaks Proxmox-only concepts into the VMware page", () => {
    /*
     * The page was authored from the Proxmox template. Anything a vSphere
     * administrator would recognise as Proxmox vocabulary is a copy-paste
     * left behind, not a feature.
     */
    const body: string = vmwareOwnSectionsOf(html);

    for (const leak of [
      /\bpve\b/i,
      /quorum/i,
      /vzdump/i,
      /backup job/i,
      /replication job/i,
      /\bLXC\b/,
      /guest agent/i,
      /HA resource/i,
    ]) {
      expect(body).not.toMatch(leak);
    }
  });

  test("stays licensing-neutral and does not impersonate VMware or Broadcom", () => {
    const body: string = pageBodyOf(html);

    expect(body).toContain("not a VMware or Broadcom product");
    expect(body).toContain("standalone ESXi host");
    expect(body).toContain("7.0 and later");
    // Copy describes OneUptime; it must not present itself as the vendor.
    expect(body).not.toMatch(/official VMware/i);
    expect(body).not.toMatch(/by Broadcom/i);
    expect(body).not.toMatch(/VMware-certified/i);
  });

  test("states the pricing and self-hosting story", () => {
    expect(html).toContain("$0.10");
    expect(html).toContain("No Per-Socket, No Per-VM Pricing");
    expect(html).toContain('href="/enterprise/self-hosted"');
    expect(html).toContain('href="/pricing"');
  });

  test("cross-links the products and docs the page leans on", () => {
    for (const href of [
      "/product/host",
      "/product/proxmox",
      "/product/dashboards",
      "/docs/telemetry/vmware",
      "/docs/monitor/vmware-monitor",
      "/accounts/register",
      "/enterprise/demo",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("every product link in the page body is a real canonical page", () => {
    const productLinks: Array<string> = catalogueLinksIn(pageBodyOf(html));

    // The page should be linking out; an empty list means the regex broke.
    expect(productLinks.length).toBeGreaterThan(2);

    for (const href of productLinks) {
      expect(PageSEOConfig[href]?.canonicalPath).toBe(href);
    }
  });

  test("wires the cursor glow to its own element ids", () => {
    /*
     * The inline script looks the hero and glow layers up by id; a leftover
     * proxmox-* id from the template the page was cloned from would render
     * the hero without its glow and nobody would notice.
     */
    expect(html).toContain('id="vmware-hero-section"');
    expect(html).toContain('id="vmware-grid-glow"');
    expect(html).toContain("getElementById('vmware-hero-section')");
    expect(html).toContain("getElementById('vmware-grid-glow')");
    expect(html).not.toContain("proxmox-hero-section");
    expect(html).not.toContain("proxmox-grid-glow");
  });
});

/*
 * The VMware page's own sections: everything in <main> up to the end of its
 * FAQ. The shared features-table include that follows legitimately lists the
 * Proxmox card's quorum / backup / replication bullets, so a Proxmox-vocabulary
 * scan has to stop before it.
 */
function vmwareOwnSectionsOf(html: string): string {
  const body: string = pageBodyOf(html);
  const faqStart: number = body.indexOf('id="vmware-faq"');
  const faqEnd: number = body.indexOf("</dl>", faqStart);

  expect(faqStart).toBeGreaterThan(-1);
  expect(faqEnd).toBeGreaterThan(faqStart);

  return body.slice(0, faqEnd);
}

describe("VMware on every product surface", () => {
  /*
   * There is no single product registry on the marketing site: the nav, the
   * footer, the features table, the homepage hero grid, the homepage product
   * list, the "everything you can monitor" pills, the product showcase and the
   * topology page each list products by hand. Render each and check the link.
   */
  test("the navigation lists VMware in both the mobile grid and the flyout", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });

    // Two product lists, two links.
    expect(nav.split('href="/product/vmware"').length - 1).toBe(2);
    expect(nav).toContain(
      'data-search="vmware vsphere vcenter esxi hosts vms virtual machines datastores vsan clusters resource pools"',
    );
  });

  test("the footer lists VMware", async () => {
    const footer: string = await render("footer.ejs", {
      footerCards: false,
      cta: false,
      homeUrl: HOME_URL,
    });

    expect(footer).toContain('href="/product/vmware"');
  });

  test.each([
    "features-table.ejs",
    "Partials/product-showcase.ejs",
    "Partials/hero-cards/product-grid.ejs",
    "Partials/home-products.ejs",
    "Partials/home-detect.ejs",
  ])("%s links to the VMware product", async (templateFileName: string) => {
    const partial: string = await render(templateFileName, {
      homeUrl: HOME_URL,
    });

    expect(partial).toContain('href="/product/vmware"');
    // The hypervisor mark is drawn inline; every surface carries it.
    expect(partial).toContain(
      '<rect x="3" y="4" width="18" height="16" rx="2"',
    );
  });

  test("the topology page places VMware in its infrastructure map", async () => {
    const topology: string = await render("topology.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/topology"),
      homeUrl: HOME_URL,
    });

    expect(topology).toContain('href="/product/vmware"');
    expect(topology).toContain("Explore VMware");
    expect(topology).toContain(
      "Kubernetes, Proxmox, VMware, Ceph, Docker Swarm &amp; hosts",
    );
  });

  test("the hero card and icon partials render on their own", async () => {
    const card: string = await render("Partials/hero-cards/vmware.ejs", {});
    const icon: string = await render("Partials/icons/vmware.ejs", {
      iconClass: "h-3 w-3",
    });

    expect(card).toContain('href="/product/vmware"');
    expect(card).toContain(">VMware<");
    expect(icon).toContain('class="h-3 w-3 text-indigo-600"');
    // Not a trademarked wordmark: the mark is the neutral hypervisor glyph.
    expect(icon).not.toMatch(/<title>VMware<\/title>/);
  });
});

/*
 * The repository root, for the checks that hold the Databases page to the
 * product it describes: the agent it installs, the docs it links to and the
 * defaults it quotes.
 */
const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/*
 * A default the page quotes, read from the `const NAME: number = <n>;` that
 * defines it. Reading the source rather than importing it keeps the server
 * modules (and their database clients) out of the website's test run.
 */
function numericConstantIn(relativePath: string, name: string): number {
  const match: RegExpMatchArray | null = repoFile(relativePath).match(
    new RegExp(`\\b${name}: number = (\\d+);`),
  );

  if (!match) {
    throw new Error(
      `${name} is no longer declared as a number literal in ${relativePath}: point this test at its new definition.`,
    );
  }

  return Number(match[1]);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The circle-stack glyph IconProp.Database draws in the dashboard.
const DATABASE_GLYPH_PATH_START: string =
  "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375";

describe("databases.ejs", () => {
  let html: string = "";
  const seo: PageSEOData = PageSEOConfig["/product/databases"]!;
  const content: DatabasesPageContent = getDatabasesPageContent();

  beforeAll(async () => {
    // Exactly the locals Routes.ts hands the template, plus homeUrl.
    html = await render("databases.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/databases"),
      databases: getDatabasesPageContent(),
      homeUrl: HOME_URL,
    });
  });

  test("renders a complete page", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(10000);
  });

  test("the hardcoded head is identical to the SEO entry", () => {
    // Search engines read the first pair, social cards the second.
    expect(html).toContain(`<title>${seo.title}</title>`);
    expect(html).toContain(`content="${seo.description}"`);
    expect(html).toContain(
      '<link rel="canonical" href="https://oneuptime.com/product/databases"',
    );
  });

  test("renders the sections the page is built around", () => {
    for (const heading of [
      "Every database you run, found and monitored",
      "Four sources, one page per database",
      "From the telemetry you already send to a monitored database",
      "Database monitoring that starts where your services do",
      `${content.engineCount} engines, known by name`,
      `${content.alertTemplateCount} ready-made monitors for ${content.enginesWithAlertTemplatesCount} engines`,
      "Built for the way databases actually run",
      "Database alerts where your team already works",
      "Pay for data, or run it yourself",
      "Questions database teams ask",
    ]) {
      expect(html).toContain(heading);
    }
  });

  test("covers every source a database is assembled from", () => {
    for (const source of [
      "Application traces",
      "Kubernetes",
      "Docker &amp; Podman",
      "Database Agent",
    ]) {
      expect(html).toContain(`>${source}</h3>`);
    }
  });

  test("prints the counts the catalogs give it, not numbers typed into the copy", async () => {
    expect(html).toContain(`${DATABASE_SYSTEMS.length} engines known by name`);
    expect(html).toContain(
      `${getAllDatabaseAlertTemplates().length} ready-made monitors for`,
    );

    // Control: other counts in, other counts out.
    const doctored: string = await render("databases.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor("/product/databases"),
      databases: {
        ...content,
        engineCount: 1234,
        alertTemplateCount: 567,
        enginesWithAlertTemplatesCount: 89,
      },
      homeUrl: HOME_URL,
    });

    expect(doctored).toContain("1234 engines, known by name");
    expect(doctored).toContain("1234 engines known by name");
    expect(doctored).toContain("567 ready-made monitors for 89 engines");
  });

  test("lists every catalog engine once, under the source of its engine metrics", () => {
    const chips: Array<string> = [
      ...html.matchAll(/data-engine="([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect([...chips].sort()).toEqual(
      DATABASE_SYSTEMS.map((descriptor: DatabaseSystemDescriptor): string => {
        return descriptor.system;
      }).sort(),
    );

    // Each group card holds the chips up to the next card.
    const cards: Array<string> = html
      .split('data-engine-group="')
      .slice(1)
      .map((card: string): string => {
        return card.split("</ul>")[0]!;
      });

    expect(cards.length).toBe(content.engineGroups.length);

    for (const card of cards) {
      const key: string = card.slice(0, card.indexOf('"'));

      for (const match of card.matchAll(/data-engine="([^"]+)">([^<]+)</g)) {
        const descriptor: DatabaseSystemDescriptor = DATABASE_SYSTEMS.find(
          (candidate: DatabaseSystemDescriptor): boolean => {
            return candidate.system === match[1];
          },
        )!;

        expect({ engine: descriptor.system, group: key }).toEqual({
          engine: descriptor.system,
          group: getDatabaseEngineGroupKey(descriptor),
        });
        expect(match[2]).toBe(escapeForHtml(descriptor.displayName));
      }
    }
  });

  test("renders the engine groups in the order the content gives", () => {
    const keys: Array<string> = [
      ...html.matchAll(/data-engine-group="([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(keys).toEqual(
      content.engineGroups.map((group: DatabaseEngineGroup): string => {
        return group.key;
      }),
    );
  });

  test("quotes every recommended monitor by its real name and severity, under its engine", () => {
    const monitorsSection: string = html.slice(
      html.indexOf('id="databases-monitors"'),
      html.indexOf("<!-- Build your own -->"),
    );
    const cards: Array<string> = monitorsSection
      .split('data-alert-template-group="')
      .slice(1);

    expect(cards.length).toBe(content.alertTemplateGroups.length);

    let quoted: number = 0;

    content.alertTemplateGroups.forEach(
      (group: DatabaseAlertTemplateGroup, index: number) => {
        const card: string = cards[index]!;

        expect(card.startsWith(`${group.receiver}"`)).toBe(true);
        expect(card).toContain(`>${escapeForHtml(group.title)}</h3>`);

        const rows: Array<DatabaseAlertTemplateEntry> = [
          ...card.matchAll(
            /<span>([^<]+)<\/span><span[^>]*>(Critical|Warning)<\/span>/g,
          ),
        ].map((match: RegExpMatchArray): DatabaseAlertTemplateEntry => {
          return {
            name: match[1]!,
            severity: match[2] as DatabaseAlertTemplateEntry["severity"],
          };
        });

        expect(rows).toEqual(
          group.templates.map(
            (
              template: DatabaseAlertTemplateEntry,
            ): DatabaseAlertTemplateEntry => {
              return {
                name: escapeForHtml(template.name),
                severity: template.severity,
              };
            },
          ),
        );

        quoted += rows.length;
      },
    );

    expect(quoted).toBe(getAllDatabaseAlertTemplates().length);
  });

  test("colours each severity the way the rest of the site does", () => {
    expect(html).toMatch(
      /<span class="[^"]*text-red-600[^"]*">Critical<\/span>/,
    );
    expect(html).toMatch(
      /<span class="[^"]*text-amber-600[^"]*">Warning<\/span>/,
    );
    expect(html).not.toMatch(
      /<span class="[^"]*text-amber-600[^"]*">Critical<\/span>/,
    );
    expect(html).not.toMatch(
      /<span class="[^"]*text-red-600[^"]*">Warning<\/span>/,
    );
  });

  test("names the forks each engine's monitors are also offered to", () => {
    expect(html).toContain("Also offered to MariaDB<");
    expect(html).toContain("Also offered to Valkey, KeyDB and Dragonfly<");
    expect(html).toContain("Also offered to OpenSearch<");

    // Only under the engines that have forks: no empty "Also offered to".
    expect(html.split("Also offered to ").length - 1).toBe(
      content.alertTemplateGroups.filter(
        (group: DatabaseAlertTemplateGroup): boolean => {
          return group.alsoOfferedTo.length > 0;
        },
      ).length,
    );
  });

  test("the alerts in the mockups are real recommended monitors of the engines they are shown on", () => {
    for (const [templateName, engineLabel, system] of [
      ["Connections Nearly Exhausted", "PostgreSQL", "postgresql"],
      ["Replica Lag", "MySQL", "mysql"],
      ["Memory Near maxmemory", "Valkey", "valkey"],
      ["Engine Metrics Stopped", "SQL Server", "microsoft.sql_server"],
    ] as Array<[string, string, string]>) {
      expect(html).toMatch(
        new RegExp(
          `>${escapeForRegExp(templateName)}</div>\\s*<div[^>]*>${escapeForRegExp(engineLabel)} `,
        ),
      );
      expect(
        getDatabaseAlertTemplates(system).map(
          (template: DatabaseAlertTemplate): string => {
            return template.name;
          },
        ),
      ).toContain(templateName);
    }
  });

  test("the engine metrics mockup charts titles from the PostgreSQL catalog", () => {
    const titles: Array<string> = getDatabaseServerMetrics("postgresql").map(
      (metric: DatabaseServerMetricDefinition): string => {
        return metric.title;
      },
    );

    for (const title of [
      "Connections",
      "Commits",
      "Rollbacks",
      "Database size",
      "Replication lag",
      "WAL age",
    ]) {
      expect(titles).toContain(title);
      expect(html).toContain(`>${title}</span>`);
    }
  });

  test("the hero labels discovery sources the way the product does", () => {
    const labels: Array<string> = DATABASE_SERVER_DISCOVERY_SOURCES.map(
      (source: DatabaseServerDiscoverySource): string => {
        return getDatabaseServerDiscoverySourceLabel(source);
      },
    );

    for (const label of [
      "Application traces",
      "Kubernetes",
      "Docker",
      "OpenTelemetry Collector",
      "Added manually",
    ]) {
      expect(labels).toContain(label);
      expect(html).toContain(`>${label}</`);
    }
  });

  test("quotes the discovery defaults the product actually uses", () => {
    const minCalls: number = numericConstantIn(
      "packages/Common/Server/Utils/Telemetry/DatabaseEndpointDiscovery.ts",
      "DEFAULT_DATABASE_SERVER_MIN_CALLS",
    );
    const budget: number = numericConstantIn(
      "packages/Common/Server/Services/DatabaseServerService.ts",
      "DEFAULT_AUTO_CREATE_BUDGET",
    );
    const archiveDays: number = numericConstantIn(
      "packages/Common/Server/Services/DatabaseServerService.ts",
      "DEFAULT_AUTO_ARCHIVE_DAYS",
    );

    expect(html).toContain(`${minCalls} queries in 15 minutes`);
    expect(html).toContain(`${budget} live discovered databases`);
    expect(html).toContain(`seen for ${archiveDays} days`);
  });

  test("quotes the discovery schedules the workers actually run", () => {
    // Client spans in ComputeServiceDependencies; pods and containers apart.
    expect(html).toContain(
      "Traces are read every 10 minutes and workloads every 5.",
    );
    const clientSpanJob: string = repoFile(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
    );

    expect(clientSpanJob).toMatch(
      /EVERY_TEN_MINUTES: string = "\*\/10 \* \* \* \*"/,
    );
    expect(clientSpanJob).toMatch(/schedule: EVERY_TEN_MINUTES\b/);
    expect(
      repoFile(
        "packages/App/FeatureSet/Workers/Jobs/DatabaseServer/DiscoverContainerDatabases.ts",
      ),
    ).toMatch(/schedule: EVERY_FIVE_MINUTE\b/);
  });

  test("describes the Database Agent the way it ships", () => {
    const compose: string = repoFile("agents/DatabaseAgent/docker-compose.yml");

    // A stock collector image, and query events off unless switched on.
    expect(html).toContain("otel/opentelemetry-collector-contrib</code>");
    expect(compose).toMatch(/image: otel\/opentelemetry-collector-contrib:/);
    expect(html).toContain("DATABASE_QUERY_EVENTS=true</code>");
    expect(compose).toContain(
      "DATABASE_QUERY_EVENTS=${DATABASE_QUERY_EVENTS:-false}",
    );
  });

  test("names the monitoring grants the Databases docs prescribe", () => {
    const docs: string = repoFile(
      "packages/App/FeatureSet/Docs/Content/en/telemetry/databases.md",
    );

    for (const grant of [
      "pg_monitor",
      "VIEW SERVER STATE",
      "SELECT_CATALOG_ROLE",
      "clusterMonitor",
    ]) {
      expect(html).toContain(`>${grant}</code>`);
      expect(docs).toContain(grant);
    }
  });

  test("every docs link in the page body is a real docs page and heading", () => {
    const docsLinks: Array<string> = [
      ...new Set(
        [...pageBodyOf(html).matchAll(/href="(\/docs\/[^"]+)"/g)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ),
    ];

    expect(docsLinks).toEqual(
      expect.arrayContaining([
        "/docs/telemetry/databases",
        "/docs/telemetry/databases#alerts-on-a-database",
        "/docs/monitor/database-health-monitor",
        "/docs/monitor/sql-monitor",
      ]),
    );

    for (const link of docsLinks) {
      const [docsPath, anchor] = link.replace(/^\/docs\//, "").split("#") as [
        string,
        string | undefined,
      ];
      const markdown: string = repoFile(
        `packages/App/FeatureSet/Docs/Content/en/${docsPath}.md`,
      );

      if (anchor) {
        const slugs: Array<string> = [
          ...markdown.matchAll(/^#{2,4} (.+)$/gm),
        ].map((match: RegExpMatchArray): string => {
          return match[1]!
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, "")
            .trim()
            .replace(/\s+/g, "-");
        });

        expect(slugs).toContain(anchor);
      }
    }
  });

  test("cross-links the products and pages it leans on", () => {
    for (const href of [
      "/product/kubernetes",
      "/product/ai-agent",
      "/product/monitoring",
      "/pricing",
      "/enterprise/self-hosted",
      "/accounts/register",
      "/enterprise/demo",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("every product link in the page body is a real canonical page", () => {
    const productLinks: Array<string> = catalogueLinksIn(pageBodyOf(html));

    expect(productLinks.length).toBeGreaterThan(2);

    for (const href of productLinks) {
      expect(PageSEOConfig[href]?.canonicalPath).toBe(href);
    }
  });

  test("names engines without presenting OneUptime as any vendor's product", () => {
    const body: string = pageBodyOf(html);

    expect(body).toContain("not affiliated with or endorsed by them");
    expect(body).not.toMatch(
      /official (?:PostgreSQL|MySQL|MariaDB|MongoDB|Redis|Oracle|Microsoft|Elastic)/i,
    );
    expect(body).not.toMatch(/certified by/i);
    expect(body).not.toMatch(/partner(?:ed)? with/i);
  });

  test("keeps the Community Edition claim exact", () => {
    expect(html).toContain(
      "Databases is part of the open source Community Edition (Apache 2.0).",
    );
  });

  test("never leaks another resource page's vocabulary into its own sections", () => {
    const body: string = databasesOwnSectionsOf(html);

    for (const leak of [
      /vCenter/,
      /ESXi/,
      /vSphere/,
      /Proxmox/,
      /datastore/i,
      /CrashLoopBackOff/,
      /kubelet/i,
    ]) {
      expect(body).not.toMatch(leak);
    }
  });

  test("wires the cursor glow to its own element ids", () => {
    expect(html).toContain('id="databases-hero-section"');
    expect(html).toContain('id="databases-grid-glow"');
    expect(html).toContain("getElementById('databases-hero-section')");
    expect(html).toContain("getElementById('databases-grid-glow')");
    for (const borrowed of ["vmware", "kubernetes", "proxmox"]) {
      expect(html).not.toContain(`${borrowed}-hero-section`);
      expect(html).not.toContain(`${borrowed}-grid-glow`);
    }
  });
});

/*
 * The Databases page's own sections: everything in <main> up to the end of
 * its FAQ. The shared features-table include that follows lists the other
 * products' cards, vocabulary and all.
 */
function databasesOwnSectionsOf(html: string): string {
  const body: string = pageBodyOf(html);
  const faqStart: number = body.indexOf('id="databases-faq"');
  const faqEnd: number = body.indexOf("</dl>", faqStart);

  expect(faqStart).toBeGreaterThan(-1);
  expect(faqEnd).toBeGreaterThan(faqStart);

  return body.slice(0, faqEnd);
}

// The markup of the first link to `href` in `html`, up to its </a>.
function linkBlockOf(html: string, href: string): string {
  const start: number = html.indexOf(`<a href="${href}"`);

  expect(start).toBeGreaterThan(-1);

  return html.slice(start, html.indexOf("</a>", start));
}

function productLinksIn(html: string): Array<string> {
  return [...html.matchAll(/href="(\/product\/[^"#]+)"/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("Databases on every product surface", () => {
  test("the navigation lists Databases right after Services, in both product lists", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });
    const links: Array<string> = productLinksIn(nav);

    expect(nav.split('href="/product/databases"').length - 1).toBe(2);

    /*
     * The dashboard files Databases beside Services, with the catalogs that
     * span every platform, not under one platform.
     */
    const afterServices: Array<string> = links
      .map((href: string, index: number): string | null => {
        return href === "/product/services" ? links[index + 1] || null : null;
      })
      .filter((href: string | null): href is string => {
        return href !== null;
      });

    expect(afterServices).toEqual(["/product/databases", "/product/databases"]);
    expect(nav).toContain(
      'data-search="databases database monitoring db postgres postgresql mysql mariadb sql server oracle redis valkey mongodb elasticsearch queries engine metrics"',
    );
  });

  test("the mobile menu lists what the flyout lists, with no hole before the AI card", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });

    // The mobile menu's two-column grid, which opens with a full-width AI card.
    const mobileStart: number = nav.indexOf(
      '<nav class="grid grid-cols-2 gap-3">',
    );
    const mobile: string = nav.slice(
      mobileStart,
      nav.indexOf("</nav>", mobileStart),
    );
    const mobileLinks: Array<string> = productLinksIn(mobile);
    const fullWidth: Array<string> = [
      ...mobile.matchAll(/<a href="(\/product\/[^"#]+)" class="col-span-2/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(mobileStart).toBeGreaterThan(-1);
    expect(fullWidth).toEqual(["/product/ai-agent"]);
    // Featured first, as the flyout features it above every product.
    expect(mobileLinks[0]).toBe("/product/ai-agent");

    /*
     * An odd number of products right before a full-width card leaves an
     * empty cell beside the last of them: the cells before each full-width
     * card must fill whole rows.
     */
    let cellsSinceFullWidth: number = 0;

    for (const href of mobileLinks) {
      if (fullWidth.includes(href)) {
        expect({ fullWidth: href, oddCell: cellsSinceFullWidth % 2 }).toEqual({
          fullWidth: href,
          oddCell: 0,
        });
        cellsSinceFullWidth = 0;
        continue;
      }

      cellsSinceFullWidth++;
    }

    // The flyout: every product card, plus its featured AI banner.
    const flyoutLinks: Array<string> = productLinksIn(
      nav.slice(nav.indexOf('id="product-modal"')),
    );

    expect([...mobileLinks].sort()).toEqual([...flyoutLinks].sort());
  });

  test("the flyout search keeps the short aliases of other products unambiguous", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });
    const search: string = nav.match(
      /href="\/product\/databases"[^>]*data-search="([^"]+)"/,
    )![1]!;

    // Typing either alias must still narrow the flyout to its one product.
    for (const alias of ["rum", "k8s"]) {
      expect(search).not.toContain(alias);
    }
  });

  test("the footer lists Databases after Hosts", async () => {
    const footer: string = await render("footer.ejs", {
      footerCards: false,
      cta: false,
      homeUrl: HOME_URL,
    });
    const links: Array<string> = productLinksIn(footer);

    expect(links).toContain("/product/databases");
    expect(links[links.indexOf("/product/host") + 1]).toBe(
      "/product/databases",
    );
  });

  test.each([
    "features-table.ejs",
    "Partials/product-showcase.ejs",
    "Partials/hero-cards/product-grid.ejs",
    "Partials/home-products.ejs",
    "Partials/home-detect.ejs",
  ])(
    "%s links to the Databases product with its glyph",
    async (templateFileName: string) => {
      const partial: string = await render(templateFileName, {
        homeUrl: HOME_URL,
      });

      expect(partial.split('href="/product/databases"').length - 1).toBe(1);
      expect(linkBlockOf(partial, "/product/databases")).toContain(
        DATABASE_GLYPH_PATH_START,
      );
    },
  );

  test("the homepage lists Databases next to Hosts", async () => {
    const products: string = await render("Partials/home-products.ejs", {
      homeUrl: HOME_URL,
    });
    const pills: string = await render("Partials/home-detect.ejs", {
      homeUrl: HOME_URL,
    });

    for (const partial of [products, pills]) {
      const links: Array<string> = productLinksIn(partial);

      expect(links[links.indexOf("/product/host") + 1]).toBe(
        "/product/databases",
      );
    }
  });

  test("the hero card and icon partials render on their own", async () => {
    const card: string = await render("Partials/hero-cards/databases.ejs", {});
    const icon: string = await render("Partials/icons/databases.ejs", {
      iconClass: "h-3 w-3",
    });

    expect(card).toContain('href="/product/databases"');
    expect(card).toContain(">Databases<");
    expect(card).toContain("hero-glow-emerald");
    expect(icon).toContain('class="h-3 w-3 text-emerald-600"');
    expect(icon).not.toMatch(/<title>/);
  });

  test("the icon is the dashboard's own Database glyph", async () => {
    const icon: string = await render("Partials/icons/databases.ejs", {});
    const iconSource: string = repoFile(
      "packages/Common/UI/Components/Icon/Icon.tsx",
    );
    const dashboardPath: string = iconSource.match(
      /icon === IconProp\.Database\)[\s\S]*?d="([^"]+)"/,
    )![1]!;

    expect(icon).toContain(`d="${dashboardPath}"`);
    expect(dashboardPath.startsWith(DATABASE_GLYPH_PATH_START)).toBe(true);
  });
});

// The queue-list glyph IconProp.QueueList draws in the dashboard.
const QUEUE_GLYPH_PATH_START: string =
  "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5";

/*
 * A system's starting threshold by name, read the way "Create monitor"
 * reads it: the template of one of the system's broker health metrics.
 */
function queueTemplateNamed(
  system: string,
  name: string,
): MessageQueueAlertTemplate | undefined {
  for (const metric of getMessageQueueMetricsForSystem(system)) {
    const template: MessageQueueAlertTemplate | undefined =
      getMessageQueueAlertTemplateForMetric(metric);

    if (template && template.name === name) {
      return template;
    }
  }

  return undefined;
}

// "1.21M", "610k", "5,412" as the mockups print them.
function parseMockupCount(value: string): number {
  const match: RegExpMatchArray | null = value
    .replace(/,/g, "")
    .match(/^([\d.]+)([kM]?)$/);

  if (!match) {
    throw new Error(`"${value}" is not a count the mockups print`);
  }

  const multiplier: number =
    match[2] === "M" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;

  return Number(match[1]) * multiplier;
}

/*
 * The Queues page's own sections: everything in <main> up to the end of its
 * FAQ. The shared features-table include that follows lists the other
 * products' cards, vocabulary and all.
 */
function queuesOwnSectionsOf(html: string): string {
  const body: string = pageBodyOf(html);
  const faqStart: number = body.indexOf('id="queues-faq"');
  const faqEnd: number = body.indexOf("</dl>", faqStart);

  expect(faqStart).toBeGreaterThan(-1);
  expect(faqEnd).toBeGreaterThan(faqStart);

  return body.slice(0, faqEnd);
}

describe("queues.ejs", () => {
  let html: string = "";
  const seo: PageSEOData = PageSEOConfig["/product/queues"]!;
  const content: QueuesPageContent = getQueuesPageContent();
  const locals: Record<string, unknown> = {
    enableGoogleTagManager: false,
    seo: seoFor("/product/queues"),
    homeUrl: HOME_URL,
  };

  // One messaging system's entry in the supported-systems section.
  function systemEntryOf(system: string): string {
    const start: number = html.indexOf(`data-messaging-system="${system}"`);

    expect(start).toBeGreaterThan(-1);

    const next: number = html.indexOf('data-messaging-system="', start + 1);

    return html.slice(start, next === -1 ? html.indexOf("</ul>", start) : next);
  }

  beforeAll(async () => {
    // Exactly the locals Routes.ts hands the template, plus homeUrl.
    html = await render("queues.ejs", {
      ...locals,
      queues: getQueuesPageContent(),
    });
  });

  test("renders a complete page", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(10000);
  });

  test("the hardcoded head is identical to the SEO entry", () => {
    // Search engines read the first pair, social cards the second.
    expect(html).toContain(`<title>${seo.title}</title>`);
    expect(html).toContain(`content="${seo.description}"`);
    expect(html).toContain(
      '<link rel="canonical" href="https://oneuptime.com/product/queues"',
    );
  });

  test("renders the sections the page is built around", () => {
    for (const heading of [
      "Every queue and topic, found and monitored",
      "Three sources, one page per queue",
      "From the spans you already send to a monitored queue",
      "Queue monitoring that sees both sides",
      `${content.systemCount} messaging systems, known by name`,
      `${content.alertThresholdCount} starting thresholds for ${content.systemsWithAlertThresholdsCount} messaging systems`,
      "Built for the way messaging actually runs",
      "Queue alerts where your team already works",
      "Pay for data, or run it yourself",
      "Questions platform teams ask",
    ]) {
      expect(html).toContain(heading);
    }
  });

  test("covers every source a queue's page is built from", () => {
    for (const source of [
      "Application traces",
      "Broker metrics",
      "Client metrics",
    ]) {
      expect(html).toContain(`>${source}</h3>`);
    }
  });

  test("prints the counts the catalogs give it, not numbers typed into the copy", async () => {
    expect(html).toContain(
      `${MESSAGING_SYSTEMS.length} messaging systems</span>`,
    );
    expect(html).toContain(
      `Curated broker health charts for ${content.systemsWithBrokerHealthCount} messaging systems`,
    );
    expect(html).toContain(
      `charts broker health for ${content.systemsWithBrokerHealthCount} of them`,
    );

    // Control: other counts in, other counts out.
    const doctored: string = await render("queues.ejs", {
      ...locals,
      queues: {
        ...content,
        systemCount: 1234,
        systemsWithBrokerHealthCount: 567,
        alertThresholdCount: 89,
        systemsWithAlertThresholdsCount: 12,
      },
    });

    expect(doctored).toContain("1234 messaging systems, known by name");
    expect(doctored).toContain("1234 messaging systems</span>");
    expect(doctored).toContain(
      "Curated broker health charts for 567 messaging systems",
    );
    expect(doctored).toContain("charts broker health for 567 of them");
    expect(doctored).toContain(
      "89 starting thresholds for 12 messaging systems",
    );
  });

  test("lists every catalog system once, under the source of its broker metrics", () => {
    const listed: Array<string> = [
      ...html.matchAll(/data-messaging-system="([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect([...listed].sort()).toEqual(
      MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor): string => {
        return descriptor.system;
      }).sort(),
    );

    // Each group card holds its systems up to the next card.
    const cards: Array<string> = html.split('data-system-group="').slice(1);

    expect(cards.length).toBe(content.systemGroups.length);

    content.systemGroups.forEach((group: QueueSystemGroup, index: number) => {
      const card: string = cards[index]!;

      expect(card.startsWith(`${group.key}"`)).toBe(true);
      expect(card).toContain(`>${escapeForHtml(group.title)}</h3>`);
      expect(
        [...card.matchAll(/data-messaging-system="([^"]+)"/g)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ).toEqual(
        group.systems.map((entry: QueueSystemEntry): string => {
          return entry.system;
        }),
      );
    });
  });

  test("names each system, where its metrics come from and the charts its queues show", () => {
    for (const group of content.systemGroups) {
      for (const entry of group.systems) {
        const block: string = systemEntryOf(entry.system);

        expect(block).toContain(`>${escapeForHtml(entry.displayName)}</span>`);

        if (entry.metricsSource) {
          expect(block).toContain(
            `>${escapeForHtml(entry.metricsSource)}</code>`,
          );
        } else {
          expect(block).not.toContain("<code");
        }

        expect(
          [...block.matchAll(/data-broker-health-chart>([^<]+)</g)].map(
            (match: RegExpMatchArray): string => {
              return match[1]!;
            },
          ),
        ).toEqual(entry.brokerHealthCharts.map(escapeForHtml));
      }
    }
  });

  test("says where the metrics of a system without charts go instead", () => {
    for (const system of ["nats", "eventgrid"]) {
      expect(systemEntryOf(system)).toContain(
        "Its broker metrics arrive in the Metrics explorer, not on a queue's page.",
      );
    }

    for (const system of ["jms", "bullmq"]) {
      expect(systemEntryOf(system)).toContain(
        "Queues from traces, with no broker metrics of their own.",
      );
    }
  });

  test("quotes every starting threshold by its real name, value and severity, under its system", () => {
    const section: string = html.slice(
      html.indexOf('id="queues-monitors"'),
      html.indexOf("<!-- Build your own -->"),
    );
    const cards: Array<string> = section
      .split('data-alert-threshold-group="')
      .slice(1);

    expect(cards.length).toBe(content.alertThresholdGroups.length);

    let quoted: number = 0;

    content.alertThresholdGroups.forEach(
      (group: QueueAlertThresholdGroup, index: number) => {
        const card: string = cards[index]!;

        expect(card.startsWith(`${group.system}"`)).toBe(true);
        expect(card).toContain(`>${escapeForHtml(group.title)}</h3>`);

        const rows: Array<QueueAlertThresholdEntry> = [
          ...card.matchAll(
            /<li[^>]*><span>([^<]+)<\/span><span[^>]*><span[^>]*>([^<]+)<\/span><span[^>]*>(Critical|Warning)<\/span><\/span><\/li>/g,
          ),
        ].map((match: RegExpMatchArray): QueueAlertThresholdEntry => {
          return {
            name: match[1]!,
            threshold: match[2]!,
            severity: match[3] as QueueAlertThresholdEntry["severity"],
          };
        });

        expect(rows).toEqual(
          group.thresholds.map(
            (entry: QueueAlertThresholdEntry): QueueAlertThresholdEntry => {
              return {
                name: escapeForHtml(entry.name),
                threshold: escapeForHtml(entry.threshold),
                severity: entry.severity,
              };
            },
          ),
        );

        // Each one is the template Create monitor reads beside that chart.
        for (const entry of group.thresholds) {
          const template: MessageQueueAlertTemplate | undefined =
            queueTemplateNamed(group.system, entry.name);

          expect(template).toBeDefined();
          expect(template!.severity).toBe(entry.severity);
          expect(
            formatMessageQueueThreshold(template!.threshold, template!.unit),
          ).toBe(entry.threshold);
        }

        quoted += rows.length;
      },
    );

    expect(quoted).toBe(content.alertThresholdCount);
  });

  test("colours each severity the way the rest of the site does", () => {
    expect(html).toMatch(
      /<span class="[^"]*text-red-600[^"]*">Critical<\/span>/,
    );
    expect(html).toMatch(
      /<span class="[^"]*text-amber-600[^"]*">Warning<\/span>/,
    );
    expect(html).not.toMatch(
      /<span class="[^"]*text-amber-600[^"]*">Critical<\/span>/,
    );
    expect(html).not.toMatch(
      /<span class="[^"]*text-red-600[^"]*">Warning<\/span>/,
    );
  });

  test("the alerts in the mockups are real starting thresholds of the systems they are shown on", () => {
    for (const [templateName, system, severity] of [
      ["Messages In Flight Near Quota", "aws_sqs", "CRITICAL"],
      ["Consumer Lag High", "kafka", "WARNING"],
      ["Dead-Lettered Messages", "servicebus", "WARNING"],
      ["Queue Depth High", "rabbitmq", "WARNING"],
    ] as Array<[string, string, string]>) {
      const template: MessageQueueAlertTemplate | undefined =
        queueTemplateNamed(system, templateName);

      expect(template).toBeDefined();
      expect(template!.severity.toUpperCase()).toBe(severity);
      expect(html).toMatch(
        new RegExp(
          `>${severity}</span>[\\s\\S]{0,300}?>${escapeForRegExp(templateName)}</div>\\s*<div[^>]*>${escapeForRegExp(getMessagingSystemDisplayName(system))} `,
        ),
      );
    }
  });

  test("the Slack alert quotes the threshold its monitor starts from", () => {
    const template: MessageQueueAlertTemplate = queueTemplateNamed(
      "kafka",
      "Consumer Lag High",
    )!;

    expect(template.severity).toBe("Warning");
    expect(html).toMatch(
      />WARNING<\/span>\s*<span class="text-white\/40 text-xs">Consumer Lag High<\/span>/,
    );
    expect(html).toContain(
      `Threshold: ${formatMessageQueueThreshold(template.threshold, template.unit)}`,
    );
    expect(html).toMatch(/<\/svg>\s*Apache Kafka &middot; orders\s*<\/span>/);
  });

  test("the broker health mockup charts RabbitMQ's catalog, with Create monitor only where the product offers it", () => {
    const rabbitmq: ReadonlyArray<MessageQueueMetricDescriptor> =
      getMessageQueueMetricsForSystem("rabbitmq");
    const tiles: Array<{ title: string; createMonitor: boolean }> = [
      ...html.matchAll(
        /data-broker-chart="([^"]+)"( data-create-monitor="true")?/g,
      ),
    ].map(
      (match: RegExpMatchArray): { title: string; createMonitor: boolean } => {
        return { title: match[1]!, createMonitor: Boolean(match[2]) };
      },
    );

    // Every chart a RabbitMQ queue shows, and none it does not.
    expect(
      tiles
        .map((tile: { title: string }): string => {
          return tile.title;
        })
        .sort(),
    ).toEqual(
      rabbitmq
        .map((metric: MessageQueueMetricDescriptor): string => {
          return metric.title;
        })
        .sort(),
    );

    for (const tile of tiles) {
      const metric: MessageQueueMetricDescriptor = rabbitmq.find(
        (candidate: MessageQueueMetricDescriptor): boolean => {
          return candidate.title === tile.title;
        },
      )!;

      // A gauge gets Create monitor; a counter, charted as a rate, does not.
      expect(tile).toEqual({
        title: tile.title,
        createMonitor: isMessageQueueMetricMonitorable(metric),
      });
      expect(html).toContain(`>${tile.title}</span>`);
    }

    expect(html).toContain("from the collector's rabbitmq receiver");
    expect(
      MESSAGING_SYSTEMS.find((descriptor: MessagingSystemDescriptor) => {
        return descriptor.system === "rabbitmq";
      })!.brokerMetrics,
    ).toMatchObject({ kind: "receiver", receiver: "rabbitmq" });

    // Its depth is ready plus unacknowledged, as the note under it says.
    const depth: MessageQueueMetricDescriptor = rabbitmq.find(
      (metric: MessageQueueMetricDescriptor): boolean => {
        return metric.title === "Queue depth";
      },
    )!;
    const total: MessageQueueSeriesTotalDefinition | undefined =
      MESSAGE_QUEUE_SERIES_TOTALS.find(
        (definition: MessageQueueSeriesTotalDefinition): boolean => {
          return (
            definition.system === "rabbitmq" &&
            definition.metricName === depth.metricName
          );
        },
      );

    expect(total?.values).toEqual(["ready", "unacknowledged"]);
    expect(html).toMatch(
      new RegExp(
        `Ready and unacknowledged, added up</span>\\s*<span[^>]*>${escapeForRegExp(depth.metricName)}</span>`,
      ),
    );
  });

  test("the broker health mockup uses the dashboard's own labels", () => {
    const section: string = repoFile(
      "packages/App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerHealthSection.tsx",
    );

    /*
     * The labels are translation keys, and a key is its English text:
     * translationKey() returns its argument, so English shows exactly
     * these words.
     */
    expect(section).toMatch(
      /BROKER_HEALTH_TITLE: string = translationKey\("Broker health"\);/,
    );
    expect(section).toMatch(
      /BROKER_HEALTH_CREATE_MONITOR_LABEL: string =\s*translationKey\("Create monitor"\);/,
    );
    expect(section).toContain(
      "{translator.translateText(BROKER_HEALTH_TITLE)}",
    );
    expect(section).toMatch(
      /translator\.translateText\(\s*BROKER_HEALTH_CREATE_MONITOR_LABEL,?\s*\)/,
    );
    expect(html).toContain(">Broker health</span>");
    expect(html).toContain(">Create monitor</div>");
  });

  test("the producers and consumers mockup uses the labels a queue's Overview shows", () => {
    const overview: string = repoFile(
      "packages/App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Overview.tsx",
    );
    const servicesCard: string = repoFile(
      "packages/App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueServicesCard.tsx",
    );

    for (const [title, sublabel] of [
      ["Published", "publish spans, selected range"],
      ["Consumed", "consumer spans, selected range"],
      ["p95 processing time", "consumer spans, as the consumers measure them"],
    ] as Array<[string, string]>) {
      expect(html).toContain(`data-queue-tile="${title}"`);
      expect(html).toContain(`>${sublabel}</div>`);
      expect(overview).toContain(`title: "${title}"`);
      expect(overview).toContain(`sublabel: "${sublabel}"`);
    }

    /*
     * The Errors tile counts failed spans, out of all of the queue's spans:
     * English reads "{{rate}} of {{count}} spans", the count being the
     * queue's total.
     */
    expect(html).toContain('data-queue-tile="Errors"');
    expect(overview).toContain('title: "Errors"');
    expect(overview).toContain('other: "{{rate}} of {{count}} spans"');
    expect(overview).toContain("count: formatMessageQueueCount(m.total)");
    expect(html).toMatch(/>[\d.]+% of [\d.]+M spans</);

    expect(servicesCard).toContain('title: "Producers"');
    expect(servicesCard).toContain('title: "Consumers"');
    // Translation keys, which are their English text.
    for (const [field, label] of [
      ["countHeader", "Published"],
      ["countHeader", "Consumed"],
      ["durationHeader", "p95 publish"],
      ["durationHeader", "p95 processing"],
    ] as Array<[string, string]>) {
      expect(servicesCard).toContain(`${field}: translationKey("${label}")`);
    }
    for (const field of ["countHeader", "durationHeader"]) {
      expect(servicesCard).toContain(
        `{translator.translateText(copy.${field})}`,
      );
    }

    for (const header of [
      ">Producers</div>",
      ">Consumers</div>",
      ">p95 publish</div>",
      ">p95 processing</div>",
    ]) {
      expect(html).toContain(header);
    }
  });

  test("the producers and consumers mockup adds up", () => {
    const block: string = html.slice(
      html.indexOf('data-queue-tile="Published"'),
      html.indexOf("<!-- Feature 2: Broker health -->"),
    );
    const tile: (title: string) => string = (title: string): string => {
      return block.match(
        new RegExp(
          `data-queue-tile="${escapeForRegExp(title)}">[\\s\\S]*?<div class="text-lg font-bold text-gray-900">([^<]+)</div>\\s*<div[^>]*>([^<]+)</div>`,
        ),
      )![1]!;
    };
    const sideCounts: (side: string) => Array<number> = (
      side: string,
    ): Array<number> => {
      const start: number = block.indexOf(`>${side}</div>`);
      const end: number =
        side === "Producers" ? block.indexOf(">Consumers</div>") : block.length;

      return [
        ...block
          .slice(start, end)
          .matchAll(
            /truncate">[^<]+<\/div><div class="col-span-3 text-right[^"]*">([^<]+)<\/div>/g,
          ),
      ].map((match: RegExpMatchArray): number => {
        return parseMockupCount(match[1]!);
      });
    };
    const sum: (values: Array<number>) => number = (
      values: Array<number>,
    ): number => {
      return values.reduce((total: number, value: number): number => {
        return total + value;
      }, 0);
    };

    const published: number = parseMockupCount(tile("Published"));
    const consumed: number = parseMockupCount(tile("Consumed"));

    // Every message published is published by one of the producers listed.
    expect(sideCounts("Producers").length).toBe(2);
    expect(Math.abs(sum(sideCounts("Producers")) - published)).toBeLessThan(
      published * 0.005,
    );
    // Each consuming service reads the topic, so their counts add up.
    expect(sideCounts("Consumers").length).toBe(2);
    expect(Math.abs(sum(sideCounts("Consumers")) - consumed)).toBeLessThan(
      consumed * 0.005,
    );

    // "N errors, X% of the queue's spans", where its spans are both sides.
    const errors: number = parseMockupCount(tile("Errors"));
    const errorsLine: RegExpMatchArray = block.match(
      />([\d.]+)% of ([\d.]+M) spans</,
    )!;
    const spans: number = parseMockupCount(errorsLine[2]!);

    expect(Math.abs(spans - (published + consumed))).toBeLessThan(
      spans * 0.005,
    );
    expect(((errors / spans) * 100).toFixed(2)).toBe(errorsLine[1]);
  });

  test("every name-folding example is what OneUptime's resolver does with that span", () => {
    const examples: Array<RegExpMatchArray> = [
      ...html.matchAll(
        /data-destination-example data-system="([^"]+)">\s*<div[^>]*>([^<]+)<\/div>[\s\S]*?data-reported-as="([^"]+)"[\s\S]*?data-queue="([^"]+)"/g,
      ),
    ];

    expect(examples.length).toBe(6);

    for (const [, system, label, reportedAs, queue] of examples) {
      const attributes: Record<string, string> = {
        "messaging.system": system!,
        "messaging.destination.name": reportedAs!,
      };
      const resolved: ResolvedMessagingDestination | null =
        resolveMessagingSpan({
          getAttribute: (key: string): unknown => {
            return attributes[key];
          },
          kind: "SPAN_KIND_CONSUMER",
        });

      expect({ reportedAs, queue: resolved?.destination }).toEqual({
        reportedAs,
        queue,
      });
      expect(resolved!.system).toBe(system);
      expect(label).toBe(getMessagingSystemDisplayName(system));
    }
  });

  test("the spellings and names it says are one queue are one queue", () => {
    expect(html).toContain("AmazonSQS, aws.sqs and aws_sqs are one system");
    for (const spelling of ["AmazonSQS", "aws.sqs", "aws_sqs"]) {
      expect(normalizeMessagingSystem(spelling)).toBe("aws_sqs");
    }

    const identifierOf: (
      system: string,
      destination: string,
      brokerScope?: string,
    ) => string | null = (
      system: string,
      destination: string,
      brokerScope: string = "",
    ): string | null => {
      return buildMessageQueueIdentifier({ system, brokerScope, destination });
    };

    // "Orders and orders are one queue"
    expect(html).toContain("Orders and orders are one queue");
    expect(identifierOf("kafka", "Orders")).toBe(
      identifierOf("kafka", "orders"),
    );

    // The FAQ: two Kafka clusters with a topic called orders share one queue.
    expect(identifierOf("kafka", "orders", "cluster-a")).toBe(
      identifierOf("kafka", "orders", "cluster-b"),
    );

    // ...while Service Bus and Event Hubs keep their namespace.
    for (const system of ["servicebus", "eventhubs"]) {
      expect(getMessagingBrokerScope(system)).toBe("azure-namespace");
      expect(identifierOf(system, "orders", "shop-prod")).not.toBe(
        identifierOf(system, "orders", "shop-test"),
      );
    }

    // JMS spans and ActiveMQ's broker metrics land on one queue.
    expect(identifierOf("activemq", "orders")).toBe(
      identifierOf("jms", "orders"),
    );
  });

  test("a broker it does not know keeps its own name, as the page says", () => {
    for (const system of ["ibmmq", "solace"]) {
      expect(html).toContain(`<code>${system}</code>`);
      expect(normalizeMessagingSystem(system)).toBe(system);
    }
  });

  test("quotes the discovery defaults the product actually uses", () => {
    const minSpans: number = numericConstantIn(
      "packages/Common/Server/Utils/Telemetry/MessageQueueDiscovery.ts",
      "DEFAULT_MESSAGE_QUEUE_MIN_SPANS",
    );
    const windowMinutes: number = numericConstantIn(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
      "WINDOW_MINUTES",
    );
    const budget: number = numericConstantIn(
      "packages/Common/Server/Services/MessageQueueService.ts",
      "DEFAULT_AUTO_CREATE_BUDGET",
    );
    const archiveDays: number = numericConstantIn(
      "packages/Common/Server/Services/MessageQueueService.ts",
      "DEFAULT_AUTO_ARCHIVE_DAYS",
    );

    expect(html).toContain(
      `A queue appears once ${minSpans} of its spans arrive in ${windowMinutes} minutes`,
    );
    expect(html).toContain(
      `only once ${minSpans} of its spans arrive in ${windowMinutes} minutes`,
    );
    expect(html).toContain(`${budget} live discovered queues per project`);
    expect(html).toContain(
      `nobody has seen for ${archiveDays} days is archived`,
    );
    expect(html).toContain(
      `A discovered queue nobody has seen for ${archiveDays} days`,
    );
  });

  test("quotes the discovery schedule and lookback the workers actually run", () => {
    const job: string = repoFile(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
    );

    expect(html).toContain(
      "Spans and broker metrics are read every 10 minutes.",
    );
    expect(job).toMatch(/EVERY_TEN_MINUTES: string = "\*\/10 \* \* \* \*"/);
    expect(job).toMatch(/schedule: EVERY_TEN_MINUTES\b/);
    expect(job).toContain("await discoverMessageQueuesForProject(");

    // Cloud monitoring's late points: the window plus its lookback is an hour.
    const lateMinutes: number = numericConstantIn(
      "packages/Common/Server/Utils/Telemetry/MessageQueueDiscovery.ts",
      "MESSAGE_QUEUE_LATE_METRIC_MINUTES",
    );
    const windowMinutes: number = numericConstantIn(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts",
      "WINDOW_MINUTES",
    );

    expect(lateMinutes + windowMinutes).toBe(60);
    expect(html).toContain("Discovery reads their metrics from the last hour");
  });

  test("monitors on late cloud metrics start with a window that can hold one", () => {
    expect(html).toContain(
      "monitors built from SQS, SNS and Pub/Sub charts start with windows long enough to hold one",
    );
    expect(html).toContain(
      "monitors on SQS, SNS and Pub/Sub charts start with a window long enough to hold their points",
    );

    for (const system of ["aws_sqs", "aws.sns", "gcp_pubsub"]) {
      const pulled: Array<MessageQueueMetricDescriptor> =
        getMessageQueueMetricsForSystem(system).filter(
          (metric: MessageQueueMetricDescriptor): boolean => {
            return metric.receiver !== "awsfirehose";
          },
        );

      expect(pulled.length).toBeGreaterThan(0);

      for (const metric of pulled) {
        expect({
          metric: metric.metricName,
          floor: getMessageQueueSourceWindowFloor(metric) !== null,
        }).toEqual({ metric: metric.metricName, floor: true });
      }
    }
  });

  test("names the monitoring access the Queues docs prescribe", () => {
    const docs: string = repoFile(
      "packages/App/FeatureSet/Docs/Content/en/telemetry/queues.md",
    );

    for (const grant of [
      "monitoring",
      "cloudwatch:ListMetrics",
      "cloudwatch:GetMetricData",
      "Monitoring Reader",
      "Monitoring Viewer",
    ]) {
      expect(html).toContain(`>${grant}</code>`);
      expect(docs).toContain(grant);
    }

    // "empty permission patterns": no right to configure, publish or consume.
    expect(html).toContain("with empty permission patterns");
    expect(docs).toContain('rabbitmqctl set_permissions -p / otel "" "" ""');
  });

  test("every docs link in the page body is a real docs page and heading", () => {
    const docsLinks: Array<string> = [
      ...new Set(
        [...pageBodyOf(html).matchAll(/href="(\/docs\/[^"]+)"/g)].map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ),
    ];

    expect(docsLinks).toEqual(
      expect.arrayContaining([
        "/docs/telemetry/queues",
        "/docs/telemetry/queues#broker-health-metrics",
        "/docs/telemetry/queues#alerting",
        "/docs/monitor/metrics-monitor",
      ]),
    );

    for (const link of docsLinks) {
      const [docsPath, anchor] = link.replace(/^\/docs\//, "").split("#") as [
        string,
        string | undefined,
      ];
      const markdown: string = repoFile(
        `packages/App/FeatureSet/Docs/Content/en/${docsPath}.md`,
      );

      if (anchor) {
        const slugs: Array<string> = [
          ...markdown.matchAll(/^#{2,4} (.+)$/gm),
        ].map((match: RegExpMatchArray): string => {
          return match[1]!
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, "")
            .trim()
            .replace(/\s+/g, "-");
        });

        expect(slugs).toContain(anchor);
      }
    }
  });

  test("cross-links the products and pages it leans on", () => {
    for (const href of [
      "/product/traces",
      "/product/serverless",
      "/pricing",
      "/enterprise/self-hosted",
      "/accounts/register",
      "/enterprise/demo",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("every product link in the page body is a real canonical page", () => {
    const productLinks: Array<string> = catalogueLinksIn(pageBodyOf(html));

    expect(productLinks.length).toBeGreaterThan(1);

    for (const href of productLinks) {
      expect(PageSEOConfig[href]?.canonicalPath).toBe(href);
    }
  });

  test("names brokers without presenting OneUptime as any vendor's product", () => {
    const body: string = pageBodyOf(html);

    expect(body).toContain("not affiliated with or endorsed by them");
    expect(body).not.toMatch(
      /official (?:Kafka|RabbitMQ|ActiveMQ|Pulsar|RocketMQ|NATS|BullMQ|Amazon|AWS|Azure|Microsoft|Google|Apache)/i,
    );
    expect(body).not.toMatch(/certified by/i);
    expect(body).not.toMatch(/partner(?:ed)? with/i);
  });

  test("keeps the Community Edition claim exact", () => {
    expect(html).toContain(
      "Queues is part of the open source Community Edition (Apache 2.0).",
    );
  });

  test("never leaks another resource page's vocabulary into its own sections", () => {
    const body: string = queuesOwnSectionsOf(html);

    for (const leak of [
      /vCenter/,
      /ESXi/,
      /vSphere/,
      /Proxmox/,
      /datastore/i,
      /CrashLoopBackOff/,
      /kubelet/i,
      /Database Agent/,
      /engine metrics/i,
    ]) {
      expect(body).not.toMatch(leak);
    }
  });

  test("the queue list mockup names systems and sources the way the dashboard does", () => {
    const hero: string = html.slice(
      html.indexOf('id="queues-hero-section"'),
      html.indexOf("<!-- What You Get Section -->"),
    );
    const model: string = repoFile(
      "packages/Common/Models/DatabaseModels/MessageQueue.ts",
    );
    const labelsStart: number = model.indexOf("DISCOVERY_SOURCE_LABELS");
    const labels: Array<string> = [
      ...model
        .slice(labelsStart, model.indexOf("]);", labelsStart))
        .matchAll(/\["[a-z-]+", "([^"]+)"\]/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(labels).toEqual([
      "Application traces",
      "Broker metrics",
      "Added manually",
    ]);

    for (const label of labels) {
      expect(hero).toContain(`>${label}</span>`);
    }

    for (const system of [
      "kafka",
      "servicebus",
      "rabbitmq",
      "aws_sqs",
      "gcp_pubsub",
    ]) {
      expect(hero).toContain(`>${getMessagingSystemDisplayName(system)}</div>`);
    }
  });

  test("wires the cursor glow to its own element ids", () => {
    expect(html).toContain('id="queues-hero-section"');
    expect(html).toContain('id="queues-grid-glow"');
    expect(html).toContain("getElementById('queues-hero-section')");
    expect(html).toContain("getElementById('queues-grid-glow')");
    for (const borrowed of ["databases", "vmware", "kubernetes", "proxmox"]) {
      expect(html).not.toContain(`${borrowed}-hero-section`);
      expect(html).not.toContain(`${borrowed}-grid-glow`);
    }
  });
});

describe("Queues on every product surface", () => {
  test("the navigation lists Queues right after Databases, in both product lists", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });
    const links: Array<string> = productLinksIn(nav);

    expect(nav.split('href="/product/queues"').length - 1).toBe(2);

    // The dashboard files Queues beside Databases, with the cross-platform catalogs.
    const afterDatabases: Array<string> = links
      .map((href: string, index: number): string | null => {
        return href === "/product/databases" ? links[index + 1] || null : null;
      })
      .filter((href: string | null): href is string => {
        return href !== null;
      });

    expect(afterDatabases).toEqual(["/product/queues", "/product/queues"]);
    expect(nav).toContain(
      'data-search="queues queue message queues messaging broker kafka rabbitmq activemq jms sqs sns pub/sub pubsub service bus event hubs event grid pulsar rocketmq nats bullmq topics consumer lag dead letter backlog"',
    );
  });

  test("the flyout search finds Queues by every broker, and leaves other products' aliases alone", async () => {
    const nav: string = await render("nav.ejs", { homeUrl: HOME_URL });
    const search: string = nav.match(
      /href="\/product\/queues"[^>]*data-search="([^"]+)"/,
    )![1]!;

    // Typing one of these must still narrow the flyout to its one product.
    for (const alias of ["rum", "k8s", "db"]) {
      expect(search).not.toContain(alias);
    }

    // "Apache Kafka" is found by "kafka", "Google Cloud Pub/Sub" by "pub/sub".
    for (const descriptor of MESSAGING_SYSTEMS) {
      const shortName: string = descriptor.displayName
        .replace(/^(?:Apache|Amazon|Azure|Google Cloud) /, "")
        .toLowerCase();

      expect({
        system: descriptor.system,
        found: search.includes(shortName),
      }).toEqual({
        system: descriptor.system,
        found: true,
      });
    }
  });

  test("the footer lists Queues after Databases", async () => {
    const footer: string = await render("footer.ejs", {
      footerCards: false,
      cta: false,
      homeUrl: HOME_URL,
    });
    const links: Array<string> = productLinksIn(footer);

    expect(links).toContain("/product/queues");
    expect(links[links.indexOf("/product/databases") + 1]).toBe(
      "/product/queues",
    );
  });

  test.each([
    "features-table.ejs",
    "Partials/product-showcase.ejs",
    "Partials/hero-cards/product-grid.ejs",
    "Partials/home-products.ejs",
    "Partials/home-detect.ejs",
  ])(
    "%s links to the Queues product with its glyph",
    async (templateFileName: string) => {
      const partial: string = await render(templateFileName, {
        homeUrl: HOME_URL,
      });

      expect(partial.split('href="/product/queues"').length - 1).toBe(1);
      expect(linkBlockOf(partial, "/product/queues")).toContain(
        QUEUE_GLYPH_PATH_START,
      );
    },
  );

  test("the homepage and the hero grid list Queues next to Databases", async () => {
    for (const templateFileName of [
      "Partials/home-products.ejs",
      "Partials/home-detect.ejs",
      "Partials/hero-cards/product-grid.ejs",
    ]) {
      const partial: string = await render(templateFileName, {
        homeUrl: HOME_URL,
      });
      const links: Array<string> = productLinksIn(partial);

      expect(links[links.indexOf("/product/databases") + 1]).toBe(
        "/product/queues",
      );
    }
  });

  test("the hero card and icon partials render on their own", async () => {
    const card: string = await render("Partials/hero-cards/queues.ejs", {});
    const icon: string = await render("Partials/icons/queues.ejs", {
      iconClass: "h-3 w-3",
    });

    expect(card).toContain('href="/product/queues"');
    expect(card).toContain(">Queues<");
    expect(card).toContain("hero-glow-indigo");
    expect(icon).toContain('class="h-3 w-3 text-indigo-600"');
    expect(icon).not.toMatch(/<title>/);
  });

  test("the icon is the glyph the dashboard marks Queues with", async () => {
    const icon: string = await render("Partials/icons/queues.ejs", {});
    const iconSource: string = repoFile(
      "packages/Common/UI/Components/Icon/Icon.tsx",
    );
    const dashboardPath: string = iconSource.match(
      /icon === IconProp\.QueueList\)[\s\S]*?d="([^"]+)"/,
    )![1]!;

    expect(icon).toContain(`d="${dashboardPath}"`);
    expect(dashboardPath.startsWith(QUEUE_GLYPH_PATH_START)).toBe(true);

    // ...the one the dashboard's navigation gives the Queues product.
    const navigationItems: string = repoFile(
      "packages/App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx",
    );
    const queuesItemStart: number = navigationItems.indexOf(
      "navbar.items.queuesTitle",
    );
    const queuesItem: string = navigationItems.slice(
      queuesItemStart,
      navigationItems.indexOf("category:", queuesItemStart),
    );

    expect(queuesItemStart).toBeGreaterThan(-1);
    expect(queuesItem).toContain("icon: IconProp.QueueList");
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
    expect(nav).toContain('href="/product/vmware"');
    expect(footer).toContain('href="/enterprise/self-hosted"');
    expect(footer).toContain('href="/trust"');
    expect(footer).toContain('href="/product/vmware"');
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
