import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { buildRenderContext } from "../Utils/RenderContext";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

const resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const dataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const ctx: ReturnType<typeof buildRenderContext> = buildRenderContext(req);
    res.status(200);

    return res.render(`${ViewsPath}/pages/index`, {
      page: "status",
      pageTitle: "Status",
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: "200 - Success",
      resources: resources,
      dataTypes: dataTypes,
      pageData: {},
      lang: ctx.lang,
      t: ctx.t,
      supportedLanguages: ctx.supportedLanguages,
      currentPath: ctx.currentPath,
    });
  }
}
