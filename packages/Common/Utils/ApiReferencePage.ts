import AnalyticsBaseModel from "../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseBaseModel from "../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * Whether the API Reference has a page for a model, and where it is.
 *
 * The API Reference (packages/App/FeatureSet/APIReference) serves a page for
 * each model it documents, at /reference/<path>, and "Page not found" for any
 * other. Its list of models (Utils/Resources.ts) and the "Go to API Docs"
 * button of the Show ID dialog read this one rule, so the dialog only offers
 * a page that exists. A model is documented when:
 *
 *   - it opts in with enableDocumentation;
 *   - it is an analytics (ClickHouse) model with a CRUD route, crudApiPath -
 *     without one there is no API to document;
 *   - it is not a master-admin API (Project, User, ...) on the
 *     billing-enabled (SaaS) build. Only the instance's master API key can
 *     call those, and that key exists on a self-hosted install alone.
 */

export interface ApiReferenceOptions {
  isBillingEnabled: boolean;
}

export type ApiReferenceModel = DatabaseBaseModel | AnalyticsBaseModel;

export const isInApiReference: (
  model: ApiReferenceModel,
  options: ApiReferenceOptions,
) => boolean = (
  model: ApiReferenceModel,
  options: ApiReferenceOptions,
): boolean => {
  if (!model.enableDocumentation) {
    return false;
  }

  if (model instanceof AnalyticsBaseModel && !model.crudApiPath) {
    return false;
  }

  if (model.isMasterAdminApiDocs && options.isBillingEnabled) {
    return false;
  }

  return true;
};

/*
 * The model's page in the API Reference ("span", "monitor"), or null when the
 * API Reference has no page for it.
 */
export const getApiReferencePagePath: (
  model: ApiReferenceModel,
  options: ApiReferenceOptions,
) => string | null = (
  model: ApiReferenceModel,
  options: ApiReferenceOptions,
): string | null => {
  if (!isInApiReference(model, options)) {
    return null;
  }

  return model.getAPIDocumentationPath() || null;
};
