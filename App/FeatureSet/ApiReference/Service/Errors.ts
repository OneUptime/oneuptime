import { ViewsPath } from ../Utils/Config;
import ResourceUtil, { ModelDocumentation } from ../Utils/Resources;
import { ExpressRequest, ExpressResponse } from CommonServer/Utils/Express;

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources(); // Get all resources from ResourceUtil

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize variables for page title and description
    let pageTitle: string = ;
    let pageDescription: string = ;
    const page: string | undefined = req.params[page]; // Get the page parameter from the request
    const pageData: any = {}; // Initialize an empty object for page data

    // Set the page title and description
    pageTitle = Errors;
    pageDescription = Learn more about how we return errors from API;

    // Render the page with the required data
    return res.render(, {
      page: page, // Pass the page parameter
      resources: Resources, // Pass all resources
      pageTitle: pageTitle, // Pass the page title
      pageDescription: pageDescription, // Pass the page description
      pageData: pageData, // Pass the page data
    });
  }
}

