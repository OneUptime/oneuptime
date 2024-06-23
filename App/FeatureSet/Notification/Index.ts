import CallAPI from ./API/Call;
import MailAPI from ./API/Mail;
import SmsAPI from ./API/SMS;
import SMTPConfigAPI from ./API/SMTPConfig;
import ./Utils/Handlebars;
import FeatureSet from CommonServer/Types/FeatureSet;
import Express, { ExpressApplication } from CommonServer/Utils/Express;
import ejs;

const NotificationFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const APP_NAME: string = api/notification;
    const app: ExpressApplication = Express.getExpressApp();

    configureApi(app, , MailAPI);
    configureApi(app, , SmsAPI);
    configureApi(app, , CallAPI);
    configureApi(app, , SMTPConfigAPI);
  },
};

function configureApi(app: ExpressApplication, path: string, api: any): void {
  app.use(path, api);
}

export default NotificationFeatureSet;

