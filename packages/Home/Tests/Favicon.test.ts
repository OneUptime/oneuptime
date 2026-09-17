import ejs from "ejs";
import fs from "fs";
import path from "path";

const HEAD_TEMPLATE: string = path.join(
  __dirname,
  "..",
  "Views",
  "head-basic.ejs",
);
const SHARED_FAVICON_URL: string =
  "/oneuptime-assets/brand/favicons/oneuptime-up-v1.svg";

function attribute(tag: string, name: string): string | null {
  const match: RegExpMatchArray | null = tag.match(
    new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"),
  );

  return match?.[2] || null;
}

function ordinaryIconLinks(source: string): Array<string> {
  return (source.match(/<link\b[^>]*>/gi) || []).filter((tag: string) => {
    const rel: string | null = attribute(tag, "rel");

    return Boolean(rel?.toLowerCase().split(/\s+/).includes("icon"));
  });
}

describe("Home favicon", () => {
  let head: string = "";

  beforeAll(async () => {
    head = (await ejs.renderFile(HEAD_TEMPLATE, {
      enableGoogleTagManager: false,
      homeUrl: "https://oneuptime.com",
    })) as string;
  });

  test("renders only contrast-safe, cache-busted browser icons", () => {
    const hrefs: Array<string> = ordinaryIconLinks(head).map((tag: string) => {
      return attribute(tag, "href") || "";
    });

    expect(hrefs).toEqual([
      "/img/favicons/favicon.ico?v=up-v1",
      "/img/favicons/favicon-32x32.png?v=up-v1",
      "/img/favicons/favicon-16x16.png?v=up-v1",
      SHARED_FAVICON_URL,
    ]);
  });

  test("uses the scalable Up mark as an any-size SVG", () => {
    const svgLink: string | undefined = ordinaryIconLinks(head).find(
      (tag: string) => {
        return attribute(tag, "href") === SHARED_FAVICON_URL;
      },
    );

    expect(svgLink).toBeDefined();
    expect(attribute(svgLink!, "type")).toBe("image/svg+xml");
    expect(attribute(svgLink!, "sizes")).toBe("any");
  });

  test("does not restore the invisible white-on-transparent override", () => {
    expect(head).not.toMatch(/rel=["'](?:shortcut )?icon["'][^>]+ou-wb\.svg/i);
  });

  test("keeps the legacy touch icon on opaque artwork", () => {
    const precomposedLink: string | undefined = (
      head.match(/<link\b[^>]*>/gi) || []
    ).find((tag: string) => {
      return attribute(tag, "rel") === "apple-touch-icon-precomposed";
    });

    expect(attribute(precomposedLink || "", "href")).toBe(
      "/img/favicons/apple-touch-icon.png",
    );
  });

  test("the template rendered instead of being inspected as raw EJS", () => {
    expect(head).not.toContain("<%");
    expect(head).toContain(
      '<link rel="canonical" href="https://oneuptime.com">',
    );
  });

  test("the Home fallback files exist", () => {
    for (const filename of [
      "favicon.ico",
      "favicon-32x32.png",
      "favicon-16x16.png",
      "apple-touch-icon.png",
    ]) {
      expect(
        fs.existsSync(
          path.join(__dirname, "..", "Static", "img", "favicons", filename),
        ),
      ).toBe(true);
    }
  });
});
