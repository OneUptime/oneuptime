import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'realtime';
const app = App(APP_NAME);

app.use('/realtime', require('./api/realtime'));

export default app;
