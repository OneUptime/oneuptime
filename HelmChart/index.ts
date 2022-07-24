import { ExpressStatic, ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import path from 'path';

export const APP_NAME = 'chart';
const app: ExpressApplication = App(APP_NAME);

// Set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//Serve files in public directory
app.use(
    [`/${APP_NAME}`, '/'],
    ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

export default app;
