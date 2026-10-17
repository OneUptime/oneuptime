import StatusPageTheme, {
  STATUS_PAGE_THEME_FALLBACK,
  parseStatusPageTheme,
} from "Common/Types/StatusPage/StatusPageTheme";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Theme, on a status page's Branding page (Status Pages -> a page ->
 * Branding -> Branding): how the page looks to its visitors - light, dark,
 * or as each visitor's device is set (Common/Types/StatusPage/
 * StatusPageTheme.ts). One choice of three, picked once and saved at once,
 * so it is three radio rows on a card of their own (StatusPageThemeCard),
 * right under the logo the choice is made with.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract finds
 * it, and is translated in all seventeen Dashboard locale files.
 */

export const StatusPageThemeCopy: {
  title: string;
  description: string;
  // The radio group's accessible name.
  ariaLabel: string;
  // Under the choices, on a page with custom CSS or header / footer HTML.
  customCodeNote: string;
  notFound: string;
} = {
  title: translationKey("Theme"),
  description: translationKey("How your status page looks to visitors."),
  ariaLabel: translationKey("Status page theme"),
  customCodeNote: translationKey(
    "Your custom CSS and HTML apply in both themes. Start a CSS rule with html.dark to style only the dark theme.",
  ),
  notFound: translationKey("Status page not found."),
};

export interface StatusPageThemeChoice {
  value: StatusPageTheme;
  title: string;
  description: string;
}

/*
 * The three choices, in the order they are offered: the light page every
 * status page has been, the dark one, and the one that follows each
 * visitor. What a dark page does with the page's one logo is said where it
 * matters: a Dark page shows it as it is, so its owner is told to use one
 * made for a dark background; a page that follows the visitor puts it on a
 * light backdrop on the dark page (StatusPage's LogoPlate).
 */
export const STATUS_PAGE_THEME_CHOICES: ReadonlyArray<StatusPageThemeChoice> =
  [
    {
      value: StatusPageTheme.Light,
      title: translationKey("Light"),
      description: translationKey("Every visitor sees the light page."),
    },
    {
      value: StatusPageTheme.Dark,
      title: translationKey("Dark"),
      description: translationKey(
        "Every visitor sees the dark page. Use a logo made for a dark background.",
      ),
    },
    {
      value: StatusPageTheme.System,
      title: translationKey("Match each visitor's device"),
      description: translationKey(
        "Light or dark, as each visitor's device is set. Visitors can switch it in the page's footer, and your logo gets a light backdrop on the dark page.",
      ),
    },
  ];

// The card's data-testid.
export const STATUS_PAGE_THEME_CARD_TEST_ID: string = "status-page-theme";

// A choice's radio. Its row is `${id}-row`, its "Saved" `${id}-status`.
export const getStatusPageThemeChoiceTestId: (
  theme: StatusPageTheme,
) => string = (theme: StatusPageTheme): string => {
  return `status-page-theme-${theme.toLowerCase()}`;
};

export const STATUS_PAGE_THEME_ERROR_TEST_ID: string =
  "status-page-theme-error";

export const STATUS_PAGE_THEME_CUSTOM_CODE_NOTE_TEST_ID: string =
  "status-page-theme-custom-code-note";

/*
 * The theme the page is drawn in, as the card reads it: a page with no theme
 * (made before the setting, or emptied through the API) is the light page.
 */
export const getShownStatusPageTheme: (value: unknown) => StatusPageTheme = (
  value: unknown,
): StatusPageTheme => {
  if (value === undefined || value === null) {
    return STATUS_PAGE_THEME_FALLBACK;
  }

  return parseStatusPageTheme(value);
};

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
