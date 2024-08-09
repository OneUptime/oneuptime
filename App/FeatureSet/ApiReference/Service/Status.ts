import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

// Get resources from ResourceUtil
const resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    _req: ExpressRequest, // Ignore request object
    res: ExpressResponse,
  ): Promise<void> {
    // Set HTTP status to 200
    res.status(200);

    return res.render(`${ViewsPath}/pages/index`, {
      // Render index page with necessary data
      page: "status",
      pageTitle: "Status",
      pageDescription: "200 - Success",
      resources: resources, // Pass resources to the template
      pageData: {}, // Pass empty data to the template
    });
  }
}
