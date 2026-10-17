import Color, { RGB } from "../../Types/Color";
import {
  getContrastRatio,
  getReadableShade,
  parseColor,
} from "../ColorContrast";

/*
 * What a status colour - a monitor status, a group's rollup, an uptime bar's
 * rule colour, the default bar colour - is drawn in on the dark theme.
 *
 * These are colours people pick, for a light page: the recommended bar
 * colours step from a light green down to a very dark red (#7f1d1d), and a
 * status can be any hex at all. On the dark theme's cards the darkest of
 * them all but vanish - the very dark red is 1.6:1 against the card, where
 * it is 10:1 against white - so the day an outage lasted longest was the
 * hardest one to see.
 *
 * So the dark theme keeps every colour as it was picked wherever it already
 * reads, and moves only the ones that do not, keeping their hue:
 *
 *   - Text in a status colour (a status's name, an uptime percentage, a
 *     group's rollup) takes the nearest lighter shade that reads at WCAG
 *     AA, 4.5:1, against the card.
 *   - An uptime bar keeps its colour exactly - the colours are told apart by
 *     their lightness, for people with red-green colour blindness, and a
 *     lighter red would look like the orange next to it - and a bar that
 *     does not stand out from the card at WCAG's 3:1 for graphical objects
 *     gets a one-pixel edge in a lighter shade of its own colour that does.
 *
 * Pure and React-free: Common/UI/Utils/StatusColorStyle.ts turns these into
 * the styles the components draw, and the tests measure them.
 */

// --ou-surface-primary in the dark theme (Common/UI/Styles/Theme.css).
export const DARK_THEME_CARD: RGB = { red: 23, green: 32, blue: 51 };

// --ou-background-primary in the dark theme: the page under the cards.
export const DARK_THEME_PAGE: RGB = { red: 15, green: 23, blue: 42 };

// WCAG 2 AA for text.
export const STATUS_TEXT_MINIMUM_CONTRAST: number = 4.5;

// WCAG 2.1 SC 1.4.11, non-text contrast, for a bar's shape.
export const UPTIME_BAR_MINIMUM_CONTRAST: number = 3;

/*
 * Every bar of a 90-day strip, on every resource of a page, asks for the
 * same few colours, and working one out is a few dozen steps of a search,
 * so each colour is worked out once. Bounded, because colours are user data.
 */
const CACHE_LIMIT: number = 512;
const textCache: Map<string, string> = new Map();
const edgeCache: Map<string, string | null> = new Map();

function toHex(rgb: RGB): string {
  return Color.rgbToColor(rgb).toString().toLowerCase();
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }

  cache.set(key, value);

  return value;
}

/**
 * The colour status text is drawn in on the dark theme: the colour itself
 * when it reads at 4.5:1 on the dark card, the nearest lighter shade of it
 * that does otherwise. Null for a colour that cannot be read, which the
 * text then keeps as it is.
 */
export function getStatusTextColorOnDark(
  color: Color | string | null | undefined,
): string | null {
  const rgb: RGB | null = parseColor(color);

  if (!rgb) {
    return null;
  }

  const key: string = toHex(rgb);
  const cached: string | undefined = textCache.get(key);

  if (cached) {
    return cached;
  }

  return remember(
    textCache,
    key,
    toHex(
      getReadableShade({
        color: rgb,
        background: DARK_THEME_CARD,
        minimumContrast: STATUS_TEXT_MINIMUM_CONTRAST,
      }),
    ),
  );
}

/**
 * The edge an uptime bar gets on the dark theme: null when the bar's own
 * colour stands out from the dark card at 3:1 (it is drawn as it is), and
 * otherwise the nearest lighter shade of it that does, for a one-pixel edge
 * inside the bar.
 */
export function getUptimeBarEdgeOnDark(
  color: Color | string | null | undefined,
): string | null {
  const rgb: RGB | null = parseColor(color);

  if (!rgb) {
    return null;
  }

  const key: string = toHex(rgb);

  if (edgeCache.has(key)) {
    return edgeCache.get(key) || null;
  }

  if (getContrastRatio(rgb, DARK_THEME_CARD) >= UPTIME_BAR_MINIMUM_CONTRAST) {
    return remember(edgeCache, key, null);
  }

  return remember(
    edgeCache,
    key,
    toHex(
      getReadableShade({
        color: rgb,
        background: DARK_THEME_CARD,
        minimumContrast: UPTIME_BAR_MINIMUM_CONTRAST,
      }),
    ),
  );
}
