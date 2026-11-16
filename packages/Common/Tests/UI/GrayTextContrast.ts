import fs from "fs";
import path from "path";
import { RGB } from "../../Types/Color";
import { getContrastRatio, parseColor } from "../../Utils/ColorContrast";

/*
 * How a Tailwind gray text class reads, without a browser: the colour the
 * palette paints it on a light page, and the colour Theme.css repaints it in
 * the dark theme, each against the surfaces quiet text sits on. For the
 * tests that hold a quiet text's class list to WCAG AA's 4.5:1 for text (a
 * status page's event card, the shared Banner).
 */

// Tailwind 3.4's grays, as every app's Tailwind build paints them.
export const TAILWIND_GRAYS: Record<string, string> = {
  "gray-50": "#f9fafb",
  "gray-100": "#f3f4f6",
  "gray-200": "#e5e7eb",
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "gray-600": "#4b5563",
  "gray-700": "#374151",
  "gray-800": "#1f2937",
  "gray-900": "#111827",
};

export const WCAG_AA_TEXT: number = 4.5;

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "../../UI/Styles/Theme.css"),
  "utf8",
);

export function rgb(color: string): RGB {
  const parsed: RGB | null = parseColor(color);

  if (!parsed) {
    throw new Error(`Not a colour: ${color}`);
  }

  return parsed;
}

// The gray shade ("600") a class list names with a prefix ("text-gray-").
export function shadeOf(className: string, prefix: string): string {
  const token: string | undefined = className
    .split(" ")
    .find((part: string): boolean => {
      return part.startsWith(prefix);
    });

  if (!token) {
    throw new Error(`No ${prefix} class in "${className}"`);
  }

  return token.slice(prefix.length);
}

// The colour Tailwind paints a gray shade on a light page.
export function lightGray(shade: string): string {
  const hex: string | undefined = TAILWIND_GRAYS[`gray-${shade}`];

  if (!hex) {
    throw new Error(`Not a gray Tailwind paints: gray-${shade}`);
  }

  return hex;
}

// The body of the first rule whose selector is exactly `selector`.
function ruleBody(selector: string): string {
  const start: number = THEME_CSS.indexOf(`${selector} {`);

  if (start === -1) {
    throw new Error(`Theme.css has no "${selector}" rule`);
  }

  const open: number = THEME_CSS.indexOf("{", start);
  const close: number = THEME_CSS.indexOf("}", open);

  return THEME_CSS.slice(open + 1, close);
}

// A custom property's value in a rule's body.
function tokenIn(body: string, token: string): string {
  const at: number = body.indexOf(`${token}:`);

  if (at === -1) {
    throw new Error(`No ${token} in the rule`);
  }

  const end: number = body.indexOf(";", at);

  return body.slice(at + token.length + 1, end).trim();
}

// The colour Theme.css gives a gray text class in the dark theme.
export function darkTextColorOf(shade: string): string {
  const selector: string = `html.dark :is(.text-gray-${shade}`;
  const at: number = THEME_CSS.indexOf(selector);

  if (at === -1) {
    throw new Error(
      `Theme.css repaints no .text-gray-${shade} in the dark theme`,
    );
  }

  const open: number = THEME_CSS.indexOf("{", at);
  const close: number = THEME_CSS.indexOf("}", open);
  const declaration: string = THEME_CSS.slice(open + 1, close)
    .replace("!important", "")
    .trim();
  const value: string = declaration
    .slice(declaration.indexOf(":") + 1, declaration.indexOf(";"))
    .trim();

  if (value.startsWith("var(")) {
    const token: string = value.slice(4, value.indexOf(")")).trim();
    return tokenIn(ruleBody("html.dark"), token);
  }

  return value;
}

export const LIGHT_SURFACES: Array<[string, string]> = [
  ["a white card", "#ffffff"],
  ["a gray-50 page", TAILWIND_GRAYS["gray-50"]!],
];

export const DARK_SURFACES: Array<[string, string]> = [
  ["the dark card", tokenIn(ruleBody("html.dark"), "--ou-surface-primary")],
  ["a dark panel", tokenIn(ruleBody("html.dark"), "--ou-surface-secondary")],
  ["the dark page", tokenIn(ruleBody("html.dark"), "--ou-background-primary")],
];

// The contrast of a gray shade's text on a light surface.
export function lightContrastOf(shade: string, surface: string): number {
  return getContrastRatio(rgb(lightGray(shade)), rgb(surface));
}

// The contrast of a gray shade's text, as the dark theme paints it.
export function darkContrastOf(shade: string, surface: string): number {
  return getContrastRatio(rgb(darkTextColorOf(shade)), rgb(surface));
}

// A class list that names a gray this light or lighter: gray-400 is 2.5:1.
export const TOO_LIGHT_GRAY_TEXT: RegExp =
  /(^|\s)text-gray-(50|100|200|300|400)(\s|$)/;
