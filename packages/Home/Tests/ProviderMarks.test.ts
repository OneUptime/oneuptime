import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "Common/Types/ProviderLogo/AllProviderLogoMarks";
import { PROVIDER_LOGO_MARK_BOXES } from "Common/Types/ProviderLogo/ProviderLogoMarks";
import {
  OPEN_TELEMETRY_GUIDES,
  OpenTelemetryGuideEntry,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { getCompareMark } from "../Utils/CompareMark";
import {
  getIntegrationsIndexContent,
  getIntegrationsScriptPath,
} from "../Utils/Integrations/OpenTelemetry/IntegrationsIndex";
import { GuideMark } from "../Utils/Integrations/OpenTelemetry/GuidePage";
import ProductCompare, {
  getProductCompareSlugs,
  Product,
} from "../Utils/ProductCompare";
import {
  getProviderLogoMarkup,
  getProviderLogoShapesHtml,
  ProviderLogoMarkup,
} from "../Utils/ProviderLogoMarkup";
import { HOME_URL, renderView, seoFor } from "./Helpers/TailwindPages";

/*
 * Other companies' marks on the website (icons-svg-one-color, doc 8 block
 * 44): the OpenTelemetry guides, their index and the comparisons draw each
 * framework's or tool's official mark as the product does - inline SVG,
 * every shape in the colour of the text around it - or its initials where
 * the logo registry has no mark. Never an image of a logo, never in a
 * brand's colours, nothing fetched to draw it: the comparison index used to
 * load 29 colour images, half of them made-up coloured initials.
 */

const HOME: string = path.join(__dirname, "..");
const VIEWS: string = path.join(HOME, "Views");

function viewFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...viewFiles(full));
    } else if (entry.name.endsWith(".ejs")) {
      files.push(full);
    }
  }

  return files;
}

function shapesOf(logo: ProviderLogo): Array<string> {
  return (ALL_PROVIDER_LOGO_MARKS[logo] || []).map(
    (shape: { d: string }): string => {
      return shape.d;
    },
  );
}

function pathData(svg: Element): Array<string> {
  return Array.from(svg.querySelectorAll("path")).map(
    (path: Element): string => {
      return path.getAttribute("d") || "";
    },
  );
}

interface CompareItem {
  slug: string;
  productName: string;
  tagline: string;
  mark: GuideMark;
}

const COMPARE_ITEMS: Array<CompareItem> = getProductCompareSlugs().map(
  (slug: string): CompareItem => {
    const product: Product = ProductCompare(slug);

    return {
      slug,
      productName: product.productName,
      tagline: product.tagline,
      mark: getCompareMark(product),
    };
  },
);

describe("a mark, ready for a page", () => {
  test("is the registry's mark: its box, its shapes in the current colour, its name", () => {
    const markup: ProviderLogoMarkup = getProviderLogoMarkup(
      ProviderLogo.Python,
    )!;

    expect(markup.viewBox).toBe(PROVIDER_LOGO_MARK_BOXES[ProviderLogo.Python]);
    expect(markup.name).toBe("Python");
    expect(markup.isWide).toBe(false);

    const svg: Element = new JSDOM(
      `<svg viewBox="${markup.viewBox}">${markup.shapesHtml}</svg>`,
    ).window.document.querySelector("svg")!;

    expect(pathData(svg)).toEqual(shapesOf(ProviderLogo.Python));
    for (const path of Array.from(svg.querySelectorAll("path"))) {
      expect(path.getAttribute("fill")).toBe("currentColor");
    }
  });

  test("a product drawn by its maker's mark carries the maker's shapes and its own name", () => {
    const markup: ProviderLogoMarkup = getProviderLogoMarkup(
      ProviderLogo.GoogleCloudStorage,
    )!;

    expect(markup.name).toBe("Google Cloud Storage");
    expect(markup.viewBox).toBe(
      PROVIDER_LOGO_MARK_BOXES[ProviderLogo.GoogleCloud],
    );
  });

  test("a product whose brand allows no logo has none to draw", () => {
    expect(getProviderLogoMarkup(ProviderLogo.Aws)).toBeUndefined();
    expect(getProviderLogoMarkup(ProviderLogo.Groq)).toBeUndefined();
  });

  test("a wordmark is drawn wide", () => {
    expect(getProviderLogoMarkup(ProviderLogo.Go)!.isWide).toBe(true);
    expect(getProviderLogoMarkup(ProviderLogo.Koa)!.isWide).toBe(true);
  });

  test("a shape's data is written as an attribute can hold it", () => {
    expect(getProviderLogoShapesHtml([{ d: 'M0 0"/><script>' }])).toBe(
      '<path fill="currentColor" d="M0 0&quot;/&gt;&lt;script&gt;"/>',
    );
    expect(getProviderLogoShapesHtml([{ d: "M0 0h1", opacity: 0.4 }])).toBe(
      '<path fill="currentColor" d="M0 0h1" fill-opacity="0.4"/>',
    );
  });
});

