import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { buildRenderContext } from "../Utils/RenderContext";
import {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
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
    const ctx: ReturnType<typeof buildRenderContext> = buildRenderContext(req);
    const pageData: Dictionary<unknown> = {};

    const tenantPermissions: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps().filter((i: PermissionProps) => {
        return i.isAssignableToTenant;
      });

    const permissionGroups: Array<{
      group: string;
      permissions: Array<PermissionProps>;
    }> = [];

    for (const group of Object.values(PermissionGroup)) {
      const groupPermissions: Array<PermissionProps> = tenantPermissions.filter(
        (p: PermissionProps) => {
          return p.group === group;
        },
      );

      if (groupPermissions.length > 0) {
        permissionGroups.push({
          group: group,
          permissions: groupPermissions,
        });
      }
    }

    pageData["permissionGroups"] = permissionGroups;

    return res.render(`${ViewsPath}/pages/index`, {
      page: "permissions",
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: ctx.t("pages.permissions.metaTitle"),
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: ctx.t("pages.permissions.metaDescription"),
      pageData: pageData,
      lang: ctx.lang,
      t: ctx.t,
      supportedLanguages: ctx.supportedLanguages,
      currentPath: ctx.currentPath,
    });
  }
}
