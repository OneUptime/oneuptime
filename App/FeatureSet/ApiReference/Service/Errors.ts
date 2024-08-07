import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

// Fetch a list of resources used in the application
const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

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
    const pageData: any = {};

    // Set the default page title and description
    pageTitle = "Errors";
    pageDescription = "Learn more about how we return errors from API";

    // Render the response using the given view and data
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}
