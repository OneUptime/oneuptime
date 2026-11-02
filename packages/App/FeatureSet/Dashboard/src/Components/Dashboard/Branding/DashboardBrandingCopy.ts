import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a dashboard's Branding page (Dashboards -> a dashboard ->
 * Branding) about its logos: the logo, made for the public dashboard's
 * light page, and the Dark Theme Logo, made for a dark background and shown
 * instead of the logo wherever the public dashboard is dark. Without a dark
 * theme logo, the logo sits on a small light backdrop there.
 *
 * The status page's Branding page says the same of a status page
 * (StatusPageBrandingCopy); the line a dashboard with no dark theme logo
 * shows, the dark theme logo's title, and both logos' placeholders, are the
 * status page's own words, already in every language.
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 * A new sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it, and is translated in all seventeen Dashboard locale files.
 */
export const DashboardBrandingCopy: {
  // The Logo card's description, and the logo's in its edit dialog.
  logoDescription: string;
  // The dark theme logo's, in the edit dialog.
  darkThemeLogoDescription: string;
  // The card's line while the dashboard has no dark theme logo.
  noDarkThemeLogo: string;
  // The logo's, in the edit dialog: in the words its dark sibling's is.
  logoPlaceholder: string;
  darkThemeLogoTitle: string;
  darkThemeLogoPlaceholder: string;
} = {
  logoDescription: translationKey("Shown in your public dashboard's header."),
  darkThemeLogoDescription: translationKey(
    "Shown instead of the logo where your public dashboard is dark. Without one, the logo is shown on a light backdrop there.",
  ),
  noDarkThemeLogo: translationKey(
    "None. The logo is shown on a light backdrop.",
  ),
  logoPlaceholder: translationKey("Upload logo"),
  darkThemeLogoTitle: translationKey("Dark Theme Logo"),
  darkThemeLogoPlaceholder: translationKey("Upload logo for the dark theme"),
};

export default DashboardBrandingCopy;
