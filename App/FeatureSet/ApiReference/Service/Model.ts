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
    // Get the page name and description from the request
    let pageTitle: string = ;
    let pageDescription: string = ;
    let page: string | undefined = req.params[page];
    const pageData: any = {};

    // If no page is provided, return a 404 error
    if (!page) {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    // Get the current resource from the resource dictionary
    const currentResource: ModelDocumentation | undefined =
      ResourceDictionary[page];

    // If the current resource is not found, return a 404 error
    if (!currentResource) {
      return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    // Set the page title and description
    pageTitle = currentResource.name;
    pageDescription = currentResource.description;

    page = model;

    // Get the table columns for the current resource
    const tableColumns: any = getTableColumns(currentResource.model);

    // Iterate over the table columns and remove columns with no access
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
    delete tableColumns[deletedAt];
    delete tableColumns[deletedByUserId];
    delete tableColumns[deletedByUser];
    delete tableColumns[version];

    // Set the page data
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

    // Get the request and response files for the current resource
    pageData.listRequest = await LocalCache.getOrSetString(
      model,
      list-request,
      async () => {
        return await LocalFile.read();
      },
    );

    pageData.itemRequest = await LocalCache.getOrSetString(
      model,
      item-request,
      async () => {
        return await LocalFile.read();
      },
    );

    pageData.itemResponse = await LocalCache.getOrSetString(
      model,
      item-response,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.countRequest = await LocalCache.getOrSetString(
      model,
      count-request,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.countResponse = await LocalCache.getOrSetString(
      model,
      count-response,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.updateRequest = await LocalCache.getOrSetString(
      model,
      update-request,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.updateResponse = await LocalCache.getOrSetString(
      model,
      update-response,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.createRequest = await LocalCache.getOrSetString(
      model,
      create-request,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.createResponse = await LocalCache.getOrSetString(
      model,
      create-response,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.deleteRequest = await LocalCache.getOrSetString(
      model,
      delete-request,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.deleteResponse = await LocalCache.getOrSetString(
      model,
      delete-response,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.listResponse = await LocalCache.getOrSetString(
      model,
      list-response,
      async () => {
        return await LocalFile.read(
          ,
        );
      },
    );

    pageData.exampleObjectID = ObjectID.generate();

    pageData.apiPath =
      AppApiRoute.toString() + currentResource.model.crudApiPath?.toString();

    pageData.isMasterAdminApiDocs = currentResource.model.isMasterAdminApiDocs;

    // Render the page
    return res.render(, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}

