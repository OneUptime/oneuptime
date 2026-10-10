import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboard's dark theme does not come from Tailwind's dark: variants.
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant (`.bg-white` does not cover `hover:bg-white`). A
 * class it has no rule for keeps its light colour in the dark theme and
 * nothing fails - a pale bubble on a dark page.
 *
 * The AI / LLM pages paint a lot of colour: the person's bubbles, the AI's,
 * tool cards, the issue pills and dots, the replay's scrubber, the summary
 * tiles and the alert cards. These read every source of those pages and
 * hold every colour class they use - in JSX, and in the plain .ts tables
 * the colours are kept in (LlmConversationCopy, LlmReplayModel,
 * LlmMonitorTemplateCopy) - to what Theme.css actually remaps.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// Whole folders: a file added to one of them is checked without a list.
const FOLDERS: Array<string> = [
  "Components/LlmConversations",
  "Components/LlmAlerts",
  "Components/Form/Monitor/LlmMonitor",
];

// The pages of AI / LLM this work drew, one file each.
const FILES: Array<string> = [
  "Pages/Llm/Conversations.tsx",
  "Pages/Llm/ConversationView.tsx",
  "Pages/Llm/Alerts.tsx",
  "Pages/Llm/Documentation.tsx",
  "Pages/Llm/Layout.tsx",
  "Components/AI/LlmNavTabs.tsx",
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

function readCode(relativePath: string): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8"),
    ),
  );
}

// Every module of the AI / LLM pages, keyed by its path under src/.
function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const folder of FOLDERS) {
    for (const name of fs.readdirSync(path.join(DASHBOARD_SRC, folder))) {
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        const relativePath: string = `${folder}/${name}`;
        modules.set(relativePath, readCode(relativePath));
      }
    }
  }

  for (const file of FILES) {
    modules.set(file, readCode(file));
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-gray-50` only with a rule of its own, so it must never be read
 * as the bare `bg-gray-50`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 400-600 mark (an icon, a dot, a focus ring, the scrubber's
 * markers) reads the same on a light and a dark card. Greys are not marks:
 * their light shades are exactly what must be remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring)-(?!gray|slate)[a-z]+-(?:400|500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

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

const GROUP_HOVER_GREY_TEXT_RULE: string =
  '.group:hover [class*="group-hover"][class*="text-gray-"]';

/*
 * Colour classes that may stay without a rule of their own, each with why.
 * The guard fails if one of them leaves the code, so the list cannot
 * outlive what it excuses.
 */
const KNOWN_EXCEPTIONS: Record<string, Array<string>> = {
  /*
   * A mid-grey mark, never a surface: the empty answer's dot, the replay's
   * activity marker and the "AI is answering" typing dots. Gray-400 reads
   * on a white card and on a dark one alike, and a dashboard-wide dark rule
   * for it would re-colour every other gray-400 surface too.
   */
  "bg-gray-400": [
    "Components/LlmConversations/LlmConversationCopy.ts",
    "Components/LlmConversations/LlmReplayModel.ts",
    "Components/LlmConversations/LlmConversationView.tsx",
  ],
};

function isRemapped(token: string): boolean {
  const utility: string = token.slice(token.lastIndexOf(":") + 1);

  if (
    utility === "text-white" ||
    utility.endsWith("-transparent") ||
    SOLID_MARK.test(utility)
  ) {
    return true;
  }

  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    token.startsWith("group-hover:text-gray-") &&
    THEME_CSS.includes(GROUP_HOVER_GREY_TEXT_RULE)
  ) {
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

describe("the AI / LLM pages in the dark theme", () => {
  test("every folder and page is read, and the colour tables with them", () => {
    const modules: Map<string, string> = getModules();

    expect(Array.from(modules.keys())).toEqual(
      expect.arrayContaining([
        "Components/LlmConversations/LlmConversationView.tsx",
        "Components/LlmConversations/LlmConversationsView.tsx",
        "Components/LlmConversations/LlmTranscriptStepView.tsx",
        "Components/LlmConversations/LlmReplayBar.tsx",
        "Components/LlmConversations/LlmSummaryTiles.tsx",
        "Components/LlmConversations/LlmConversationRow.tsx",
        "Components/LlmConversations/LlmIssueBadge.tsx",
        // The plain .ts modules that hold colour classes.
        "Components/LlmConversations/LlmConversationCopy.ts",
        "Components/LlmConversations/LlmReplayModel.ts",
        "Components/LlmAlerts/LlmMonitorTemplateCopy.ts",
        "Components/LlmAlerts/LlmAlertsView.tsx",
        "Components/LlmAlerts/LlmMonitorPreview.tsx",
        "Components/Form/Monitor/LlmMonitor/LlmMonitorStepForm.tsx",
        "Pages/Llm/Documentation.tsx",
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

  test("every colour class the pages use is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getModules()) {
      for (const token of tokensIn(code)) {
        tokens.add(token);

        if (
          !isRemapped(token) &&
          !(KNOWN_EXCEPTIONS[token] || []).includes(moduleKey)
        ) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The scan found the pages' colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(60);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The person's bubble and the AI's.
        "bg-indigo-50",
        "ring-indigo-100",
        "bg-white",
        "ring-gray-200",
        // A failed call, and the issue pills.
        "bg-red-50",
        "ring-red-200",
        "bg-amber-50",
        "bg-violet-50",
        "bg-orange-50",
        // The scrubber's track and the pending answer's bubble.
        "bg-gray-200",
        "bg-gray-100",
        // Rows and chips on hover.
        "hover:bg-gray-50",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("every known exception is still in the code it excuses, and still needs excusing", () => {
    const modules: Map<string, string> = getModules();

    for (const [token, moduleKeys] of Object.entries(KNOWN_EXCEPTIONS)) {
      for (const moduleKey of moduleKeys) {
        expect({
          token,
          moduleKey,
          present: tokensIn(modules.get(moduleKey) || "").includes(token),
        }).toEqual({ token, moduleKey, present: true });
      }

      expect({ token, remapped: isRemapped(token) }).toEqual({
        token,
        remapped: false,
      });
    }
  });

  /*
   * The colours kept in tables reach the page through a template literal
   * (`${style.badgeClassName}`), so they are checked where they are written.
   */
  test("the issue, marker and alert colour tables are among those checked", () => {
    const modules: Map<string, string> = getModules();
    const tokensOf: (moduleKey: string) => Array<string> = (
      moduleKey: string,
    ): Array<string> => {
      return tokensIn(modules.get(moduleKey) || "");
    };

    expect(
      tokensOf("Components/LlmConversations/LlmConversationCopy.ts"),
    ).toEqual(
      expect.arrayContaining([
        "bg-red-50",
        "text-red-700",
        "ring-red-200",
        "bg-amber-50",
        "text-amber-700",
        "bg-gray-100",
        "text-gray-700",
        "bg-violet-50",
        "text-violet-700",
        "bg-emerald-500",
      ]),
    );
    expect(tokensOf("Components/LlmConversations/LlmReplayModel.ts")).toEqual(
      expect.arrayContaining([
        "bg-indigo-500",
        "bg-violet-500",
        "bg-cyan-500",
        "bg-gray-400",
        "bg-red-500",
      ]),
    );
    expect(tokensOf("Components/LlmAlerts/LlmMonitorTemplateCopy.ts")).toEqual(
      expect.arrayContaining([
        "bg-amber-50",
        "bg-red-50",
        "bg-orange-50",
        "bg-violet-50",
        "bg-sky-50",
        "bg-gray-100",
      ]),
    );
  });
});
