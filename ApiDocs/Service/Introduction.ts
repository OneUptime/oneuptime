import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import ResourceUtil from "../Utils/Resources";

const Resources = ResourceUtil.getResources();
const FeaturedResources = ResourceUtil.getFeaturedResources();

export default class ServiceHandler { 
    public static async executeResponse(req: ExpressRequest, res: ExpressResponse): Promise<void> {

        let pageTitle: string = "";
        let pageDescription: string = "";
        let page = req.params['page'];
        let pageData: any = {};

        pageData.featuredResources = FeaturedResources;
        pageTitle = "Introduction"
        pageDescription = "API Documentation for OneUptime";

        return res.render('pages/index', {
            page: page,
            resources: Resources,
            pageTitle: pageTitle,
            pageDescription: pageDescription,
            pageData: pageData
        });
    }
}