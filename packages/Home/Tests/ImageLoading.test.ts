import {
  MARKETING_PAGES,
  MarketingPage,
  VIEWS_ROOT,
  renderMarketingPage,
} from "./Helpers/TailwindPages";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * How the marketing site's images load.
 *
 * The homepage's hero has no image: the largest thing it paints on a phone
 * is text (the description under the headline), so its LCP is held up by
 * what blocks rendering - the stylesheet, the HTML - not by an image. The one
 * image above the fold on every page is the nav's logo, fetched first
 * (fetchpriority="high") and given a box in its own proportions, so nothing
 * moves when it arrives. Everything below the fold waits until it is near
 * the viewport (loading="lazy") and decodes off the main thread
 * (decoding="async"), with a width and height that reserve its box.
 */

const STATIC_IMG: string = path.join(__dirname, "..", "Static", "img");

const svgRatio: (file: string) => number = (file: string): number => {
  const svg: Element = new JSDOM(
    fs.readFileSync(path.join(STATIC_IMG, file), "utf8"),
    { contentType: "image/svg+xml" },
  ).window.document.documentElement;

  return Number(svg.getAttribute("width")) / Number(svg.getAttribute("height"));
};

// A PNG's size, from its IHDR chunk: width and height at bytes 16 and 20.
const pngRatio: (file: string) => number = (file: string): number => {
  const png: Buffer = fs.readFileSync(path.join(STATIC_IMG, file));

  expect(png.toString("ascii", 12, 16)).toBe("IHDR");
  return png.readUInt32BE(16) / png.readUInt32BE(20);
};

const attributeRatio: (image: Element) => number = (image: Element): number => {
  return (
    Number(image.getAttribute("width")) / Number(image.getAttribute("height"))
  );
};

describe("the homepage", () => {
  let document: Document;

  beforeAll(async () => {
    const homepage: MarketingPage = MARKETING_PAGES.find(
      (page: MarketingPage): boolean => {
        return page.template === "index.ejs";
      },
    )!;

    document = new JSDOM(await renderMarketingPage(homepage)).window.document;
  }, 600000);

  test("has no image in its hero: what it paints largest is text", () => {
    const hero: Element = document.getElementById("hero-section")!;

    expect(hero).not.toBeNull();
    expect(hero.querySelectorAll("img, picture, video")).toHaveLength(0);
    expect(hero.querySelector("h1")!.textContent!.trim()).toBe(
      "AI-native observability. From the first alert to the fix.",
    );
  });

  test("fetches the nav's logo first, and only that", () => {
    const urgent: Array<Element> = Array.from(
      document.querySelectorAll("img[fetchpriority='high']"),
    );

    expect(urgent).toHaveLength(1);
    expect(urgent[0]!.getAttribute("src")).toBe("/img/3-transparent.svg");
    expect(urgent[0]!.closest("header")).not.toBeNull();
    expect(urgent[0]!.hasAttribute("loading")).toBe(false);
  });

  test("gives both nav logos a box in the logo's own proportions", () => {
    const logos: Array<Element> = Array.from(
      document.querySelectorAll("header img[src='/img/3-transparent.svg']"),
    );

    expect(logos).toHaveLength(2);

    for (const logo of logos) {
      // h-8 w-auto: the width follows these until the file arrives, then the file.
      expect(attributeRatio(logo)).toBeCloseTo(
        svgRatio("3-transparent.svg"),
        5,
      );
    }
  });

  test("leaves every image below the nav to load near the viewport, in a reserved box", () => {
    const later: Array<Element> = Array.from(
      document.querySelectorAll("img"),
    ).filter((image: Element): boolean => {
      return image.closest("header") === null;
    });

    // The customer logos and the footer's logo.
    expect(later.length).toBeGreaterThan(10);

    const eager: Array<string> = later
      .filter((image: Element): boolean => {
        return (
          image.getAttribute("loading") !== "lazy" ||
          image.getAttribute("decoding") !== "async" ||
          !image.getAttribute("width") ||
          !image.getAttribute("height")
        );
      })
      .map((image: Element): string => {
        return image.outerHTML;
      });

    expect(eager).toEqual([]);
  });

  test("gives the footer's logo a box in its own proportions", () => {
    const logo: Element = document.querySelector(
      "footer img[src='/img/4-gray.svg']",
    )!;

    expect(logo).not.toBeNull();
    expect(attributeRatio(logo)).toBeCloseTo(svgRatio("4-gray.svg"), 5);
  });
});

