import PublicPageTheme, {
  PUBLIC_PAGE_THEME_FALLBACK,
  parsePublicPageTheme,
} from "Common/Types/Theme/PublicPageTheme";

/*
 * What every Theme card of a public page shares (PublicPageThemeCard): a
 * status page's (Status Pages -> a page -> Branding) and a public
 * dashboard's (Dashboards -> a dashboard -> Branding). One choice of three -
 * Light, Dark, or as each visitor's device is set
 * (Common/Types/Theme/PublicPageTheme.ts) - picked once and saved at once,
 * each beside a small picture of the page in it (PublicPageThemePreview).
 * The words and the pictures are each page's own.
 *
 * Kept free of React so the cards and App/Tests read these exact values.
 */

export interface PublicPageThemeChoice {
  value: PublicPageTheme;
  title: string;
  description: string;
}

// The words a Theme card is drawn with.
export interface PublicPageThemeCardCopy {
  title: string;
  description: string;
  // The radio group's accessible name.
  ariaLabel: string;
  // When the page or dashboard the card is about is not there.
  notFound: string;
}

/*
 * The picture's frame: a mid grey that shows against the light card and the
 * dark one alike, so the light picture has an edge on the light dashboard
 * and the dark picture on the dark one. The choice in force is framed in the
 * accent colour, which reads at 3:1 on both.
 */
export const PUBLIC_PAGE_THEME_PREVIEW_EDGE: string = "rgb(148 163 184 / 60%)";
export const PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE: string = "#6366f1";

/*
 * The theme a page is drawn in, as a card reads it: a page with no theme
 * (made before the setting, or emptied through the API) is the light page.
 */
export const getShownPublicPageTheme: (value: unknown) => PublicPageTheme = (
  value: unknown,
): PublicPageTheme => {
  if (value === undefined || value === null) {
    return PUBLIC_PAGE_THEME_FALLBACK;
  }

  return parsePublicPageTheme(value);
};

/*
 * The test ids of a Theme card, from the card's own (`testId`): its
 * choices' group `${testId}-choices`, the reason a pick was refused
 * `${testId}-error`, and a choice's radio `${testId}-<theme>`, whose row is
 * `-row`, its picture `-visual` and its "Saved" `-status`.
 */
export const getPublicPageThemeChoiceTestId: (
  testId: string,
  theme: PublicPageTheme,
) => string = (testId: string, theme: PublicPageTheme): string => {
  return `${testId}-${theme.toLowerCase()}`;
};

export const getPublicPageThemeChoicesTestId: (testId: string) => string = (
  testId: string,
): string => {
  return `${testId}-choices`;
};

export const getPublicPageThemeErrorTestId: (testId: string) => string = (
  testId: string,
): string => {
  return `${testId}-error`;
};
