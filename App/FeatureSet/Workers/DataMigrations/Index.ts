import AddDefaultGlobalConfig from './AddDefaultGlobalConfig';
import AddDowntimeMonitorStatusToStatusPage from './AddDowntimeMonitorStatusToStatusPage';
// import AddEndDateToIncidentStateTimeline from './AddEndDateToIncidentStateTimeline';
import AddEndDateToMonitorStatusTimeline from './AddEndDateToMonitorStatusTimeline';
// import AddEndDateToScheduledEventsStateTimeline from './AddEndDateToScheduledEventsStateTimeline';
import AddEndedState from './AddEndedState';
import AddMonitoringDatesToMonitor from './AddMonitoringDatesToMonitors';
import AddOwnerInfoToProjects from './AddOwnerInfoToProject';
import AddPostedAtToPublicNotes from './AddPostedAtToPublicNotes';
// import AddStartDateToIncidentStateTimeline from './AddStartDateToIncidentStateTimeline';
// import AddStartDateToMonitorStatusTimeline from './AddStartDateToMonitorStatusTimeline';
// import AddStartDateToScheduledEventsStateTimeline from './AddStartDateToScheduledEventsStateTimeline';
import DataMigrationBase from './DataMigrationBase';
import MigrateDefaultUserNotificationRule from './MigrateDefaultUserNotificationRule';
import MigrateDefaultUserNotificationSetting from './MigrateDefaultUserSettingNotification';
import MigrateToMeteredSubscription from './MigrateToMeteredSubscription';
import MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage from './MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage';
import UpdateActiveMonitorCountToBillingProvider from './UpdateActiveMonitorCountToBillingProvider';
import UpdateGlobalConfigFromEnv from './UpdateGlobalCongfigFromEnv';

// This is the order in which the migrations will be run. Add new migrations to the end of the array.

const DataMigrations: Array<DataMigrationBase> = [
    new MigrateDefaultUserNotificationRule(),
    new AddOwnerInfoToProjects(),
    new MigrateDefaultUserNotificationSetting(),
    new MigrateToMeteredSubscription(),
    new UpdateActiveMonitorCountToBillingProvider(),
    new AddMonitoringDatesToMonitor(),
    new AddEndedState(),
    new AddDefaultGlobalConfig(),
    new UpdateGlobalConfigFromEnv(),
    new AddPostedAtToPublicNotes(),
    new MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage(),
    new AddDowntimeMonitorStatusToStatusPage(),
    new AddEndDateToMonitorStatusTimeline(),
    // new AddEndDateToScheduledEventsStateTimeline(),
    // new AddEndDateToIncidentStateTimeline(),
    // new AddStartDateToIncidentStateTimeline(),
    // new AddStartDateToMonitorStatusTimeline(),
    // new AddStartDateToScheduledEventsStateTimeline(),
];

export default DataMigrations;
