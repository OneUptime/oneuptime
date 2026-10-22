import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Code in the dark theme: its first page (the request box, its pickers and
 * the task list), Repositories, a repository's page and a task's
 * conversation - every module under Components/Code and Pages/Code, walked
 * rather than listed, so a component added later is held too.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * and per variant. A class it has no rule for keeps its light colour in the
 * dark theme - a white bubble on a slate page, gray-900 text on a gray-900
 * card - and nothing fails. The browser suite (packages/E2E/Code) reads the
 * colours drawn; this holds every class to what Theme.css remaps.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ROOTS: Array<string> = [
  path.join(DASHBOARD_SRC, "Components", "Code"),
  path.join(DASHBOARD_SRC, "Pages", "Code"),
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

const SOURCE_FILE: RegExp = /\.tsx?$/;

// Every .ts and .tsx module under the roots, by its path from src.
function listModules(): Array<string> {
  const modules: Array<string> = [];
  const pending: Array<string> = [...ROOTS];

  while (pending.length > 0) {
    const directory: string = pending.shift()!;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        pending.push(full);
      } else if (SOURCE_FILE.test(entry.name)) {
        modules.push(path.relative(DASHBOARD_SRC, full));
      }
    }
  }

  return modules.sort();
}

const MODULES: Array<string> = listModules();

// Comments hold prose, not classes.
function readCode(file: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: `hover:bg-gray-100` needs a
 * rule of its own, apart from `bg-gray-100`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|current|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 400-600 mark (an icon, a spinner's arc, a focus ring, a
 * state's colour) reads on a light and a dark card alike. Greys are not
 * marks: their light shades are exactly what must be remapped. A tint of
 * one (a focus ring's /10 glow) is a mark too.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)(?:\/\d+)?$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

// A whole class built from a value ("text-${tone}"), not a test id's tail ("context-${kind}").
const TEMPLATE_COLOR_TOKEN: RegExp =
  /(?<![\w-])(bg|text|border|ring|divide|from|via|to)-\$\{/;

/*
 * Mid greys that read on both grounds as the small marks they are: a
 * stopped task's dot and its badge's faint ring (CodeTaskCopy).
 */
const MID_GREY_MARKS: Array<string> = ["bg-gray-400", "ring-gray-500/20"];

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-indigo-"]:hover. Matched with startsWith.
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

  if (
    MID_GREY_MARKS.includes(token) ||
    utility === "text-white" ||
    utility === "text-current" ||
    utility === "bg-current" ||
    utility === "border-current" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility)
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

describe("Code in the dark theme", () => {
  test("reads every page and component of Code, the new request box and the Repositories table among them", () => {
    expect(MODULES).toEqual(
      expect.arrayContaining([
        "Components/Code/CodeAskBox.tsx",
        "Components/Code/CodeBranchPicker.tsx",
        "Components/Code/CodeComposer.tsx",
        "Components/Code/CodeDiffStat.tsx",
        "Components/Code/CodePicker.tsx",
        "Components/Code/CodeRepositoryPicker.tsx",
        "Components/Code/CodeRepositoriesTable.tsx",
        "Components/Code/CodeRepositoryCommandsCard.tsx",
        "Components/Code/CodeTaskCopy.ts",
        "Components/Code/CodeTaskList.tsx",
        "Components/Code/CodeTaskStateMark.tsx",
        "Components/Code/CodeTaskTurn.tsx",
        "Pages/Code/Code.tsx",
        "Pages/Code/Repositories.tsx",
        "Pages/Code/Repository/Tasks.tsx",
        "Pages/Code/Task/Conversation.tsx",
      ]),
    );
  });

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const file of MODULES) {
      const code: string = readCode(file);

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

  test("every colour class they use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const file of MODULES) {
      for (const token of tokensIn(readCode(file))) {
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${file}: ${token}`);
        }
      }
    }

    // The scan found the redesign's colours at all, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The request box and its pickers' lists.
        "bg-white",
        "border-gray-300",
        "hover:bg-gray-100",
        "bg-gray-50",
        // A person's message, a white bubble with a hairline.
        "ring-gray-200",
        // The blocker strip at the top of the box.
        "bg-amber-50",
        // The task list's lines added and removed.
        "text-emerald-600",
        "text-red-600",
        // The repositories' GitHub mark.
        "bg-gray-900",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  /*
   * The reply box held at the bottom of the window sits on the page's own
   * ground in either theme: the canvas variable Theme.css redefines for
   * html.dark - never bg-gray-50, which dark mode turns a shade lighter
   * than the page.
   */
  test("the reply box's ground is the theme's canvas, which both themes define", () => {
    const conversation: string = readCode("Pages/Code/Task/Conversation.tsx");

    expect(conversation).toContain(
      'backgroundColor: "var(--ou-background-primary)"',
    );
    const definitions: number = (
      THEME_CSS.match(/--ou-background-primary:/g) || []
    ).length;
    expect(definitions).toBeGreaterThanOrEqual(2);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("text-gray-500")).toBe(true);
    expect(isRemapped("bg-amber-50")).toBe(true);
    expect(isRemapped("text-indigo-600")).toBe(true);
    expect(isRemapped("ring-indigo-500/10")).toBe(true);
    expect(isRemapped("bg-gray-150")).toBe(false);
    expect(isRemapped("text-lime-950")).toBe(false);
    expect(isRemapped("hover:bg-lime-50")).toBe(false);
    // A keyboard's row takes its hover's ground (Theme.css, for Code's rows).
    expect(isRemapped("focus-visible:bg-gray-50")).toBe(true);
    // The mid-grey marks are allowed as the marks they are, and no others.
    expect(isRemapped("bg-gray-400")).toBe(true);
    expect(isRemapped("ring-gray-500/20")).toBe(true);
    expect(isRemapped("ring-gray-500/30")).toBe(false);
  });

  test("a whole class built from a value is caught; a test id's tail is not", () => {
    expect(TEMPLATE_COLOR_TOKEN.test("className={`text-${tone}`}")).toBe(true);
    expect(TEMPLATE_COLOR_TOKEN.test("className={`x bg-${tone}`}")).toBe(true);
    expect(
      TEMPLATE_COLOR_TOKEN.test("dataTestId={`code-add-context-${kind}`}"),
    ).toBe(false);
  });
});
