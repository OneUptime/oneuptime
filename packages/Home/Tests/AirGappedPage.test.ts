import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  AIR_GAPPED_LLM_PROVIDER_ENV,
  AIR_GAPPED_VALUES_YAML,
  AirGappedAudience,
  AirGappedCapability,
  AirGappedCompliancePoint,
  AirGappedConnection,
  AirGappedFaq,
  AirGappedNetworkItem,
  AirGappedPageContent,
  AirGappedStep,
  CHART_SIGNING_KEY_URL,
  getAirGappedContent,
} from "../Utils/AirGapped";
import { getSelfHostedContent } from "../Utils/SelfHosted";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * THE AIR-GAPPED PAGE, RENDERED.
 *
 * The real template with the locals Routes.ts hands it, read back as a
 * browser would: what each section says (all of it from Utils/AirGapped.ts,
 * whose facts Tests/AirGappedFacts.test.ts holds to the repository), that
 * every link goes somewhere real - a route of this site, a docs page at a
 * heading it has, an anchor on the page, or an outside page opened in a new
 * tab - that the headings read in order for a screen reader, that the
 * booking is the architecture assessment the CRM knows, and that the menus,
 * the footer and the pages buyers come from lead here.
 */

const HOME: string = path.join(__dirname, "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const DOCS_CONTENT: string = path.join(
  HOME,
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);
const HOME_URL: string = "https://oneuptime.com";
const PAGE_PATH: string = "/enterprise/air-gapped";

const routesSource: string = fs.readFileSync(
  path.join(HOME, "Routes.ts"),
  "utf8",
);

