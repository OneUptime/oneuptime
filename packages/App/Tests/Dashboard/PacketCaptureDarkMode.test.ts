import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Packet captures in the dark theme: the readiness notice and its settings,
 * the Start form's filter boxes, preview and errors, the captures list's
 * rows, progress bar and action error (Components/PacketCapture). The audit
 * log's Download badge is Enterprise code, held to Theme.css by ee's own
 * suite (ee/Tests/UI/AuditLogs/AuditLogDownloadEntry.test.tsx): this suite
 * runs without ee/.
 *
 * The dark theme does not use Tailwind's dark: variants. Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * (and per variant: `.bg-gray-50` does not cover `hover:bg-gray-50`). A
 * class it has no rule for keeps its light colour - a pale card glowing on
 * a slate page - and nothing fails. So this holds every colour class they
 * draw with to what Theme.css actually remaps.
 */

const COMPONENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "PacketCapture",
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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}

const COMPONENT_FILES: Array<string> = fs
  .readdirSync(COMPONENT_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".tsx");
  });

const COMPONENT_CODE: string = COMPONENT_FILES.map((name: string): string => {
  return code(path.join(COMPONENT_DIR, name));
}).join("\n");

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(THEME_CSS_PATH, "utf8")
  .replace(BLOCK_COMMENT, " ");

const STRING_LITERAL: RegExp = /"([^"\n]*)"|`([^`]*)`/g;
const TEMPLATE_VALUE: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;

// Every whitespace-separated token of every string literal in the code.
function stringTokens(source: string): Array<string> {
  const tokens: Array<string> = [];

  for (const match of source.matchAll(STRING_LITERAL)) {
    const text: string = (match[1] ?? match[2] ?? "").replace(
      TEMPLATE_VALUE,
      " ",
    );

    tokens.push(
      ...text.split(WHITESPACE).filter((token: string): boolean => {
        return token.length > 0;
      }),
    );
  }

  return tokens;
}

// The utility a token applies, after its variants.
function utilityOf(token: string): string {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let i: number = 0; i < token.length; i++) {
    const character: string = token[i]!;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = i;
    }
  }

  return token.slice(lastColon + 1);
}

const COLOR_UTILITY: RegExp =
  /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

// A mid-tone hue reads the same in both themes; a neutral grey does not.
const SOLID: RegExp =
  /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

const IDENTIFIER_CHAR: RegExp = /[\w-]/;
const SUBSTRING_VARIANT: RegExp = /\[class\*="([^"]+)"\]/g;
const BACKSLASH: RegExp = /\\/g;
const COLON: RegExp = /:/g;
const SLASH: RegExp = /\//g;
const TEMPLATED_COLOR: RegExp = /(?:bg|text|border|ring)-\$\{/;

// Interaction variants Theme.css remaps by prefix, e.g. [class*="hover:text-amber-"].
const SUBSTRING_VARIANTS: Array<string> = Array.from(
  THEME_CSS.matchAll(SUBSTRING_VARIANT),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
).filter((prefix: string): boolean => {
  return prefix.includes(":");
});

function isRemapped(token: string): boolean {
  const utility: string = utilityOf(token);

  // An unprefixed mid-tone hue; a prefixed one needs a rule of its own.
  if (utility === token && SOLID.test(utility)) {
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

  // A focus ring's mid-tone colour reads the same in both themes.
  if (
    (token.startsWith("focus-visible:") || token.startsWith("focus:")) &&
    SOLID.test(utility)
  ) {
    return true;
  }

  const escapedClass: string = token
    .replace(BACKSLASH, "\\\\")
    .replace(COLON, "\\:")
    .replace(SLASH, "\\/");
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

function colorTokens(source: string): Array<string> {
  return Array.from(
    new Set(
      stringTokens(source).filter((token: string): boolean => {
        return COLOR_UTILITY.test(utilityOf(token));
      }),
    ),
  );
}

describe("packet captures in the dark theme", () => {
  test("the scan reads every packet capture component", () => {
    expect(COMPONENT_FILES.sort()).toEqual([
      "DevicePacketCaptures.tsx",
      "PacketCaptureFilterInput.tsx",
      "PacketCaptureReadinessNotice.tsx",
      "PacketCapturesTable.tsx",
      "ProbePacketCaptures.tsx",
      "StartPacketCaptureModal.tsx",
    ]);
  });

  test("they use no dark: variants and build no colour class from a template", () => {
    expect(COMPONENT_CODE).not.toContain("dark:");
    expect(COMPONENT_CODE).not.toMatch(TEMPLATED_COLOR);
  });

  test("every colour class the components draw with is remapped for dark mode", () => {
    const tokens: Array<string> = colorTokens(COMPONENT_CODE);

    // The scan found their colours at all, so this is not vacuous.
    expect(tokens).toEqual(
      expect.arrayContaining([
        // The readiness notice and its settings.
        "border-gray-200",
        "bg-gray-50",
        "text-gray-900",
        "text-gray-600",
        // The filter preview and its errors.
        "text-red-600",
        "bg-gray-100",
        // The action error above the list.
        "border-red-200",
        "bg-red-50",
        "text-red-700",
      ]),
    );

    expect(
      tokens.filter((token: string): boolean => {
        return !isRemapped(token);
      }),
    ).toEqual([]);
  });
});
