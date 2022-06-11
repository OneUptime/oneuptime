import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'realtime';
const app: ExpressApplication = App(APP_NAME);

app.use('/realtime', require('./api/realtime'));

export default app;
