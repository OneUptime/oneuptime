import {
  Host,
  HttpProtocol,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";

// Fetch a list of resources used in the application
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  // Handles the HTTP response for a given request
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    let pageTitle: string = "";
    let pageDescription: string = "";

    // Get the 'page' parameter from the request
    const page: string | undefined = req.params["page"];
    const pageData: Dictionary<unknown> = {
      hostUrl: new URL(HttpProtocol, Host).toString(),
    };

    // Set the default page title and description
    pageTitle = "OneUptime OpenAPI Specification";
    pageDescription =
      "Learn more about the OpenAPI specification for OneUptime";

    // Render the response using the given view and data
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
