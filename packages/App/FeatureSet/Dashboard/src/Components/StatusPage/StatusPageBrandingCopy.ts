import Color from "Common/Types/Color";
import { Green } from "Common/Types/BrandColors";
import { DEFAULT_STATUS_PAGE_LANGUAGE } from "Common/Types/StatusPage/StatusPageLanguage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import {
  HistoryChartBarColorRuleInput,
  isRecommendedHistoryChartBarColorRuleSet,
} from "Common/Utils/StatusPage/HistoryChartBarColors";

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
 * ever change under More settings: the history chart's colors, the
 * languages and search engine indexing. The overall uptime % and what counts as downtime,
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
  /*
   * The cards everyone sets, each saying what it changes for a visitor:
   * they said "These will show up on your status page.", "Favicon will be
   * used for SEO." (it is the browser tab's icon) and "Header Links for
   * your status page", and two lists said "No status header link for this
   * status page."
   */
  imagesDescription: string;
  /*
   * The two logos in the Edit Images dialog, each saying where it is shown -
   * the logo said only "Status Page Logo", right above a logo for the dark
   * theme - and the card's line while the page has no dark theme logo.
   */
  logoDescription: string;
  darkThemeLogoDescription: string;
  noDarkThemeLogo: string;
  titleDescription: string;
  pageTitlePlaceholder: string;
  pageDescriptionPlaceholder: string;
  faviconDescription: string;
  headerLinksDescription: string;
  headerLink: string;
  headerLinks: string;
  headerLinkTitlePlaceholder: string;
  copyrightDescription: string;
  footerLinksDescription: string;
  footerLink: string;
  footerLinks: string;
  footerLinkTitlePlaceholder: string;
  // The Title and Description card's dialog, named like the others.
  titleEditTitle: string;
  // Under the More settings section's title, once it is open.
  advancedDescription: string;
  // The cards under More settings, as its folded header names them.
  defaultBarColorTitle: string;
  barColorRulesTitle: string;
  // The history chart's cards, and the preview under them (issue #486).
  defaultBarColorDescription: string;
  barColorRulesDescription: string;
  barColorRulesEmptyTitle: string;
  barColorRulesEmptyDescription: string;
  useRecommendedRules: string;
  barColorPreviewTitle: string;
  barColorPreviewDescription: string;
  fullColorVision: string;
  deuteranopia: string;
  protanopia: string;
  noData: string;
  uptimePercentOrMore: string;
  uptimeUnderPercent: string;
  withoutRules: string;
  lookAlike: string;
  shadowedRule: string;
  noRuleMatches: string;
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
  imagesDescription: translationKey("Shown at the top of your status page."),
  logoDescription: translationKey(
    "Shown on your status page and in the emails it sends.",
  ),
  darkThemeLogoDescription: translationKey(
    "Shown instead of the logo where your status page is dark. Without one, the logo is shown on a light backdrop there.",
  ),
  noDarkThemeLogo: translationKey(
    "None. The logo is shown on a light backdrop.",
  ),
  titleDescription: translationKey(
    "Its name in the browser tab and in subscriber emails, and the description search engines show.",
  ),
  pageTitlePlaceholder: translationKey("e.g., Acme Status"),
  pageDescriptionPlaceholder: translationKey(
    "e.g., Live status of Acme's website and API.",
  ),
  faviconDescription: translationKey("The small icon in the browser tab."),
  headerLinksDescription: translationKey(
    "Links at the top of your status page, such as your website or support.",
  ),
  headerLink: translationKey("Header Link"),
  headerLinks: translationKey("Header Links"),
  headerLinkTitlePlaceholder: translationKey("e.g., Support"),
  copyrightDescription: translationKey(
    "The line at the bottom of your status page, such as Acme, Inc.",
  ),
  footerLinksDescription: translationKey(
    "Links at the bottom of your status page, such as your terms or privacy policy.",
  ),
  footerLink: translationKey("Footer Link"),
  footerLinks: translationKey("Footer Links"),
  footerLinkTitlePlaceholder: translationKey("e.g., Privacy Policy"),
  titleEditTitle: translationKey("Edit Title and Description"),
  advancedDescription: translationKey(
    "History chart colors, languages, and whether search engines may list this page.",
  ),
  defaultBarColorTitle: translationKey("Default Bar Color"),
  barColorRulesTitle: translationKey("Bar Color Rules"),
  defaultBarColorDescription: translationKey(
    "The color of a day that no bar color rule matches. A day with no monitoring data is always drawn gray and striped.",
  ),
  barColorRulesDescription: translationKey(
    "Each bar of the uptime history is a day. Rules color a day by its uptime: they are checked from the top, and the first one the day's uptime reaches sets its color.",
  ),
  barColorRulesEmptyTitle: translationKey("No bar color rules"),
  barColorRulesEmptyDescription: translationKey(
    "Each day takes the color of the most severe monitor status it had, even if only for a minute. The recommended rules color a day by how long it was down, in colors that people with red-green color blindness can tell apart.",
  ),
  useRecommendedRules: translationKey("Use Recommended Rules"),
  barColorPreviewTitle: translationKey("Bar Color Preview"),
  barColorPreviewDescription: translationKey(
    "How each kind of day looks on your status page: as most people see it, and as people with red-green color blindness see it.",
  ),
  fullColorVision: translationKey("Full color vision"),
  deuteranopia: translationKey("Deuteranopia (red-green)"),
  protanopia: translationKey("Protanopia (red-green)"),
  noData: translationKey("No data"),
  uptimePercentOrMore: translationKey("{{percent}}% or more"),
  uptimeUnderPercent: translationKey("Under {{percent}}%"),
  withoutRules: translationKey(
    "Without rules, a day takes the color of the most severe monitor status it had, even if only for a minute.",
  ),
  lookAlike: translationKey(
    "{{first}} and {{second}} look alike to people with red-green color blindness.",
  ),
  shadowedRule: translationKey(
    "The {{percent}}% rule never colors a day: a rule above it already matches every day it would. Drag it higher.",
  ),
  noRuleMatches: translationKey(
    "A day under {{percent}}% uptime matches no rule, so it takes the default bar color.",
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
    "Control whether search engines like Google and Bing may list this status page on its custom domains. Its preview URL is never listed.",
  ),
  searchEngineIndexingSwitchTitle: translationKey(
    "Allow Search Engines to Index this Status Page",
  ),
  searchEngineIndexingSwitchDescription: translationKey(
    "Search engines may list this page in their results. After you turn it off, they can take a few weeks to drop it.",
  ),
  notFound: translationKey("Status page not found."),
};

