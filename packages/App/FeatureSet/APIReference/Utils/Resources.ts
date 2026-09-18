import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ArrayUtil from "Common/Utils/Array";
import Dictionary from "Common/Types/Dictionary";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Models from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";

export interface ModelDocumentation {
  name: string;
  path: string;
  model: BaseModel | AnalyticsBaseModel;
  /*
   * True for ClickHouse-backed Analytics models (Log, Span, Metric, ...),
   * which are rendered through a separate metadata path in Model.ts.
   */
  isAnalytics: boolean;
  description: string;
}

export default class ResourceUtil {
  // Get all resources that should have documentation enabled
  public static getResources(): Array<ModelDocumentation> {
    const databaseResources: Array<ModelDocumentation> = Models.filter(
      (model: { new (): BaseModel }) => {
        const modelInstance: BaseModel = new model();
        let showDocs: boolean = modelInstance.enableDocumentation;

        // If billing is enabled, do not show master admin API docs
        if (modelInstance.isMasterAdminApiDocs && IsBillingEnabled) {
          showDocs = false;
        }

        return showDocs;
      },
    ).map((model: { new (): BaseModel }) => {
      const modelInstance: BaseModel = new model();

      return {
        name: modelInstance.singularName!,
        path: modelInstance.getAPIDocumentationPath(),
        model: modelInstance,
        isAnalytics: false,
        description: modelInstance.tableDescription!,
      };
    });

    /*
     * Analytics (ClickHouse) models expose live REST APIs via
     * BaseAnalyticsAPI but live in a separate model registry. Include the
     * ones that opt in via `enableDocumentation` and actually expose a
     * CRUD route (`crudApiPath`).
     */
    const analyticsResources: Array<ModelDocumentation> =
      AnalyticsModels.filter((model: { new (): AnalyticsBaseModel }) => {
        const modelInstance: AnalyticsBaseModel = new model();
        let showDocs: boolean =
          modelInstance.enableDocumentation &&
          Boolean(modelInstance.crudApiPath);

        if (modelInstance.isMasterAdminApiDocs && IsBillingEnabled) {
          showDocs = false;
        }

        return showDocs;
      }).map((model: { new (): AnalyticsBaseModel }) => {
        const modelInstance: AnalyticsBaseModel = new model();

        return {
          name: modelInstance.singularName,
          path: modelInstance.getAPIDocumentationPath(),
          model: modelInstance,
          isAnalytics: true,
          description: modelInstance.tableDescription,
        };
      });

    return [...databaseResources, ...analyticsResources].sort(
      ArrayUtil.sortByFieldName("name"),
    );
  }

  // Get featured resources that are pre-selected
  public static getFeaturedResources(): Array<ModelDocumentation> {
    const featuredResources: Array<string> = [
      "Monitor",
      "Scheduled Maintenance Event",
      "Status Page",
      "Incident",
      "Team",
      "On-Call Duty",
      "Label",
      "Team Member",
    ];

    return ResourceUtil.getResources().filter(
      (resource: ModelDocumentation) => {
        return featuredResources.includes(resource.name);
      },
    );
  }

  // Create a dictionary of resources indexed by their path
  public static getResourceDictionaryByPath(): Dictionary<ModelDocumentation> {
    const dict: Dictionary<ModelDocumentation> = {};

    const resources: Array<ModelDocumentation> = ResourceUtil.getResources();

    for (const resource of resources) {
      dict[resource.path] = resource;
    }

    return dict;
  }
}
