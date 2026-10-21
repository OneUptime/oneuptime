/*
 * Colours for the printed map.
 *
 * The live map paints with the theme: neutral strokes are CSS variables
 * with a light-mode fallback ("var(--ou-chart-series-neutral, #64748b)"),
 * so they follow the reader into dark mode. A PDF has no theme. It is a
 * document handed to somebody else, printed on white paper, and it must
 * read the same whoever exported it and whatever their dashboard looked
 * like at the time — so every colour is resolved to its LIGHT value here,
 * and nothing about the viewer's theme ever reaches the file.
 */

// What a colour the export cannot read is drawn as: the map's muted grey.
export const PRINT_FALLBACK_COLOR: string = "#6b7280";

// The paper.
export const PRINT_PAPER_COLOR: string = "#ffffff";

const CSS_VARIABLE_WITH_FALLBACK: RegExp =
  /^var\(\s*--[A-Za-z0-9_-]+\s*,\s*(.+)\)$/;
const SHORT_HEX_COLOR: RegExp = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
const LONG_HEX_COLOR: RegExp = /^#[0-9a-fA-F]{6}$/;

/**
 * The light-mode hex value of a colour the map paints with.
 *
 * "var(--x, #abc)" resolves to its fallback (nested variables included),
 * "#abc" expands to "#aabbcc", and anything else — a variable with no
 * fallback, a named colour, an empty string — becomes `fallback`. The
 * result is always lower-case "#rrggbb".
 */
export function resolvePrintColor(
  color: string | null | undefined,
  fallback: string = PRINT_FALLBACK_COLOR,
): string {
  let value: string = (color || "").trim();

  // Bounded, so a malformed nested value cannot loop.
  for (let depth: number = 0; depth < 8; depth++) {
    const variable: RegExpMatchArray | null = value.match(
      CSS_VARIABLE_WITH_FALLBACK,
    );
    if (!variable) {
      break;
    }
    value = (variable[1] || "").trim();
  }

  const short: RegExpMatchArray | null = value.match(SHORT_HEX_COLOR);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  }
  if (LONG_HEX_COLOR.test(value)) {
    return value.toLowerCase();
  }
  return fallback === PRINT_FALLBACK_COLOR
    ? PRINT_FALLBACK_COLOR
    : resolvePrintColor(fallback, PRINT_FALLBACK_COLOR);
}

/** An opacity as PDF takes it: a number from 0 to 1, opaque when unknown. */
export function clampOpacity(opacity: number | null | undefined): number {
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) {
    return 1;
  }
  return Math.max(0, Math.min(1, opacity));
}
