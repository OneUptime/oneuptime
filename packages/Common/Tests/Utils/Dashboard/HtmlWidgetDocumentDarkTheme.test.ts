import HtmlWidgetDocument, {
  HtmlWidgetColorScheme,
} from "../../../Utils/Dashboard/HtmlWidgetDocument";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import { RGB } from "../../../Types/Color";
import { DARK_THEME_CARD } from "../../../Utils/StatusPage/StatusColorsOnDark";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The HTML widget's document in the dashboard's dark theme - a reader's own
 * pick in the dashboard, and a public dashboard's theme
 * (HtmlWidgetDocument.build, colorScheme).
 *
 * A frame whose colour scheme is not the page's is painted on an opaque
 * backdrop in its own scheme, so a widget that starts transparent showed as
 * a white box on the dark card, its gray-700 text on top. In the dark theme
 * the document declares the dark scheme, starts its text in the dark
 * theme's colour, and marks its <html> with the dark class for the author's
 * own html.dark rules. The light document is exactly what it always was.
 *
 * The browser half - the frame really is transparent on the dark card - is
 * in packages/E2E/PublicDashboardTheme.
 */

const OPTIONS: Parameters<typeof HtmlWidgetDocument.build>[0] = {
  html: "<h3>Release train</h3>",
  css: ".release { font-weight: 600; }",
  javascript: "window.ready = true;",
  allowScripts: true,
};

const build: (colorScheme?: HtmlWidgetColorScheme) => string = (
  colorScheme?: HtmlWidgetColorScheme,
): string => {
  return HtmlWidgetDocument.build(
    colorScheme ? { ...OPTIONS, colorScheme } : OPTIONS,
  );
};

const parse: (document: string) => Document = (document: string): Document => {
  return new DOMParser().parseFromString(document, "text/html");
};

const styles: (document: string) => Array<string> = (
  document: string,
): Array<string> => {
  return Array.from(parse(document).querySelectorAll("style")).map(
    (element: HTMLStyleElement): string => {
      return element.textContent || "";
    },
  );
};

const rgb: (color: string) => RGB = (color: string): RGB => {
  return parseColor(color)!;
};

describe("the light theme's document", () => {
  it("is the document it always was: asking for light changes nothing", () => {
    expect(build("light")).toBe(build());
  });

  it("declares no scheme and no dark class, and starts its text in gray-700", () => {
    const document: string = build();

    expect(parse(document).documentElement.className).toBe("");
    expect(document).not.toContain("color-scheme");
    expect(styles(document)[0]).toContain("color: #374151;");
  });
});

describe("the dark theme's document", () => {
  const document: string = build("dark");

  it("marks <html> with the dark class, as the page around it is marked", () => {
    expect(parse(document).documentElement.classList.contains("dark")).toBe(
      true,
    );
    expect(parse(document).documentElement.getAttribute("lang")).toBe("en");
  });

  it("declares the dark scheme, so the frame stays transparent on the dark card", () => {
    expect(styles(document)[0]).toContain(":root { color-scheme: dark; }");
    // Still transparent: the reset's own background is kept.
    expect(styles(document)[0]).toContain("background: transparent;");
  });

  it("starts its text in the dark theme's colour, readable on the dark card", () => {
    const reset: string = styles(document)[0]!;

    expect(reset).toContain("body { color: #e2e8f0; }");
    // After the light reset's colour, so it is the one that applies.
    expect(reset.lastIndexOf("color: #e2e8f0")).toBeGreaterThan(
      reset.indexOf("color: #374151"),
    );
    expect(
      getContrastRatio(rgb("#e2e8f0"), DARK_THEME_CARD),
    ).toBeGreaterThanOrEqual(7);
  });

  it("is the dark theme's own text colour (Theme.css --ou-text-secondary)", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const darkTokens: string = themeCss.slice(
      themeCss.indexOf("html.dark {"),
      themeCss.indexOf("}", themeCss.indexOf("html.dark {")),
    );

    expect(darkTokens).toContain("--ou-text-secondary: #e2e8f0;");
  });

  it("leaves the author's own CSS last, so it wins - an html.dark rule of theirs included", () => {
    const authored: string = HtmlWidgetDocument.build({
      ...OPTIONS,
      css: "html.dark body { color: #fde68a; }",
      colorScheme: "dark",
    });
    const blocks: Array<string> = styles(authored);

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toContain("html.dark body { color: #fde68a; }");
    expect(authored.indexOf("html.dark body")).toBeGreaterThan(
      authored.indexOf("color-scheme: dark"),
    );
  });

  it("changes nothing else: the author's markup and script, the sandbox and the links", () => {
    const light: Document = parse(build());
    const dark: Document = parse(document);

    expect(dark.body.innerHTML).toBe(light.body.innerHTML);
    expect(dark.querySelector("base")?.getAttribute("target")).toBe("_blank");
    expect(dark.querySelectorAll("script")).toHaveLength(2);
  });
});
