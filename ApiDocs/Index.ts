import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import path from 'path';
import ResourceUtil, { ModelDocumentation } from './Utils/Resources';
import IntroductionServiceHandler from './Service/Introduction';
import ErrorServiceHandler from './Service/Errors';
import PermissionServiceHandler from './Service/Permissions';
import AuthenticationServiceHandler from './Service/Authentication';
import PageNotFoundServiceHandler from './Service/PageNotFound';
import ModelServiceHandler from './Service/Model';
import PaginationServiceHandler from './Service/Pagination';
import Dictionary from 'Common/Types/Dictionary';

const ResourceDictionary: Dictionary<ModelDocumentation> =
    ResourceUtil.getReosurceDictionaryByPath();

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
    return res.redirect('/docs/introduction');
});

app.get(
    ['/docs/page-not-found'],
    (req: ExpressRequest, res: ExpressResponse) => {
        return PageNotFoundServiceHandler.executeResponse(req, res);
    }
);

// All Pages
app.get(['/docs/:page'], (req: ExpressRequest, res: ExpressResponse) => {
    const page: string | undefined = req.params['page'];

    if (!page) {
        return PageNotFoundServiceHandler.executeResponse(req, res);
    }

    const currentResource: ModelDocumentation | undefined =
        ResourceDictionary[page];

    if (req.params['page'] === 'permissions') {
        return PermissionServiceHandler.executeResponse(req, res);
    } else if (req.params['page'] === 'authentication') {
        return AuthenticationServiceHandler.executeResponse(req, res);
    } else if (req.params['page'] === 'pagination') {
        return PaginationServiceHandler.executeResponse(req, res);
    } else if (req.params['page'] === 'errors') {
        return ErrorServiceHandler.executeResponse(req, res);
    } else if (req.params['page'] === 'introduction') {
        return IntroductionServiceHandler.executeResponse(req, res);
    } else if (currentResource) {
        return ModelServiceHandler.executeResponse(req, res);
    }
    // page not found
    return PageNotFoundServiceHandler.executeResponse(req, res);
});

app.get('/*', (req: ExpressRequest, res: ExpressResponse) => {
    return PageNotFoundServiceHandler.executeResponse(req, res);
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
