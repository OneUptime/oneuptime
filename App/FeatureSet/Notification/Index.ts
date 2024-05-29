import CallAPI from './API/Call';
// API
import MailAPI from './API/Mail';
import SmsAPI from './API/SMS';
import SMTPConfigAPI from './API/SMTPConfig';
import './Utils/Handlebars';
import FeatureSet from 'CommonServer/Types/FeatureSet';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import 'ejs';

const NotificationFeatureSet: FeatureSet = {
    init: async (): Promise<void> => {
        const APP_NAME: string = 'api/notification';
        const app: ExpressApplication = Express.getExpressApp();

        app.use([`/${APP_NAME}/email`, '/email'], MailAPI);
        app.use([`/${APP_NAME}/sms`, '/sms'], SmsAPI);
        app.use([`/${APP_NAME}/call`, '/call'], CallAPI);
        app.use([`/${APP_NAME}/smtp-config`, '/smtp-config'], SMTPConfigAPI);
    },
};

export default NotificationFeatureSet;