describe("every guide and every comparison has a mark the site can draw", () => {
  test.each(
    OPEN_TELEMETRY_GUIDES.filter((entry: OpenTelemetryGuideEntry) => {
      return Boolean(entry.logo);
    }).map((entry: OpenTelemetryGuideEntry): [string, ProviderLogo] => {
      return [entry.slug, entry.logo!];
    }),
  )("the %s guide's mark", (_slug: string, logo: ProviderLogo) => {
    expect(getProviderLogoMarkup(logo)).toBeDefined();
  });

  test.each(getProductCompareSlugs())(
    "the %s comparison shows its tool's mark, or its initials",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      const mark: GuideMark = getCompareMark(product);

      if (product.logo) {
        expect(mark.logo?.name.length).toBeGreaterThan(0);
        expect(mark.logo?.viewBox).toBe(PROVIDER_LOGO_MARK_BOXES[product.logo]);
      } else {
        expect(mark.logo).toBeUndefined();
        expect(mark.monogram).toMatch(/^[A-Za-z]{1,2}$/);
      }
      expect((product as unknown as Record<string, unknown>)["iconUrl"]).toBe(
        undefined,
      );
    },
  );

  test("the tools Simple Icons carries are drawn by their marks", () => {
    const withMarks: Array<string> = COMPARE_ITEMS.filter(
      (item: CompareItem): boolean => {
        return Boolean(item.mark.logo);
      },
    ).map((item: CompareItem): string => {
      return item.slug;
    });

    expect(withMarks.length).toBeGreaterThanOrEqual(16);
    expect(withMarks).toEqual(
      expect.arrayContaining(["pagerduty", "datadog", "newrelic", "sentry"]),
    );
  });
});

