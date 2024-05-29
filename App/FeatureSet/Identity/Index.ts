import AuthenticationAPI from './API/Authentication';
import ResellerAPI from './API/Reseller';
import SsoAPI from './API/SSO';
import StatusPageAuthenticationAPI from './API/StatusPageAuthentication';
import StatusPageSsoAPI from './API/StatusPageSSO';
import FeatureSet from 'CommonServer/Types/FeatureSet';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import 'ejs';

const IdentityFeatureSet: FeatureSet = {
    init: async (): Promise<void> => {
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
    },
};

export default IdentityFeatureSet;
