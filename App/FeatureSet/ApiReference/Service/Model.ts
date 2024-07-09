import { CodeExamplesPath, ViewsPath } from ../Utils/Config;
import ResourceUtil, { ModelDocumentation } from ../Utils/Resources;
import PageNotFoundServiceHandler from ./PageNotFound;
import { AppApiRoute } from Common/ServiceRoute;
import { ColumnAccessControl } from Common/Types/BaseDatabase/AccessControl;
import { getTableColumns } from Common/Types/Database/TableColumn;
import Dictionary from Common/Types/Dictionary;
import ObjectID from Common/Types/ObjectID;
import Permission, {
  PermissionHelper,
  PermissionProps,
} from Common/Types/Permission;
import LocalCache from CommonServer/Infrastructure/LocalCache;
import { ExpressRequest, ExpressResponse } from CommonServer/Utils/Express;
import LocalFile from CommonServer/Utils/LocalFile;

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const ResourceDictionary: Dictionary<ModelDocumentation> =
  ResourceUtil.getResourceDictionaryByPath();

const PermissionDictionary: Dictionary<PermissionProps> =
  PermissionHelper.getAllPermissionPropsAsDictionary();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    let pageTitle: string = ;
    let pageDescription: string = ;
    let page: string | undefined = req.params[page];
    const pageData: any = {};

    if (!page) {
      // If no page is provided, return a 404 page
      return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    const currentResource: ModelDocumentation | undefined =
      ResourceDictionary[page];

    if (!currentResource) {
      // If the current resource is not found, return a 404 page
      return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    // Get the page title and description from the current resource
    pageTitle = currentResource.name;
    pageDescription = currentResource.description;

    page = model; // Not sure why this is set to model, it seems unnecessary

    const tableColumns: any = getTableColumns(currentResource.model);

    for (const key in tableColumns) {
      const accessControl: ColumnAccessControl | null =
        currentResource.model.getColumnAccessControlFor(key);

      if (!accessControl) {
        // Remove columns with no access control
        delete tableColumns[key];
        continue;
      }

      if (
        accessControl?.create.length === 0 &&
        accessControl?.read.length === 0 &&
        accessControl?.update.length === 0
      ) {
        // Remove columns with no access
        delete tableColumns[key];
        continue;
      }

      tableColumns[key].permissions = accessControl;
    }

    // Remove unnecessary columns
    delete tableColumns[deletedAt];
    delete tableColumns[deletedByUserId];
    delete tableColumns[deletedByUser];
    delete tableColumns[version];

    pageData.title = currentResource.model.singularName;
    pageData.description = currentResource.model.tableDescription;
    pageData.columns = tableColumns;

Here is the improved code with comments:

    // Create table permissions based on read, update, delete, and create permissions
    pageData.tablePermissions = {
      read: currentResource.model.readRecordPermissions.map(
        // Map each permission to its corresponding value in PermissionDictionary
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
      update: currentResource.model.updateRecordPermissions.map(
        // Map each permission to its corresponding value in PermissionDictionary
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
      delete: currentResource.model.deleteRecordPermissions.map(
        // Map each permission to its corresponding value in PermissionDictionary
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
      create: currentResource.model.createRecordPermissions.map(
        // Map each permission to its corresponding value in PermissionDictionary
        (permission: Permission) => {
          return PermissionDictionary[permission];
        },
      ),
    };

    // Get or set a string in the LocalCache for list request
    pageData.listRequest = await LocalCache.getOrSetString(
      model,
      list-request,
      async () => {
        // Read the ListRequest.md file from CodeExamplesPath
        return await LocalFile.read();
      },
    );

    // Get or set a string in the LocalCache for item request
    pageData.itemRequest = await LocalCache.getOrSetString(
      model,
      item-request,
      async () => {
        // Read the ItemRequest.md file from CodeExamplesPath
        return await LocalFile.read();
      },
    );

    // Get or set a string in the LocalCache for item response
    pageData.itemResponse = await LocalCache.getOrSetString(
      model,
      item-response,
      async () => {
        // Read the ItemResponse.md file from CodeExamplesPath
        return await LocalFile.read(
          ,
        );
      },
    );

    // Get or set a string in the LocalCache for count request
    pageData.countRequest = await LocalCache.getOrSetString(
      model,
      count-request,
      async () => {
        // Read the CountRequest.md file from CodeExamplesPath
        return await LocalFile.read(
          ,
        );
      },
    );

    // Get or set a string in the LocalCache for count response
    pageData.countResponse = await LocalCache.getOrSetString(
      model,
      count-response,
Here is the code with improved comments:

    // This is an asynchronous function that reads a file from the local file system
    async () => {
      return await LocalFile.read(
        ,
      );
    },
    );

    // This sets a cache for the update request
    pageData.updateRequest = await LocalCache.getOrSetString(
      model, // This is the cache key
      update-request, // This is the cache key
      async () => { // This is the asynchronous function that populates the cache
        // This reads a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

    // This sets a cache for the update response
    pageData.updateResponse = await LocalCache.getOrSetString(
      model, // This is the cache key
      update-response, // This is the cache key
      async () => { // This is the asynchronous function that populates the cache
        // This reads a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

    // This sets a cache for the create request
    pageData.createRequest = await LocalCache.getOrSetString(
      model, // This is the cache key
      create-request, // This is the cache key
      async () => { // This is the asynchronous function that populates the cache
        // This reads a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

    // This sets a cache for the create response
    pageData.createResponse = await LocalCache.getOrSetString(
      model, // This is the cache key
      create-response, // This is the cache key
      async () => { // This is the asynchronous function that populates the cache
        // This reads a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

    // This sets a cache for the delete request
    pageData.deleteRequest = await LocalCache.getOrSetString(
      model, // This is the cache key
      delete-request, // This is the cache key
      async () => { // This is the asynchronous function that populates the cache
        // This reads a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

    // This sets a cache for the delete response
    pageData.deleteResponse = await LocalCache.getOrSetString(
      model, // This is the cache key
      delete-response, // This is the cache key
      async () => { // This is the asynchronous function that populates the cache
        // This reads a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

Here is the improved code with comments:

    // This line is returning the result of the function
          },
    );

    // This line is getting or setting a string value in the local cache
    pageData.listResponse = await LocalCache.getOrSetString(
      model,
      list-response,
      async () => {
        // This line is reading a file from the local file system
        return await LocalFile.read(
          ,
        );
      },
    );

    // This line is generating a unique object ID
    pageData.exampleObjectID = ObjectID.generate();

    // This line is constructing the API path based on the app API route and the current resource's CRUD API path
    pageData.apiPath =
      AppApiRoute.toString() + currentResource.model.crudApiPath?.toString();

    // This line is checking if the current resource's model is a master admin API docs
    pageData.isMasterAdminApiDocs = currentResource.model.isMasterAdminApiDocs;

    // This line is rendering the index page with the required data
    return res.render(, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}
