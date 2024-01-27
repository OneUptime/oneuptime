import AddDefaultGlobalConfig from './AddDefaultGlobalConfig';
import AddDowntimeMonitorStatusToStatusPage from './AddDowntimeMonitorStatusToStatusPage';
import AddEndedState from './AddEndedState';
import AddMonitoringDatesToMonitor from './AddMonitoringDatesToMonitors';
import AddOwnerInfoToProjects from './AddOwnerInfoToProject';
import AddPostedAtToPublicNotes from './AddPostedAtToPublicNotes';
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
];

export default DataMigrations;
