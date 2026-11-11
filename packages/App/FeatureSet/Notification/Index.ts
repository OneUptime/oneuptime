import BroadcastEmailAPI from "./API/BroadcastEmail";
import CallAPI from "./API/Call";
// API
import MailAPI from "./API/Mail";
import SmsAPI from "./API/SMS";
import WhatsAppAPI from "./API/WhatsApp";
import TelegramAPI from "./API/Telegram";
import WebhookAPI from "./API/Webhook";
import CallAndSmsGatewayAPI from "./API/CallAndSmsGateway";
import PushRelayAPI from "./API/PushRelay";
import SMTPConfigAPI from "./API/SMTPConfig";
import ServerTestSendAPI from "./API/ServerTestSend";
import PhoneNumberAPI from "./API/PhoneNumber";
import IncomingCallAPI from "./API/IncomingCall";
import SubscriberNotificationPreviewAPI from "./API/SubscriberNotificationPreview";
import MailService from "./Services/MailService";
import "./Utils/Handlebars";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import { CarriedLogo } from "Common/Server/Utils/Mail/EmailCarriedLogos";
import StatusPageCarriedLogo from "Common/Server/Utils/StatusPage/StatusPageCarriedLogo";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import SubscriberNotificationPreview from "Common/Types/StatusPage/SubscriberNotificationPreview";
import { SERVER_TEST_SEND_ROUTE } from "Common/Types/ServerSetup/ServerTestSend";
import "ejs";

const NotificationFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const APP_NAME: string = "api/notification";
    const app: ExpressApplication = Express.getExpressApp();

    /*
     * A status page's logo goes inside the emails that show it, read from
     * the database (StatusPageCarriedLogo), rather than load from its
     * address when the email is opened.
     */
    MailService.carryStatusPageLogosWith(
      (address: string): Promise<CarriedLogo | null> => {
        return StatusPageCarriedLogo.readAddress(address);
      },
    );

    /*
     * How the server's own emails, SMS and calls go is written down
     * (ServerSendingStatus), so the server can say whether it can send -
     * to its admins in the product, and on the sign-in pages.
     */
    ServerSendingStatus.startRecordingOutcomes();

    app.use([`/${APP_NAME}/email`, "/email"], MailAPI);
    app.use([`/${APP_NAME}/sms`, "/sms"], SmsAPI);
    app.use([`/${APP_NAME}/whatsapp`, "/whatsapp"], WhatsAppAPI);
    app.use([`/${APP_NAME}/telegram`, "/telegram"], TelegramAPI);
    app.use([`/${APP_NAME}/webhook`, "/webhook"], WebhookAPI);
    app.use(
      [`/${APP_NAME}/call-and-sms-gateway`, "/call-and-sms-gateway"],
      CallAndSmsGatewayAPI,
    );
    app.use([`/${APP_NAME}/push-relay`, "/push-relay"], PushRelayAPI);
    app.use([`/${APP_NAME}/call`, "/call"], CallAPI);
    app.use([`/${APP_NAME}/smtp-config`, "/smtp-config"], SMTPConfigAPI);
    /*
     * A master admin's test send through the server's own email, SMS and
     * call settings (Admin Dashboard, ServerTestSend). The Admin Dashboard
     * reaches it at NOTIFICATION_URL, as the Dashboard reaches /smtp-config.
     */
    app.use(
      [
        `/${APP_NAME}${SERVER_TEST_SEND_ROUTE}`,
        SERVER_TEST_SEND_ROUTE,
      ],
      ServerTestSendAPI,
    );
    app.use([`/${APP_NAME}/phone-number`, "/phone-number"], PhoneNumberAPI);
    app.use([`/${APP_NAME}/incoming-call`, "/incoming-call"], IncomingCallAPI);
    /*
     * Status page subscriber email preview and test send. The Dashboard
     * reaches it at NOTIFICATION_URL (/notification, which the ingress
     * rewrites to /api/notification), like /smtp-config/test.
     */
    app.use(
      [
        `/${APP_NAME}${SubscriberNotificationPreview.routerPath}`,
        SubscriberNotificationPreview.routerPath,
      ],
      SubscriberNotificationPreviewAPI,
    );
    app.use(
      [`/${APP_NAME}/broadcast-email`, "/broadcast-email"],
      BroadcastEmailAPI,
    );
    app.use(["/api/admin/email"], BroadcastEmailAPI);
  },
};

export default NotificationFeatureSet;
