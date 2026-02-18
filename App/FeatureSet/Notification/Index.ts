import CallAPI from "./API/Call";
// API
import MailAPI from "./API/Mail";
import SmsAPI from "./API/SMS";
import WhatsAppAPI from "./API/WhatsApp";
import PushNotificationAPI from "./API/PushNotification";
import PushRelayAPI from "./API/PushRelay";
import SMTPConfigAPI from "./API/SMTPConfig";
import PhoneNumberAPI from "./API/PhoneNumber";
import IncomingCallAPI from "./API/IncomingCall";
import "./Utils/Handlebars";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import "ejs";

const NotificationFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const APP_NAME: string = "api/notification";
    const app: ExpressApplication = Express.getExpressApp();

    app.use([`/${APP_NAME}/email`, "/email"], MailAPI);
    app.use([`/${APP_NAME}/sms`, "/sms"], SmsAPI);
    app.use([`/${APP_NAME}/whatsapp`, "/whatsapp"], WhatsAppAPI);
    app.use([`/${APP_NAME}/push`, "/push"], PushNotificationAPI);
    app.use([`/${APP_NAME}/push-relay`, "/push-relay"], PushRelayAPI);
    app.use([`/${APP_NAME}/call`, "/call"], CallAPI);
    app.use([`/${APP_NAME}/smtp-config`, "/smtp-config"], SMTPConfigAPI);
    app.use([`/${APP_NAME}/phone-number`, "/phone-number"], PhoneNumberAPI);
    app.use([`/${APP_NAME}/incoming-call`, "/incoming-call"], IncomingCallAPI);
  },
};

export default NotificationFeatureSet;
