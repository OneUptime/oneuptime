import App from 'CommonServer/Utils/StartServer';
import path from 'path';
import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/Utils/Express';

export const APP_NAME = 'accounts';

App(APP_NAME);

const app: ExpressApplication = Express.getExpressApp();

app.use(ExpressStatic(path.join(__dirname, 'build')));

app.use(
    `/${APP_NAME}/static/js`,
    ExpressStatic(path.join(__dirname, 'build', 'static', 'js'))
);

app.use(`/${APP_NAME}`, ExpressStatic(path.join(__dirname, 'build')));

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

export default app;
