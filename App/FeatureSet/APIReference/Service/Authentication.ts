import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";

// Retrieve resources documentation
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    let pageTitle: string = "";
    let pageDescription: string = "";

    // Extract page parameter from request
    const page: string | undefined = req.params["page"];
    const pageData: Dictionary<unknown> = {};

    // Set default page title and description for the authentication page
    pageTitle = "Authentication";
    pageDescription = "Learn how to authenticate requests with OneUptime API";

    // Render the index page with the specified parameters
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
