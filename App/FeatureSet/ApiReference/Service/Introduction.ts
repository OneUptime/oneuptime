import { ExpressRequest, ExpressResponse } from 'CommonServer/Utils/Express';
import ResourceUtil, { ModelDocumentation } from '../Utils/Resources';
import { ViewsPath } from '../Utils/Config';

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const FeaturedResources: Array<ModelDocumentation> =
    ResourceUtil.getFeaturedResources();



export default class ServiceHandler {
    public static async executeResponse(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        let pageTitle: string = '';
        let pageDescription: string = '';
        const page: string | undefined = req.params['page'];
        const pageData: any = {};

        pageData.featuredResources = FeaturedResources;
        pageTitle = 'Introduction';
        pageDescription = 'API Documentation for OneUptime';

        return res.render(`${ViewsPath}/pages/index`, {
            page: page,
            resources: Resources,
            pageTitle: pageTitle,
            pageDescription: pageDescription,
            pageData: pageData,
        });
    }
}
