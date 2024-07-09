import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources(); // Get all resources from ResourceUtil

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize variables
    let pageTitle: string = "";
    let pageDescription: string = "";
    const page: string | undefined = req.params["page"];
    const pageData: any = {};

    // Set page title and description
    pageTitle = "Errors";
    pageDescription = "Learn more about how we return errors from API";

    // Render the page
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources, // Pass resources to the view
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData, // Pass empty page data to the view
    });
  }
}