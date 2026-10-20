import DashboardTheme, {
  DASHBOARD_THEME_COLORS,
} from "Common/Types/Dashboard/DashboardTheme";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { DARK_THEME_CARD } from "Common/Utils/StatusPage/StatusColorsOnDark";
import Color from "Common/Types/Color";
import {
  PublicPageThemeCardCopy,
  PublicPageThemeChoice,
  getPublicPageThemeChoiceTestId,
  getPublicPageThemeErrorTestId,
} from "../../PublicPageTheme/PublicPageThemeCopy";

/*
 * Theme, on a dashboard's Branding page (Dashboards -> a dashboard ->
 * Branding): how the dashboard looks to the visitors of its public link -
 * light, dark, or as each visitor's device is set (Common/Types/Dashboard/
 * DashboardTheme.ts). One choice of three, picked once and saved at once,
 * so it is three radio rows on a card of their own (DashboardThemeCard,
 * every public page's Theme card: PublicPageThemeCard), right under the
 * logo, each beside a small picture of a dashboard in it
 * (DashboardThemePreview).
 *
 * Every visitor can switch between light and dark from the dashboard's
 * toolbar, whatever the theme, so the card says once that they can, and
 * each choice says what visitors see when they open the dashboard.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract finds
 * it, and is translated in all seventeen Dashboard locale files.
 */

export const DashboardThemeCopy: PublicPageThemeCardCopy = {
  title: translationKey("Theme"),
  description: translationKey(
    "How your public dashboard looks to visitors. They can switch it from its toolbar.",
  ),
  ariaLabel: translationKey("Public dashboard theme"),
  notFound: translationKey("Dashboard not found."),
};

export type DashboardThemeChoice = PublicPageThemeChoice;

/*
 * The three choices, in the order they are offered: the light dashboard
 * every public dashboard has been, the dark one, and the one that follows
 * each visitor. Each says only what visitors see first, in one sentence.
 * None asks anything of the logo: wherever the page is dark, it sits on a
 * light backdrop (PublicDashboard's LogoPlate).
 */
export const DASHBOARD_THEME_CHOICES: ReadonlyArray<DashboardThemeChoice> = [
  {
    value: DashboardTheme.Light,
    title: translationKey("Light"),
    description: translationKey("Visitors see the light dashboard."),
  },
  {
    value: DashboardTheme.Dark,
    title: translationKey("Dark"),
    description: translationKey("Visitors see the dark dashboard."),
  },
  {
    value: DashboardTheme.System,
    title: translationKey("Match each visitor's device"),
    description: translationKey(
      "Light or dark, as each visitor's device is set.",
    ),
  },
];

/*
 * The colours of the pictures beside the choices (DashboardThemePreview):
 * the public dashboard's own, so the picture is the page. Plain colours,
 * never Tailwind classes, which the dashboard's own dark theme would remap.
 */
export interface DashboardThemePreviewPalette {
  // The page behind everything.
  page: string;
  // The header across the top, the logo's mark and the dashboard's name.
  header: string;
  mark: string;
  name: string;
  // A widget, its edge and its label line.
  card: string;
  cardEdge: string;
  line: string;
  // What the widgets show: a value, a chart's line and a second series.
  value: string;
  series: string;
  secondSeries: string;
}

export const getDashboardThemePreviewPalettes: () => {
  light: DashboardThemePreviewPalette;
  dark: DashboardThemePreviewPalette;
} = (): {
  light: DashboardThemePreviewPalette;
  dark: DashboardThemePreviewPalette;
} => {
  // The dark theme's card (Theme.css --ou-surface-primary).
  const darkCard: string = Color.rgbToColor(DARK_THEME_CARD)
    .toString()
    .toLowerCase();

  return {
    light: {
      page: DASHBOARD_THEME_COLORS.light,
      header: "#ffffff",
      mark: "#6366f1",
      name: "#9ca3af",
      card: "#ffffff",
      cardEdge: "#e5e7eb",
      line: "#d1d5db",
      value: "#374151",
      series: "#6366f1",
      secondSeries: "#10b981",
    },
    dark: {
      page: DASHBOARD_THEME_COLORS.dark,
      header: darkCard,
      mark: "#818cf8",
      name: "#64748b",
      card: darkCard,
      cardEdge: "#334155",
      line: "#475569",
      value: "#e2e8f0",
      series: "#818cf8",
      secondSeries: "#34d399",
    },
  };
};

// The card's data-testid.
export const DASHBOARD_THEME_CARD_TEST_ID: string = "dashboard-theme";

// A choice's radio. Its row is `${id}-row`, its "Saved" `${id}-status`.
export const getDashboardThemeChoiceTestId: (
  theme: DashboardTheme,
) => string = (theme: DashboardTheme): string => {
  return getPublicPageThemeChoiceTestId(DASHBOARD_THEME_CARD_TEST_ID, theme);
};

export const DASHBOARD_THEME_ERROR_TEST_ID: string =
  getPublicPageThemeErrorTestId(DASHBOARD_THEME_CARD_TEST_ID);

export default DashboardThemeCopy;
