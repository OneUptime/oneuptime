import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources(); // Get all resources from ResourceUtil

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize page title and description
    let pageTitle: string = "";
    let pageDescription: string = "";
    const page: string | undefined = req.params["page"]; // Get the page parameter from the request
    const pageData: any = {}; // Initialize an empty object to hold page data

    // Set page title and description
    pageTitle = "Permissions";
    pageDescription = "Learn how permissions work with OneUptime";

    // Filter permissions to only include those that are assignable to tenants
    pageData.permissions = PermissionHelper.getAllPermissionProps().filter(
      (i: PermissionProps) => {
        return i.isAssignableToTenant; // This line is hard to understand without a comment
        // It's filtering permissions based on the 'isAssignableToTenant' property
      },
    );

    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      pageTitle: pageTitle,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}