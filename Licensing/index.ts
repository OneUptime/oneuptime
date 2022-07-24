import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    ExpressApplication,
} from 'CommonServer/Utils/Express';

import App from 'CommonServer/Utils/StartServer';

export const APP_NAME = 'licensing';
const app: ExpressApplication = App(APP_NAME);

import path from 'path';

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(ExpressStatic(path.join(__dirname, 'views')));
app.use('/', ExpressStatic(path.join(__dirname, 'views', 'img')));

// Routes(API)
app.use(`${APP_NAME}/validate`, require('./src/api/license'));

app.use('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).render('notFound.ejs', {});
});

export default app;
