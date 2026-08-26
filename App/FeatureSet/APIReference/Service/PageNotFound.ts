import { GoogleTagManagerEnabled } from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { buildRenderContext } from "../Utils/RenderContext";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const ctx: ReturnType<typeof buildRenderContext> = buildRenderContext(req);
    res.status(404);

    return res.render(`${ViewsPath}/pages/index`, {
      page: "404",
      pageTitle: ctx.t("ui.pageNotFoundMetaTitle"),
      enableGoogleTagManager: GoogleTagManagerEnabled,
      pageDescription: ctx.t("ui.pageNotFoundMetaDescription"),
      resources: Resources,
      dataTypes: DataTypes,
      pageData: {},
      ...ctx,
    });
  }
}
