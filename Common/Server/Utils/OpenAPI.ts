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
import Permission from "../../Types/Permission";

export default class OpenAPIUtil {
  /**
   * Helper method to check if permissions should exclude API generation.
   * Returns true if:
   * 1. The permissions array is empty or undefined, OR
   * 2. The permissions array contains Permission.Public or Permission.CurrentUser
   */
  private static shouldExcludeApiForPermissions(permissions: Array<Permission> | undefined): boolean {
    if (!permissions || permissions.length === 0) {
      return true;
    }
    
    return permissions.includes(Permission.Public) || permissions.includes(Permission.CurrentUser);
  }

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

    // Use schema names that are already registered
    const querySchemaName = `${tableName}QuerySchema`;
    const selectSchemaName = `${tableName}SelectSchema`;
    const sortSchemaName = `${tableName}SortSchema`;
    const groupBySchemaName = `${tableName}GroupBySchema`;

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
                query: { $ref: `#/components/schemas/${querySchemaName}` },
                select: { $ref: `#/components/schemas/${selectSchemaName}` },
                sort: { $ref: `#/components/schemas/${sortSchemaName}` },
                groupBy: { $ref: `#/components/schemas/${groupBySchemaName}` },
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

    // Use schema name that is already registered
    const querySchemaName = `${tableName}QuerySchema`;

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
                query: { $ref: `#/components/schemas/${querySchemaName}` },
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

    // Skip generating create API if model has no create permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.createRecordPermissions)) {
      return;
    }

    // Use schema names that are already registered
    const createSchemaName = `${tableName}CreateSchema`;
    const selectSchemaName = `${tableName}SelectSchema`;
    const readSchemaName = `${tableName}ReadSchema`;

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
                  $ref: `#/components/schemas/${createSchemaName}`,
                },
                miscDataProps: { 
                  type: "object",
                  description: "Additional data properties for creation",
                  additionalProperties: true
                },
                select: { $ref: `#/components/schemas/${selectSchemaName}` },
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
                    $ref: `#/components/schemas/${readSchemaName}`,
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

    // Skip generating get API if model has no read permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.readRecordPermissions)) {
      return;
    }

    // Use schema name that is already registered
    const selectSchemaName = `${tableName}SelectSchema`;

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
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                select: { $ref: `#/components/schemas/${selectSchemaName}` },
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

    // Skip generating update API if model has no update permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.updateRecordPermissions)) {
      return;
    }

    // Use schema names that are already registered
    const updateSchemaName = `${tableName}UpdateSchema`;
    const selectSchemaName = `${tableName}SelectSchema`;
    const readSchemaName = `${tableName}ReadSchema`;

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
                  $ref: `#/components/schemas/${updateSchemaName}`,
                },
                select: { $ref: `#/components/schemas/${selectSchemaName}` },
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
                    $ref: `#/components/schemas/${readSchemaName}`,
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
    
    // Skip generating delete API if model has no delete permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.deleteRecordPermissions)) {
      return;
    }
    
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
    const modelType = model.constructor as new () => DatabaseBaseModel;
    
    // Register the main model schema (for backwards compatibility)
    const modelSchema: ModelSchemaType = ModelSchema.getModelSchema({
      modelType: modelType,
    });
    registry.register(tableName, modelSchema);

    // Register operation-specific schemas based on permissions
    this.registerOperationSpecificSchemas(registry, tableName, modelType, model);

    // Register query, select, and sort schemas
    this.registerQuerySchemas(registry, tableName, modelType);
  }

  private static registerOperationSpecificSchemas(
    registry: OpenAPIRegistry,
    tableName: string,
    modelType: new () => DatabaseBaseModel,
    model: DatabaseBaseModel,
  ): void {
    // Check if model has create permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.createRecordPermissions)) {
      const createSchema = ModelSchema.getCreateModelSchema({ modelType });
      registry.register(`${tableName}CreateSchema`, createSchema);
    }

    // Check if model has read permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.readRecordPermissions)) {
      const readSchema = ModelSchema.getReadModelSchema({ modelType });
      registry.register(`${tableName}ReadSchema`, readSchema);
    }

    // Check if model has update permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.updateRecordPermissions)) {
      const updateSchema = ModelSchema.getUpdateModelSchema({ modelType });
      registry.register(`${tableName}UpdateSchema`, updateSchema);
    }

    // Check if model has delete permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.deleteRecordPermissions)) {
      const deleteSchema = ModelSchema.getDeleteModelSchema({ modelType });
      registry.register(`${tableName}DeleteSchema`, deleteSchema);
    }
  }

  private static registerQuerySchemas(
    registry: OpenAPIRegistry,
    tableName: string,
    modelType: new () => DatabaseBaseModel,
  ): void {
    const querySchemaName = `${tableName}QuerySchema`;
    const selectSchemaName = `${tableName}SelectSchema`;
    const sortSchemaName = `${tableName}SortSchema`;
    const groupBySchemaName = `${tableName}GroupBySchema`;

    const querySchema = ModelSchema.getQueryModelSchema({ 
      modelType: modelType 
    });
    const selectSchema = ModelSchema.getSelectModelSchema({ 
      modelType: modelType 
    });
    const sortSchema = ModelSchema.getSortModelSchema({ 
      modelType: modelType 
    });
    const groupBySchema = ModelSchema.getGroupByModelSchema({ 
      modelType: modelType 
    });

    registry.register(querySchemaName, querySchema);
    registry.register(selectSchemaName, selectSchema);
    registry.register(sortSchemaName, sortSchema);
    registry.register(groupBySchemaName, groupBySchema);
  }
}
