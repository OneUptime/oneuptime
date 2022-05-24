import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'data-ingestor';
const app = App(APP_NAME);

app.use([`/${APP_NAME}/probe`, '/probe'], require('./api/probe'));

export default app;
