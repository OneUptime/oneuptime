import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";
import { JSONObject, JSONValue } from "../../Types/JSON";
import logger from "./Logger";
import { ModelSchema, ModelSchemaType } from "../../Utils/Schema/ModelSchema";
import LocalCache from "../Infrastructure/LocalCache";

export default class OpenAPIUtil {
  public static generateOpenAPISpec(): JSONObject {

    // check if the cache is already in LocalCache
    const cachedSpec: JSONValue | undefined = LocalCache.getJSON(
      "openapi",
      "spec",
    );

    if (cachedSpec) {
      logger.debug("Returning cached OpenAPI spec");
      return cachedSpec as JSONObject;
    }

    const registry: OpenAPIRegistry = new OpenAPIRegistry();
   

    // Register schemas and paths for all models
    for (const ModelClass of Models) {
      const model: DatabaseBaseModel = new ModelClass();
      const modelName: string | null = model.tableName; 

      if(!modelName) {
        continue; 
      }

      // check if enable documentation is enabled

      if (!model.enableDocumentation) {
        logger.debug(
          `Skipping OpenAPI documentation for model ${modelName} as it is disabled.`,
        );
        continue;
      }

      if(!model.crudApiPath) {
        logger.debug(
          `Skipping OpenAPI documentation for model ${modelName} as it does not have a CRUD API path defined.`,
        );
        continue;
      }
      
      const basePath: string = model.crudApiPath.toString(); 

      // register the model schema
      OpenAPIUtil.registerModelSchemas(registry, model);
      
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


      paths[`${basePath}/{id}/update-item`] = {
        post: this.generateUpdateApiSpec({ modelType: ModelClass }),
        get: this.generateUpdateApiSpec({ modelType: ModelClass }),
      };

      // Delete endpoints (DELETE, POST, GET)
      if (!paths[`${basePath}/{id}`]) {
        paths[`${basePath}/{id}`] = {};
      }


      paths[`${basePath}/{id}/delete-item`] = {
        post: this.generateDeleteApiSpec({ modelType: ModelClass }),
        get: this.generateDeleteApiSpec({ modelType: ModelClass }),
      };

      // Register the paths in the registry
      for (const path in paths) {
        if (paths[path]) {
          const methods: Record<string, any> | undefined = paths[path];
          if (typeof methods === "object" && methods !== null) {
            for (const method in methods) {
              if (methods[method]) {
                const spec: any = methods[method];
                registry.registerPath({
                  method: method.toLowerCase(), 
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
    

    logger.debug(
      "OpenAPI components and paths generated successfully",
    );

    logger.debug(
      JSON.stringify({...components}, null, 2),
    );

    const openApiSpec: JSONObject =  {
      openapi: "3.0.0",
      info: {
        title: "API Documentation",
        version: "1.0.0",
        description: "API documentation generated from models",
      },
      ...components,
    } as unknown as JSONObject;

    LocalCache.setJSON(
      "openapi",
      "spec",
      openApiSpec,
    );

    return openApiSpec;

  }

  public static generateListApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
  }): JSONObject {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    return {
      summary: `List ${tableName}`,
      description: `Endpoint to list all ${tableName} items`,
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
                      $ref: `#/components/schemas/${tableName}`,
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
  }): JSONObject {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    return {
      summary: `Count ${tableName}`,
      description: `Endpoint to count ${tableName} items`,
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
  }): JSONObject {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    return {
      summary: `Create ${tableName}`,
      description: `Endpoint to create a new ${tableName}`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  $ref: `#/components/schemas/${tableName}Input`,
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
                    $ref: `#/components/schemas/${tableName}`,
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
  }): JSONObject {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    return {
      summary: `Get ${tableName}`,
      description: `Endpoint to retrieve a single ${tableName} by ID`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${tableName} to retrieve`,
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
                    $ref: `#/components/schemas/${tableName}`,
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
  }): JSONObject {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    return {
      summary: `Update ${tableName}`,
      description: `Endpoint to update an existing ${tableName}`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${tableName} to update`,
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
                  $ref: `#/components/schemas/${tableName}UpdateInput`,
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
                    $ref: `#/components/schemas/${tableName}`,
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
  }): JSONObject {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    return {
      summary: `Delete ${tableName}`,
      description: `Endpoint to delete a ${tableName}`,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${tableName} to delete`,
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

  private static registerModelSchemas(
    registry: OpenAPIRegistry,
    model: DatabaseBaseModel
  ): void {
    const tableName: string = model.tableName || "UnknownModel";
    const modelSchema: ModelSchemaType = ModelSchema.getModelSchema({
      modelType: model.constructor as new () => DatabaseBaseModel,
    });
    registry.register(tableName, modelSchema);
  }


}
      