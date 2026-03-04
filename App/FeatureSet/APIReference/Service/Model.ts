import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import CodeExampleGenerator, {
  CodeExamples,
} from "../Utils/CodeExampleGenerator";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import PageNotFoundServiceHandler from "./PageNotFound";
import { AppApiRoute } from "Common/ServiceRoute";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import LocalFile from "Common/Server/Utils/LocalFile";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

interface ExampleObjects {
  simpleSelectExample: JSONObject;
  simpleQueryExample: JSONObject;
  simpleSortExample: JSONObject;
  simpleCreateExample: JSONObject;
  simpleUpdateExample: JSONObject;
  simpleResponseExample: JSONObject;
  simpleListResponseExample: Array<JSONObject>;
}

interface ApiCodeExamples {
  list: CodeExamples;
  getItem: CodeExamples;
  count: CodeExamples;
  create: CodeExamples;
  update: CodeExamples;
  delete: CodeExamples;
}

// Helper function to get a default example value based on column type
function getDefaultExampleForType(
  columnType: string | undefined,
  columnTitle: string | undefined,
): JSONValue {
  const typeStr: string = (columnType || "").toLowerCase();
  const title: string = (columnTitle || "").toLowerCase();

  if (typeStr.includes("objectid") || typeStr.includes("id")) {
    return "550e8400-e29b-41d4-a716-446655440000";
  }
  if (typeStr.includes("boolean") || typeStr.includes("bool")) {
    return true;
  }
  if (
    typeStr.includes("number") ||
    typeStr.includes("int") ||
    typeStr.includes("decimal")
  ) {
    return 100;
  }
  if (typeStr.includes("date") || typeStr.includes("time")) {
    return "2024-01-15T10:30:00.000Z";
  }
  if (typeStr.includes("email")) {
    return "user@example.com";
  }
  if (typeStr.includes("phone")) {
    return "+1-555-123-4567";
  }
  if (typeStr.includes("url") || typeStr.includes("link")) {
    return "https://example.com";
  }
  if (typeStr.includes("color")) {
    return "#3498db";
  }
  if (
    typeStr.includes("markdown") ||
    typeStr.includes("longtext") ||
    typeStr.includes("description")
  ) {
    return `Example ${title || "text"} content`;
  }
  if (typeStr.includes("json") || typeStr.includes("object")) {
    return { key: "value" };
  }
  if (typeStr.includes("array")) {
    return [];
  }
  // Default for text fields
  return `Example ${title || "value"}`;
}

