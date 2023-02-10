import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import path from 'path';

const APP_NAME: string = 'api-docs';

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
app.get(['/', '/docs'], (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('pages/index');
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
