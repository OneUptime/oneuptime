import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";
import { JSONObject } from "../../Types/JSON";

export default class OpenAPIUtil {
  public static generateOpenAPISpec(): JSONObject {
    const registry: OpenAPIRegistry = new OpenAPIRegistry();

    // Register schemas and paths for all models
    for (const ModelClass of Models) {
      const model: DatabaseBaseModel = new ModelClass();
      const modelName: string = model.constructor.name;
      const basePath: string = `/api/${modelName.toLowerCase()}`;
      // Use a plain object for paths
      const paths: Record<string, Record<string, any>> = {};

      // List endpoints (POST and GET)
      paths[`${basePath}/get-list`] = {
        post: this.generateListApiSpec({ modelType: ModelClass }),
        get: this.generateListApiSpec({ modelType: ModelClass }),
      };
      // Count endpoint
      paths[`${basePath}/count`] = {
        post: this.generateCountApiSpec({ modelType: ModelClass }),
      };
      // Create endpoint
      paths[basePath] = {
        post: this.generateCreateApiSpec({ modelType: ModelClass }),
      };
      // Get item endpoints (POST and GET)
      paths[`${basePath}/{id}/get-item`] = {
        post: this.generateGetApiSpec({ modelType: ModelClass }),
        get: this.generateGetApiSpec({ modelType: ModelClass }),
      };
      // Update endpoints (PUT, POST, GET)
      if (!paths[`${basePath}/{id}`]) {
        paths[`${basePath}/{id}`] = {};
      }

      paths[`${basePath}/{id}`]!["put"] = this.generateUpdateApiSpec({
        modelType: ModelClass,
      });
      paths[`${basePath}/{id}/update-item`] = {
        post: this.generateUpdateApiSpec({ modelType: ModelClass }),
        get: this.generateUpdateApiSpec({ modelType: ModelClass }),
      };
      // Delete endpoints (DELETE, POST, GET)
      if (!paths[`${basePath}/{id}`]) {
        paths[`${basePath}/{id}`] = {};
      }
      paths[`${basePath}/{id}`]!["delete"] = this.generateDeleteApiSpec({
        modelType: ModelClass,
      });
      paths[`${basePath}/{id}/delete-item`] = {
        post: this.generateDeleteApiSpec({ modelType: ModelClass }),
        get: this.generateDeleteApiSpec({ modelType: ModelClass }),
      };

      // Register the paths in the registry
      for (const path in paths) {
        if (paths.hasOwnProperty(path)) {
          const methods: Record<string, any> | undefined = paths[path];
          if (typeof methods === "object" && methods !== null) {
            for (const method in methods) {
              if (methods.hasOwnProperty(method)) {
                const spec: any = methods[method];
                registry.registerPath({
                  method: method as any,
                  path,
                  ...spec,
                });
              }
            }
          }
        }
      }
    }

    const generator: OpenApiGeneratorV3 = new OpenApiGeneratorV3(
      registry.definitions,
    );
    const components: Pick<any, "components"> = generator.generateComponents();

    return {
      openapi: "3.0.0",
      info: {
        title: "API Documentation",
        version: "1.0.0",
        description: "API documentation generated from models",
      },
      components: components,
    } as unknown as JSONObject;
  }

  public static generateListApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    return {
      summary: `List ${model.constructor.name}`,
      description: `Endpoint to list all ${model.constructor.name} items`,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                query: { type: "object" },
                select: { type: "object" },
                sort: { type: "object" },
                groupBy: { type: "object" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "array",
                    items: {
                      $ref: `#/components/schemas/${model.constructor.name}`,
                    },
                  },
                  count: { type: "number" },
                },
              },
            },
          },
        },
      },
    };
  }

  public static generateCountApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    return {
      summary: `Count ${model.constructor.name}`,
      description: `Endpoint to count ${model.constructor.name} items`,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                query: { type: "object" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  count: { type: "number" },
                },
              },
            },
          },
        },
      },
    };
  }

  public static generateCreateApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    return {
      summary: `Create ${model.constructor.name}`,
      description: `Endpoint to create a new ${model.constructor.name}`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  $ref: `#/components/schemas/${model.constructor.name}Input`,
                },
                miscDataProps: { type: "object" },
              },
              required: ["data"],
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Created successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    $ref: `#/components/schemas/${model.constructor.name}`,
                  },
                },
              },
            },
          },
        },
        "400": {
          description: "Bad request",
        },
      },
    };
  }

  public static generateGetApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    return {
      summary: `Get ${model.constructor.name}`,
      description: `Endpoint to retrieve a single ${model.constructor.name} by ID`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${model.constructor.name} to retrieve`,
        },
      ],
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    $ref: `#/components/schemas/${model.constructor.name}`,
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Resource not found",
        },
      },
    };
  }

  public static generateUpdateApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    return {
      summary: `Update ${model.constructor.name}`,
      description: `Endpoint to update an existing ${model.constructor.name}`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${model.constructor.name} to update`,
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  $ref: `#/components/schemas/${model.constructor.name}UpdateInput`,
                },
              },
              required: ["data"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    $ref: `#/components/schemas/${model.constructor.name}`,
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Resource not found",
        },
        "400": {
          description: "Bad request",
        },
      },
    };
  }

  public static generateDeleteApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }) {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    return {
      summary: `Delete ${model.constructor.name}`,
      description: `Endpoint to delete a ${model.constructor.name}`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${model.constructor.name} to delete`,
        },
      ],
      responses: {
        "204": {
          description: "Deleted successfully",
        },
        "404": {
          description: "Resource not found",
        },
      },
    };
  }
}