// Helper function to generate example objects from column metadata
function generateExampleObjects(
  tableColumns: Dictionary<TableColumnMetadata>,
  exampleObjectID: string,
): ExampleObjects {
  const simpleSelectExample: JSONObject = {};
  const simpleQueryExample: JSONObject = {};
  const simpleSortExample: JSONObject = {};
  const simpleCreateExample: JSONObject = {};
  const simpleUpdateExample: JSONObject = {};
  const simpleResponseExample: JSONObject = {
    _id: exampleObjectID,
  };

  // Sort columns: prioritize fields with examples, then required, then alphabetically
  const sortedColumnKeys: Array<string> = Object.keys(tableColumns).sort(
    (a: string, b: string) => {
      const aHasExample: boolean = tableColumns[a]?.example !== undefined;
      const bHasExample: boolean = tableColumns[b]?.example !== undefined;
      const aRequired: boolean = tableColumns[a]?.required || false;
      const bRequired: boolean = tableColumns[b]?.required || false;

      // Prioritize fields with examples
      if (aHasExample && !bHasExample) {
        return -1;
      }
      if (!aHasExample && bHasExample) {
        return 1;
      }
      // Then prioritize required fields
      if (aRequired && !bRequired) {
        return -1;
      }
      if (!aRequired && bRequired) {
        return 1;
      }
      return a.localeCompare(b);
    },
  );

  let selectCount: number = 0;
  let createCount: number = 0;
  let updateCount: number = 0;

  for (const key of sortedColumnKeys) {
    const column: TableColumnMetadata | undefined = tableColumns[key];
    if (!column) {
      continue;
    }

    const accessControl: ColumnAccessControl | undefined = (
      column as unknown as JSONObject
    )["permissions"] as ColumnAccessControl | undefined;

    // Get the example value - use defined example or generate a default
    const exampleValue: JSONValue =
      column.example !== undefined
        ? (column.example as JSONValue)
        : getDefaultExampleForType(column.type?.toString(), column.title);

    /*
     * Add to select example (limit to 5 fields for readability)
     * Also add the field to response example so response matches select
     */
    if (
      selectCount < 5 &&
      accessControl?.read &&
      accessControl.read.length > 0
    ) {
      simpleSelectExample[key] = true;
      simpleResponseExample[key] = exampleValue;
      selectCount++;
    }

    // Add to create example (only fields with create permission)
    if (
      createCount < 5 &&
      accessControl?.create &&
      accessControl.create.length > 0 &&
      !column.computed
    ) {
      simpleCreateExample[key] = exampleValue;
      createCount++;
    }

    // Add to update example (only fields with update permission)
    if (
      updateCount < 3 &&
      accessControl?.update &&
      accessControl.update.length > 0 &&
      !column.computed
    ) {
      simpleUpdateExample[key] = exampleValue;
      updateCount++;
    }
  }

  // Add a query example using the first string/text field with an example
  for (const key of sortedColumnKeys) {
    const column: TableColumnMetadata | undefined = tableColumns[key];
    if (column) {
      const exampleValue: JSONValue =
        column.example !== undefined
          ? (column.example as JSONValue)
          : getDefaultExampleForType(column.type?.toString(), column.title);

      if (
        typeof exampleValue === "string" &&
        column.type?.toString().toLowerCase().includes("text")
      ) {
        simpleQueryExample[key] = exampleValue;
        break;
      }
    }
  }

  // Add sort example - sort by createdAt descending if available
  simpleSortExample["createdAt"] = -1;

  // Generate list response with 3 sample items
  const simpleListResponseExample: Array<JSONObject> = [
    { ...simpleResponseExample, _id: exampleObjectID },
    {
      ...simpleResponseExample,
      _id: ObjectID.generate().toString(),
    },
    {
      ...simpleResponseExample,
      _id: ObjectID.generate().toString(),
    },
  ];

  return {
    simpleSelectExample,
    simpleQueryExample,
    simpleSortExample,
    simpleCreateExample,
    simpleUpdateExample,
    simpleResponseExample,
    simpleListResponseExample,
  };
}

// Helper function to generate code examples for all API operations
function generateApiCodeExamples(
  apiPath: string,
  exampleObjects: ExampleObjects,
  exampleObjectID: string,
): ApiCodeExamples {
  // List endpoint
  const listExamples: CodeExamples = CodeExampleGenerator.generate({
    method: "POST",
    endpoint: `${apiPath}/get-list?skip=0&limit=10`,
    body: {
      select: exampleObjects.simpleSelectExample,
      query: exampleObjects.simpleQueryExample,
      sort: exampleObjects.simpleSortExample,
    },
    description: "List items with pagination",
  });

  // Get item endpoint
  const getItemExamples: CodeExamples = CodeExampleGenerator.generate({
    method: "POST",
    endpoint: `${apiPath}/${exampleObjectID}/get-item`,
    body: {
      select: exampleObjects.simpleSelectExample,
    },
    description: "Get a single item by ID",
  });

  // Count endpoint
  const countExamples: CodeExamples = CodeExampleGenerator.generate({
    method: "POST",
    endpoint: `${apiPath}/count`,
    body: {
      query: exampleObjects.simpleQueryExample,
    },
    description: "Count items matching a query",
  });

  // Create endpoint
  const createExamples: CodeExamples = CodeExampleGenerator.generate({
    method: "POST",
    endpoint: apiPath,
    body: {
      data: exampleObjects.simpleCreateExample,
    },
    description: "Create a new item",
  });

  // Update endpoint
  const updateExamples: CodeExamples = CodeExampleGenerator.generate({
    method: "PUT",
    endpoint: `${apiPath}/${exampleObjectID}`,
    body: {
      data: exampleObjects.simpleUpdateExample,
    },
    description: "Update an existing item",
  });

  // Delete endpoint
  const deleteExamples: CodeExamples = CodeExampleGenerator.generate({
    method: "DELETE",
    endpoint: `${apiPath}/${exampleObjectID}`,
    description: "Delete an item by ID",
  });

  return {
    list: listExamples,
    getItem: getItemExamples,
    count: countExamples,
    create: createExamples,
    update: updateExamples,
    delete: deleteExamples,
  };
}

