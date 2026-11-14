import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ArrayUtil from "Common/Utils/Array";
import Dictionary from "Common/Types/Dictionary";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Models from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import { isInApiReference } from "Common/Utils/ApiReferencePage";

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
  /*
   * Get all resources that should have documentation enabled. Which ones is
   * decided by isInApiReference (Common/Utils/ApiReferencePage.ts), the rule
   * the Dashboard's Show ID dialog also reads to offer "Go to API Docs" only
   * for a page that is here. On the billing-enabled build it leaves the
   * master admin API docs out.
   */
  public static getResources(): Array<ModelDocumentation> {
    const databaseResources: Array<ModelDocumentation> = Models.filter(
      (model: { new (): BaseModel }) => {
        return isInApiReference(new model(), {
          isBillingEnabled: IsBillingEnabled,
        });
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
        return isInApiReference(new model(), {
          isBillingEnabled: IsBillingEnabled,
        });
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

  /*
   * The resources the reference opens with, by table: a name people read
   * can change (On-Call Duty became On-Call, #6817), and a featured page
   * named by it would silently drop out. On-call policies had, since the
   * list named them "On-Call Duty", which no model was called.
   */
  public static readonly FEATURED_TABLES: ReadonlyArray<string> = [
    "Monitor",
    "ScheduledMaintenance",
    "StatusPage",
    "Incident",
    "Team",
    "OnCallDutyPolicy",
    "Label",
    "TeamMember",
  ];

  // Get featured resources that are pre-selected
  public static getFeaturedResources(): Array<ModelDocumentation> {
    return ResourceUtil.getResources().filter(
      (resource: ModelDocumentation) => {
        return ResourceUtil.FEATURED_TABLES.includes(
          resource.model.tableName || "",
        );
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
