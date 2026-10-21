import {
  CloudMarketplaceEntries,
  CloudMarketplaceEntry,
  CloudMarketplaceLink,
  CloudMarketplaceProduct,
  CloudMarketplacesContent,
  getCloudMarketplacesContent,
} from "../Utils/CloudMarketplaces";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import Pricing from "../Utils/Pricing";
import { SelfHostedContent, getSelfHostedContent } from "../Utils/SelfHosted";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * THE ONE-LINE POINTERS TO THE CLOUD MARKETPLACES.
 *
 * The pricing page names OneUptime Cloud's public listings under the plans,
 * and the self-hosted page names OneUptime Enterprise's under the Enterprise
 * Edition's call to action - each linked straight to the listing, and each
 * only while there is one (Utils/CloudMarketplaces.ts). The real templates,
 * rendered with the locals Routes.ts hands them.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

function seoFor(pagePath: string): PageSEOData & { fullCanonicalUrl: string } {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function render(
  template: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, template),
    { homeUrl: HOME_URL, ...locals },
    { views: [VIEWS_ROOT] },
  )) as string;
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent || "").split(/\s+/).join(" ").trim();
}

// The marketplaces with each product's listing replaced.
function withListings(
  listingUrls: (
    entry: CloudMarketplaceEntry,
  ) => Record<CloudMarketplaceProduct, string | null>,
): CloudMarketplacesContent {
  return getCloudMarketplacesContent(
    CloudMarketplaceEntries.map(
      (entry: CloudMarketplaceEntry): CloudMarketplaceEntry => {
        return { ...entry, listingUrls: listingUrls(entry) };
      },
    ),
  );
}

const NO_LISTING: CloudMarketplacesContent = withListings(() => {
  return { cloud: null, enterprise: null };
});

const EVERY_LISTING: CloudMarketplacesContent = withListings(
  (entry: CloudMarketplaceEntry) => {
    return {
      cloud: `https://example.com/${entry.marketplace}/cloud`,
      enterprise: `https://example.com/${entry.marketplace}/enterprise`,
    };
  },
);

const ENTERPRISE_ONLY: CloudMarketplacesContent = withListings(
  (entry: CloudMarketplaceEntry) => {
    return {
      cloud: null,
      enterprise: `https://example.com/${entry.marketplace}/enterprise`,
    };
  },
);

const CLOUD_ONLY: CloudMarketplacesContent = withListings(
  (entry: CloudMarketplaceEntry) => {
    return {
      cloud: `https://example.com/${entry.marketplace}/cloud`,
      enterprise: null,
    };
  },
);

/*
 * ---------------------------------------------------------------------------
 * The pricing page.
 * ---------------------------------------------------------------------------
 */

const POINTER_ON_PRICING: string = '[data-testid="pricing-cloud-marketplaces"]';

async function renderPricing(
  cloudMarketplaces?: CloudMarketplacesContent,
): Promise<Document> {
  // The locals Routes.ts hands the page.
  const locals: Record<string, unknown> = {
    pricing: Pricing,
    enableGoogleTagManager: false,
    seo: seoFor("/pricing"),
  };

  if (cloudMarketplaces) {
    locals["cloudMarketplaces"] = cloudMarketplaces;
  }

  return documentOf(await render("pricing.ejs", locals));
}

function outboundLinksIn(element: Element | null): Array<HTMLAnchorElement> {
  return Array.from(element?.querySelectorAll('a[target="_blank"]') || []);
}

