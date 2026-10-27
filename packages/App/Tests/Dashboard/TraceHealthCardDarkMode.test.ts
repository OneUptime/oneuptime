import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Trace health" card at the top of a service's Traces page
 * (Components/Traces/TraceHealthCard) in the dark theme, and where the page
 * puts it.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class and per
 * variant. A class it has no rule for keeps its light colour in the dark
 * theme - amber text glowing on a slate card - and nothing fails. So this
 * reads the card's sources and holds every colour class to what Theme.css
 * actually remaps, the way the other *DarkMode guards do.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const SOURCES: Array<string> = [
  path.join(DASHBOARD_SRC, "Components", "Traces", "TraceHealthCard.tsx"),
  path.join(
    DASHBOARD_SRC,
    "Components",
    "Traces",
    "TraceHealthPresentation.ts",
  ),
];

const TRACES_PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Service",
  "View",
  "Traces.tsx",
);

const THEME_CSS: string = fs
  .readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "UI",
      "Styles",
      "Theme.css",
    ),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (utility === "text-white" || SOLID_FILL.test(utility)) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    if (!IDENTIFIER_CHAR.test(next)) {
      return true;
    }

    from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
  }

  return false;
}

describe("the trace health card in the dark theme", () => {
  test("uses no dark: variants and builds no colour class from a template", () => {
    for (const file of SOURCES) {
      const code: string = codeOf(file);

      expect({ file, dark: code.includes("dark:") }).toEqual({
        file,
        dark: false,
      });
      expect({ file, template: TEMPLATE_COLOR_TOKEN.test(code) }).toEqual({
        file,
        template: false,
      });
    }
  });

  test("every colour class it uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const file of SOURCES) {
      for (const match of codeOf(file).matchAll(COLOR_TOKEN)) {
        const token: string = match[1]!;
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${path.basename(file)}: ${token}`);
        }
      }
    }

    // The scan found the card's colours, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "border-gray-200",
        "text-gray-500",
        "text-gray-900",
        "text-amber-700",
        "text-indigo-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });
});

describe("the service's Traces page", () => {
  const page: string = codeOf(TRACES_PAGE);

  test("puts the card above the traces, for the service on the page", () => {
    expect(page).toContain(
      'import TraceHealthCard from "../../../Components/Traces/TraceHealthCard";',
    );
    expect(page).toContain("<TraceHealthCard serviceId={modelId} />");
    expect(page.indexOf("<TraceHealthCard")).toBeLessThan(
      page.indexOf("<TracesViewer"),
    );
  });
});
