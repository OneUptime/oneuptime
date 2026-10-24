import Reviews, { Review } from "../Utils/Reviews";
import {
  MARKETING_PAGES,
  MarketingPage,
  renderMarketingPage,
  renderView,
} from "./Helpers/TailwindPages";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";
import colors from "tailwindcss/colors";

/*
 * A review's five stars used to be five inline SVGs - on the homepage, with
 * thirty reviews, 150 copies of one 470-byte drawing, 71 KB of the page.
 * They are now five <img> of one cached file that draws exactly what each
 * SVG drew: the same path, in the same box, in the colour `fill-amber-400`
 * gave it.
 */

const STAR_FILE: string = path.join(
  __dirname,
  "..",
  "Static",
  "img",
  "review-star.svg",
);

// The star each inline SVG drew (viewBox 0 0 20 20, class fill-amber-400).
const STAR_PATH: string =
  "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z";

describe("the star file", () => {
  let svg: Element;

  beforeAll(() => {
    const document: Document = new JSDOM(fs.readFileSync(STAR_FILE, "utf8"), {
      contentType: "image/svg+xml",
    }).window.document;

    expect(document.querySelector("parsererror")).toBeNull();
    svg = document.documentElement;
  });

  test("draws the star the inline SVGs drew, in the same box", () => {
    expect(svg.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(
      Array.from(svg.querySelectorAll("path"), (element: Element) => {
        return element.getAttribute("d");
      }),
    ).toEqual([STAR_PATH]);
  });

  test("in the colour fill-amber-400 gave them", () => {
    expect(svg.getAttribute("fill")).toBe(colors.amber[400]);
    expect(colors.amber[400]).toBe("#fbbf24");
  });
});

describe("a review", () => {
  let document: Document;

  beforeAll(async () => {
    const review: Review = Reviews.reviewsList1[0]!;

    document = new JSDOM(
      await renderView(path.join("Partials", "review.ejs"), {
        review: review,
        glowColor: "emerald",
      }),
    ).window.document;
  });

  test("shows five stars, each the cached file at the size the SVG had", () => {
    const stars: Array<HTMLImageElement> = Array.from(
      document.querySelectorAll("img"),
    );

    expect(stars).toHaveLength(5);

    for (const star of stars) {
      expect(star.getAttribute("src")).toBe("/img/review-star.svg");
      // h-4 w-4, as the SVG was; width and height reserve the same box.
      expect(star.getAttribute("class")).toBe("h-4 w-4");
      expect(star.getAttribute("width")).toBe("16");
      expect(star.getAttribute("height")).toBe("16");
      // Decorative, as the SVG was (aria-hidden): no text for a reader.
      expect(star.getAttribute("alt")).toBe("");
      // Reviews sit far below the fold.
      expect(star.getAttribute("loading")).toBe("lazy");
      expect(star.getAttribute("decoding")).toBe("async");
    }
  });

  test("in the same row, and draws no star of its own", () => {
    const row: Element = document.querySelector("img")!.parentElement!;

    expect(row.getAttribute("class")).toBe("flex items-center gap-0.5 mb-4");
    expect(document.querySelectorAll("svg")).toHaveLength(0);
    expect(document.documentElement.outerHTML).not.toContain("M9.049 2.927");
  });
});

describe("the homepage", () => {
  /*
   * The homepage quotes three reviews - the first of each list the route
   * deals them into - as plain quotes, without a star rating, so it draws
   * no star in any form.
   */
  test("quotes three reviews, and draws no star", async () => {
    const homepage: MarketingPage = MARKETING_PAGES.find(
      (page: MarketingPage): boolean => {
        return page.template === "index.ejs";
      },
    )!;
    const html: string = await renderMarketingPage(homepage);
    const featured: Array<Review> = [
      Reviews.reviewsList1[0]!,
      Reviews.reviewsList2[0]!,
      Reviews.reviewsList3[0]!,
    ];

    for (const review of featured) {
      expect(html).toContain(ejs.escapeXML(review.name));
      expect(html).toContain(ejs.escapeXML(review.text));
    }

    expect(html).not.toContain('src="/img/review-star.svg"');
    expect(html).not.toContain(STAR_PATH);
  }, 600000);
});
