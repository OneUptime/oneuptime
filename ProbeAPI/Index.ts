import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'data-ingestor';
const app = App(APP_NAME);

// API
import ProbeAPI from './API/Probe';

// Attach to the app.
app.use([`/${APP_NAME}/probe`, '/probe'], ProbeAPI);

export default app;
