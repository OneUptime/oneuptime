import { ExpressStatic } from 'CommonServer/Utils/Express';
import app from 'CommonServer/Utils/StartServer';

import path from 'path';

// Set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//Serve files in public directory
app.use(
    ['/chart', '/'],
    ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

export default app;
