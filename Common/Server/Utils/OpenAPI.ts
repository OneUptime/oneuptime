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
import { Host, HttpProtocol } from "../EnvironmentConfig";

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

      if (!modelName) {
        continue;
      }

      // check if enable documentation is enabled

      if (!model.enableDocumentation) {
        logger.debug(
          `Skipping OpenAPI documentation for model ${modelName} as it is disabled.`,
        );
        continue;
      }

      if (!model.crudApiPath) {
        logger.debug(
          `Skipping OpenAPI documentation for model ${modelName} as it does not have a CRUD API path defined.`,
        );
        continue;
      }

      // register the model schema
      OpenAPIUtil.registerModelSchemas(registry, model);

      this.generateListApiSpec({
        modelType: ModelClass,
        registry,
      });

      this.generateCountApiSpec({
        modelType: ModelClass,
        registry,
      });
      this.generateCreateApiSpec({
        modelType: ModelClass,
        registry,
      });
      this.generateGetApiSpec({
        modelType: ModelClass,
        registry,
      });
      this.generateUpdateApiSpec({
        modelType: ModelClass,
        registry,
      });
      this.generateDeleteApiSpec({
        modelType: ModelClass,
        registry,
      });
    }

    const generator: OpenApiGeneratorV3 = new OpenApiGeneratorV3(
      registry.definitions,
    );

    const spec: JSONObject = generator.generateDocument({
      openapi: "3.0.0",
      info: {
        title: "OneUptime OpenAPI Specification",
        version: "1.0.0",
        description:
          "OpenAPI specification for OneUptime. This document describes the API endpoints, request and response formats, and other details necessary for developers to interact with the OneUptime API.",
      },
      servers: [
        {
          url: `${HttpProtocol.toString()}${Host.toString()}/api`,
          description: "API Server",
        },
      ],
    }) as unknown as JSONObject;

    LocalCache.setJSON("openapi", "spec", spec as JSONObject);

    return spec;
  }

  public static generateListApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    const singularModelName: string = model.singularName || tableName;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/get-list`,
      summary: `List ${singularModelName}`,
      description: `Endpoint to list all ${singularModelName} items`,
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
        ...this.getGenericStatusResponseSchema(),
      },
    });
  }

  public static generateCountApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    const singularModelName: string = model.singularName || tableName;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/count`,
      summary: `Count ${singularModelName}`,
      description: `Endpoint to count ${singularModelName} items`,
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
        ...this.getGenericStatusResponseSchema(),
      },
    });
  }

  public static generateCreateApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    const singularModelName: string = model.singularName || tableName;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}`,
      summary: `Create ${singularModelName}`,
      description: `Endpoint to create a new ${singularModelName}`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  $ref: `#/components/schemas/${tableName}`,
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
        ...this.getGenericStatusResponseSchema(),
      },
    });
  }

  public static getGenericStatusResponseSchema(): JSONObject {
    return {
      "400": {
        description:
          "Bad request. This response indicates that the request was malformed or contained invalid data.",
      },
      "401": {
        description:
          "Unauthorized. This response indicates that the request requires user authentication.",
      },
      "402": {
        description:
          "Payment Required. This response indicates that the request requires payment or a valid subscription.",
      },
      "403": {
        description:
          "Forbidden. This response indicates that the server understood the request, but refuses to authorize it.",
      },
      "408": {
        description:
          "Request Timeout. This response indicates that the server timed out waiting for the request.",
      },
      "405": {
        description:
          "Project not found. This response indicates that the requested project does not exist or is not accessible.",
      },
      "415": {
        description:
          "Unable to reach server. This response indicates that the server is currently unreachable or down.",
      },
      "422": {
        description:
          "Not authorized. This response indicates that the user does not have permission to access the requested resource.",
      },
      "500": {
        description:
          "Internal Server Error. This response indicates that the server encountered an unexpected condition that prevented it from fulfilling the request.",
      },
    };
  }

  public static generateGetApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    const singularModelName: string = model.singularName || tableName;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/{id}`,
      summary: `Get ${singularModelName}`,
      description: `Endpoint to retrieve a single ${singularModelName} by ID`,
      parameters: [
        ...(OpenAPIUtil.getDefaultApiHeaders() as Array<any>),
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${singularModelName} to retrieve`,
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
        ...this.getGenericStatusResponseSchema(),
      },
    });
  }

  public static getDefaultApiHeaders(): Array<JSONObject> {
    return [
      {
        name: "APIKey",
        in: "header",
        required: true,
        schema: { type: "string" },
        description: "API key for authentication",
        example: "your-api-key-here",
      },
    ];
  }

  public static generateUpdateApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    const singularModelName: string = model.singularName || tableName;

    data.registry.registerPath({
      method: "put",
      path: `${model.crudApiPath}/{id}`,
      summary: `Update ${singularModelName}`,
      description: `Endpoint to update an existing ${singularModelName}`,
      parameters: [
        ...(OpenAPIUtil.getDefaultApiHeaders() as Array<any>),
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${singularModelName} to update`,
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
                  $ref: `#/components/schemas/${tableName}`,
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
        ...this.getGenericStatusResponseSchema(),
      },
    });
  }

  public static generateDeleteApiSpec(data: {
    modelType: new () => DatabaseBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownModel";
    const singularModelName: string = model.singularName || tableName;
    data.registry.registerPath({
      method: "delete",
      path: `${model.crudApiPath}/{id}`,
      summary: `Delete ${singularModelName}`,
      description: `Endpoint to delete a ${singularModelName}`,
      parameters: [
        ...(OpenAPIUtil.getDefaultApiHeaders() as Array<any>),
        {
          name: "id",
          in: "path",
          required: true,
          schema: {
            type: "string",
            format: "uuid",
          },
          description: `ID of the ${singularModelName} to delete`,
        },
      ],
      responses: {
        "200": {
          description: "Deleted successfully",
        },
        ...this.getGenericStatusResponseSchema(),
      },
    });
  }

  private static registerModelSchemas(
    registry: OpenAPIRegistry,
    model: DatabaseBaseModel,
  ): void {
    const tableName: string = model.tableName || "UnknownModel";
    const modelSchema: ModelSchemaType = ModelSchema.getModelSchema({
      modelType: model.constructor as new () => DatabaseBaseModel,
    });
    registry.register(tableName, modelSchema);
  }
}
