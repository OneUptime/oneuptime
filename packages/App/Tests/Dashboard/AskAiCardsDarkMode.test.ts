import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI IN THE DARK THEME: the dialog and the cards in it.
 *
 * The approval card a create_alert waits on and the card it leaves under
 * the answer ("ALT-12 · High memory usage on test01", with its Open) are
 * drawn by ToolApprovalCard and ResourceCardWidget, in the Ask AI dialog
 * and an incident's or alert's AI card alike (#5301's UI review). The
 * dialog itself - its header, its start, the composer, the conversation,
 * its live line and footer, the history and the way back into it - is
 * held to the same rule, file by file, so a colour added to any of them
 * cannot keep its light shade on a dark dialog.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-white` does not cover `hover:bg-white`). A class
 * it has no rule for keeps its light colour in the dark theme - an emerald
 * link on a dark green card, a white button on slate - and nothing fails.
 * So these read the two cards' sources and hold every colour class to what
 * Theme.css actually remaps. They are drawn dark in real Chromium too:
 * packages/E2E/EventOverview (the approval card, ?thread=linking&theme=dark).
 */

const AI_CHAT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "AIChat",
);

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "Common");

const AI_DIR: string = path.join(AI_CHAT_DIR, "..", "AI");

const SOURCES: Array<[string, string]> = [
  ["ToolApprovalCard.tsx", path.join(AI_CHAT_DIR, "ToolApprovalCard.tsx")],
  [
    "Widgets/ResourceCardWidget.tsx",
    path.join(AI_CHAT_DIR, "Widgets", "ResourceCardWidget.tsx"),
  ],
  // The dialog: everything Ask AI draws around its cards.
  ...[
    "AskAiDialog.tsx",
    "AskAiConversation.tsx",
    "AskAiHistory.tsx",
    "AskAiMark.tsx",
    "AskAiResumeButton.tsx",
    "ChatHomeView.tsx",
    "ChatInput.tsx",
    "ChatMessageList.tsx",
    "ChatActivityFeed.tsx",
    "ChatDownloadMenu.tsx",
    "PageContextChip.tsx",
    "PermissionModePicker.tsx",
    "ProviderPicker.tsx",
    "AIChatUnavailableView.tsx",
  ].map((file: string): [string, string] => {
    return [file, path.join(AI_CHAT_DIR, file)];
  }),
  // An answer's citation marks and its sources, shared with the AI card.
  [
    "AnswerCitationChip.tsx",
    path.join(AI_DIR, "InvestigationConversation", "AnswerCitationChip.tsx"),
  ],
  [
    "AnswerSources.tsx",
    path.join(AI_DIR, "InvestigationConversation", "AnswerSources.tsx"),
  ],
  [
    "InvestigationCitationChip.tsx",
    path.join(AI_DIR, "InvestigationReport", "InvestigationCitationChip.tsx"),
  ],
];

const THEME_CSS_PATH: string = path.join(
  COMMON_DIR,
  "UI",
  "Styles",
  "Theme.css",
);

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function readCodeAt(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function getModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();

  for (const [key, file] of SOURCES) {
    modules.set(key, readCodeAt(file));
  }

  return modules;
}

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

/*
 * The whole variant chain is part of the token: Theme.css remaps
 * `hover:bg-emerald-100` only with a rule of its own, so it must never be
 * read as the bare `bg-emerald-100`.
 */
const COLOR_TOKEN: RegExp =
  /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|via|to)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

/*
 * A saturated 500/600 mark (an icon's tile, a focus ring, the stops of
 * Ask AI's indigo-to-violet mark) reads the same on a light and a dark
 * card. Greys are not marks: their light shades are exactly what must be
 * remapped.
 */
const SOLID_MARK: RegExp =
  /^(?:bg|text|border|ring|from|via|to)-(?!gray|slate)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;

const TEMPLATE_COLOR_TOKEN: RegExp =
  /(bg|text|border|ring|divide|from|via|to)-\$\{/;

const SUBSTRING_RULE: RegExp = /\[class\*="([^"]+)"\]/g;
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;

/*
 * Interaction variants Theme.css remaps by prefix, e.g.
 * [class*="hover:text-emerald-"]:hover. Matched with startsWith.
 */
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_RULE),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

/*
 * Theme.css colours every grey group-hover text by substring, not by name
 * (so the status page guard's named one is not the only one remapped).
 */
const GROUP_HOVER_GREY_TEXT_RULE: string =
  '.group:hover [class*="group-hover"][class*="text-gray-"]';

/*
 * Colour classes these parts carried before, each with why it may stay,
 * and the files it may stay in. The guard fails if one of them leaves the
 * code, so the list cannot outlive what it excuses.
 */
const KNOWN_EXCEPTIONS: Record<string, Array<string>> = {
  /*
   * A chosen Skip: white words on a mid grey, which reads the same on a
   * light and a dark card. And the live dot of the activity feed's own
   * frame (an AI insight's triage): a mid grey on either theme.
   */
  "bg-gray-500": ["ToolApprovalCard.tsx", "ChatActivityFeed.tsx"],
  // The live dot's ping, round the dot above.
  "bg-gray-400": ["ChatActivityFeed.tsx"],
  // The Run button's spinner while the decision is sent: on the dark button.
  "border-white/40": ["ToolApprovalCard.tsx"],
  // The Stop button's spinner while it stops: on the dark button too.
  "border-gray-500": ["ChatInput.tsx"],
  // A citation chip's hover ring (the AI card's guard excuses it too).
  "hover:ring-indigo-200": ["InvestigationCitationChip.tsx"],
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

describe("Ask AI in the dark theme", () => {
  test("no part of it uses dark: variants or builds a colour class from a template", () => {
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

  test("every colour class the dialog and its cards draw with is remapped for dark mode", () => {
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

    // The read found the cards' colours at all, so this is not vacuous.
    expect(tokens.size).toBeGreaterThan(20);
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        // The approval card: its wash, an action's box and its words.
        "bg-amber-50/70",
        "border-amber-200/70",
        "text-gray-900",
        "text-gray-700",
        // Allow and Skip, chosen and not.
        "bg-gray-900",
        "hover:bg-gray-50",
        // The card under the answer, and its Open.
        "bg-emerald-50/70",
        "border-emerald-200",
        "text-emerald-700",
        "hover:bg-emerald-100",
        "hover:text-emerald-800",
        // The keyboard's focus ring on Open.
        "focus-visible:ring-indigo-500",
        // The dialog's backdrop, its mark, and the composer's box.
        "bg-gray-950/40",
        "from-indigo-500",
        "to-violet-600",
        "focus-within:border-gray-300",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("every known exception is still in the code it excuses", () => {
    const modules: Map<string, string> = getModules();

    for (const [token, moduleKeys] of Object.entries(KNOWN_EXCEPTIONS)) {
      for (const moduleKey of moduleKeys) {
        expect({
          token,
          moduleKey,
          present: tokensIn(modules.get(moduleKey) || "").includes(token),
        }).toEqual({
          token,
          moduleKey,
          present: true,
        });
      }
      // And it really has no rule of its own, or it would not need excusing.
      expect({ token, remapped: isRemapped(token) }).toEqual({
        token,
        remapped: false,
      });
    }
  });
});
