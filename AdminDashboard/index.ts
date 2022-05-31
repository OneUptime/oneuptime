import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/utils/Express';
import path from 'path';
import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'admin';
const app: ExpressApplication = App(APP_NAME);

app.use(ExpressStatic(path.join(__dirname, 'build')));
app.use(`/${APP_NAME}`, ExpressStatic(path.join(__dirname, 'build')));
app.use(
    `/${APP_NAME}/static/js`,
    ExpressStatic(path.join(__dirname, 'build/static/js'))
);

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3100);
