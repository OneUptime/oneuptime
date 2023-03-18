import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import ResourceUtil from "../Utils/Resources";

const Resources = ResourceUtil.getResources();

export default class ServiceHandler { 
    public static async executeResponse(req: ExpressRequest, res: ExpressResponse): Promise<void> {

        let pageTitle: string = "";
        let pageDescription: string = "";
        let page = req.params['page'];
        let pageData: any = {};

        pageTitle = "Errors"
        pageDescription = "Learn more about how we reuturn errors from API"

        return res.render('pages/index', {
            page: page,
            resources: Resources,
            pageTitle: pageTitle,
            pageDescription: pageDescription,
            pageData: pageData
        });
    }
}