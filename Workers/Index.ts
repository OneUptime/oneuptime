import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import Redis from 'CommonServer/Infrastructure/Redis';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';
import { QueueJob, QueueName } from 'CommonServer/Infrastructure/Queue';
import QueueWorker from 'CommonServer/Infrastructure/QueueWorker';

// Payments.
import './Jobs/PaymentProvider/CheckSubscriptionStatus';
import './Jobs/PaymentProvider/UpdateTeamMembersIfNull';

// Announcements.
import './Jobs/Announcement/SendEmailToSubscribers';

// Incidents
import './Jobs/Incident/SendEmailToSubscribers';
import './Jobs/IncidentStateTimeline/SendEmailToSubscribers';

// Incident Notes
import './Jobs/IncidentPublicNote/SendEmailToSubscribers';

// Hard Delete
import './Jobs/HardDelete/HardDeleteItemsInDatabase';

// Scheduled Event
import './Jobs/ScheduledMaintenance/ChangeStateToOngoing';
import './Jobs/ScheduledMaintenance/SendEmailToSubscribers';
import './Jobs/ScheduledMaintenanceStateTimeline/SendEmailToSubscribers';

// Scheduled Event Notes
import './Jobs/ScheduledMaintenancePublicNote/SendEmailToSubscribers';

// Certs Routers
import StausPageCerts from './Jobs/StatusPageCerts/StausPageCerts';

// Express
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import JobDictonary from './Utils/JobDictionary';

// Monitor Owners
import './Jobs/MonitorOwners/SendCreatedResourceEmail';
import './Jobs/MonitorOwners/SendOwnerAddedEmail';
import './Jobs/MonitorOwners/SendStatusChangeEmail';

// Incident Owners
import './Jobs/IncidentOwners/SendCreatedResourceEmail';
import './Jobs/IncidentOwners/SendOwnerAddedEmail';
import './Jobs/IncidentOwners/SendStateChangeEmail';

// Scheduled Event Owners
import './Jobs/ScheduledMaintenanceOwners/SendCreatedResourceEmail';
import './Jobs/ScheduledMaintenanceOwners/SendOwnerAddedEmail';
import './Jobs/ScheduledMaintenanceOwners/SendStateChangeEmail';

// Status Page Owners
import './Jobs/StatusPageOwners/SendCreatedResourceEmail';
import './Jobs/StatusPageOwners/SendOwnerAddedEmail';

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

        // Job process.
        QueueWorker.getWorker(
            QueueName.Worker,
            async (job: QueueJob) => {
                const name: string = job.name;

                logger.info('Running Job: ' + name);

                const funcToRun: Function = JobDictonary.getJobFunction(name);

                if (funcToRun) {
                    await funcToRun();
                }
            },
            { concurrency: 10 }
        );
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
