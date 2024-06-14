import { CodeExamplesPath, ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import LocalCache from "CommonServer/Infrastructure/LocalCache";
import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import LocalFile from "CommonServer/Utils/LocalFile";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    let pageTitle: string = "";
    let pageDescription: string = "";
    const page: string | undefined = req.params["page"];
    const pageData: any = {};

    pageTitle = "Pagination";
    pageDescription = "Learn how to paginate requests with OneUptime API";

    pageData.responseCode = await LocalCache.getOrSetString(
      "pagination",
      "response",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/Pagination/Response.md`,
        );
      },
    );

    pageData.requestCode = await LocalCache.getOrSetString(
      "pagination",
      "request",
      async () => {
        return await LocalFile.read(
          `${CodeExamplesPath}/Pagination/Request.md`,
        );
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
