import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import ResourceUtil from "../Utils/Resources";
import LocalFile from 'CommonServer/Utils/LocalFile';
import LocalCache from "CommonServer/Infrastructure/LocalCache";

const Resources = ResourceUtil.getResources();

export default class ServiceHandler {
    public static async executeResponse(req: ExpressRequest, res: ExpressResponse): Promise<void> {

        let pageTitle: string = "";
        let pageDescription: string = "";
        let page = req.params['page'];
        let pageData: any = {};

        pageTitle = "Pagination"
        pageDescription = "Learn how to paginate requests with OneUptime API";

        pageData.responseCode = await LocalCache.getOrSetString("pagination", "response", async () => {
            return await LocalFile.read("/usr/src/app/CodeExamples/Pagination/Response.md");
        })

        pageData.requestCode = await LocalCache.getOrSetString("pagination", "request", async () => {
            return await LocalFile.read("/usr/src/app/CodeExamples/Pagination/Request.md");
        })

        return res.render('pages/index', {
            page: page,
            resources: Resources,
            pageTitle: pageTitle,
            pageDescription: pageDescription,
            pageData: pageData
        });
    }
}