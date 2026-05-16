import {
  Host,
  HttpProtocol,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { buildRenderContext } from "../Utils/RenderContext";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const ctx: ReturnType<typeof buildRenderContext> = buildRenderContext(req);
    const pageData: Dictionary<unknown> = {
      hostUrl: new URL(HttpProtocol, Host).toString(),
    };

    return res.render(`${ViewsPath}/pages/index`, {
      page: "openapi",
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: ctx.t("pages.openapi.metaTitle"),
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: ctx.t("pages.openapi.metaDescription"),
      pageData: pageData,
      lang: ctx.lang,
      t: ctx.t,
      supportedLanguages: ctx.supportedLanguages,
      currentPath: ctx.currentPath,
    });
  }
}
