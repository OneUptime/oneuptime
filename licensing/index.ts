import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'common-server/utils/express';

import app from 'common-server/utils/start-server';

import path from 'path';

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(ExpressStatic(path.join(__dirname, 'views')));
app.use('/', ExpressStatic(path.join(__dirname, 'views', 'img')));

// Routes(API)
app.use('/license/validate', require('./src/api/license'));

app.use('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).render('notFound.ejs', {});
});

export default app;