describe("the pages draw their marks inline, never as images", () => {
  test("the comparisons' index", async () => {
    const document: Document = new JSDOM(
      await renderView("compare-index.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        compareGroups: [{ title: "Every comparison", items: COMPARE_ITEMS }],
        compareCount: COMPARE_ITEMS.length,
        seo: seoFor("/compare"),
      }),
    ).window.document;

    // The comparison cards, not the nav's or the footer's links.
    const cards: Array<Element> = Array.from(
      document.querySelectorAll("a.group.rounded-2xl[href^='/compare/']"),
    );

    expect(cards).toHaveLength(COMPARE_ITEMS.length);
    for (const card of cards) {
      expect(card.querySelector("img")).toBeNull();
    }

    const marks: Array<Element> = Array.from(
      document.querySelectorAll(
        "a.group.rounded-2xl[href^='/compare/'] svg[data-mark-logo]",
      ),
    );

    expect(marks.length).toBe(
      COMPARE_ITEMS.filter((item: CompareItem): boolean => {
        return Boolean(item.mark.logo);
      }).length,
    );
    for (const mark of marks) {
      expect(mark.getAttribute("fill")).toBe("currentColor");
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      expect(mark.getAttribute("class")).toContain("text-gray-700");
    }
  });

  test.each(["datadog", "rootly"])(
    "the %s comparison's header",
    async (slug: string) => {
      const product: Product = ProductCompare(slug);
      const html: string = await renderView("product-compare.ejs", {
        support: false,
        enableGoogleTagManager: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        productConfig: product,
        productMark: getCompareMark(product),
        onlyShowCompareTable: false,
        seo: seoFor(`/compare/${slug}`),
        homeUrl: HOME_URL,
      });
      const document: Document = new JSDOM(html).window.document;
      const heading: Element = Array.from(document.querySelectorAll("h3")).find(
        (element: Element): boolean => {
          return element.textContent?.trim() === product.productName;
        },
      )!;
      const card: Element = heading.closest("div.rounded-2xl")!;

      expect(card.querySelector("img")).toBeNull();
      if (product.logo) {
        expect(pathData(card.querySelector("svg[data-mark-logo]")!)).toEqual(
          shapesOf(product.logo),
        );
      } else {
        expect(card.querySelector("svg[data-mark-logo]")).toBeNull();
        expect(card.textContent).toContain(getCompareMark(product).monogram);
      }
    },
  );

  test("the integrations' index: every card and every group's heading", async () => {
    const document: Document = new JSDOM(
      await renderView("integrations/index.ejs", {
        enableGoogleTagManager: false,
        seo: seoFor("/integrations"),
        integrations: getIntegrationsIndexContent(HOME_URL),
        integrationsScript: getIntegrationsScriptPath(),
      }),
    ).window.document;

    const groups: Array<Element> = Array.from(
      document.querySelectorAll("[data-integrations-group]"),
    );

    expect(groups.length).toBeGreaterThan(5);
    for (const group of groups) {
      expect(group.querySelector("img")).toBeNull();
    }

    const marks: Array<Element> = Array.from(
      document.querySelectorAll(
        "[data-integrations-group] svg[data-mark-logo]",
      ),
    );

    expect(marks.length).toBeGreaterThan(30);
    for (const mark of marks) {
      expect(mark.getAttribute("viewBox")).toBeTruthy();
      expect(mark.querySelectorAll("path").length).toBeGreaterThan(0);
      for (const path of Array.from(mark.querySelectorAll("path"))) {
        expect(path.getAttribute("fill")).toBe("currentColor");
      }
    }
  });

  test("no view loads a logo image the registry's marks replaced", () => {
    const found: Array<string> = [];

    for (const file of viewFiles(VIEWS)) {
      const text: string = fs.readFileSync(file, "utf8");

      for (const banned of [
        "/img/provider-logos/",
        "iconUrl",
        "/img/price_compare/",
        "mark.logo.src",
        "group.logo.src",
      ]) {
        if (text.includes(banned)) {
          found.push(`${path.relative(HOME, file)}: ${banned}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  test("the site serves no logo files, and the unused comparison chart is gone", () => {
    expect(fs.readFileSync(path.join(HOME, "Routes.ts"), "utf8")).not.toContain(
      "provider-logos",
    );
    expect(
      fs.existsSync(path.join(HOME, "Utils", "ProviderLogoFiles.ts")),
    ).toBe(false);
    expect(fs.existsSync(path.join(VIEWS, "comparision-chart.ejs"))).toBe(
      false,
    );
  });

  test("the colour images the comparisons loaded are gone from the site", () => {
    // The 29 files the comparisons' iconUrl pointed at, until this change.
    const oldImages: Array<string> = [
      "pagerduty.jpeg",
      "statuspagelogo.png",
      "pingdom.svg",
      "datadog.svg",
      "newrelic.svg",
      "betterstack.svg",
      "uptimerobot.svg",
      "checkly.svg",
      "incident-io.svg",
      "signoz.svg",
      "opsgenie.svg",
      "squadcast.svg",
      "firehydrant.svg",
      "rootly.svg",
      "xmatters.svg",
      "grafana.svg",
      "dynatrace.svg",
      "splunk.svg",
      "sentry.svg",
      "appdynamics.svg",
      "elastic-stack.svg",
      "site24x7.svg",
      "cronitor.svg",
      "healthchecks.svg",
      "instatus.svg",
      "freshping.svg",
      "prometheus.svg",
      "zabbix.svg",
      "nagios.svg",
    ];

    expect(
      oldImages.filter((file: string): boolean => {
        return fs.existsSync(path.join(HOME, "Static", "img", file));
      }),
    ).toEqual([]);
  });
});
