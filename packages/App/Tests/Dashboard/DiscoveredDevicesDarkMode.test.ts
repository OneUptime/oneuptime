import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`). A
 * class it has no rule for keeps its light colour in the dark theme and
 * nothing fails - a pale badge on a dark page.
 *
 * The Discovered Devices page (issue #5775) paints its state badges
 * (Monitored, Hidden from map, Not seen recently, Discovered only), its
 * search box, its running-imports strip and the Add to monitoring dialog.
 * These read every source of the page and hold every colour class it uses
 * to what Theme.css actually remaps - the same rule NetworkTrafficDarkMode
 * holds the Traffic pages to.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The whole folder: a file added to it is checked without a list.
const FOLDERS: Array<string> = ["Components/NetworkDevice/DiscoveredDevices"];

// The pages that draw it.
const FILES: Array<string> = [
  "Pages/NetworkDevice/Endpoints.tsx",
  "Pages/NetworkSite/View/Endpoints.tsx",
];

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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function addFolder(modules: Map<string, string>, folder: string): void {
  for (const entry of fs.readdirSync(path.join(DASHBOARD_SRC, folder), {
    withFileTypes: true,
  })) {
    const relativePath: string = `${folder}/${entry.name}`;

    if (entry.isDirectory()) {
      addFolder(modules, relativePath);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      modules.set(relativePath, readCode(relativePath));
    }
  }
}

function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const folder of FOLDERS) {
    addFolder(modules, folder);
  }

  for (const file of FILES) {
    modules.set(file, readCode(file));
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:text-indigo-700` only with a rule of its own, so it must never be
 * read as the bare `text-indigo-700`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 400-600 mark (an icon, a dot, a link) reads the same on a
 * light and a dark card. Greys are not marks: their light shades are
 * exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)$/;

/*
 * A badge's ring: a mid-tone at a low opacity (`ring-emerald-600/20`) is a
 * faint tint of its colour over whatever card it sits on, light or dark -
 * the badges across the Dashboard draw it the same way, with no rule of
 * their own in Theme.css.
 */
const TRANSLUCENT_RING: RegExp = /^ring-[a-z]+-(?:500|600|700)\/\d{1,2}$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_SELECTOR: RegExp = /\[class\*="([^"]+)"\]/g;

// Interaction variants Theme.css remaps by prefix, matched with startsWith.
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_SELECTOR),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (
    utility === "text-white" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility) ||
    TRANSLUCENT_RING.test(utility)
  ) {
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

  // CSS escaping, as Theme.css writes the class.
  const escapedClass: string = token
    .replace(BACKSLASH, "\\\\")
    .replace(COLON, "\\:")
    .replace(SLASH, "\\/");
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

describe("the Discovered Devices page in the dark theme", () => {
  test("every component and page is read", () => {
    expect(Array.from(getModules().keys())).toEqual(
      expect.arrayContaining([
        "Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable.tsx",
        "Components/NetworkDevice/DiscoveredDevices/AddDiscoveredDevicesDialog.tsx",
        "Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceItems.ts",
        "Pages/NetworkDevice/Endpoints.tsx",
        "Pages/NetworkSite/View/Endpoints.tsx",
      ]),
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getModules()) {
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

  test("every colour class the page uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The scan found the page's colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(15);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The four state badges.
        "bg-emerald-50",
        "text-emerald-700",
        "bg-gray-100",
        "text-gray-600",
        "bg-amber-50",
        "text-amber-700",
        "bg-indigo-50",
        "text-indigo-700",
        // The search box.
        "bg-white",
        "border-gray-300",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the badges keep their ring tints, which read on either card", () => {
    const table: string = readCode(
      "Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable.tsx",
    );

    for (const ring of [
      "ring-emerald-600/20",
      "ring-gray-500/20",
      "ring-amber-600/20",
      "ring-indigo-600/20",
    ]) {
      expect(table).toContain(ring);
    }

    // No fixed hex colour that would not follow the theme.
    expect(table).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