describe("images below the fold elsewhere", () => {
  const source: (template: string) => string = (template: string): string => {
    return fs.readFileSync(path.join(VIEWS_ROOT, template), "utf8");
  };

  const imagesIn: (template: string, src: string) => Array<Element> = (
    template: string,
    src: string,
  ): Array<Element> => {
    // Only the <img> tags themselves; the templates' EJS is left as text.
    const tags: Array<string> = (
      source(template).match(/<img\b[^>]*>/g) || []
    ).filter((tag: string): boolean => {
      return tag.includes(`src="${src}"`);
    });

    return tags.map((tag: string): Element => {
      return new JSDOM(tag).window.document.querySelector("img")!;
    });
  };

  test("the solution and industry pages draw OneUptime AI, with no screenshot to load", () => {
    // Partials/copilot.ejs is the homepage's AI section, whose investigation is drawn in HTML.
    expect(source(path.join("Partials", "copilot.ejs"))).toContain(
      "include('./home-ai')",
    );
    expect(source(path.join("Partials", "home-ai.ejs"))).not.toMatch(/<img\b/);
    expect(
      source(path.join("Partials", "home-mocks", "mock-autofix.ejs")),
    ).not.toMatch(/<img\b/);
  });

  test.each([
    "dashboards.ejs",
    "exceptions.ejs",
    "incident-management.ejs",
    "monitoring.ejs",
    "on-call.ejs",
    "status-page.ejs",
    "traces.ejs",
    "workflows.ejs",
  ])("the chat demo's avatar on %s", (template: string) => {
    /*
     * The one in the page's markup; the smaller ones are written by its
     * script as the demo plays.
     */
    const avatars: Array<Element> = imagesIn(
      template,
      "/img/OneUptimePNG/1.png",
    ).filter((image: Element): boolean => {
      return (image.getAttribute("class") || "").includes("w-10 h-10");
    });

    expect(avatars).toHaveLength(1);
    expect(avatars[0]!.getAttribute("width")).toBe("40");
    expect(avatars[0]!.getAttribute("height")).toBe("40");
    expect(avatars[0]!.getAttribute("loading")).toBe("lazy");
    expect(avatars[0]!.getAttribute("decoding")).toBe("async");
    expect(pngRatio(path.join("OneUptimePNG", "1.png"))).toBe(1);
  });

  test("the comparison page's pricing panel logo", () => {
    const [logo] = imagesIn(
      "product-compare.ejs",
      "/img/OneUptimePNG/2.png",
    ).filter((image: Element): boolean => {
      return image.getAttribute("loading") === "lazy";
    });

    expect(logo).toBeDefined();
    expect(logo!.getAttribute("decoding")).toBe("async");
    // The one at the top of the page is not lazy.
    expect(
      imagesIn("product-compare.ejs", "/img/OneUptimePNG/2.png").filter(
        (image: Element): boolean => {
          return !image.hasAttribute("loading");
        },
      ),
    ).toHaveLength(1);
  });

  test("the comparison index's product icons", () => {
    // Its src is an EJS tag, whose %> a tag pattern would stop at: read the line.
    const lines: Array<string> = source("compare-index.ejs")
      .split("\n")
      .filter((line: string): boolean => {
        return line.includes("<img") && line.includes("iconUrl");
      });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('class="h-7 w-7 object-contain"');
    expect(lines[0]).toContain('width="28" height="28"');
    expect(lines[0]).toContain('loading="lazy" decoding="async"');
  });
});
