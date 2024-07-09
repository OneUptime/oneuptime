import BaseModel from "Common/Models/BaseModel";
import ArrayUtil from "Common/Types/ArrayUtil";
import Dictionary from "Common/Types/Dictionary";
import { IsBillingEnabled } from "CommonServer/EnvironmentConfig";
import Models from "Model/Models/Index";

// This interface represents the documentation for each model
export interface ModelDocumentation {
  name: string;
  path: string;
  model: BaseModel;
  description: string;
}

// This class provides utility methods for working with resources
export default class ResourceUtil {
  // Get all resources that have documentation enabled
  public static getResources(): Array<ModelDocumentation> {
    const resources: Array<ModelDocumentation> = Models.filter(
      // Filter models based on whether documentation is enabled
      (model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();
        let showDocs: boolean = modelInstance.enableDocumentation;

        // If the model is a master admin API and billing is enabled, hide the documentation
        if (modelInstance.isMasterAdminApiDocs && IsBillingEnabled) {
          showDocs = false;
        }

        return showDocs;
      },
    )
      // Map each model to a ModelDocumentation object
     .map((model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();

        return {
          // Get the singular name of the model
          name: modelInstance.singularName!,
          // Get the API documentation path for the model
          path: modelInstance.getAPIDocumentationPath(),
          // Get the model instance
          model: modelInstance,
          // Get the table description for the model
          description: modelInstance.tableDescription!,
        };
      })
      // Sort the resources by name
     .sort(ArrayUtil.sortByFieldName("name"));

    return resources;
  }

  // Get the featured resources (those in the featuredResources array)
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

    // Filter the resources to only include featured resources
    return ResourceUtil.getResources().filter(
      (resource: ModelDocumentation) => {
        return featuredResources.includes(resource.name);
      },
    );
  }

  // Get a dictionary of resources, keyed by path
  public static getResourceDictionaryByPath(): Dictionary<ModelDocumentation> {
    const dict: Dictionary<ModelDocumentation> = {};

    // Get all resources
    const resources: Array<ModelDocumentation> = ResourceUtil.getResources();

    // Add each resource to the dictionary
    for (const resource of resources) {
      dict[resource.path] = resource;
    }

    return dict;
  }
}