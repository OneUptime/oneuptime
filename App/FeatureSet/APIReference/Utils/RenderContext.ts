import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
  makeT,
  SUPPORTED_DOCS_LANGUAGES,
  TranslateFn,
} from "./I18n";
import {
  buildReferenceNavigation,
  buildSearchIndex,
  findAdjacentPages,
  findNavLocation,
  ReferenceNavAdjacent,
  ReferenceNavLocation,
  ReferenceNavSection,
  ReferenceSearchEntry,
} from "./Navigation";
import DataTypeUtil from "./DataTypes";
import ResourceUtil from "./Resources";
import Dictionary from "Common/Types/Dictionary";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

export interface ReferenceRenderContext {
  lang: string;
  t: TranslateFn;
  supportedLanguages: typeof SUPPORTED_DOCS_LANGUAGES;
  currentPath: string;
  /*
   * Master admin APIs only exist for operators who run their own instance, so
   * the page and its nav links are hidden on the billing-enabled (SaaS) build —
   * the same rule Resources.ts applies to master-admin model docs.
   */
  showMasterAdminApis: boolean;
  /** Last URL segment, e.g. "introduction" or "monitor". "" when there is none. */
  currentPage: string;
  /** The sidebar, the mobile drawer and the command palette all read this. */
  navSections: Array<ReferenceNavSection>;
  /** Flat, section-tagged list the command palette filters over. */
  searchIndex: Array<ReferenceSearchEntry>;
  /** Previous/next links for the pager. Both null on pages outside the nav. */
  pager: ReferenceNavAdjacent;
  /** Where the current page sits in the tree; null for pages outside it. */
  currentLocation: ReferenceNavLocation | null;
}

/*
 * Navigation is identical for every request in a language, and building it
 * instantiates every documented model, so it is built once per language and
 * held. The registries it reads are fixed at boot.
 */
const navigationCache: Dictionary<Array<ReferenceNavSection>> = {};
const searchIndexCache: Dictionary<Array<ReferenceSearchEntry>> = {};

export function getNavigationForLanguage(
  lang: string,
): Array<ReferenceNavSection> {
  const cached: Array<ReferenceNavSection> | undefined = navigationCache[lang];

  if (cached) {
    return cached;
  }

  const sections: Array<ReferenceNavSection> = buildReferenceNavigation({
    t: makeT(lang),
    resources: ResourceUtil.getResources(),
    dataTypes: DataTypeUtil.getDataTypes(),
    showMasterAdminApis: !IsBillingEnabled,
  });

  navigationCache[lang] = sections;

  return sections;
}

export function getSearchIndexForLanguage(
  lang: string,
): Array<ReferenceSearchEntry> {
  const cached: Array<ReferenceSearchEntry> | undefined =
    searchIndexCache[lang];

  if (cached) {
    return cached;
  }

  const index: Array<ReferenceSearchEntry> = buildSearchIndex(
    getNavigationForLanguage(lang),
  );

  searchIndexCache[lang] = index;

  return index;
}

/** Only used by tests, which build navigation for several languages in one process. */
export function clearNavigationCaches(): void {
  for (const key of Object.keys(navigationCache)) {
    delete navigationCache[key];
  }

  for (const key of Object.keys(searchIndexCache)) {
    delete searchIndexCache[key];
  }
}

/*
 * Build the per-request rendering context (language, translation function,
 * canonical path, navigation) every API Reference view receives.
 */
export function buildRenderContext(
  req: ExpressRequest,
): ReferenceRenderContext {
  const langParam: string = req.params["lang"] || "";
  const lang: string = isSupportedDocsLanguage(langParam)
    ? langParam
    : DEFAULT_DOCS_LANGUAGE;
  const currentPage: string = req.params["page"] || "";
  const navSections: Array<ReferenceNavSection> =
    getNavigationForLanguage(lang);

  return {
    lang: lang,
    t: makeT(lang),
    supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
    currentPath: req.originalUrl,
    showMasterAdminApis: !IsBillingEnabled,
    currentPage: currentPage,
    navSections: navSections,
    searchIndex: getSearchIndexForLanguage(lang),
    pager: findAdjacentPages(navSections, currentPage),
    currentLocation: findNavLocation(navSections, currentPage),
  };
}
