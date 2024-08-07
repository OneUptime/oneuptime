import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import PageNotFoundServiceHandler from "./PageNotFound";
import { AppApiRoute } from "Common/ServiceRoute";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { getTableColumns } from "Common/Types/Database/TableColumn";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import LocalFile from "Common/Server/Utils/LocalFile";

// Get all resources and resource dictionary
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const ResourceDictionary: Dictionary<ModelDocumentation> =
  ResourceUtil.getResourceDictionaryByPath();

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
    const pageData: any = {};

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
    const tableColumns: any = getTableColumns(currentResource.model);

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

      tableColumns[key].permissions = accessControl;
    }

    // Remove unnecessary columns
    delete tableColumns["deletedAt"];
    delete tableColumns["deletedByUserId"];
    delete tableColumns["deletedByUser"];
    delete tableColumns["version"];

    // Set page data
    pageData.title = currentResource.model.singularName;
    pageData.description = currentResource.model.tableDescription;
    pageData.columns = tableColumns;

    pageData.tablePermissions = {
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
    pageData.listRequest = await LocalCache.getOrSetString(
      "model",
      "list-request",
      async () => {
        // Read the list request data from a file
        return await LocalFile.read(`${CodeExamplesPath}/Model/ListRequest.md`);
      },
    );

    // Cache the item request data
    pageData.itemRequest = await LocalCache.getOrSetString(
      "model",
      "item-request",
      async () => {
        // Read the item request data from a file
        return await LocalFile.read(`${CodeExamplesPath}/Model/ItemRequest.md`);
      },
    );

    // Cache the item response data
    pageData.itemResponse = await LocalCache.getOrSetString(
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
    pageData.countRequest = await LocalCache.getOrSetString(
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
    pageData.countResponse = await LocalCache.getOrSetString(
      "model",
      "count-response",
      async () => {
        // Read the CountResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CountResponse.md`,
        );
      },
    );

    pageData.updateRequest = await LocalCache.getOrSetString(
      "model",
      "update-request",
      async () => {
        // Read the UpdateRequest.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/UpdateRequest.md`,
        );
      },
    );

    pageData.updateResponse = await LocalCache.getOrSetString(
      "model",
      "update-response",
      async () => {
        // Read the UpdateResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/UpdateResponse.md`,
        );
      },
    );

    pageData.createRequest = await LocalCache.getOrSetString(
      "model",
      "create-request",
      async () => {
        // Read the CreateRequest.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CreateRequest.md`,
        );
      },
    );

    pageData.createResponse = await LocalCache.getOrSetString(
      "model",
      "create-response",
      async () => {
        // Read the CreateResponse.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/CreateResponse.md`,
        );
      },
    );

    pageData.deleteRequest = await LocalCache.getOrSetString(
      "model",
      "delete-request",
      async () => {
        // Read the DeleteRequest.md file
        return await LocalFile.read(
          `${CodeExamplesPath}/Model/DeleteRequest.md`,
        );
      },
    );

    pageData.deleteResponse = await LocalCache.getOrSetString(
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
    pageData.listResponse = await LocalCache.getOrSetString(
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
    pageData.exampleObjectID = ObjectID.generate();

    // Construct the API path for the current resource
    pageData.apiPath =
      AppApiRoute.toString() + currentResource.model.crudApiPath?.toString();

    // Check if the current resource is a master admin API
    pageData.isMasterAdminApiDocs = currentResource.model.isMasterAdminApiDocs;

    // Render the index page with the required data
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}
