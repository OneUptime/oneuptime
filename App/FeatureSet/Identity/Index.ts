import 'ejs';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import AuthenticationAPI from './API/Authentication';
import SsoAPI from './API/SSO';
import ResellerAPI from './API/Reseller';
import StatusPageSsoAPI from './API/StatusPageSSO';
import StatusPageAuthenticationAPI from './API/StatusPageAuthentication';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'api/identity';

app.use([`/${APP_NAME}`, '/'], AuthenticationAPI);

app.use([`/${APP_NAME}`, '/'], ResellerAPI);

app.use([`/${APP_NAME}`, '/'], SsoAPI);

app.use([`/${APP_NAME}`, '/'], StatusPageSsoAPI);

app.use(
    [`/${APP_NAME}/status-page`, '/status-page'],
    StatusPageAuthenticationAPI
);
