import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

// Retrieve resources from ResourceUtil
const resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    _req: ExpressRequest, // Ignore request object
    res: ExpressResponse,
  ): Promise<void> {
    // Set HTTP status to 200
    res.status(200);

    // Render index page with necessary data
    return res.render(`${ViewsPath}/pages/index`, {
      page: "status",
      pageTitle: "Status",
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: "200 - Success",
      resources: resources, // Pass resources to the template
      pageData: {}, // Pass empty data to the template
    });
  }
}
