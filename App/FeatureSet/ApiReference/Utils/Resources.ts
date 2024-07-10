import BaseModel from "Common/Models/BaseModel";
import ArrayUtil from "Common/Types/ArrayUtil";
import Dictionary from "Common/Types/Dictionary";
import { IsBillingEnabled } from "CommonServer/EnvironmentConfig";
import Models from "Model/Models/Index";

export interface ModelDocumentation {
  name: string;
  path: string;
  model: BaseModel;
  description: string;
}

export default class ResourceUtil {
  // Get all resources that should have documentation enabled
  public static getResources(): Array<ModelDocumentation> {
    const resources: Array<ModelDocumentation> = Models.filter(
      (model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();
        let showDocs: boolean = modelInstance.enableDocumentation;

        // If billing is enabled, do not show master admin API docs
        if (modelInstance.isMasterAdminApiDocs && IsBillingEnabled) {
          showDocs = false;
        }

        return showDocs;
      },
    )
      .map((model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();

        return {
          name: modelInstance.singularName!,
          path: modelInstance.getAPIDocumentationPath(),
          model: modelInstance,
          description: modelInstance.tableDescription!,
        };
      })
      .sort(ArrayUtil.sortByFieldName("name"));

    return resources;
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
