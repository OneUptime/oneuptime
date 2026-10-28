import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { getGuidePageContent } from "../Utils/Integrations/OpenTelemetry/GuidePage";
import {
  getFeaturedGuideCards,
  getIntegrationsIndexContent,
} from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import { OpenTelemetryGuide } from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import {
  HOME_URL,
  VIEWS_ROOT,
  renderView,
  seoFor,
} from "./Helpers/TailwindPages";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * The integrations pages as the rest of the website lays them out, and as a
 * phone shows them:
 *
 * - their content lines up with the nav's logo and every product page's:
 *   the site's gutters (px-6, lg:px-8), not narrower ones of their own;
 * - the site's nav scrolls away with the page, so the guide's contents
 *   stick to the top of the screen (scrolling themselves in a short
 *   window), and a heading or a language group a link jumps to lands just
 *   under the top instead of a nav's height below it;
 * - the index's search field focuses like the site's other fields (its
 *   own ring, not the browser's outline), its hint fits a phone's field,
 *   and its clear button is drawn in the field's grey;
 * - the index says what the guides are in two short sentences.
 */

const SCRIPT_PATH: string = "/js/integrations.js?v=test";
const STYLES: string = fs.readFileSync(
  path.join(VIEWS_ROOT, "Partials", "integrations", "styles.ejs"),
  "utf8",
);

// The page-wide containers: the site's 80rem column.
function pageContainers(document: Document): Array<Element> {
  return Array.from(document.querySelectorAll("main .max-w-7xl"));
}

function expectSiteGutters(containers: Array<Element>): void {
  expect(containers.length).toBeGreaterThan(0);
  for (const container of containers) {
    expect([container.className, container.classList.contains("px-6")]).toEqual(
      [container.className, true],
    );
    expect(container.classList.contains("lg:px-8")).toBe(true);
    expect(container.classList.contains("px-4")).toBe(false);
    expect(container.classList.contains("sm:px-6")).toBe(false);
  }
}

async function renderGuide(slug: string): Promise<Document> {
  return new JSDOM(
    await renderView("integrations/opentelemetry-guide.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor(getOpenTelemetryGuidePath(slug)),
      guide: getGuidePageContent(slug, HOME_URL),
      integrationsScript: SCRIPT_PATH,
    }),
  ).window.document;
}

async function renderIndex(): Promise<Document> {
  return new JSDOM(
    await renderView("integrations/index.ejs", {
      enableGoogleTagManager: false,
      seo: seoFor(OPEN_TELEMETRY_GUIDES_INDEX_PATH),
      integrations: getIntegrationsIndexContent(HOME_URL),
      integrationsScript: SCRIPT_PATH,
    }),
  ).window.document;
}

describe("the site's gutters", () => {
  test("the nav and the product pages, which the integrations pages line up with, use px-6 and lg:px-8", async () => {
    const nav: Document = new JSDOM(await renderView("nav.ejs", {})).window
      .document;
    const navContainer: Element | null = nav.querySelector(".max-w-7xl");

    expect(navContainer?.classList.contains("px-6")).toBe(true);

    const traces: string = fs.readFileSync(
      path.join(VIEWS_ROOT, "traces.ejs"),
      "utf8",
    );
    expect(traces).toContain('class="mx-auto max-w-7xl px-6 lg:px-8"');
  });

  test.each(
    OPEN_TELEMETRY_GUIDE_PAGES.map((guide: OpenTelemetryGuide): string => {
      return guide.slug;
    }),
  )(
    "the %s guide uses them for its header, body and related guides",
    async (slug: string) => {
      const document: Document = await renderGuide(slug);
      const containers: Array<Element> = pageContainers(document);

      // Header, body and the related guides' band.
      expect(containers.length).toBe(3);
      expectSiteGutters(containers);
    },
  );

  test("the index uses them for its header and its groups", async () => {
    const containers: Array<Element> = pageContainers(await renderIndex());

    expect(containers.length).toBe(2);
    expectSiteGutters(containers);
  });

  test("the product pages' row of frameworks uses the gutters of the page it sits on", async () => {
    const document: Document = new JSDOM(
      await renderView("traces.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/product/traces"),
        frameworkGuides: getFeaturedGuideCards(),
      }),
    ).window.document;
    const strip: Element | null = document.querySelector(
      "[data-framework-guides]",
    );

    expectSiteGutters(Array.from(strip?.querySelectorAll(".max-w-7xl") || []));
  });
});

