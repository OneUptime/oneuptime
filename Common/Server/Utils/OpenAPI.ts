import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import type {
  ParameterObject,
  ReferenceObject,
} from "@asteasolutions/zod-to-openapi/dist/types";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../Models/AnalyticsModels/Index";
import { JSONObject, JSONValue } from "../../Types/JSON";
import { ModelSchema, ModelSchemaType } from "../../Utils/Schema/ModelSchema";
import {
  AnalyticsModelSchema,
  AnalyticsModelSchemaType,
} from "../../Utils/Schema/AnalyticsModelSchema";
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
  private static shouldExcludeApiForPermissions(
    permissions: Array<Permission> | undefined,
  ): boolean {
    if (!permissions || permissions.length === 0) {
      return true;
    }

    return (
      permissions.length > 0 &&
      permissions.every((permission: Permission) => {
        return (
          permission === Permission.Public ||
          permission === Permission.CurrentUser
        );
      })
    );
  }

  public static generateOpenAPISpec(): JSONObject {
    // check if the cache is already in LocalCache
    const cachedSpec: JSONValue | undefined = LocalCache.getJSON(
      "openapi",
      "spec",
    );

    if (cachedSpec) {
      return cachedSpec as JSONObject;
    }

    const registry: OpenAPIRegistry = new OpenAPIRegistry();
    const tags: Array<{ name: string; description: string }> = [];

    // Register schemas and paths for all models
    for (const ModelClass of Models) {
      const model: DatabaseBaseModel = new ModelClass();
      const modelName: string | null = model.tableName;

      if (!modelName) {
        continue;
      }

      // check if enable documentation is enabled

      if (!model.enableDocumentation) {
        continue;
      }

      if (!model.crudApiPath) {
        continue;
      }

      // Add tag for this model
      const singularModelName: string = model.singularName || modelName;
      tags.push({
        name: singularModelName,
        description:
          model.tableDescription || `API endpoints for ${singularModelName}`,
      });

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

    // Register schemas and paths for all Analytics models
    for (const AnalyticsModelClass of AnalyticsModels) {
      const analyticsModel: AnalyticsBaseModel = new AnalyticsModelClass();
      const modelName: string | null = analyticsModel.tableName;

      if (!modelName) {
        continue;
      }

      if (!analyticsModel.crudApiPath) {
        continue;
      }

      // Add tag for this model
      const singularModelName: string =
        analyticsModel.singularName || modelName;
      tags.push({
        name: singularModelName,
        description: `API endpoints for ${singularModelName}`,
      });

      // register the analytics model schema
      OpenAPIUtil.registerAnalyticsModelSchemas(registry, analyticsModel);

      this.generateAnalyticsListApiSpec({
        modelType: AnalyticsModelClass,
        registry,
      });

      this.generateAnalyticsCountApiSpec({
        modelType: AnalyticsModelClass,
        registry,
      });

      this.generateAnalyticsCreateApiSpec({
        modelType: AnalyticsModelClass,
        registry,
      });

      this.generateAnalyticsGetApiSpec({
        modelType: AnalyticsModelClass,
        registry,
      });

      this.generateAnalyticsUpdateApiSpec({
        modelType: AnalyticsModelClass,
        registry,
      });

      this.generateAnalyticsDeleteApiSpec({
        modelType: AnalyticsModelClass,
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
      tags: tags.sort(
        (
          a: { name: string; description: string },
          b: { name: string; description: string },
        ) => {
          return a.name.localeCompare(b.name);
        },
      ),
    }) as unknown as JSONObject;

    // Add security schemes and global security requirement
    if (!spec["components"]) {
      spec["components"] = {};
    }

    (spec["components"] as JSONObject)["securitySchemes"] = {
      ApiKey: {
        type: "apiKey",
        in: "header",
        name: "APIKey",
        description:
          "API key for authentication. Required for all API requests.",
      },
    };

    spec["security"] = [
      {
        ApiKey: [],
      },
    ];

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
    const querySchemaName: string = `${tableName}QuerySchema`;
    const selectSchemaName: string = `${tableName}SelectSchema`;
    const sortSchemaName: string = `${tableName}SortSchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/get-list`,
      operationId: `list${tableName}`,
      summary: `List ${singularModelName}`,
      description: `Endpoint to list all ${singularModelName} items`,
      tags: [singularModelName],
      parameters: [...OpenAPIUtil.getDefaultApiHeaders()],
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
    const querySchemaName: string = `${tableName}QuerySchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/count`,
      operationId: `count${tableName}`,
      summary: `Count ${singularModelName}`,
      description: `Endpoint to count ${singularModelName} items`,
      tags: [singularModelName],
      parameters: [...OpenAPIUtil.getDefaultApiHeaders()],
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
    const createSchemaName: string = `${tableName}CreateSchema`;
    const readSchemaName: string = `${tableName}ReadSchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}`,
      operationId: `create${tableName}`,
      summary: `Create ${singularModelName}`,
      description: `Endpoint to create a new ${singularModelName}`,
      tags: [singularModelName],
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
    const selectSchemaName: string = `${tableName}SelectSchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/{id}/get-item`,
      operationId: `get${tableName}`,
      summary: `Get ${singularModelName}`,
      description: `Endpoint to retrieve a single ${singularModelName} by ID`,
      tags: [singularModelName],
      parameters: [
        ...OpenAPIUtil.getDefaultApiHeaders(),
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

  public static getDefaultApiHeaders(): Array<
    ParameterObject | ReferenceObject
  > {
    return [];
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
    const updateSchemaName: string = `${tableName}UpdateSchema`;
    const readSchemaName: string = `${tableName}ReadSchema`;

    data.registry.registerPath({
      method: "put",
      path: `${model.crudApiPath}/{id}`,
      operationId: `update${tableName}`,
      summary: `Update ${singularModelName}`,
      description: `Endpoint to update an existing ${singularModelName}`,
      tags: [singularModelName],
      parameters: [
        ...OpenAPIUtil.getDefaultApiHeaders(),
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
      operationId: `delete${tableName}`,
      summary: `Delete ${singularModelName}`,
      description: `Endpoint to delete a ${singularModelName}`,
      tags: [singularModelName],
      parameters: [
        ...OpenAPIUtil.getDefaultApiHeaders(),
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
    const modelType: new () => DatabaseBaseModel =
      model.constructor as new () => DatabaseBaseModel;

    // Register the main model schema (for backwards compatibility)
    const modelSchema: ModelSchemaType = ModelSchema.getModelSchema({
      modelType: modelType,
    });
    registry.register(tableName, modelSchema);

    // Register operation-specific schemas based on permissions
    this.registerOperationSpecificSchemas(
      registry,
      tableName,
      modelType,
      model,
    );

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
      const createSchema: ModelSchemaType = ModelSchema.getCreateModelSchema({
        modelType,
      });
      registry.register(`${tableName}CreateSchema`, createSchema);
    }

    // Check if model has read permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.readRecordPermissions)) {
      const readSchema: ModelSchemaType = ModelSchema.getReadModelSchema({
        modelType,
      });
      registry.register(`${tableName}ReadSchema`, readSchema);
    }

    // Check if model has update permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.updateRecordPermissions)) {
      const updateSchema: ModelSchemaType = ModelSchema.getUpdateModelSchema({
        modelType,
      });
      registry.register(`${tableName}UpdateSchema`, updateSchema);
    }

    // Check if model has delete permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.deleteRecordPermissions)) {
      const deleteSchema: ModelSchemaType = ModelSchema.getDeleteModelSchema({
        modelType,
      });
      registry.register(`${tableName}DeleteSchema`, deleteSchema);
    }
  }

  private static registerQuerySchemas(
    registry: OpenAPIRegistry,
    tableName: string,
    modelType: new () => DatabaseBaseModel,
  ): void {
    const querySchemaName: string = `${tableName}QuerySchema`;
    const selectSchemaName: string = `${tableName}SelectSchema`;
    const sortSchemaName: string = `${tableName}SortSchema`;
    const groupBySchemaName: string = `${tableName}GroupBySchema`;

    const querySchema: ModelSchemaType = ModelSchema.getQueryModelSchema({
      modelType: modelType,
    });
    const selectSchema: ModelSchemaType = ModelSchema.getSelectModelSchema({
      modelType: modelType,
    });
    const sortSchema: ModelSchemaType = ModelSchema.getSortModelSchema({
      modelType: modelType,
    });
    const groupBySchema: ModelSchemaType = ModelSchema.getGroupByModelSchema({
      modelType: modelType,
    });

    registry.register(querySchemaName, querySchema);
    registry.register(selectSchemaName, selectSchema);
    registry.register(sortSchemaName, sortSchema);
    registry.register(groupBySchemaName, groupBySchema);
  }

  // Analytics-specific methods

  private static registerAnalyticsModelSchemas(
    registry: OpenAPIRegistry,
    model: AnalyticsBaseModel,
  ): void {
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const modelType: new () => AnalyticsBaseModel =
      model.constructor as new () => AnalyticsBaseModel;

    // Register the main analytics model schema
    const modelSchema: AnalyticsModelSchemaType =
      AnalyticsModelSchema.getModelSchema({
        modelType: modelType,
      });
    registry.register(tableName, modelSchema);

    // Register operation-specific schemas based on permissions
    this.registerAnalyticsOperationSpecificSchemas(
      registry,
      tableName,
      modelType,
      model,
    );

    // Register query, select, and sort schemas
    this.registerAnalyticsQuerySchemas(registry, tableName, modelType);
  }

  private static registerAnalyticsOperationSpecificSchemas(
    registry: OpenAPIRegistry,
    tableName: string,
    modelType: new () => AnalyticsBaseModel,
    model: AnalyticsBaseModel,
  ): void {
    // Check if model has create permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.getCreatePermissions())) {
      const createSchema: AnalyticsModelSchemaType =
        AnalyticsModelSchema.getCreateModelSchema({
          modelType,
        });
      registry.register(`${tableName}CreateSchema`, createSchema);
    }

    // Check if model has read permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.getReadPermissions())) {
      const readSchema: AnalyticsModelSchemaType =
        AnalyticsModelSchema.getModelSchema({
          modelType,
        });
      registry.register(`${tableName}ReadSchema`, readSchema);
    }

    // Check if model has update permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.getUpdatePermissions())) {
      const updateSchema: AnalyticsModelSchemaType =
        AnalyticsModelSchema.getCreateModelSchema({
          modelType,
        });
      registry.register(`${tableName}UpdateSchema`, updateSchema);
    }

    // Check if model has delete permissions and should not exclude API generation
    if (!this.shouldExcludeApiForPermissions(model.getDeletePermissions())) {
      const deleteSchema: AnalyticsModelSchemaType =
        AnalyticsModelSchema.getModelSchema({
          modelType,
        });
      registry.register(`${tableName}DeleteSchema`, deleteSchema);
    }
  }

  private static registerAnalyticsQuerySchemas(
    registry: OpenAPIRegistry,
    tableName: string,
    modelType: new () => AnalyticsBaseModel,
  ): void {
    const querySchemaName: string = `${tableName}QuerySchema`;
    const selectSchemaName: string = `${tableName}SelectSchema`;
    const sortSchemaName: string = `${tableName}SortSchema`;
    const groupBySchemaName: string = `${tableName}GroupBySchema`;

    const querySchema: AnalyticsModelSchemaType =
      AnalyticsModelSchema.getQueryModelSchema({
        modelType: modelType,
      });
    const selectSchema: AnalyticsModelSchemaType =
      AnalyticsModelSchema.getSelectModelSchema({
        modelType: modelType,
      });
    const sortSchema: AnalyticsModelSchemaType =
      AnalyticsModelSchema.getSortModelSchema({
        modelType: modelType,
      });
    const groupBySchema: AnalyticsModelSchemaType =
      AnalyticsModelSchema.getGroupByModelSchema({
        modelType: modelType,
      });

    registry.register(querySchemaName, querySchema);
    registry.register(selectSchemaName, selectSchema);
    registry.register(sortSchemaName, sortSchema);
    registry.register(groupBySchemaName, groupBySchema);
  }

  // Analytics API generation methods

  private static generateAnalyticsListApiSpec(data: {
    modelType: new () => AnalyticsBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const singularModelName: string = model.singularName || tableName;

    // Use schema names that are already registered
    const querySchemaName: string = `${tableName}QuerySchema`;
    const selectSchemaName: string = `${tableName}SelectSchema`;
    const sortSchemaName: string = `${tableName}SortSchema`;
    const groupBySchemaName: string = `${tableName}GroupBySchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/get-list`,
      operationId: `list${tableName}`,
      summary: `List ${singularModelName}`,
      description: `Endpoint to list all ${singularModelName} items`,
      tags: [singularModelName],
      parameters: [...OpenAPIUtil.getDefaultApiHeaders()],
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

  private static generateAnalyticsCountApiSpec(data: {
    modelType: new () => AnalyticsBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const singularModelName: string = model.singularName || tableName;

    // Use schema name that is already registered
    const querySchemaName: string = `${tableName}QuerySchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/count`,
      operationId: `count${tableName}`,
      summary: `Count ${singularModelName}`,
      description: `Endpoint to count ${singularModelName} items`,
      tags: [singularModelName],
      parameters: [...OpenAPIUtil.getDefaultApiHeaders()],
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

  private static generateAnalyticsCreateApiSpec(data: {
    modelType: new () => AnalyticsBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const singularModelName: string = model.singularName || tableName;

    // Skip generating create API if model has no create permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.getCreatePermissions())) {
      return;
    }

    // Use schema names that are already registered
    const createSchemaName: string = `${tableName}CreateSchema`;
    const readSchemaName: string = `${tableName}ReadSchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}`,
      operationId: `create${tableName}`,
      summary: `Create ${singularModelName}`,
      description: `Endpoint to create a new ${singularModelName}`,
      tags: [singularModelName],
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

  private static generateAnalyticsGetApiSpec(data: {
    modelType: new () => AnalyticsBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const singularModelName: string = model.singularName || tableName;

    // Skip generating get API if model has no read permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.getReadPermissions())) {
      return;
    }

    // Use schema name that is already registered
    const selectSchemaName: string = `${tableName}SelectSchema`;

    data.registry.registerPath({
      method: "post",
      path: `${model.crudApiPath}/{id}`,
      operationId: `get${tableName}`,
      summary: `Get ${singularModelName}`,
      description: `Endpoint to retrieve a single ${singularModelName} by ID`,
      tags: [singularModelName],
      parameters: [
        ...OpenAPIUtil.getDefaultApiHeaders(),
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

  private static generateAnalyticsUpdateApiSpec(data: {
    modelType: new () => AnalyticsBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const singularModelName: string = model.singularName || tableName;

    // Skip generating update API if model has no update permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.getUpdatePermissions())) {
      return;
    }

    // Use schema names that are already registered
    const updateSchemaName: string = `${tableName}UpdateSchema`;
    const readSchemaName: string = `${tableName}ReadSchema`;

    data.registry.registerPath({
      method: "put",
      path: `${model.crudApiPath}/{id}`,
      operationId: `update${tableName}`,
      summary: `Update ${singularModelName}`,
      description: `Endpoint to update an existing ${singularModelName}`,
      tags: [singularModelName],
      parameters: [
        ...OpenAPIUtil.getDefaultApiHeaders(),
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

  private static generateAnalyticsDeleteApiSpec(data: {
    modelType: new () => AnalyticsBaseModel;
    registry: OpenAPIRegistry;
  }): void {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();
    const tableName: string = model.tableName || "UnknownAnalyticsModel";
    const singularModelName: string = model.singularName || tableName;

    // Skip generating delete API if model has no delete permissions or contains Public/CurrentUser permissions
    if (this.shouldExcludeApiForPermissions(model.getDeletePermissions())) {
      return;
    }

    data.registry.registerPath({
      method: "delete",
      path: `${model.crudApiPath}/{id}`,
      operationId: `delete${tableName}`,
      summary: `Delete ${singularModelName}`,
      description: `Endpoint to delete a ${singularModelName}`,
      tags: [singularModelName],
      parameters: [
        ...OpenAPIUtil.getDefaultApiHeaders(),
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
}
