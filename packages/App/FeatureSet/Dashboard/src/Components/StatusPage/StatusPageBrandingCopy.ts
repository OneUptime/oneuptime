import Color from "Common/Types/Color";
import { Green } from "Common/Types/BrandColors";
import { DEFAULT_STATUS_PAGE_LANGUAGE } from "Common/Types/StatusPage/StatusPageLanguage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A status page's Branding page (Status Pages -> a page -> Branding ->
 * Branding): everything that makes the page look like the company's own, on
 * one page.
 *
 * It used to be five screens - Essential Branding, Header, Footer, Overview
 * Page and Languages - beside an empty Navbar page no menu linked to, and
 * what people looked for was rarely where the names said: the logo was on
 * Header, the favicon on Essential Branding, the history chart's colors on
 * Overview Page. The cards are the same cards. The page puts first what
 * nearly everyone sets, in the order a visitor meets it (the logo and cover
 * image, the title and description, the favicon, the header's links, the
 * text at the top of the overview, the footer), and folds what few people
 * ever change under Advanced: the history chart's colors, the languages and
 * search engine indexing. The overall uptime % and what counts as downtime,
 * which were on Overview Page, are about what the page shows, so they are on
 * Advanced Settings now.
 *
 * Kept free of React so the page, its Search Engine Indexing card and
 * App/Tests read these exact strings. A new sentence is wrapped in
 * translationKey() so npm run i18n:extract finds it, and is translated in all
 * seventeen Dashboard locale files (App/Tests/Dashboard/
 * StatusPageBrandingOnePage checks).
 */

// The status page column the Branding page switches on and off.
export type BrandingSwitchColumn = "enableSearchEngineIndexing";

export const StatusPageBrandingCopy: {
  // Under the folded Advanced section's title, folded or open.
  advancedDescription: string;
  overviewDescriptionTitle: string;
  overviewDescriptionDescription: string;
  overviewDescriptionEditButton: string;
  languagesTitle: string;
  languagesDescription: string;
  languagesEditButton: string;
  searchEngineIndexingTitle: string;
  searchEngineIndexingDescription: string;
  searchEngineIndexingSwitchTitle: string;
  searchEngineIndexingSwitchDescription: string;
  notFound: string;
} = {
  advancedDescription: translationKey(
    "History chart colors, languages, and whether search engines may list this page.",
  ),
  overviewDescriptionTitle: translationKey("Overview Page Description"),
  overviewDescriptionDescription: translationKey(
    "Shown at the top of your status page's overview, above everything else. Markdown is supported.",
  ),
  overviewDescriptionEditButton: translationKey("Edit Description"),
  languagesTitle: translationKey("Languages"),
  languagesDescription: translationKey(
    "The language first-time visitors see, and the languages they can switch to in the footer.",
  ),
  languagesEditButton: translationKey("Edit Languages"),
  searchEngineIndexingTitle: translationKey("Search Engine Indexing"),
  searchEngineIndexingDescription: translationKey(
    "Control whether search engines like Google and Bing are allowed to list this status page in their results.",
  ),
  searchEngineIndexingSwitchTitle: translationKey(
    "Allow Search Engines to Index this Status Page",
  ),
  searchEngineIndexingSwitchDescription: translationKey(
    "On by default. Turn this off to keep the page reachable by anyone with the link while keeping it out of search results - OneUptime then serves the page with a noindex, nofollow robots directive. Search engines can take a few weeks to drop a page they have already indexed.",
  ),
  notFound: translationKey("Status page not found."),
};

// The data-testid of the Search Engine Indexing switch.
export const SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID: string =
  "branding-switch-enableSearchEngineIndexing";

// The data-testid of the Branding page's folded Advanced section.
export const BRANDING_ADVANCED_SECTION_TEST_ID: string =
  "status-page-branding-advanced";

/*
 * What the cards in the Advanced section hold, as each one has loaded it.
 * Anything not loaded yet is left out, and counts as untouched.
 */
export interface BrandingAdvancedValues {
  defaultBarColor?: Color | string | null | undefined;
  barColorRuleCount?: number | undefined;
  defaultLanguage?: string | null | undefined;
  enabledLanguages?: Array<string> | null | undefined;
  enableSearchEngineIndexing?: boolean | null | undefined;
}

/*
 * Whether the default bar color is one somebody chose. Every status page is
 * created with green (StatusPageService), and one without a color is drawn
 * green on the status page, so neither is a choice.
 */
export const isDefaultBarColorChosen: (
  color: Color | string | null | undefined,
) => boolean = (color: Color | string | null | undefined): boolean => {
  if (!color) {
    return false;
  }

  const chosen: string = color.toString().trim().toLowerCase();

  return chosen !== "" && chosen !== Green.toString().trim().toLowerCase();
};

/*
 * Whether anything in the Advanced section is set to something other than
 * what a new status page starts with, so the folded section says
 * "Configured" and folding never hides a setting that is in force: a chosen
 * default bar color, any bar color rule, a default language other than
 * English, a shorter list of languages, or search engines kept away.
 */
export const isBrandingAdvancedConfigured: (
  values: BrandingAdvancedValues,
) => boolean = (values: BrandingAdvancedValues): boolean => {
  if (isDefaultBarColorChosen(values.defaultBarColor)) {
    return true;
  }

  if ((values.barColorRuleCount || 0) > 0) {
    return true;
  }

  if (
    values.defaultLanguage &&
    values.defaultLanguage !== DEFAULT_STATUS_PAGE_LANGUAGE
  ) {
    return true;
  }

  if (values.enabledLanguages && values.enabledLanguages.length > 0) {
    return true;
  }

  // The column defaults to on and is not nullable: only false is off.
  return values.enableSearchEngineIndexing === false;
};

export default StatusPageBrandingCopy;
