import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME = 'data-ingestor';
const app: ExpressApplication = App(APP_NAME);

// API
import ProbeAPI from './API/Probe';

// Attach to the app.
app.use([`/${APP_NAME}/probe`, '/probe'], ProbeAPI);

export default app;