// The data-testid of the Search Engine Indexing switch.
export const SEARCH_ENGINE_INDEXING_SWITCH_TEST_ID: string =
  "branding-switch-enableSearchEngineIndexing";

// The data-testid of the Branding page's folded More settings section.
export const BRANDING_ADVANCED_SECTION_TEST_ID: string =
  "status-page-branding-advanced";

// The data-testid of Use Recommended Rules, under an empty rules table.
export const USE_RECOMMENDED_RULES_EMPTY_STATE_TEST_ID: string =
  "use-recommended-bar-color-rules";

/*
 * What the cards in the Advanced section hold, as each one has loaded it.
 * Anything not loaded yet is left out, and counts as untouched.
 */
export interface BrandingAdvancedValues {
  defaultBarColor?: Color | string | null | undefined;
  barColorRuleCount?: number | undefined;
  // The rules themselves, in their order, as the rules table loaded them.
  barColorRules?: ReadonlyArray<HistoryChartBarColorRuleInput> | undefined;
  defaultLanguage?: string | null | undefined;
  enabledLanguages?: Array<string> | null | undefined;
  enableSearchEngineIndexing?: boolean | null | undefined;
}

/*
 * Whether the bar color rules are some somebody chose. A page made in the
 * dashboard starts with the recommended ones (StatusPageService), and an
 * older page, or one made from Terraform, with none: neither is a choice.
 * Rules not loaded yet count as chosen when there are any, as they always
 * did.
 */
export const areBarColorRulesChosen: (
  values: BrandingAdvancedValues,
) => boolean = (values: BrandingAdvancedValues): boolean => {
  const ruleCount: number = values.barColorRuleCount || 0;

  if (ruleCount === 0) {
    return false;
  }

  return !(
    values.barColorRules &&
    values.barColorRules.length === ruleCount &&
    isRecommendedHistoryChartBarColorRuleSet(values.barColorRules)
  );
};

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
 * Whether the languages differ from what a new status page starts with: a
 * default language other than English, or a shorter list to switch to.
 */
export const areBrandingLanguagesChosen: (
  values: BrandingAdvancedValues,
) => boolean = (values: BrandingAdvancedValues): boolean => {
  if (
    values.defaultLanguage &&
    values.defaultLanguage !== DEFAULT_STATUS_PAGE_LANGUAGE
  ) {
    return true;
  }

  return Boolean(values.enabledLanguages && values.enabledLanguages.length > 0);
};

/*
 * What the folded More settings header lists: its four cards, each a chip
 * once it differs from what a new status page starts with, so folding
 * never hides a setting in force.
 */
export const getBrandingAdvancedItems: (
  values: BrandingAdvancedValues,
) => Array<FoldedSectionItem> = (
  values: BrandingAdvancedValues,
): Array<FoldedSectionItem> => {
  const ruleCount: number = values.barColorRuleCount || 0;

  return [
    foldedSectionItem(StatusPageBrandingCopy.defaultBarColorTitle, {
      isSet: isDefaultBarColorChosen(values.defaultBarColor),
    }),
    foldedSectionItem(StatusPageBrandingCopy.barColorRulesTitle, {
      isSet: areBarColorRulesChosen(values),
      value: String(ruleCount),
    }),
    foldedSectionItem(StatusPageBrandingCopy.languagesTitle, {
      isSet: areBrandingLanguagesChosen(values),
    }),
    foldedSectionItem(StatusPageBrandingCopy.searchEngineIndexingTitle, {
      // The column defaults to on and is not nullable: only false is off.
      isSet: values.enableSearchEngineIndexing === false,
      value: translationKey("Off"),
      translateValue: true,
    }),
  ];
};

/*
 * Whether anything in the More settings section is set to something other
 * than what a new status page starts with: a chosen default bar color, bar
 * color rules other than the recommended ones, a default language other
 * than English, a shorter list of languages, or search engines kept away.
 */
export const isBrandingAdvancedConfigured: (
  values: BrandingAdvancedValues,
) => boolean = (values: BrandingAdvancedValues): boolean => {
  if (isDefaultBarColorChosen(values.defaultBarColor)) {
    return true;
  }

  if (areBarColorRulesChosen(values)) {
    return true;
  }

  if (areBrandingLanguagesChosen(values)) {
    return true;
  }

  // The column defaults to on and is not nullable: only false is off.
  return values.enableSearchEngineIndexing === false;
};

export default StatusPageBrandingCopy;
