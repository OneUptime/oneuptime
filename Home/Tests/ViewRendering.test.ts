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