describe("the pricing page's line about the cloud marketplaces", () => {
  const content: CloudMarketplacesContent = getCloudMarketplacesContent();
  let page: Document;
  let line: Element | null;

  beforeAll(async () => {
    page = await renderPricing(content);
    line = page.querySelector(POINTER_ON_PRICING);
  });

  test("names OneUptime Cloud's public listings, and says they cost what the plans cost", () => {
    expect(textOf(line)).toBe(
      "Prefer to pay on your cloud bill? Buy OneUptime Cloud on AWS Marketplace (opens in a new tab) or Microsoft Marketplace (opens in a new tab), at the same prices. See every marketplace →",
    );
  });

  test("links each name to its listing in a new tab, and reports the click", () => {
    const links: Array<HTMLAnchorElement> = outboundLinksIn(line);

    expect(
      links.map((link: HTMLAnchorElement) => {
        return [link.getAttribute("href"), textOf(link)];
      }),
    ).toEqual(
      content.publicListings.cloud.map((listing: CloudMarketplaceLink) => {
        return [listing.url, `${listing.name} (opens in a new tab)`];
      }),
    );

    for (const link of links) {
      expect((link.getAttribute("rel") || "").split(" ").sort()).toEqual([
        "noopener",
        "noreferrer",
      ]);
      expect(link.getAttribute("data-ou-cta")).toBe("cta_cloud_marketplace");
      // A name is never split over two lines.
      expect(link.className.split(" ")).toContain("whitespace-nowrap");
    }
  });

  test("keeps the product's name whole, and wraps in even lines on a phone", () => {
    const product: Element | undefined = Array.from(
      line?.querySelectorAll("span") || [],
    ).find((span: Element) => {
      return textOf(span) === "OneUptime Cloud";
    });

    expect(product?.className.split(" ")).toContain("whitespace-nowrap");
    expect(line?.querySelector("p")?.className.split(" ")).toEqual(
      expect.arrayContaining(["text-balance", "text-center"]),
    );
  });

  test("names AWS's and Microsoft's OneUptime Cloud listings as they link them", () => {
    expect(
      outboundLinksIn(line).map((link: HTMLAnchorElement) => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      "https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw",
      "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud",
    ]);
  });

  test("leads to every marketplace on the Resellers page", () => {
    const more: HTMLAnchorElement | null =
      line?.querySelector('a[href="/resellers#cloud-marketplaces"]') || null;

    expect(more).not.toBeNull();
    expect(more?.hasAttribute("target")).toBe(false);
    expect(textOf(more?.querySelector("span[aria-hidden]"))).toBe("→");
    expect(textOf(more)).toBe("See every marketplace →");
  });

  test("sits under the plans, before Pay As You Go", () => {
    const following: number =
      page.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING;
    const plans: Element | undefined = Array.from(
      page.querySelectorAll("h2"),
    ).find((heading: Element) => {
      return textOf(heading) === "Enterprise";
    });
    const payAsYouGo: Element | undefined = Array.from(
      page.querySelectorAll("h3"),
    ).find((heading: Element) => {
      return textOf(heading) === "Pay As You Go";
    });

    expect(plans!.compareDocumentPosition(line!) & following).toBeTruthy();
    expect(line!.compareDocumentPosition(payAsYouGo!) & following).toBeTruthy();
    expect(page.querySelectorAll(POINTER_ON_PRICING)).toHaveLength(1);
  });

  test("names three listings as 'A, B or C'", async () => {
    const page: Document = await renderPricing(EVERY_LISTING);

    expect(textOf(page.querySelector(POINTER_ON_PRICING))).toContain(
      "Buy OneUptime Cloud on AWS Marketplace (opens in a new tab), Microsoft Marketplace (opens in a new tab) or Google Cloud Marketplace (opens in a new tab), at the same prices.",
    );
    expect(
      outboundLinksIn(page.querySelector(POINTER_ON_PRICING)),
    ).toHaveLength(3);
  });

  test("names one listing alone", async () => {
    const page: Document = await renderPricing(
      withListings((entry: CloudMarketplaceEntry) => {
        return {
          cloud:
            entry === CloudMarketplaceEntries[0]
              ? "https://example.com/only"
              : null,
          enterprise: null,
        };
      }),
    );

    expect(textOf(page.querySelector(POINTER_ON_PRICING))).toBe(
      "Prefer to pay on your cloud bill? Buy OneUptime Cloud on AWS Marketplace (opens in a new tab), at the same prices. See every marketplace →",
    );
  });

  test("names only OneUptime Cloud's listings: an Enterprise listing is for the self-hosted page", async () => {
    const page: Document = await renderPricing(ENTERPRISE_ONLY);

    expect(page.querySelector(POINTER_ON_PRICING)).toBeNull();
  });

  test("says nothing while no listing is public", async () => {
    const page: Document = await renderPricing(NO_LISTING);

    expect(page.querySelector(POINTER_ON_PRICING)).toBeNull();
    // The plans and Pay As You Go are as they were.
    expect(
      Array.from(page.querySelectorAll("h3")).some((heading: Element) => {
        return textOf(heading) === "Pay As You Go";
      }),
    ).toBe(true);
  });

  test("renders without the marketplaces at all, as other renders of the page do", async () => {
    const page: Document = await renderPricing();

    expect(page.querySelector(POINTER_ON_PRICING)).toBeNull();
    expect(page.title).toBe(getPageSEO("/pricing").title);
  });

  test("is reported by the page's click listener, which every tagged link reaches", async () => {
    const html: string = await render("pricing.ejs", {
      pricing: Pricing,
      enableGoogleTagManager: false,
      seo: seoFor("/pricing"),
      cloudMarketplaces: content,
    });

    expect(html).toContain("a[data-ou-cta]");
    expect(html).toContain(`this.getAttribute('data-ou-cta')`);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The self-hosted page.
 * ---------------------------------------------------------------------------
 */

const POINTER_ON_SELF_HOSTED: string =
  '[data-testid="self-hosted-cloud-marketplaces"]';

async function renderSelfHosted(
  cloudMarketplaces?: CloudMarketplacesContent,
): Promise<Document> {
  const selfHosted: SelfHostedContent = getSelfHostedContent();

  // The locals Routes.ts hands the page.
  return documentOf(
    await render("self-hosted.ejs", {
      support: false,
      enableGoogleTagManager: false,
      footerCards: true,
      cta: false,
      blackLogo: false,
      requestDemoCta: true,
      selfHosted: cloudMarketplaces
        ? { ...selfHosted, cloudMarketplaces: cloudMarketplaces }
        : selfHosted,
      seo: seoFor("/enterprise/self-hosted"),
    }),
  );
}

describe("the self-hosted page's line about the cloud marketplaces", () => {
  const content: CloudMarketplacesContent = getCloudMarketplacesContent();
  let page: Document;
  let line: Element | null;

  beforeAll(async () => {
    page = await renderSelfHosted();
    line = page.querySelector(POINTER_ON_SELF_HOSTED);
  });

  test("names OneUptime Enterprise's public listings, its price, and that the buyer's subscription is their license", () => {
    expect(textOf(line)).toBe(
      "Or buy it on Microsoft Marketplace (opens in a new tab) for $0.10 per user per hour, on your cloud bill. Your subscription is your license. How it works →",
    );
  });

  test("comes right after the Enterprise Edition's call to action, in its section", () => {
    const section: HTMLElement | null =
      page.getElementById("enterprise-edition");
    const callToAction: Element | undefined = Array.from(
      section?.querySelectorAll("a") || [],
    ).find((link: Element) => {
      return textOf(link) === "Talk to us about Enterprise Edition";
    });

    expect(section?.contains(line)).toBe(true);
    expect(callToAction?.nextElementSibling).toBe(line);
    expect(page.querySelectorAll(POINTER_ON_SELF_HOSTED)).toHaveLength(1);
  });

  test("links each listing in a new tab, and reports the click", () => {
    const links: Array<HTMLAnchorElement> = outboundLinksIn(line);

    expect(
      links.map((link: HTMLAnchorElement) => {
        return [link.getAttribute("href"), textOf(link)];
      }),
    ).toEqual(
      content.publicListings.enterprise.map((listing: CloudMarketplaceLink) => {
        return [listing.url, `${listing.name} (opens in a new tab)`];
      }),
    );
    expect(
      links.map((link: HTMLAnchorElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      "https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-enterprise",
    ]);

    for (const link of links) {
      expect((link.getAttribute("rel") || "").split(" ").sort()).toEqual([
        "noopener",
        "noreferrer",
      ]);
      expect(link.getAttribute("data-ou-cta")).toBe("cta_cloud_marketplace");
      expect(link.className.split(" ")).toContain("whitespace-nowrap");
    }
  });

  test("leads to the buyer's guide for how to install and how billing works", () => {
    const guide: HTMLAnchorElement | null =
      line?.querySelector('a[href="/docs/installation/cloud-marketplaces"]') ||
      null;

    expect(guide).not.toBeNull();
    expect(textOf(guide)).toBe("How it works →");
    expect(guide?.hasAttribute("target")).toBe(false);
  });

  test("leaves the architecture assessment calls to action as they were", () => {
    expect(
      page.querySelectorAll('a[data-ou-cta="cta_request_demo"]'),
    ).toHaveLength(3);
    expect(line?.querySelector('a[data-ou-cta="cta_request_demo"]')).toBeNull();
  });

  test("names two listings as 'A or B'", async () => {
    const page: Document = await renderSelfHosted(
      withListings((entry: CloudMarketplaceEntry) => {
        return {
          cloud: null,
          enterprise:
            entry === CloudMarketplaceEntries[2]
              ? null
              : `https://example.com/${entry.marketplace}`,
        };
      }),
    );

    expect(textOf(page.querySelector(POINTER_ON_SELF_HOSTED))).toBe(
      "Or buy it on AWS Marketplace (opens in a new tab) or Microsoft Marketplace (opens in a new tab) for $0.10 per user per hour, on your cloud bill. Your subscription is your license. How it works →",
    );
  });

  test("names only OneUptime Enterprise's listings: a Cloud listing is for the pricing page", async () => {
    const page: Document = await renderSelfHosted(CLOUD_ONLY);

    expect(page.querySelector(POINTER_ON_SELF_HOSTED)).toBeNull();
  });

  test("says nothing while no listing is public", async () => {
    const page: Document = await renderSelfHosted(NO_LISTING);

    expect(page.querySelector(POINTER_ON_SELF_HOSTED)).toBeNull();
    expect(page.getElementById("enterprise-edition")).not.toBeNull();
  });

  test("names every listing when every marketplace has one", async () => {
    const page: Document = await renderSelfHosted(EVERY_LISTING);

    expect(
      outboundLinksIn(page.querySelector(POINTER_ON_SELF_HOSTED)),
    ).toHaveLength(3);
  });
});
