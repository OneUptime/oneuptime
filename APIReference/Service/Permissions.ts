import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // Initialize page title and description
    let pageTitle: string = "";
    let pageDescription: string = "";

    // Get the requested page
    const page: string | undefined = req.params["page"];
    const pageData: Dictionary<unknown> = {};

    // Set page title and description
    pageTitle = "Permissions";
    pageDescription = "Learn how permissions work with OneUptime";

    // Filter permissions to only include those assignable to tenants
    pageData["permissions"] = PermissionHelper.getAllPermissionProps().filter(
      (i: PermissionProps) => {
        return i.isAssignableToTenant;
      },
    );

    // Render the page
    return res.render(`${ViewsPath}/pages/index`, {
      page: page,
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: pageTitle,
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: pageDescription,
      pageData: pageData,
    });
  }
}
