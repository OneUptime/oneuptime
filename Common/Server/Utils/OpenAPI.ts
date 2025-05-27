import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { JSONObject } from "../../Types/JSON";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";

export default class OpenAPIUtil {
  public static generateOpenAPISpec(): string {
    const registry = new OpenAPIRegistry();
    
    // Register schemas and paths for all models
    for (const ModelClass of Models) {
      if (typeof ModelClass === 'function') {
        const model = new ModelClass();
        const modelName = model.constructor.name;
        
        // Register schema for the model
        // Note: In a real implementation, you would need to convert your model schema to OpenAPI schema
        
        // Register API endpoints for this model
        const basePath = `/api/${modelName.toLowerCase()}`;
        
        const paths: JSONObject = {};
        
        // List endpoint
        paths[basePath] = {
          get: this.genenerateListApiSpec({ modelType: ModelClass }),
          post: this.generateCreateApiSpec({ modelType: ModelClass })
        };
        
        // Single item endpoints
        paths[`${basePath}/{id}`] = {
          get: this.generateGetApiSpec({ modelType: ModelClass }),
          put: this.generateUpdateApiSpec({ modelType: ModelClass }),
          delete: this.generateDeleteApiSpec({ modelType: ModelClass })
        };
        
        // Register the paths in the registry
        for (const path in paths) {
          if (paths.hasOwnProperty(path)) {
            registry.registerPath(path, paths[path]);
          }
        }
      }
    }

    const generator = new OpenApiGeneratorV3(registry.definitions);
    const components = generator.generateComponents();

    return JSON.stringify({
      openapi: "3.0.0",
      info: {
        title: "API Documentation",
        version: "1.0.0",
        description: "API documentation generated from models",
      },
      components: components,
    }, null, 2);

  }

  public static genenerateListApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    // Here you would generate the list API spec based on the model
    // This is a placeholder implementation
    const listApiSpec: JSONObject = {
      summary: `List ${model.constructor.name}`,
      description: `Endpoint to list all ${model.constructor.name} items`,
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: `#/components/schemas/${model.constructor.name}` },
              },
            },
          },
        },
      },
    };

    return listApiSpec;
  }

  public static generateGetApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    
    const getApiSpec: JSONObject = {
      summary: `Get ${model.constructor.name}`,
      description: `Endpoint to retrieve a single ${model.constructor.name} by ID`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid"
          },
          description: `ID of the ${model.constructor.name} to retrieve`
        }
      ],
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${model.constructor.name}`
              }
            }
          }
        },
        "404": {
          description: "Resource not found"
        }
      }
    };
    
    return getApiSpec;
  }

  public static generateCreateApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    
    const createApiSpec: JSONObject = {
      summary: `Create ${model.constructor.name}`,
      description: `Endpoint to create a new ${model.constructor.name}`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: `#/components/schemas/${model.constructor.name}Input`
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Created successfully",
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${model.constructor.name}`
              }
            }
          }
        },
        "400": {
          description: "Bad request"
        }
      }
    };
    
    return createApiSpec;
  }

  public static generateUpdateApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    
    const updateApiSpec: JSONObject = {
      summary: `Update ${model.constructor.name}`,
      description: `Endpoint to update an existing ${model.constructor.name}`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid"
          },
          description: `ID of the ${model.constructor.name} to update`
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: `#/components/schemas/${model.constructor.name}UpdateInput`
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Updated successfully",
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${model.constructor.name}`
              }
            }
          }
        },
        "404": {
          description: "Resource not found"
        },
        "400": {
          description: "Bad request"
        }
      }
    };
    
    return updateApiSpec;
  }

  public static generateDeleteApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    
    const deleteApiSpec: JSONObject = {
      summary: `Delete ${model.constructor.name}`,
      description: `Endpoint to delete a ${model.constructor.name}`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid"
          },
          description: `ID of the ${model.constructor.name} to delete`
        }
      ],
      responses: {
        "204": {
          description: "Deleted successfully"
        },
        "404": {
          description: "Resource not found"
        }
      }
    };
    
    return deleteApiSpec;
  }
}