// Get all resources and resource dictionary
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();
const ResourceDictionary: Dictionary<ModelDocumentation> =
  ResourceUtil.getResourceDictionaryByPath();

// Dynamically built from DataTypes registry — no manual updates needed when new types are added
const TypeToDocPath: Dictionary<string> = DataTypeUtil.getTypeToDocPathMap();

// Get all permission props
const PermissionDictionary: Dictionary<PermissionProps> =
  PermissionHelper.getAllPermissionPropsAsDictionary();

export default class ServiceHandler {
  // Execute response for a given page
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    let pageTitle: string = "";
    let pageDescription: string = "";
    let page: string | undefined = req.params["page"];
    const pageData: Dictionary<unknown> = {};

    // Check if page is provided
    if (!page) {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    // Get current resource
    const currentResource: ModelDocumentation | undefined =
      ResourceDictionary[page];

    // Check if current resource exists
    if (!currentResource) {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    // Set page title and description
    pageTitle = currentResource.name;
    pageDescription = currentResource.description;

    page = "model";

    // Get table columns for current resource
    const tableColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      currentResource.model,
    );

    // Filter out columns with no access
    for (const key in tableColumns) {
      const accessControl: ColumnAccessControl | null =
        currentResource.model.getColumnAccessControlFor(key);

      if (!accessControl) {
        delete tableColumns[key];
        continue;
      }

      if (
        accessControl?.create.length === 0 &&
        accessControl?.read.length === 0 &&
        accessControl?.update.length === 0
      ) {
        delete tableColumns[key];
        continue;
      }

      if (tableColumns[key] && tableColumns[key]!.hideColumnInDocumentation) {
        delete tableColumns[key];
        continue;
      }

      if (tableColumns[key]) {
        (tableColumns[key] as any).permissions = accessControl;
      }
    }

    // Remove unnecessary columns
    delete tableColumns["deletedAt"];
    delete tableColumns["deletedByUserId"];
    delete tableColumns["deletedByUser"];
    delete tableColumns["version"];

    // For columns with a modelType (Entity/EntityArray), resolve the related model's documentation path
    for (const key in tableColumns) {
      const column: TableColumnMetadata | undefined = tableColumns[key];
      if (column?.modelType) {
        try {
          const relatedModelInstance: BaseModel = new column.modelType();
          if (relatedModelInstance.enableDocumentation) {
            (column as any).modelDocumentationPath =
              relatedModelInstance.getAPIDocumentationPath();
            (column as any).modelName = relatedModelInstance.singularName;
          }
        } catch {
          // If model instantiation fails, skip linking
        }
      }

      // Resolve non-entity complex types to their documentation paths
      if (column?.type && !(column as any).modelDocumentationPath) {
        const typeStr: string = column.type.toString();
        const docPath: string | undefined = TypeToDocPath[typeStr];
        if (docPath) {
          (column as any).typeDocumentationPath = docPath;
        }
      }
    }

    // Set page data
    pageData["title"] = currentResource.model.singularName;
    pageData["description"] = currentResource.model.tableDescription;
    pageData["columns"] = tableColumns;

    pageData["tablePermissions"] = {
      read: currentResource.model.readRecordPermissions.map(
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
      update: currentResource.model.updateRecordPermissions.map(
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
      delete: currentResource.model.deleteRecordPermissions.map(
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
      create: currentResource.model.createRecordPermissions.map(
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
    };

    // Cache the list request data
    pageData["listRequest"] = await LocalCache.getOrSetString(
      "model",
      "list-request",
      async () => {
        // Read the list request data from a file
        return await LocalFile.read(`${CodeExamplesPath}/Model/ListRequest.md`);
      },
    );

    // Cache the item request data
    pageData["itemRequest"] = await LocalCache.getOrSetString(
      "model",
      "item-request",
      async () => {
        // Read the item request data from a file
        return await LocalFile.read(`${CodeExamplesPath}/Model/ItemRequest.md`);
      },
    );

    // Cache the item response data
    pageData["itemResponse"] = await LocalCache.getOrSetString(
      "model",
      "item-response",
      async () => {
        // Read the item response data from a file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/ItemResponse.md`,
        );
      },
    );

    // Cache the count request data
    pageData["countRequest"] = await LocalCache.getOrSetString(
      "model",
      "count-request",
      async () => {
        // Read the count request data from a file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CountRequest.md`,
        );
      },
    );

    // Cache the count response data
    pageData["countResponse"] = await LocalCache.getOrSetString(
      "model",
      "count-response",
      async () => {
        // Read the CountResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CountResponse.md`,
        );
      },
    );

    pageData["updateRequest"] = await LocalCache.getOrSetString(
      "model",
      "update-request",
      async () => {
        // Read the UpdateRequest.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/UpdateRequest.md`,
        );
      },
    );

    pageData["updateResponse"] = await LocalCache.getOrSetString(
      "model",
      "update-response",
      async () => {
        // Read the UpdateResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/UpdateResponse.md`,
        );
      },
    );

