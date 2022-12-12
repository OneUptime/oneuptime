import App from 'CommonServer/Utils/StartServer';
import path from 'path';
import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';

export const APP_NAME: string = 'accounts';

const app: ExpressApplication = Express.getExpressApp();

app.use(ExpressStatic(path.join(__dirname, 'public')));

app.use(`/${APP_NAME}`, ExpressStatic(path.join(__dirname, 'public')));

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
