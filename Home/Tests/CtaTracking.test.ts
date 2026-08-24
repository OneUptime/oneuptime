import {
  getClaimsMatrix,
  getClaimsNeedingReview,
  ClaimStatuses,
} from "../Utils/Claims";
import { getSelfHostedContent } from "../Utils/SelfHosted";
import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * Which clicks count as commercial intent, and whether the enterprise ones
 * count at all.
 *
 * The selector used to be `a[href*="demo"]`, which was wrong in both
 * directions at the same time. It matched in-page scroll anchors — a visitor
 * moving down the demo page they had already reached was reported as a fresh
 * demo request — and it matched nothing on the self-hosted page, whose
 * enterprise CTAs point at #architecture-assessment. In a sales-led funnel
 * that is the one CTA that matters, and it was the one firing nothing.
 *
 * Separately, the highest-intent pages sent their clicks into mailto: links.
 * A mailto produces no browser event and no server request, so a paid click
 * that ended there was spend with no recoverable outcome.
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

type SeoForFunction = (
  pagePath: string,
) => PageSEOData & { fullCanonicalUrl: string };

const seoFor: SeoForFunction = (
  pagePath: string,
): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

const headBasic: string = fs.readFileSync(
  path.join(VIEWS_ROOT, "head-basic.ejs"),
  "utf-8",
);

describe("the CTA click listener", () => {
  test("prefers an explicitly tagged CTA over guessing from the href", () => {
    expect(headBasic).toContain("a[data-ou-cta]");
    expect(headBasic).toContain(`this.getAttribute('data-ou-cta')`);
  });

  test("no longer matches every href containing the word demo", () => {
    /*
     * This is the assertion that stops #book-demo scroll anchors being
     * counted as demo requests.
     */
    expect(headBasic).not.toContain(`a[href*="demo"]`);
  });

  test("still covers the untagged register and demo links across the site", () => {
    expect(headBasic).toContain(`a[href*="register"]`);
    expect(headBasic).toContain(`a[href="/enterprise/demo"]`);
  });

  test("a register link is still reported as the get-started CTA", () => {
    expect(headBasic).toContain(`'cta_get_started'`);
    expect(headBasic).toContain(`'cta_request_demo'`);
  });
});

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

  test("every architecture assessment CTA is tagged, so it is measurable", () => {
    const anchors: RegExpMatchArray | null = html.match(
      /<a href="#architecture-assessment" data-ou-cta="cta_request_demo"/g,
    );

    expect(anchors).toHaveLength(3);
  });

  test("no architecture assessment CTA is left untagged", () => {
    const untagged: RegExpMatchArray | null = html.match(
      /<a href="#architecture-assessment"(?! data-ou-cta)/g,
    );

    expect(untagged).toBeNull();
  });
});

describe("trust.ejs", () => {
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

  test("the hero CTA books a conversation instead of opening a mail client", () => {
    /*
     * /trust is the target of the /security, /security-center and
     * /trust-center redirects, so it is where a paid SOC 2 or ISO 27001 click
     * lands. That is enterprise intent, and it used to produce nothing.
     */
    expect(html).toContain(
      '<a href="/enterprise/demo" data-ou-cta="cta_request_demo"',
    );
    expect(html).not.toContain(
      "mailto:security@oneuptime.com?subject=Security%20documentation%20request",
    );
  });

  test("the security inbox is still reachable for vulnerability reports", () => {
    // Repointing the sales CTA must not remove the disclosure route.
    expect(html).toContain("mailto:security@oneuptime.com");
  });
});

describe("support.ejs", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await render("support.ejs", {
      support: true,
      footerCards: true,
      enableGoogleTagManager: false,
      cta: false,
      blackLogo: false,
      requestDemoCta: false,
      seo: seoFor("/support"),
      homeUrl: HOME_URL,
    });
  });

  test("the hero CTA points at the booking embed already on the page", () => {
    /*
     * The Cal embed sat roughly 200 lines below a hero whose only action was
     * a mailto.
     */
    expect(html).toContain(
      '<a href="#schedule-call-section" data-ou-cta="cta_request_demo"',
    );
    expect(html).toContain('id="schedule-call-section"');
  });

  test("contact sales reaches the demo booking, not an inbox", () => {
    expect(html).toContain(
      '<a href="/enterprise/demo" data-ou-cta="cta_request_demo"',
    );
    expect(html).not.toContain("mailto:sales@oneuptime.com");
  });

  test("support email is still offered, just not as the only path", () => {
    expect(html).toContain("mailto:support@oneuptime.com");
  });
});

describe("demo.ejs", () => {
  test("its in-page scroll anchors are deliberately left untagged", () => {
    /*
     * A visitor already on /enterprise/demo scrolling to the embed has not
     * made a second demo request. Leaving these untagged is what keeps
     * cta_request_demo meaning "asked for a demo from somewhere else".
     */
    const demoSource: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "demo.ejs"),
      "utf-8",
    );

    expect(demoSource).toContain('href="#book-demo"');
    expect(demoSource).not.toContain('href="#book-demo" data-ou-cta');
  });
});

describe("PageSEO wiring", () => {
  test("the pages these CTAs point at are real, canonical pages", () => {
    expect(PageSEOConfig["/enterprise/demo"]).toBeDefined();
    expect(PageSEOConfig["/enterprise/self-hosted"]).toBeDefined();
  });
});