describe("a guide's contents and anchors", () => {
  let document: Document;

  beforeAll(async () => {
    document = await renderGuide("express");
  });

  test("the contents stick to the top of the screen, where the nav would be if it stayed", () => {
    const contents: Element | null = document.querySelector(
      'nav[aria-label="On this page"].guide-contents',
    );

    expect(contents).not.toBeNull();
    expect(contents!.classList.contains("sticky")).toBe(true);
    expect(contents!.classList.contains("top-0")).toBe(true);
    expect(contents!.classList.contains("top-24")).toBe(false);
  });

  test("the contents scroll themselves in a window too short to show them whole", () => {
    const contents: Element = document.querySelector(".guide-contents")!;

    expect(contents.classList.contains("max-h-screen")).toBe(true);
    expect(contents.classList.contains("overflow-y-auto")).toBe(true);
  });

  test("a heading a link jumps to lands just under the top of the screen", () => {
    expect(STYLES).toContain(".guide-section { scroll-margin-top: 2rem; }");
    expect(STYLES).not.toContain("scroll-margin-top: 6rem");
    expect(document.querySelectorAll("section.guide-section").length).toBe(14);
  });
});

describe("the index", () => {
  let document: Document;

  beforeAll(async () => {
    document = await renderIndex();
  });

  test("a language group a breadcrumb jumps to lands just under the top of the screen", () => {
    const groups: Array<Element> = Array.from(
      document.querySelectorAll("[data-integrations-group]"),
    );

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.classList.contains("scroll-mt-8")).toBe(true);
      expect(group.classList.contains("scroll-mt-24")).toBe(false);
    }
  });

  test("says what the guides are in two short sentences", () => {
    const lead: string = (
      document.querySelector("header h1 + p")?.textContent || ""
    ).trim();

    expect(lead).toBe(
      "Step-by-step guides that send your framework's traces, metrics and logs to OneUptime. Each one was run end to end before it was published.",
    );
  });

  describe("the search field", () => {
    let search: HTMLInputElement;

    beforeAll(() => {
      search = document.querySelector(
        "[data-integrations-search]",
      ) as HTMLInputElement;
    });

    test("is a search field whose hint fits a phone's field whole", () => {
      expect(search.type).toBe("search");
      // A 390px phone leaves about 210px of the field for its hint.
      expect(search.placeholder).toBe("Search frameworks…");
      expect(search.placeholder.length).toBeLessThanOrEqual(20);
    });

    test("focuses with its own ring, as the site's other fields do, not the browser's outline", () => {
      for (const name of [
        "focus:outline-none",
        "focus:ring-2",
        "focus:ring-inset",
        "focus:ring-indigo-500",
      ]) {
        expect([name, search.classList.contains(name)]).toEqual([name, true]);
      }
    });

    test("is not spell-checked: framework names are not words", () => {
      expect(search.getAttribute("spellcheck")).toBe("false");
    });

    test("draws the browser's clear button in the field's grey", () => {
      expect(search.classList.contains("integrations-search")).toBe(true);
      expect(STYLES).toContain(
        ".integrations-search::-webkit-search-cancel-button",
      );
      // gray-400, the search icon's colour, in place of the browser's blue.
      expect(STYLES).toContain("stroke='%239ca3af'");
      // The index carries the styles that hold it.
      expect(
        Array.from(document.querySelectorAll("style")).some(
          (style: Element): boolean => {
            return (style.textContent || "").includes(
              "-webkit-search-cancel-button",
            );
          },
        ),
      ).toBe(true);
    });
  });
});
