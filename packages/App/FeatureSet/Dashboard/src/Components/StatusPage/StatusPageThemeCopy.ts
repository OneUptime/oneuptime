import Color from "Common/Types/Color";
import StatusPageTheme, {
  STATUS_PAGE_THEME_COLORS,
} from "Common/Types/StatusPage/StatusPageTheme";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { DARK_THEME_CARD } from "Common/Utils/StatusPage/StatusColorsOnDark";
import {
  PublicPageThemeCardCopy,
  PublicPageThemeChoice,
  getPublicPageThemeChoiceTestId,
  getPublicPageThemeErrorTestId,
} from "../PublicPageTheme/PublicPageThemeCopy";

/*
 * Theme, on a status page's Branding page (Status Pages -> a page ->
 * Branding -> Branding): how the page looks to its visitors - light, dark,
 * or as each visitor's device is set (Common/Types/StatusPage/
 * StatusPageTheme.ts). One choice of three, picked once and saved at once,
 * so it is three radio rows on a card of their own (StatusPageThemeCard,
 * which a public dashboard's Theme card shares: PublicPageThemeCard), right
 * under the logo the choice is made with.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract finds
 * it, and is translated in all seventeen Dashboard locale files.
 */

export const StatusPageThemeCopy: PublicPageThemeCardCopy & {
  // Under the choices, on a page with custom CSS or header / footer HTML.
  customCodeNote: string;
} = {
  title: translationKey("Theme"),
  description: translationKey("How your status page looks to visitors."),
  ariaLabel: translationKey("Status page theme"),
  customCodeNote: translationKey(
    "Your custom CSS and HTML apply in both themes. Start a CSS rule with html.dark to style only the dark theme.",
  ),
  notFound: translationKey("Status page not found."),
};

/*
 * The class the note names, written as code wherever it appears in the
 * note's sentence. Every translation keeps it as it is (App/Tests/Dashboard/
 * StatusPageThemeCopy.test.ts): it is what the CSS says, in any language.
 */
export const STATUS_PAGE_DARK_THEME_CSS_PREFIX: string = "html.dark";

export interface StatusPageThemeNotePart {
  text: string;
  // Drawn as code: the CSS prefix the note names.
  isCode: boolean;
}

/*
 * The custom code note, translated, cut into its words and the CSS prefix
 * it names, so the card draws the prefix as code.
 */
export const getStatusPageThemeNoteParts: (
  translatedNote: string,
) => Array<StatusPageThemeNotePart> = (
  translatedNote: string,
): Array<StatusPageThemeNotePart> => {
  const parts: Array<StatusPageThemeNotePart> = [];

  translatedNote
    .split(STATUS_PAGE_DARK_THEME_CSS_PREFIX)
    .forEach((text: string, index: number): void => {
      if (index > 0) {
        parts.push({ text: STATUS_PAGE_DARK_THEME_CSS_PREFIX, isCode: true });
      }

      if (text.length > 0) {
        parts.push({ text, isCode: false });
      }
    });

  return parts;
};

export type StatusPageThemeChoice = PublicPageThemeChoice;

/*
 * The three choices, in the order they are offered: the light page every
 * status page has been, the dark one, and the one that follows each
 * visitor. Each says only what visitors get, in a sentence or two, beside a
 * picture of the page in it (StatusPageThemePreview). None asks anything of
 * the owner's logo: the page has one, made for the light page and the
 * emails, and wherever the page is dark it sits on a light backdrop
 * (StatusPage's LogoPlate), so it reads on every choice as it is. A logo
 * made for dark backgrounds is optional, beside the logo on Branding, and
 * is shown there instead, with no backdrop.
 */
export const STATUS_PAGE_THEME_CHOICES: ReadonlyArray<StatusPageThemeChoice> = [
  {
    value: StatusPageTheme.Light,
    title: translationKey("Light"),
    description: translationKey("Every visitor sees the light page."),
  },
  {
    value: StatusPageTheme.Dark,
    title: translationKey("Dark"),
    description: translationKey("Every visitor sees the dark page."),
  },
  {
    value: StatusPageTheme.System,
    title: translationKey("Match each visitor's device"),
    description: translationKey(
      "Light or dark, as each visitor's device is set. Visitors can switch it in the footer.",
    ),
  },
];

