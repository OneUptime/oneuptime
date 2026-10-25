import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dark theme does not use Tailwind's dark: variants. Theme.css re-colours
 * the light utility classes under html.dark, one rule per class (and per
 * variant). A class it has no rule for keeps its light colour in the dark
 * theme - a white tile on a slate page - and nothing fails.
 *
 * So these read the sources of what this overhaul added to Security - the
 * Overview's top card (its band and the pipeline), Get started and the test
 * attack; the
 * runs pages (Waiting for Approval, Playbook Runs), which took the place of
 * the tabs and views along the tops of pages; "Your logs" and "Send to your
 * SIEM" on Connections; the Rule Library - its list, filters, a rule's
 * details and the add dialog - and every
 * component they import from their
 * own folders, and hold every colour class to what Theme.css remaps. The
 * walk follows .ts helpers too: a colour kept in a data module is still
 * drawn. Rendering is covered in Common/Tests/App/Dashboard and the browser
 * suite in packages/E2E/SecurityOperations.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ENTRY_FILES: Array<string> = [
  "Pages/SecurityEvents/Overview.tsx",
  "Pages/SecurityEvents/Connections.tsx",
  "Pages/SecurityEvents/RuleLibrary.tsx",
  "Pages/SecurityEvents/Layout.tsx",
  "Pages/SecurityEvents/PlaybookRuns.tsx",
];

// What the walk must reach, so a renamed import cannot quietly shrink it.
const MUST_REACH: Array<string> = [
  "Components/SecurityOverview/SecurityPipeline.tsx",
  "Components/SecurityOverview/SecurityGettingStarted.tsx",
  "Components/SecurityOverview/SecurityOverviewStatus.tsx",
  "Components/SecurityOverview/SecurityOverviewStatusModel.ts",
  "Components/SecurityOverview/SecuritySetupTest.tsx",
  "Components/SecurityOverview/SecuritySetupModel.ts",
  "Components/SecurityEvents/SecurityLogsSourceCard.tsx",
  "Components/SecurityEvents/SecurityEventDestinationsTable.tsx",
  "Components/SecurityEvents/SecurityEventDestinationFormModal.tsx",
  "Components/SecurityEvents/SecurityEventDestinationTest.tsx",
  "Components/SecurityEvents/SecurityEventDestinationUtil.ts",
  // The Rule Library: its list, its filters, a rule's details and the add dialog.
  "Components/SecurityEvents/RuleLibraryTable.tsx",
  "Components/SecurityEvents/RuleLibraryFilterBar.tsx",
  "Components/SecurityEvents/RuleLibraryRulePanel.tsx",
  "Components/SecurityEvents/RuleLibraryAddDialog.tsx",
  "Components/SecurityEvents/RuleLibraryDataStatus.tsx",
  "Components/SecurityEvents/RuleLibraryCopy.ts",
  "Components/SecurityEvents/RuleLibraryUtil.ts",
];

// Only the folders this overhaul drew in; older Security pages have guards of their own.
const WALKED_FOLDERS: Array<string> = [
  "Pages/SecurityEvents/",
  "Components/SecurityOverview/",
  "Components/SecurityEvents/",
];

// Pulled in by an entry, but drawn by components with guards of their own.
const NOT_WALKED: Array<string> = [
  "Components/SecurityEvents/SecurityEventConnectionsTable.tsx",
  "Pages/SecurityEvents/SideMenu.tsx",
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

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const base: string = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier),
  );

  for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
    if (fs.existsSync(path.join(DASHBOARD_SRC, candidate))) {
      return candidate;
    }
  }

  return null;
}

function getWalkedModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [...ENTRY_FILES];

  while (pending.length > 0) {
    const file: string = pending.shift()!;

    if (modules.has(file)) {
      continue;
    }

    const code: string = squash(
      stripComments(fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8")),
    );
    modules.set(file, code);

    for (const match of code.matchAll(/from "(\.{1,2}\/[A-Za-z0-9_/.]+)"/g)) {
      const resolved: string | null = resolveImport(file, match[1]!);

      if (
        resolved &&
        !NOT_WALKED.includes(resolved) &&
        WALKED_FOLDERS.some((folder: string): boolean => {
          return resolved.startsWith(folder);
        })
      ) {
        pending.push(resolved);
      }
    }
  }

  return modules;
}

const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * Text on a solid fill, and the solid fills themselves, read the same in
 * both themes - as does no fill at all (bg-transparent: the remapped
 * colour under it shows through, as in every table's search box).
 */
const SOLID_FILL: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A dark: variant, which Theme.css's remaps never see.
const DARK_VARIANT: RegExp = /(?<![\w-])dark:/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

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

  if (
    utility === "text-white" ||
    utility === "bg-transparent" ||
    SOLID_FILL.test(utility)
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

  const escapedClass: string = token
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/\//g, "\\/");
  let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

  while (from !== -1) {
    const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

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

describe("Security's set-up and connection pieces in the dark theme", () => {
  test("the walk starts at the pages and reaches every new piece", () => {
    const modules: Map<string, string> = getWalkedModules();

    for (const file of [...ENTRY_FILES, ...MUST_REACH]) {
      expect([file, modules.has(file)]).toEqual([file, true]);
    }
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getWalkedModules()) {
      expect({ moduleKey, dark: DARK_VARIANT.test(code) }).toEqual({
        moduleKey,
        dark: false,
      });
      expect({
        moduleKey,
        template: TEMPLATE_COLOR_TOKEN.test(code),
      }).toEqual({ moduleKey, template: false });
    }
  });

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getWalkedModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    expect(tokens.size).toBeGreaterThan(20);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // Get started, and the top card's band in each of its tones.
        "bg-indigo-50",
        "bg-emerald-50",
        "bg-amber-50",
        "bg-red-50",
        "bg-gray-50",
        // The pipeline's hairlines, and its figures and status lines.
        "bg-gray-200",
        "text-red-700",
        "text-amber-700",
        "text-emerald-700",
        "text-indigo-700",
        "text-gray-900",
        "text-gray-600",
        "text-gray-500",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("hover:border-indigo-300")).toBe(true);
    expect(isRemapped("bg-emerald-500")).toBe(true);
    expect(isRemapped("bg-transparent")).toBe(true);
    // Only no fill at all: a transparent border or text is not let through.
    expect(isRemapped("border-transparent")).toBe(false);
    expect(isRemapped("group-hover:bg-white")).toBe(false);
    expect(isRemapped("lg:bg-white")).toBe(false);
    expect(isRemapped("bg-gray-55")).toBe(false);
    // Greys are not solid fills: a grey 500 needs a rule of its own.
    expect(SOLID_FILL.test("bg-gray-500")).toBe(false);
  });
});
