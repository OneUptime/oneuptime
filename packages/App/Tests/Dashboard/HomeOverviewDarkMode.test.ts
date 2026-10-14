import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant: `.bg-white` does not cover `hover:bg-white`). A class it has no
 * rule for keeps its light colour in the dark theme - a white tile on a slate
 * page, or gray-900 text on a gray-900 card - and nothing fails.
 *
 * So these read the source of every component Home draws (Pages/Home/Home.tsx
 * and Components/Home/*.tsx) and hold every colour class to what Theme.css
 * actually remaps. The folder is walked rather than listed, so a card added
 * to Home later is covered automatically. Rendering is covered in
 * Common/Tests/App/Dashboard/Home*.test.tsx and the browser suite in
 * packages/E2E/HomeOverview, which screenshots the page in the dark theme.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const HOME_COMPONENTS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Home",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

// Home's page and every .tsx component in Components/Home, by file name.
function getHomeModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  modules.set(
    "Pages/Home/Home.tsx",
    readCodeAt(path.join(DASHBOARD_SRC, "Pages", "Home", "Home.tsx")),
  );

  for (const fileName of fs.readdirSync(HOME_COMPONENTS_DIR).sort()) {
    if (fileName.endsWith(".tsx")) {
      modules.set(
        `Components/Home/${fileName}`,
        readCodeAt(path.join(HOME_COMPONENTS_DIR, fileName)),
      );
    }
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `lg:bg-white` only with a rule of its own, so it must never be read as the
 * bare `bg-white`. Gradient stops are colours too.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

// Text on a solid fill, and the solid fills themselves, read the same in both themes.
const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:border-indigo-"]:hover. Matched with startsWith, never
 * includes: `group-hover:bg-indigo-50` is not covered by the `:hover` rule
 * for `hover:bg-indigo-50`, which only fires on the element itself.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (utility === "text-white" || SOLID_FILL.test(utility)) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    SUBSTRING_VARIANTS.some((prefix: string): boolean => {
      return token.startsWith(prefix);
    })
  ) {
    return true;
  }

  /*
   * CSS escaping, as Theme.css writes the class: backslashes first, so the
   * ones added for ":" and "/" are not escaped a second time.
   */
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

function tokensIn(code: string): Array<string> {
  return Array.from(code.matchAll(COLOR_TOKEN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("Home in the dark theme", () => {
  test("the walk reaches the page and every card it draws", () => {
    const modules: Map<string, string> = getHomeModules();

    for (const expected of [
      "Pages/Home/Home.tsx",
      "Components/Home/ExploreProducts.tsx",
      "Components/Home/GettingStarted.tsx",
      "Components/Home/HomeCommandBar.tsx",
      "Components/Home/HowOneUptimeWorks.tsx",
      "Components/Home/NeedsAttention.tsx",
      "Components/Home/OverviewStats.tsx",
      "Components/Home/ProjectHealthCard.tsx",
      "Components/Home/ProjectResources.tsx",
      "Components/Home/UpcomingMaintenance.tsx",
    ]) {
      expect({ expected, found: modules.has(expected) }).toEqual({
        expected,
        found: true,
      });
    }
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getHomeModules()) {
      expect({ moduleKey, dark: code.includes("dark:") }).toEqual({
        moduleKey,
        dark: false,
      });
      expect({
        moduleKey,
        template: TEMPLATE_COLOR_TOKEN.test(code),
      }).toEqual({ moduleKey, template: false });
    }
  });

  test("every colour class Home uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getHomeModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found Home's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(30);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The health card's bands, one per verdict.
        "bg-red-50",
        "bg-amber-50",
        "bg-indigo-50",
        "bg-emerald-50",
        "bg-gray-50",
        // The strip's hairline grid and its cells.
        "bg-gray-200",
        "bg-white",
        "hover:bg-gray-50",
        // The cells' and rows' text.
        "text-gray-900",
        "text-gray-500",
        "text-red-600",
        "text-amber-600",
        "text-emerald-600",
        // Declare Incident and Create: the Dashboard's normal button.
        "border-gray-300",
        "text-gray-700",
        // Links.
        "text-indigo-600",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * Theme.css paints near-white over any hovered group child carrying a
   * text-gray-* class (it outranks the indigo hover rule), so the two on
   * one element turn white on hover in the dark theme, not indigo.
   */
  test("no element pairs a grey text colour with an indigo group-hover text colour", () => {
    for (const [moduleKey, code] of getHomeModules()) {
      for (const match of code.matchAll(/className="([^"]*)"/g)) {
        const classes: Array<string> = match[1]!.split(" ");
        const clash: boolean =
          classes.some((name: string): boolean => {
            return name.startsWith("text-gray-");
          }) &&
          classes.some((name: string): boolean => {
            return name.startsWith("group-hover:text-indigo-");
          });

        expect({ moduleKey, classes: match[1], clash }).toEqual({
          moduleKey,
          classes: match[1],
          clash: false,
        });
      }
    }
  });

  test("the product colours Home borrows from the products menu are remapped too", () => {
    const menu: string = readCodeAt(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Components",
        "Navbar",
        "NavBarMenuModal.tsx",
      ),
    );
    const block: string = menu.slice(
      menu.indexOf("export const ICON_COLOR_CLASSES"),
      menu.indexOf("};", menu.indexOf("export const ICON_COLOR_CLASSES")),
    );
    const unmapped: Array<string> = tokensIn(block).filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );

    expect(tokensIn(block).length).toBeGreaterThan(30);
    expect(unmapped).toEqual([]);
  });
});