/*
 * The colours of the pictures beside the choices (StatusPageThemePreview):
 * the status page's own, so the picture is the page. Plain colours, never
 * Tailwind classes, which the dashboard's own dark theme would remap.
 */
export interface StatusPageThemePreviewPalette {
  // The page behind everything.
  page: string;
  // The header's logo mark and the page's name beside it.
  mark: string;
  name: string;
  // A card of the overview, its edge and its title line.
  card: string;
  cardEdge: string;
  line: string;
  // Uptime bars: a day that was up, and one that was not.
  up: string;
  degraded: string;
}

export const getStatusPageThemePreviewPalettes: () => {
  light: StatusPageThemePreviewPalette;
  dark: StatusPageThemePreviewPalette;
} = (): {
  light: StatusPageThemePreviewPalette;
  dark: StatusPageThemePreviewPalette;
} => {
  return {
    light: {
      page: STATUS_PAGE_THEME_COLORS.light,
      mark: "#6366f1",
      name: "#9ca3af",
      card: "#ffffff",
      cardEdge: "#e5e7eb",
      line: "#d1d5db",
      up: "#22c55e",
      degraded: "#f59e0b",
    },
    dark: {
      page: STATUS_PAGE_THEME_COLORS.dark,
      mark: "#818cf8",
      name: "#64748b",
      // The dark theme's card (Theme.css --ou-surface-primary).
      card: Color.rgbToColor(DARK_THEME_CARD).toString().toLowerCase(),
      cardEdge: "#334155",
      line: "#475569",
      up: "#22c55e",
      degraded: "#f59e0b",
    },
  };
};

/*
 * The picture's frame, every public page's (PublicPageThemeCopy): a mid grey
 * that shows against the light card and the dark one alike, and the accent
 * colour around the choice in force, which reads at 3:1 on both.
 */
export {
  PUBLIC_PAGE_THEME_PREVIEW_EDGE as STATUS_PAGE_THEME_PREVIEW_EDGE,
  PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE as STATUS_PAGE_THEME_PREVIEW_SELECTED_EDGE,
  /*
   * The theme the page is drawn in, as the card reads it: a page with no
   * theme (made before the setting, or emptied through the API) is the
   * light page.
   */
  getShownPublicPageTheme as getShownStatusPageTheme,
} from "../PublicPageTheme/PublicPageThemeCopy";

// The card's data-testid.
export const STATUS_PAGE_THEME_CARD_TEST_ID: string = "status-page-theme";

// A choice's radio. Its row is `${id}-row`, its "Saved" `${id}-status`.
export const getStatusPageThemeChoiceTestId: (
  theme: StatusPageTheme,
) => string = (theme: StatusPageTheme): string => {
  return getPublicPageThemeChoiceTestId(STATUS_PAGE_THEME_CARD_TEST_ID, theme);
};

export const STATUS_PAGE_THEME_ERROR_TEST_ID: string =
  getPublicPageThemeErrorTestId(STATUS_PAGE_THEME_CARD_TEST_ID);

export const STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID: string =
  "status-page-theme-custom-code-note";

/*
 * Whether the page has custom code that is drawn on it: custom CSS, header
 * HTML or footer HTML. Custom JavaScript changes nothing a theme draws.
 */
export const hasStatusPageCustomCode: (page: {
  customCSS?: string | null | undefined;
  headerHTML?: string | null | undefined;
  footerHTML?: string | null | undefined;
}) => boolean = (page: {
  customCSS?: string | null | undefined;
  headerHTML?: string | null | undefined;
  footerHTML?: string | null | undefined;
}): boolean => {
  return [page.customCSS, page.headerHTML, page.footerHTML].some(
    (code: string | null | undefined): boolean => {
      return Boolean(code && code.trim().length > 0);
    },
  );
};

export default StatusPageThemeCopy;
