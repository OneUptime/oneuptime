import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { buildRenderContext } from "../Utils/RenderContext";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import LocalFile from "Common/Server/Utils/LocalFile";
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

    pageData["responseCode"] = await LocalCache.getOrSetString(
      "pagination",
      "response",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/Pagination/Response.md`,
        );
      },
    );

    pageData["requestCode"] = await LocalCache.getOrSetString(
      "pagination",
      "request",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/Pagination/Request.md`,
        );
      },
    );

    return res.render(`${ViewsPath}/pages/index`, {
      page: "pagination",
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: ctx.t("pages.pagination.metaTitle"),
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: ctx.t("pages.pagination.metaDescription"),
      pageData: pageData,
      lang: ctx.lang,
      t: ctx.t,
      supportedLanguages: ctx.supportedLanguages,
      currentPath: ctx.currentPath,
    });
  }
}
