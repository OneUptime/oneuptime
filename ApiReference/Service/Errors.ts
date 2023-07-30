import { ExpressRequest, ExpressResponse } from 'CommonServer/Utils/Express';
import ResourceUtil, { ModelDocumentation } from '../Utils/Resources';

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();

export default class ServiceHandler {
    public static async executeResponse(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        let pageTitle: string = '';
        let pageDescription: string = '';
        const page: string | undefined = req.params['page'];
        const pageData: any = {};

        pageTitle = 'Errors';
        pageDescription = 'Learn more about how we return errors from API';

        return res.render('pages/index', {
            page: page,
            resources: Resources,
            pageTitle: pageTitle,
            pageDescription: pageDescription,
            pageData: pageData,
        });
    }
}