const MARKDOWN_HEADING: RegExp = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const CODE_FENCE: RegExp = /^\s*(```|~~~)/;

type SEOForTemplate = PageSEOData & { fullCanonicalUrl: string };

function seoFor(pagePath: string): SEOForTemplate {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function renderView(
  template: string,
  locals: Record<string, unknown>,
): Promise<string> {
  return (await ejs.renderFile(path.join(VIEWS_ROOT, template), locals, {
    views: [VIEWS_ROOT],
  })) as string;
}

// Exactly the locals Routes.ts hands the page, plus homeUrl.
async function renderPage(
  content: AirGappedPageContent = getAirGappedContent(),
): Promise<string> {
  return renderView("air-gapped.ejs", {
    enableGoogleTagManager: false,
    seo: seoFor(PAGE_PATH),
    airGapped: content,
    homeUrl: HOME_URL,
  });
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent || "").split(/\s+/).join(" ").trim();
}

function all(root: ParentNode, selector: string): Array<Element> {
  return Array.from(root.querySelectorAll(selector));
}

// Is `routePath` the first argument of an app.get( in Routes.ts?
function hasGetRoute(routePath: string): boolean {
  const declaration: string = `"${routePath}"`;
  let searchFrom: number = 0;

  while (searchFrom < routesSource.length) {
    const index: number = routesSource.indexOf(declaration, searchFrom);

    if (index === -1) {
      return false;
    }

    if (
      routesSource
        .slice(Math.max(0, index - 40), index)
        .trim()
        .endsWith("app.get(")
    ) {
      return true;
    }

    searchFrom = index + declaration.length;
  }

  return false;
}

// The anchors a docs page answers to: its headings, slugged as the docs do.
function docsAnchors(markdownFile: string): Set<string> {
  const anchors: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of fs.readFileSync(markdownFile, "utf8").split("\n")) {
    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(MARKDOWN_HEADING);

    if (heading) {
      anchors.add(slugifyMarkdownHeading(heading[1]!));
    }
  }

  return anchors;
}

/*
 * Where a link goes, checked: a docs page at a heading it has, a route of
 * this site, an anchor of this page, or an outside page.
 */
function problemWithLink(page: Document, href: string): string | null {
  if (href.startsWith("#")) {
    return page.getElementById(href.slice(1)) ? null : "no such anchor";
  }

  if (href.startsWith("mailto:") || href.startsWith("https://")) {
    return null;
  }

  const [address, anchor] = href.split("#") as [string, string | undefined];

  if (address.startsWith("/docs/")) {
    const file: string = path.join(
      DOCS_CONTENT,
      `${address.slice("/docs/".length)}.md`,
    );

    if (!fs.existsSync(file)) {
      return "no such docs page";
    }

    return anchor && !docsAnchors(file).has(anchor)
      ? "no such heading on the docs page"
      : null;
  }

  return hasGetRoute(address) ? null : "no route";
}

describe("the air-gapped page", () => {
  let html: string;
  let page: Document;
  let main: Element;
  const content: AirGappedPageContent = getAirGappedContent();

  beforeAll(async () => {
    html = await renderPage();
    page = documentOf(html);
    main = page.getElementById("main-content")!;
  });

  test("renders a whole page, with nothing left unfilled", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(main).not.toBeNull();
    expect(textOf(main)).not.toContain("undefined");
    expect(textOf(main)).not.toContain("[object Object]");
  });

  test("writes the head from its SEO entry", () => {
    const seo: SEOForTemplate = seoFor(PAGE_PATH);

    expect(page.title).toBe(seo.title);
    expect(
      page.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe(seo.description);
    expect(
      page.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(`${HOME_URL}${PAGE_PATH}`);
  });

  test("leads with one heading that says what the page is for", () => {
    const headings: Array<Element> = all(page, "h1");

    expect(headings).toHaveLength(1);
    expect(textOf(headings[0])).toBe(
      "Run OneUptime with no internet connection.",
    );
    expect(headings[0]!.id).toBe("air-gapped-title");
  });

  test("offers the two things a visitor comes for: planning an install, and the steps", () => {
    const hero: Element = page.getElementById("air-gapped-hero")!;
    const plan: Element | null = hero.querySelector(
      'a[href="#plan-your-install"]',
    );
    const steps: Element | null = hero.querySelector('a[href="#set-up"]');

    expect(textOf(plan)).toBe("Plan your air-gapped install");
    // Booking the assessment is the enterprise conversion: tagged, so it counts.
    expect(plan?.getAttribute("data-ou-cta")).toBe("cta_request_demo");
    expect(textOf(steps)).toBe("See the four steps");
    expect(page.getElementById("plan-your-install")).not.toBeNull();
    expect(page.getElementById("set-up")).not.toBeNull();
  });

  test("lists the proof points under the buttons, in order", () => {
    expect(
      all(page, '[data-testid="air-gapped-proof-points"] li').map(textOf),
    ).toEqual(content.proofPoints);
  });

  test("draws OneUptime and everything it uses inside one boundary: the customer's network", () => {
    const picture: Element = page.querySelector(
      '[data-testid="air-gapped-network"]',
    )!;

    expect(textOf(picture)).toContain("Your network");
    expect(textOf(picture)).toContain("No route to the internet needed");
    expect(textOf(picture)).toContain("OneUptime");

    const items: Array<string> = all(
      picture,
      'ul[aria-label="Inside your network"] li',
    ).map(textOf);

    expect(items).toEqual(
      content.network.map((item: AirGappedNetworkItem): string => {
        return `${item.label} ${item.detail}`;
      }),
    );
  });

  test("names each section in the bar that follows the reader, each link landing on its section", () => {
    const bar: Element = page.querySelector('nav[aria-label="On this page"]')!;
    const links: Array<[string, string]> = all(bar, "a").map(
      (link: Element): [string, string] => {
        return [textOf(link), link.getAttribute("href") || ""];
      },
    );

    expect(links).toEqual([
      ["Who it's for", "#who-its-for"],
      ["What runs inside", "#inside"],
      ["Set up", "#set-up"],
      ["Connections out", "#connections-out"],
      ["AI", "#ai"],
      ["Compliance", "#compliance"],
      ["FAQ", "#faq"],
    ]);

    for (const [, href] of links) {
      expect(page.getElementById(href.slice(1))?.tagName).toBe("SECTION");
    }
  });

  test("labels every section with its own heading", () => {
    const sections: Array<Element> = all(main, "section[id]");

    expect(sections.map((section: Element): string => {
      return section.id;
    })).toEqual([
      "air-gapped-hero",
      "who-its-for",
      "inside",
      "set-up",
      "connections-out",
      "ai",
      "compliance",
      "faq",
      "plan-your-install",
    ]);

    for (const section of sections) {
      const label: Element | null = page.getElementById(
        section.getAttribute("aria-labelledby") || "",
      );

      expect([section.id, Boolean(label && section.contains(label))]).toEqual([
        section.id,
        true,
      ]);
      expect(["H1", "H2"]).toContain(label!.tagName);
    }
  });

  test("never skips a heading level, so a screen reader reads the page in order", () => {
    const levels: Array<number> = all(main, "h1, h2, h3, h4, h5, h6").map(
      (heading: Element): number => {
        return Number(heading.tagName.slice(1));
      },
    );

    expect(levels[0]).toBe(1);

    levels.forEach((level: number, index: number) => {
      if (index > 0) {
        expect(level).toBeLessThanOrEqual(levels[index - 1]! + 1);
      }
    });

    expect(
      all(main, "h2").map(textOf),
    ).toEqual([
      "For networks that stay closed",
      "Everything runs inside your network",
      "Four steps to an air-gapped install",
      "What reaches out, and what to use instead",
      "OneUptime AI, on a model you run",
      "Your data, inside your boundary",
      "Questions buyers ask",
      "Bring us your network. Leave with an install plan.",
    ]);
  });

  test("says who it is for: one card per audience", () => {
    const cards: Array<Element> = all(
      page,
      '[data-testid="air-gapped-audience"]',
    );

    expect(
      cards.map((card: Element): string => {
        return textOf(card);
      }),
    ).toEqual(
      content.audiences.map((audience: AirGappedAudience): string => {
        return `${audience.title} ${audience.description}`;
      }),
    );
  });

  test("shows everything that runs inside, each card with where to read more", () => {
    const cards: Array<Element> = all(
      page,
      '[data-testid="air-gapped-capability"]',
    );

    expect(cards).toHaveLength(content.capabilities.length);

    content.capabilities.forEach(
      (capability: AirGappedCapability, index: number) => {
        const card: Element = cards[index]!;

        expect(textOf(card.querySelector("h3"))).toBe(capability.title);
        expect(textOf(card.querySelector("p"))).toBe(capability.description);

        const link: Element | null = card.querySelector("a");

        if (capability.link) {
          expect(link?.getAttribute("href")).toBe(capability.link.href);
          expect(textOf(link)).toBe(capability.link.label);
        } else {
          expect(link).toBeNull();
        }
      },
    );
  });

  test("numbers the four steps, in order, each with the settings it uses", () => {
    const steps: Array<Element> = all(
      page,
      'ol [data-testid="air-gapped-step"]',
    );

    expect(steps).toHaveLength(4);

    content.steps.forEach((step: AirGappedStep, index: number) => {
      const item: Element = steps[index]!;

      expect(item.id).toBe(`step-${step.key}`);
      expect(textOf(item.querySelector("span"))).toBe(String(index + 1));
      expect(textOf(item.querySelector("h3"))).toBe(step.title);
      expect(textOf(item.querySelector("p"))).toBe(step.description);
      expect(all(item, "code").map(textOf)).toEqual(step.settings);

      if (step.link) {
        const link: Element | null = item.querySelector(
          `a[href="${step.link.href}"]`,
        );

        expect(textOf(link)).toContain(step.link.label);
      }
    });
  });

  test("gives the chart's signing key fingerprint where the chart is brought in", () => {
    const key: Element = page.querySelector(
      '#step-bring-in-chart [data-testid="air-gapped-signing-key"]',
    )!;

    expect(
      all(key, "p.ag-code span").map(textOf),
    ).toEqual(content.signingKey.fingerprintHalves);

    const link: Element | null = key.querySelector("a");

    expect(link?.getAttribute("href")).toBe(CHART_SIGNING_KEY_URL);
    expect(textOf(link)).toBe("OneUptime's public key (opens in a new tab)");
  });

  test("shows the values.yaml exactly as the chart's air-gapped suite renders it, with what the test proves", () => {
    const panel: Element = page.querySelector(
      '[data-testid="air-gapped-values"]',
    )!;

    expect(panel.querySelector("pre")?.textContent).toBe(
      AIR_GAPPED_VALUES_YAML,
    );
    expect(textOf(panel)).toContain("values.yaml");
    expect(textOf(panel.nextElementSibling)).toBe(content.valuesCaption);
  });

  test("says how upgrades work, linking the upgrade guide", () => {
    const upgrades: Element = page.querySelector(
      '[data-testid="air-gapped-upgrades"]',
    )!;

    expect(textOf(upgrades)).toContain(`Upgrades. ${content.upgradeNote}`);
    expect(upgrades.querySelector("a")?.getAttribute("href")).toBe(
      "/docs/installation/upgrading",
    );
  });

  test("lists every connection out, with when it happens and what to use inside the gap", () => {
    const rows: Array<Element> = all(
      page,
      '[data-testid="air-gapped-connection"]',
    );

    expect(rows).toHaveLength(content.connections.length);

    content.connections.forEach(
      (connection: AirGappedConnection, index: number) => {
        const row: Element = rows[index]!;
        const heading: string = textOf(row.querySelector("h3"));

        expect(row.id).toBe(`connection-${connection.key}`);
        expect(heading.startsWith(connection.name)).toBe(true);
        // The badge is on the connections made unless a setting stops them.
        expect(heading.endsWith("On by default")).toBe(connection.onByDefault);
        expect(textOf(row)).toContain(connection.destination);
        expect(textOf(row)).toContain(connection.when);
        expect(textOf(row)).toContain(connection.inside);
      },
    );
  });

  test("says under the table how webhooks reach inside, and where the docs list each integration's addresses", () => {
    const more: Element = page.querySelector(
      '[data-testid="air-gapped-connections-more"]',
    )!;

    expect(textOf(more.querySelector("code"))).toBe(
      "webhooks.allowPrivateNetwork",
    );
    expect(
      all(more, "a").map((link: Element): string => {
        return `${textOf(link)} ${link.getAttribute("href")}`;
      }),
    ).toEqual([
      "connections out of your network /docs/self-hosted/architecture#connections-out-of-your-network",
      "private network access /docs/self-hosted/private-network-access",
    ]);
  });

  test("labels each connection's columns on a phone, and the table's columns from a tablet up", () => {
    const header: Element = page.querySelector(
      "#connections-out [aria-hidden='true']",
    )!;

    expect(all(header, "span").map(textOf)).toEqual([
      "Connection",
      "When",
      "Inside an air gap",
    ]);
    // Hidden on a phone without the bare `hidden` a foreign stylesheet overrides.
    expect(header.className.split(" ")).toEqual(
      expect.arrayContaining(["max-md:hidden", "md:grid"]),
    );
    expect(header.className.split(" ")).not.toContain("hidden");

    for (const row of all(page, '[data-testid="air-gapped-connection"]')) {
      expect(all(row, ".md\\:hidden").map(textOf)).toEqual([
        "When:",
        "Inside an air gap:",
      ]);
    }
  });

  test("offers AI on a model the customer runs, with the server settings for it", () => {
    const section: Element = page.getElementById("ai")!;

    expect(
      all(section, '[data-testid="air-gapped-ai-option"]').map(textOf),
    ).toEqual(
      content.ai.options.map((option: { title: string; description: string }) => {
        return `${option.title} ${option.description}`;
      }),
    );
    expect(section.querySelector("pre")?.textContent).toBe(
      AIR_GAPPED_LLM_PROVIDER_ENV,
    );
    expect(textOf(section)).toContain(content.ai.setup);
    expect(textOf(section)).toContain(content.ai.safety);
    expect(
      section
        .querySelector('a[href^="/docs/ai/llm-provider"]')
        ?.getAttribute("href"),
    ).toBe(
      "/docs/ai/llm-provider#self-hosted-zero-config-via-environment-variables",
    );
  });

  test("says what stays inside for compliance, pointing at the claims matrix", () => {
    const section: Element = page.getElementById("compliance")!;

    expect(
      all(section, '[data-testid="air-gapped-compliance"]').map(textOf),
    ).toEqual(
      content.compliance.map((point: AirGappedCompliancePoint): string => {
        return `${point.title} ${point.description}`;
      }),
    );
    expect(section.querySelector('a[href="/trust#claims"]')).not.toBeNull();
    expect(
      section.querySelector('a[href="/enterprise/self-hosted"]'),
    ).not.toBeNull();
  });

  test("answers the questions buyers ask, folded, and the same answers for search engines", () => {
    const questions: Array<Element> = all(
      page,
      '[data-testid="air-gapped-faq"]',
    );

    expect(
      questions.map((question: Element): [string, string] => {
        return [
          textOf(question.querySelector("summary")),
          textOf(question.querySelector("p")),
        ];
      }),
    ).toEqual(
      content.faqs.map((faq: AirGappedFaq): [string, string] => {
        return [faq.question, faq.answer];
      }),
    );

    for (const question of questions) {
      expect(question.tagName).toBe("DETAILS");
      expect(question.hasAttribute("open")).toBe(false);
    }

    const faqSchema: { mainEntity: Array<Record<string, unknown>> } =
      all(page, 'script[type="application/ld+json"]')
        .map((script: Element) => {
          return JSON.parse(script.textContent || "{}");
        })
        .find((schema: Record<string, unknown>) => {
          return schema["@type"] === "FAQPage";
        });

    expect(faqSchema.mainEntity).toEqual(
      content.faqs.map((faq: AirGappedFaq) => {
        return {
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        };
      }),
    );
  });

  test("books the architecture assessment, the conversation the CRM knows, and offers email", () => {
    const section: Element = page.getElementById("plan-your-install")!;

    expect(
      all(section, '[data-testid="air-gapped-plan-topics"] li').map(textOf),
    ).toEqual(content.planCall.topics);
    expect(
      section.querySelector('a[href^="mailto:"]')?.getAttribute("href"),
    ).toBe(`mailto:${content.planCall.email}`);
    expect(page.getElementById("my-cal-inline-air-gapped")).not.toBeNull();

    for (const words of [
      'elementOrSelector: "#my-cal-inline-air-gapped"',
      'calLink: "oneuptimehq/demo"',
      "window.oneUptimeCalAttributionMetadata('architecture_assessment')",
      "window.oneUptimeOnCalBookingSuccess(",
      "bookingKind: 'architecture_assessment'",
      "legacyEventName: 'home/architecture-assessment-booked'",
    ]) {
      expect([words, html.includes(words)]).toEqual([words, true]);
    }

    // The attendee's name and email in Cal's detail never reach analytics.
    for (const words of [
      "const { data, type, namespace }",
      "'data': data",
      "detail.data,",
      "detail.data)",
    ]) {
      expect([words, html.includes(words)]).toEqual([words, false]);
    }
  });

  test("tags every link to the booking, so each click counts", () => {
    const toBooking: Array<Element> = all(
      page,
      'a[href="#plan-your-install"]',
    );

    expect(toBooking.length).toBeGreaterThan(0);

    for (const link of toBooking) {
      expect(link.getAttribute("data-ou-cta")).toBe("cta_request_demo");
    }
  });

  test("links only to real places: routes, docs pages at their headings, anchors, and outside pages", () => {
    const links: Array<Element> = all(main, "a[href]");

    expect(links.length).toBeGreaterThan(15);

    for (const link of links) {
      const href: string = link.getAttribute("href")!;

      expect([href, problemWithLink(page, href)]).toEqual([href, null]);
    }
  });

  test("opens every outside page in a new tab, and says so", () => {
    for (const link of all(main, 'a[href^="https://"]')) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect((link.getAttribute("rel") || "").split(" ").sort()).toEqual([
        "noopener",
        "noreferrer",
      ]);
      expect(textOf(link.querySelector(".sr-only"))).toBe(
        "(opens in a new tab)",
      );
    }
  });

  test("loads no image and no script from anywhere but the site and the booking calendar", () => {
    expect(all(main, "img")).toHaveLength(0);

    const scriptSources: Array<string> = all(page, "script[src]").map(
      (script: Element): string => {
        return script.getAttribute("src")!;
      },
    );

    for (const source of scriptSources) {
      expect(source.startsWith("/")).toBe(true);
    }
  });
});

describe("the air-gapped page's structured data and metadata", () => {
  test("is an enterprise page, under Self-Hosted in its breadcrumb trail", () => {
    const seo: PageSEOData = PageSEOConfig[PAGE_PATH]!;

    expect(seo.canonicalPath).toBe(PAGE_PATH);
    expect(seo.pageType).toBe("enterprise");
    expect(
      seo.breadcrumbs.map((crumb: { name: string; url: string }): string => {
        return `${crumb.name} ${crumb.url}`;
      }),
    ).toEqual([
      "Home /",
      "Enterprise /enterprise/overview",
      "Self-Hosted /enterprise/self-hosted",
      "Air-Gapped /enterprise/air-gapped",
    ]);
  });

  test("leads its title with what buyers search for, and fits a search result", () => {
    const seo: PageSEOData = PageSEOConfig[PAGE_PATH]!;

    expect(seo.title).toBe("Air-Gapped Monitoring & Observability | OneUptime");
    expect(seo.title.length).toBeLessThanOrEqual(60);
    expect(seo.description.length).toBeLessThanOrEqual(160);
    expect(seo.description).toContain("no internet");
    expect(seo.description).toContain("license offline");
  });
});

describe("the pages and menus that lead to the air-gapped page", () => {
  let page: Document;

  beforeAll(async () => {
    page = documentOf(await renderPage());
  });

  test("is in the Enterprise menu, after Self-Hosted", () => {
    const menu: Element = page.getElementById("solutions-menu")!;
    const featured: Array<string> = all(menu, "a")
      .map((link: Element): string => {
        return link.getAttribute("href") || "";
      })
      .filter((href: string): boolean => {
        return href.startsWith("/enterprise/");
      });

    expect(featured.slice(0, 4)).toEqual([
      "/enterprise/overview",
      "/enterprise/self-hosted",
      "/enterprise/air-gapped",
      "/enterprise/demo",
    ]);
    expect(
      textOf(menu.querySelector('a[href="/enterprise/air-gapped"]')),
    ).toBe("Air-Gapped Run it with no internet connection");
  });

  test("is in the footer's Solutions column, after Self-Hosted", () => {
    const footer: Element = page.querySelector("footer")!;
    const link: Element | null = footer.querySelector(
      'a[href="/enterprise/air-gapped"]',
    );

    expect(textOf(link)).toBe("Air-Gapped");

    const previous: Element | null =
      link?.closest("li")?.previousElementSibling || null;

    expect(previous?.querySelector("a")?.getAttribute("href")).toBe(
      "/enterprise/self-hosted",
    );
  });

  test("the self-hosted page's air-gapped section leads here, and to the connections out", async () => {
    const selfHosted: Document = documentOf(
      await renderView("self-hosted.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: false,
        blackLogo: false,
        requestDemoCta: true,
        selfHosted: getSelfHostedContent(),
        seo: seoFor("/enterprise/self-hosted"),
        homeUrl: HOME_URL,
      }),
    );
    const section: Element = selfHosted.getElementById("air-gapped")!;
    const link: Element | null = section.querySelector(
      '[data-testid="self-hosted-air-gapped-link"]',
    );

    expect(link?.getAttribute("href")).toBe("/enterprise/air-gapped");
    expect(textOf(link)).toBe("Everything about air-gapped installs");
    expect(
      section.querySelector('a[href="/enterprise/air-gapped#connections-out"]'),
    ).not.toBeNull();
    expect(textOf(section)).not.toContain("SMS gateway");
  });

  test("the Enterprise overview's data residency card and the government page lead here", async () => {
    const overview: Document = documentOf(
      await renderView("enterprise-overview.ejs", {
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
      }),
    );
    const residency: Element | undefined = all(overview, "h3")
      .find((heading: Element): boolean => {
        return textOf(heading) === "Custom Data Residency";
      })
      ?.closest("div");

    expect(
      residency
        ?.querySelector('a[href="/enterprise/air-gapped"]')
        ?.textContent?.trim(),
    ).toBe("air-gapped");

    const government: Document = documentOf(
      await renderView("industries/government.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/industries/government"),
        homeUrl: HOME_URL,
      }),
    );

    expect(
      textOf(
        government.querySelector("main a[href='/enterprise/air-gapped']") ||
          government.querySelector("a[href='/enterprise/air-gapped']"),
      ),
    ).toBe("air-gap support");
  });
});

describe("the anchors the page links into the docs", () => {
  test("every docs address the content writes is a docs page at a heading it has", () => {
    const content: AirGappedPageContent = getAirGappedContent();
    const addresses: Array<string> = [
      ...Object.values(content.docs),
      ...content.capabilities
        .map((capability: AirGappedCapability): string => {
          return capability.link?.href || "";
        })
        .filter((href: string): boolean => {
          return href.startsWith("/docs/");
        }),
      ...content.steps
        .map((step: AirGappedStep): string => {
          return step.link?.href || "";
        })
        .filter((href: string): boolean => {
          return href.startsWith("/docs/");
        }),
    ];

    expect(addresses.length).toBeGreaterThan(8);

    const empty: Document = documentOf("<html><body></body></html>");

    for (const address of addresses) {
      expect([address, problemWithLink(empty, address)]).toEqual([
        address,
        null,
      ]);
    }
  });

  test("the helper finds a missing page and a missing heading", () => {
    const empty: Document = documentOf("<html><body></body></html>");

    expect(problemWithLink(empty, "/docs/self-hosted/no-such-page")).toBe(
      "no such docs page",
    );
    expect(
      problemWithLink(empty, "/docs/self-hosted/enterprise#no-such-heading"),
    ).toBe("no such heading on the docs page");
    expect(problemWithLink(empty, "/no-such-route")).toBe("no route");
    expect(problemWithLink(empty, "#nowhere")).toBe("no such anchor");
    expect(problemWithLink(empty, "/enterprise/air-gapped")).toBeNull();
  });
});
