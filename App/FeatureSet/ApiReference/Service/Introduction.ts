import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";

// Get all resources and featured resources from ResourceUtil
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const FeaturedResources: Array<ModelDocumentation> =
  ResourceUtil.getFeaturedResources();

export default class ServiceHandler {
  // Handle the API request
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize page title and description
    let pageTitle: string = "";
    let pageDescription: string = "";

    // Get the requested page from the URL parameters
    const page: string | undefined = req.params["page"];
    const pageData: any = {};

    // Set featured resources for the page
    pageData.featuredResources = FeaturedResources;

    // Set page title and description
    pageTitle = "Introduction";
    pageDescription = "API Reference for OneUptime";

    // Render the index page with the required data
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}
