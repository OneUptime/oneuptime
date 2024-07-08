import BaseModel from Common/Models/BaseModel;
import ArrayUtil from Common/Types/ArrayUtil;
import Dictionary from Common/Types/Dictionary;
import { IsBillingEnabled } from CommonServer/EnvironmentConfig;
import Models from Model/Models/Index;

export interface ModelDocumentation {
  name: string;
  path: string;
  model: BaseModel;
  description: string;
}

export default class ResourceUtil {
  public static getResources(): Array<ModelDocumentation> {
    // Filter models based on whether documentation is enabled
    const resources: Array<ModelDocumentation> = Models.filter(
      (model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();
        let showDocs: boolean = modelInstance.enableDocumentation;

        // If the model is for master admin API docs and billing is enabled, hide the docs
        if (modelInstance.isMasterAdminApiDocs && IsBillingEnabled) {
          showDocs = false;
        }

        return showDocs;
      },
    )
     .map((model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();

        // Create a new ModelDocumentation object for each model
        return {
          name: modelInstance.singularName!, // Singular name of the model
          path: modelInstance.getAPIDocumentationPath(), // API documentation path
          model: modelInstance, // The model instance
          description: modelInstance.tableDescription!, // Description of the table
        };
      })
     .sort(ArrayUtil.sortByFieldName(name)); // Sort by name

    return resources;
  }

  public static getFeaturedResources(): Array<ModelDocumentation> {
    // Get the featured resources
    const featuredResources: Array<string> = [
      Monitor,
      Scheduled Maintenance Event,
      Status Page,
      Incident,
      Team,
      On-Call Duty,
      Label,
      Team Member,
    ];

    // Filter the resources to get the featured ones
    return ResourceUtil.getResources().filter(
      (resource: ModelDocumentation) => {
        return featuredResources.includes(resource.name);
      },
    );
  }

  public static getResourceDictionaryByPath(): Dictionary<ModelDocumentation> {
    // Create a dictionary to store resources by path
    const dict: Dictionary<ModelDocumentation> = {};

    // Get the resources
    const resources: Array<ModelDocumentation> = ResourceUtil.getResources();

    // Add each resource to the dictionary
    for (const resource of resources) {
      dict[resource.path] = resource;
    }

    return dict;
  }
}

