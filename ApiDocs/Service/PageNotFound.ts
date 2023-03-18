import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import ResourceUtil from "../Utils/Resources";

const Resources = ResourceUtil.getResources();

export default class ServiceHandler {
    public static async executeResponse(_req: ExpressRequest, res: ExpressResponse): Promise<void> {

        res.status(404);
        return res.render('pages/index', {
            page: "404",
            pageTitle: "Page Not Found",
            pageDescription: "Page you're looking for is not found.",
            resources: Resources,
            pageData: {}
        });
    }
}