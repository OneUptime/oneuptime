import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
  makeT,
  SUPPORTED_DOCS_LANGUAGES,
  TranslateFn,
} from "./I18n";
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
}

/*
 * Build the per-request rendering context (language, translation function,
 * canonical path) every API Reference view receives.
 */
export function buildRenderContext(
  req: ExpressRequest,
): ReferenceRenderContext {
  const langParam: string = req.params["lang"] || "";
  const lang: string = isSupportedDocsLanguage(langParam)
    ? langParam
    : DEFAULT_DOCS_LANGUAGE;
  return {
    lang: lang,
    t: makeT(lang),
    supportedLanguages: SUPPORTED_DOCS_LANGUAGES,
    currentPath: req.originalUrl,
    showMasterAdminApis: !IsBillingEnabled,
  };
}
