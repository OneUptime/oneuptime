import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import Redis from 'CommonServer/Infrastructure/Redis';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';

// Payments.
import './Jobs/PaymentProvider/CheckSubscriptionStatus';

// Announcements.
import './Jobs/Announcement/SendEmailToSubscribers';

// Incidents
import './Jobs/Incident/SendEmailToSubscribers';

// Scheduled Event
import './Jobs/ScheduledMaintenance/ChangeStateToOngoing';
import './Jobs/ScheduledMaintenance/SendEmailToSubscribers';

// Certs Routers
import StausPageCerts from './Jobs/StatusPageCerts/StausPageCerts';

// Express
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';

const APP_NAME: string = 'workers';

const app: ExpressApplication = Express.getExpressApp();

//cert routes.
app.use(`/${APP_NAME.toLocaleLowerCase()}`, StausPageCerts);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // connect redis
        await Redis.connect();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
