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
    model: BaseModel
}

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


    const sortByName = (a: ModelDocumentation, b: ModelDocumentation) => {
        if (a.name < b.name) {
            return -1;
        }
        if (a.name > b.name) {
            return 1;
        }
        return 0;
    }

    const resources: Array<ModelDocumentation> = Models.filter((model: typeof BaseModel) => {
        const modelInstance: BaseModel = new model();
        return modelInstance.enableDocumentation;
    }).map((model: typeof BaseModel) => {

        const modelInstance: BaseModel = new model();

        return {
            name: modelInstance.singularName!,
            path: Text.pascalCaseToDashes(modelInstance.singularName as string),
            model: modelInstance
        }
    }).sort(sortByName);

    let pageTitle: string = "Home";

    if (req.params['page'] === "quickstart") {
        pageTitle = "Quickstart"
    }

    else if (req.params['page'] === "authentication") {
        pageTitle = "Authentication"
    }

    else if (req.params['page'] === "errors") {
        pageTitle = "Errors"
    }

    else if (req.params['page'] === "index") {
        pageTitle = "Home"
    }


    let modelTableColumns: Array<TableColumnMetadata> = []

    const currentResource: ModelDocumentation | undefined = resources.find((reosurce) => {
        return reosurce.path === req.params['page']
    });

    if (currentResource) {
        pageTitle = currentResource.name;
        modelTableColumns = currentResource.model.getTableColumns().columns.map((columnName: string) => {
            return currentResource.model.getTableColumnMetadata(columnName);
        });
    }

    return res.render('pages/index', {
        page: req.params['page'],
        resources: resources,
        pageTitle: pageTitle,
        modelTableColumns: modelTableColumns
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
