import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize variables to hold page title and description
    let pageTitle: string = "";
    let pageDescription: string = "";

    // Get the requested page from the URL parameters
    const page: string | undefined = req.params["page"];
    const pageData: any = {};

    // Set the page title and description
    pageTitle = "Authentication";
    pageDescription = "Learn how to authenticate requests with OneUptime API";

    // Render the page with the required data
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}