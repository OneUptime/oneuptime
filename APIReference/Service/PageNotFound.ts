import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources(); // Get an array of model documentation resources
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  // This is a static method that handles the response
  public static async executeResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Set the HTTP status code to 404 (Not Found)
    res.status(404);

    // Render the 'index' page with the given data
    return res.render(`${ViewsPath}/pages/index`, {
      page: "404", // The page type (404 in this case)
      pageTitle: "Page Not Found", // The page title
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: "Page you're looking for is not found.", // The page description
      resources: Resources, // The array of model documentation resources
      dataTypes: DataTypes,
      pageData: {}, // An empty object to hold any additional page data
    });
  }
}
