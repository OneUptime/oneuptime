import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import LocalFile from "Common/Server/Utils/LocalFile";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources(); // Get all resources from ResourceUtil
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    let pageTitle: string = ""; // Initialize page title
    let pageDescription: string = ""; // Initialize page description
    const page: string | undefined = req.params["page"]; // Get the page parameter from the request
    const pageData: Dictionary<unknown> = {}; // Initialize page data object

    // Set page title and description
    pageTitle = "Pagination";
    pageDescription = "Learn how to paginate requests with OneUptime API";

    // Get response and request code from LocalCache or LocalFile
    pageData["responseCode"] = await LocalCache.getOrSetString(
      "pagination",
      "response",
      async () => {
        // Read Response.md file from CodeExamplesPath
        return await LocalFile.read(
          `${CodeExamplesPath}/Pagination/Response.md`,
        );
      },
    );

    pageData["requestCode"] = await LocalCache.getOrSetString(
      "pagination",
      "request",
      async () => {
        // Read Request.md file from CodeExamplesPath
        return await LocalFile.read(
          `${CodeExamplesPath}/Pagination/Request.md`,
        );
      },
    );

    // Render the page with the page data
    return res.render(`${ViewsPath}/pages/index`, {
      page: page, // Pass the page parameter
      resources: Resources, // Pass all resources
      dataTypes: DataTypes,
      pageTitle: pageTitle,
      enableGoogleTagManager: IsBillingEnabled, // Pass the page title
      pageDescription: pageDescription, // Pass the page description
      pageData: pageData, // Pass the page data
    });
  }
}
