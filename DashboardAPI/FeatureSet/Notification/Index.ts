import 'ejs';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';

// API
import MailAPI from './API/Mail';
import SmsAPI from './API/SMS';
import CallAPI from './API/Call';
import SMTPConfigAPI from './API/SMTPConfig';
import './Utils/Handlebars';


const APP_NAME: string = 'api/notification';
const app: ExpressApplication = Express.getExpressApp();

app.use([`/${APP_NAME}/email`, '/email'], MailAPI);
app.use([`/${APP_NAME}/sms`, '/sms'], SmsAPI);
app.use([`/${APP_NAME}/call`, '/call'], CallAPI);
app.use([`/${APP_NAME}/smtp-config`, '/smtp-config'], SMTPConfigAPI);