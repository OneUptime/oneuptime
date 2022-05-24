import App from 'CommonServer/Utils/StartServer';
import AuthenticationAPI from './API/AuthenticationAPI';

export const APP_NAME: string = 'identity';

const app = App(APP_NAME);

app.use([`/${APP_NAME}`,'/'], AuthenticationAPI);

export default app;
