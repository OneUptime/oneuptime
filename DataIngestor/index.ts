import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'data-ingestor';
const app: ExpressApplication = App(APP_NAME);

app.use([`/${APP_NAME}/probe`, '/probe'], require('./api/probe'));

export default app;
