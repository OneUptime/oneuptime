import { ExpressStatic } from 'common-server/utils/express';
import app from 'common-server/utils/start-server';

import path from 'path';

// set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//serve files in public directory
app.use(
    ['/chart', '/'],
    ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

export default app;
