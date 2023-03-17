import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import path from 'path';
import Models from "Model/Models/Index";
import Text from "Common/Types/Text";
import { TableColumnMetadata } from 'Common/Types/Database/TableColumn';
import BaseModel from 'Common/Models/BaseModel';

export interface ModelDocumentation {
    name: string;
    path: string;
    model: BaseModel;
    description: string;
}

const sortByName = (a: ModelDocumentation, b: ModelDocumentation) => {
    if (a.name < b.name) {
        return -1;
    }
    if (a.name > b.name) {
        return 1;
    }
    return 0;
}

const Resources: Array<ModelDocumentation> = Models.filter((model: typeof BaseModel) => {
    const modelInstance: BaseModel = new model();
    return modelInstance.enableDocumentation;
}).map((model: typeof BaseModel) => {

    const modelInstance: BaseModel = new model();

    return {
        name: modelInstance.singularName!,
        path: Text.pascalCaseToDashes(modelInstance.singularName as string),
        model: modelInstance,
        description: modelInstance.tableDescription!
    }
}).sort(sortByName);

const featuredResources = ['Monitor', 'Scheduled Maintenance Event', 'Status Page', 'Incident', 'Team', 'On Call Duty', 'Label', 'Team Member'];

const APP_NAME: string = 'docs';

const app: ExpressApplication = Express.getExpressApp();

// Set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Public static files
app.use(ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 }));

app.use(
    '/docs',
    ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

// Index page
app.get(['/docs'], (_req: ExpressRequest, res: ExpressResponse) => {
    return res.redirect('/docs/index');
});


// All Pages 
app.get(['/docs/:page'], (req: ExpressRequest, res: ExpressResponse) => {


    let pageTitle: string = "Home";
    let pageDescription: string = "API Documntation for OneUptime";

    let pageData: {
        featuredResources?: Array<ModelDocumentation> | undefined;
        modelTableColumns?: Array<TableColumnMetadata> | undefined;
    } = {
        
    };

    if (req.params['page'] === "permissions") {
        pageTitle = "Permissions"
        pageDescription = "Learn how permisisons work with OneUptime"
    }

    else if (req.params['page'] === "authentication") {
        pageTitle = "Authentication"
        pageDescription = "Learn how to authenticate requests with OneUptime"
    }

    else if (req.params['page'] === "errors") {
        pageTitle = "Errors"
        pageDescription = "Learn more about how we reuturn errors from API"
    }

    else if (req.params['page'] === "index") {
        pageData.featuredResources = Resources.filter((resource)=> featuredResources.includes(resource.name));
        pageTitle = "Home"
        pageDescription = "API Documntation for OneUptime";
    }

    const currentResource: ModelDocumentation | undefined = Resources.find((reosurce) => {
        return reosurce.path === req.params['page']
    });

    if (currentResource) {
        // Resource Page. 
        pageTitle = currentResource.name;
        pageDescription = currentResource.description;
        pageData = {
            modelTableColumns: currentResource.model.getTableColumns().columns.map((columnName: string) => {
                return currentResource.model.getTableColumnMetadata(columnName);
            })
        }
    }

    return res.render('pages/index', {
        page: req.params['page'],
        resources: Resources,
        pageTitle: pageTitle,
        pageDescription: pageDescription,
        pageData: pageData
    });
});

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();

export default app;
