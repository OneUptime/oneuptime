import {
  MAX_FEATURED_OPEN_TELEMETRY_GUIDES,
  OPEN_TELEMETRY_GUIDES,
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OpenTelemetryGuideEntry,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { getFeaturedGuideCards } from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import { OpenTelemetryGuide } from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import { generateLlmsFullTxt, generateLlmsTxt } from "../Utils/AIDiscovery";
import { HOME_URL, renderView, seoFor } from "./Helpers/TailwindPages";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { JSDOM } from "jsdom";

/*
 * Where a reader finds the OpenTelemetry guides from the rest of the site:
 * the nav's Resources menu and the phone menu, the footer's Resources
 * column, the telemetry product pages' strip of frameworks, and llms.txt
 * for tools and AI assistants. The docs and the Dashboard's telemetry guide
 * link them too, from their own packages.
 */

const PRODUCT_PAGES: Array<[string, string]> = [
  ["traces.ejs", "/product/traces"],
  ["observability.ejs", "/product/observability"],
  ["logs-management.ejs", "/product/logs-management"],
  ["metrics.ejs", "/product/metrics"],
  ["exceptions.ejs", "/product/exceptions"],
  ["rum.ejs", "/product/rum"],
];

const GUIDE_PATHS: Array<string> = OPEN_TELEMETRY_GUIDE_PAGES.map(
  (guide: OpenTelemetryGuide): string => {
    return getOpenTelemetryGuidePath(guide.slug);
  },
);

// The guides the catalog features, which the product pages show.
const FEATURED: Array<OpenTelemetryGuideEntry> = OPEN_TELEMETRY_GUIDES.filter(
  (entry: OpenTelemetryGuideEntry): boolean => {
    return entry.isFeatured === true;
  },
);
const FEATURED_PATHS: Array<string> = FEATURED.map(
  (entry: OpenTelemetryGuideEntry): string => {
    return getOpenTelemetryGuidePath(entry.slug);
  },
);

function textOf(element: Element | null): string {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
}

describe("the nav and the footer", () => {
  let nav: Document;
  let footer: Document;

  beforeAll(async () => {
    nav = new JSDOM(await renderView("nav.ejs", {})).window.document;
    footer = new JSDOM(await renderView("footer.ejs", {})).window.document;
  });

  test("list the integrations in the Resources menu, beside Books", () => {
    const links: Array<Element> = Array.from(
      nav.querySelectorAll(
        `#resources-menu a[href="${OPEN_TELEMETRY_GUIDES_INDEX_PATH}"]`,
      ),
    );

    expect(links.length).toBe(1);
    expect(textOf(links[0]!)).toBe("Integrations OpenTelemetry guides");
    expect(links[0]!.previousElementSibling?.getAttribute("href")).toBe(
      "/books",
    );
  });

  test("describe the integrations in one line, no longer than their neighbours' in the Resources menu", () => {
    const link: Element = nav.querySelector(
      `#resources-menu a[href="${OPEN_TELEMETRY_GUIDES_INDEX_PATH}"]`,
    )!;
    // The Learn grid: two columns of entries, each a name over one line.
    const neighbours: Array<Element> = Array.from(
      link.parentElement!.querySelectorAll(":scope > a"),
    ).filter((entry: Element): boolean => {
      return entry !== link;
    });
    const descriptionOf: (entry: Element) => string = (
      entry: Element,
    ): string => {
      return textOf(entry.querySelector("p.text-xs"));
    };

    expect(neighbours.length).toBeGreaterThan(0);
    // The grid stays two even columns.
    expect((neighbours.length + 1) % 2).toBe(0);
    const longest: number = Math.max(
      ...neighbours.map((entry: Element): number => {
        return descriptionOf(entry).length;
      }),
    );
    expect(descriptionOf(link)).toBe("OpenTelemetry guides");
    expect(descriptionOf(link).length).toBeLessThanOrEqual(longest);
  });

  test("list them in the phone menu, keeping its two columns even", () => {
    const link: Element | null = nav.querySelector(
      '[data-testid="integrations-mobile-link"]',
    );

    expect(link?.getAttribute("href")).toBe(OPEN_TELEMETRY_GUIDES_INDEX_PATH);
    const links: number =
      link?.parentElement?.querySelectorAll("a").length || 0;
    expect(links).toBeGreaterThan(0);
    expect(links % 2).toBe(0);
  });

  test("list them in the footer's Resources column, after the API reference", () => {
    const link: Element | null = footer.querySelector(
      `footer a[href="${OPEN_TELEMETRY_GUIDES_INDEX_PATH}"]`,
    );

    expect(textOf(link)).toBe("Integrations");
    expect(
      link
        ?.closest("li")
        ?.previousElementSibling?.querySelector("a")
        ?.getAttribute("href"),
    ).toBe("/reference");
  });
});

describe.each(PRODUCT_PAGES)(
  "the %s product page",
  (template: string, pagePath: string) => {
    test("lists the featured frameworks, each with its logo, and the index", async () => {
      const document: Document = new JSDOM(
        await renderView(template, {
          enableGoogleTagManager: false,
          seo: seoFor(pagePath),
          frameworkGuides: getFeaturedGuideCards(),
        }),
      ).window.document;
      const strip: Element | null = document.querySelector(
        "[data-framework-guides]",
      );
      const hrefs: Array<string> = Array.from(
        strip?.querySelectorAll("a") || [],
      ).map((link: Element): string => {
        return link.getAttribute("href") || "";
      });

      expect(hrefs).toEqual([
        OPEN_TELEMETRY_GUIDES_INDEX_PATH,
        ...FEATURED_PATHS,
      ]);
      expect(textOf(strip!.querySelector("h2"))).toBe(
        "Set it up for your framework",
      );
      // Each card names its framework beside its logo, which is decorative.
      const cards: Array<Element> = Array.from(strip!.querySelectorAll("li a"));
      expect(
        cards.map((card: Element): string => {
          return textOf(card);
        }),
      ).toEqual(
        FEATURED.map((entry: OpenTelemetryGuideEntry): string => {
          return entry.name;
        }),
      );
      for (const card of cards) {
        expect(card.querySelector("img")?.getAttribute("alt")).toBe("");
      }

      /*
       * Two cards to a row on a phone, three on a tablet, six on a laptop:
       * the featured guides fill whole rows at each, no card left alone.
       */
      const grid: Element = strip!.querySelector("ul")!;
      const columns: Array<number> = [
        "grid-cols-",
        "sm:grid-cols-",
        "lg:grid-cols-",
      ].map((prefix: string): number => {
        const token: string | undefined = Array.from(grid.classList).find(
          (name: string): boolean => {
            return name.startsWith(prefix);
          },
        );
        return Number((token || "").slice(prefix.length));
      });
      expect(columns).toEqual([2, 3, 6]);
      for (const perRow of columns) {
        expect([perRow, cards.length % perRow]).toEqual([perRow, 0]);
      }
    });

    test("shows nothing in the strip's place when it is rendered without the guides", async () => {
      const document: Document = new JSDOM(
        await renderView(template, {
          enableGoogleTagManager: false,
          seo: seoFor(pagePath),
        }),
      ).window.document;

      expect(document.querySelector("[data-framework-guides]")).toBeNull();
    });
  },
);

describe("the guides the product pages feature", () => {
  test("are the featured guides, in the catalog's order, each published, named and marked by its logo", () => {
    const cards: ReturnType<typeof getFeaturedGuideCards> =
      getFeaturedGuideCards();

    expect(
      cards.map((card: { href: string }): string => {
        return card.href;
      }),
    ).toEqual(FEATURED_PATHS);
    for (const path of FEATURED_PATHS) {
      expect(GUIDE_PATHS).toContain(path);
    }
    for (const card of cards) {
      expect(card.name.length).toBeGreaterThan(0);
      // A row of brands on a product page: every one has its official logo.
      expect([card.name, Boolean(card.mark.logo)]).toEqual([card.name, true]);
    }
  });

  test("fill at most two rows, so a product page stays a product page", () => {
    expect(FEATURED.length).toBeGreaterThan(0);
    expect(FEATURED.length).toBeLessThanOrEqual(
      MAX_FEATURED_OPEN_TELEMETRY_GUIDES,
    );
  });

  test("name at least one framework of every language with a guide", () => {
    const languagesWithGuides: Set<string> = new Set(
      OPEN_TELEMETRY_GUIDES.map((entry: OpenTelemetryGuideEntry): string => {
        return entry.language;
      }),
    );
    const featuredLanguages: Set<string> = new Set(
      FEATURED.map((entry: OpenTelemetryGuideEntry): string => {
        return entry.language;
      }),
    );

    expect([...featuredLanguages].sort()).toEqual(
      [...languagesWithGuides].sort(),
    );
  });
});

describe("llms.txt", () => {
  test("lists the index and every guide, each as its Markdown copy", () => {
    for (const txt of [
      generateLlmsTxt(HOME_URL, []),
      generateLlmsFullTxt(HOME_URL, []),
    ]) {
      const section: string = txt.slice(txt.indexOf("## Integrations"));

      expect(txt).toContain("## Integrations");
      expect(section).toContain(
        `(${HOME_URL}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}.md)`,
      );
      for (const guidePath of GUIDE_PATHS) {
        expect(section).toContain(`(${HOME_URL}${guidePath}.md)`);
      }
    }
  });
});
