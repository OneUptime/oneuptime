import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    res.status(200);
    return res.render(`${ViewsPath}/pages/index`, {
      page: "status",
      pageTitle: "Status",
      pageDescription: "200 - Success",
      resources: Resources,
      pageData: {},
    });
  }
}
