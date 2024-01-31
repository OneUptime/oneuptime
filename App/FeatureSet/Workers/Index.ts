import logger from 'CommonServer/Utils/Logger';
import { QueueJob, QueueName } from 'CommonServer/Infrastructure/Queue';
import QueueWorker from 'CommonServer/Infrastructure/QueueWorker';
import FeatureSet from 'CommonServer/Types/FeatureSet';

// Payments.
import './Jobs/PaymentProvider/CheckSubscriptionStatus';
import './Jobs/PaymentProvider/UpdateTeamMembersIfNull';
import './Jobs/PaymentProvider/PopulatePlanNameInProject';

// Announcements.
import './Jobs/Announcement/SendNotificationToSubscribers';

// Incidents
import './Jobs/Incident/SendNotificationToSubscribers';
import './Jobs/IncidentStateTimeline/SendNotificationToSubscribers';

// Incident Notes
import './Jobs/IncidentPublicNote/SendNotificationToSubscribers';

// Hard Delete
import './Jobs/HardDelete/HardDeleteItemsInDatabase';

// Scheduled Event
import './Jobs/ScheduledMaintenance/ChangeStateToOngoing';
import './Jobs/ScheduledMaintenance/ChangeStateToEnded';
import './Jobs/ScheduledMaintenance/SendNotificationToSubscribers';
import './Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers';

// Scheduled Event Notes
import './Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers';

// Certs Routers
import StatusPageCerts from './Jobs/StatusPageCerts/StatusPageCerts';

// Express
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import JobDictionary from './Utils/JobDictionary';

// Monitor Owners
import './Jobs/MonitorOwners/SendCreatedResourceNotification';
import './Jobs/MonitorOwners/SendOwnerAddedNotification';
import './Jobs/MonitorOwners/SendStatusChangeNotification';

// Incident Owners
import './Jobs/IncidentOwners/SendCreatedResourceNotification';
import './Jobs/IncidentOwners/SendOwnerAddedNotification';
import './Jobs/IncidentOwners/SendStateChangeNotification';
import './Jobs/IncidentOwners/SendNotePostedNotification';

// Scheduled Event Owners
import './Jobs/ScheduledMaintenanceOwners/SendCreatedResourceNotification';
import './Jobs/ScheduledMaintenanceOwners/SendOwnerAddedNotification';
import './Jobs/ScheduledMaintenanceOwners/SendStateChangeNotification';
import './Jobs/ScheduledMaintenanceOwners/SendNotePostedNotification';

// Status Page Owners
import './Jobs/StatusPageOwners/SendCreatedResourceNotification';
import './Jobs/StatusPageOwners/SendOwnerAddedNotification';
import './Jobs/StatusPageOwners/SendAnnouncementCreatedNotification';
import RunDatabaseMigrations from './Utils/DataMigration';

// On-Call Duty Policy Executions.
import './Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions';
import './Jobs/OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions';

// User Notifications Log
import './Jobs/UserOnCallLog/ExecutePendingExecutions';
import './Jobs/UserOnCallLog/TimeoutStuckExecutions';

import './Jobs/IncomingRequestMonitor/CheckHeartbeat';
import AnalyticsTableManagement from './Utils/AnalyticsDatabase/TableManegement';

import './Jobs/Workflow/TimeoutJobs';
import './Jobs/MeteredPlan/ReportTelemetryMeteredPlan';

const APP_NAME: string = 'api/workers';

const app: ExpressApplication = Express.getExpressApp();

//cert routes.
app.use(`/${APP_NAME.toLocaleLowerCase()}`, StatusPageCerts);

const WorkersFeatureSet: FeatureSet = {
    init: async (): Promise<void> => {
        try {
            // run async database migrations
            RunDatabaseMigrations().catch((err: Error) => {
                logger.error('Error running database migrations');
                logger.error(err);
            });

            // create tables in analytics database
            await AnalyticsTableManagement.createTables();

            // Job process.
            QueueWorker.getWorker(
                QueueName.Worker,
                async (job: QueueJob) => {
                    const name: string = job.name;

                    logger.info('Running Job: ' + name);

                    const funcToRun: Function =
                        JobDictionary.getJobFunction(name);

                    if (funcToRun) {
                        await funcToRun();
                    }
                },
                { concurrency: 10 }
            );
        } catch (err) {
            logger.error('App Init Failed:');
            logger.error(err);
            throw err;
        }
    },
};

export default WorkersFeatureSet;
