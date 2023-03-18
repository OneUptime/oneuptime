import { ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import PageNotFoundServiceHandler from "./PageNotFound";

const Resources = ResourceUtil.getResources();
const ResourceDictionary = ResourceUtil.getReosurceDictionaryByPath();

export default class ServiceHandler { 
    public static async executeResponse(req: ExpressRequest, res: ExpressResponse): Promise<void> {

        let pageTitle: string = "";
        let pageDescription: string = "";
        let page = req.params['page'];
        let pageData: any = {};

        if(!page){
            return PageNotFoundServiceHandler.executeResponse(req, res)
        }


        const currentResource: ModelDocumentation | undefined = ResourceDictionary[page];

        if(!currentResource){
            return PageNotFoundServiceHandler.executeResponse(req, res)
        }

        // Resource Page. 
        pageTitle = currentResource.name;
        pageDescription = currentResource.description;
        pageData = {
            modelTableColumns: currentResource.model.getTableColumns().columns.map((columnName: string) => {
                return currentResource.model.getTableColumnMetadata(columnName);
            })
        }
        
        page = "model"

        return res.render('pages/index', {
            page: page,
            resources: Resources,
            pageTitle: pageTitle,
            pageDescription: pageDescription,
            pageData: pageData
        });
    }
}