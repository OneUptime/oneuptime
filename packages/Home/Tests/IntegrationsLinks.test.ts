import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { getFrameworkGuideCards } from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
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
      nav.querySelectorAll(`#resources-menu a[href="${OPEN_TELEMETRY_GUIDES_INDEX_PATH}"]`),
    );

    expect(links.length).toBe(1);
    expect(textOf(links[0]!)).toBe("Integrations OpenTelemetry for your framework");
    expect(links[0]!.previousElementSibling?.getAttribute("href")).toBe("/books");
  });

  test("list them in the phone menu, keeping its two columns even", () => {
    const link: Element | null = nav.querySelector('[data-testid="integrations-mobile-link"]');

    expect(link?.getAttribute("href")).toBe(OPEN_TELEMETRY_GUIDES_INDEX_PATH);
    expect(link?.parentElement?.querySelectorAll("a").length! % 2).toBe(0);
  });

  test("list them in the footer's Resources column, after the API reference", () => {
    const link: Element | null = footer.querySelector(
      `footer a[href="${OPEN_TELEMETRY_GUIDES_INDEX_PATH}"]`,
    );

    expect(textOf(link)).toBe("Integrations");
    expect(
      link?.closest("li")?.previousElementSibling?.querySelector("a")?.getAttribute("href"),
    ).toBe("/reference");
  });
});

describe.each(PRODUCT_PAGES)("the %s product page", (template: string, pagePath: string) => {
  test("lists every framework with a guide, and the index", async () => {
    const document: Document = new JSDOM(
      await renderView(template, {
        enableGoogleTagManager: false,
        seo: seoFor(pagePath),
        frameworkGuides: getFrameworkGuideCards(),
      }),
    ).window.document;
    const strip: Element | null = document.querySelector("[data-framework-guides]");
    const hrefs: Array<string> = Array.from(strip?.querySelectorAll("a") || []).map(
      (link: Element): string => {
        return link.getAttribute("href") || "";
      },
    );

    expect(hrefs).toEqual([OPEN_TELEMETRY_GUIDES_INDEX_PATH, ...GUIDE_PATHS]);
    expect(textOf(strip!.querySelector("h2"))).toBe("Set it up for your framework");
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
});

describe("the guides' cards for the product pages", () => {
  test("are every published guide, in the catalog's order, each named and marked", () => {
    const cards: ReturnType<typeof getFrameworkGuideCards> = getFrameworkGuideCards();

    expect(
      cards.map((card: { href: string }): string => {
        return card.href;
      }),
    ).toEqual(GUIDE_PATHS);
    for (const card of cards) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.mark.logo || card.mark.monogram).toBeTruthy();
    }
  });
});

describe("llms.txt", () => {
  test("lists the index and every guide, each as its Markdown copy", () => {
    for (const txt of [generateLlmsTxt(HOME_URL, []), generateLlmsFullTxt(HOME_URL, [])]) {
      const section: string = txt.slice(txt.indexOf("## Integrations"));

      expect(txt).toContain("## Integrations");
      expect(section).toContain(`(${HOME_URL}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}.md)`);
      for (const guidePath of GUIDE_PATHS) {
        expect(section).toContain(`(${HOME_URL}${guidePath}.md)`);
      }
    }
  });
});
