import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";

// Get all resources from ResourceUtil
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    // The _req parameter is not used in the function
    _req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Set the HTTP status code to 200
    res.status(200);
    // Render the index page with the given data
    return res.render(`${ViewsPath}/pages/index`, {
      // Set the page type to "status"
      page: "status",
      // Set the page title to "Status"
      pageTitle: "Status",
      // Set the page description to "200 - Success"
      pageDescription: "200 - Success",
      // Pass the resources array to the page
      resources: Resources,
      // Pass an empty pageData object to the page
      pageData: {},
    });
  }
}