    pageData["createRequest"] = await LocalCache.getOrSetString(
      "model",
      "create-request",
      async () => {
        // Read the CreateRequest.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CreateRequest.md`,
        );
      },
    );

    pageData["createResponse"] = await LocalCache.getOrSetString(
      "model",
      "create-response",
      async () => {
        // Read the CreateResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CreateResponse.md`,
        );
      },
    );

    pageData["deleteRequest"] = await LocalCache.getOrSetString(
      "model",
      "delete-request",
      async () => {
        // Read the DeleteRequest.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/DeleteRequest.md`,
        );
      },
    );

    pageData["deleteResponse"] = await LocalCache.getOrSetString(
      "model",
      "delete-response",
      async () => {
        // Read the DeleteResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/DeleteResponse.md`,
        );
      },
    );

    // Get list response from cache or set it if it's not available
    pageData["listResponse"] = await LocalCache.getOrSetString(
      "model",
      "list-response",
      async () => {
        // Read the list response from a file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/ListResponse.md`,
        );
      },
    );

    // Generate a unique ID for the example object
    const exampleObjectID: string = ObjectID.generate().toString();
    pageData["exampleObjectID"] = exampleObjectID;

    // Generate dynamic example objects from column metadata
    const exampleObjects: ExampleObjects = generateExampleObjects(
      tableColumns,
      exampleObjectID,
    );
    pageData["exampleObjects"] = exampleObjects;

    // Construct the API path for the current resource
    const apiPath: string =
      AppApiRoute.toString() + currentResource.model.crudApiPath?.toString();
    pageData["apiPath"] = apiPath;

    // Generate code examples for all languages
    const codeExamples: ApiCodeExamples = generateApiCodeExamples(
      apiPath,
      exampleObjects,
      exampleObjectID,
    );
    pageData["codeExamples"] = codeExamples;

    // Check if the current resource is a master admin API
    pageData["isMasterAdminApiDocs"] =
      currentResource.model.isMasterAdminApiDocs;

    // Render the index page with the required data
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: pageTitle,
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}
