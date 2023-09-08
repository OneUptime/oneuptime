import AddDefaultGlobalConfig from './AddDefaultGlobalConfig';
import AddEndedState from './AddEndedState';
import AddMonitoringDatesToMonitor from './AddMonitoringDatesToMonitors';
import AddOwnerInfoToProjects from './AddOwnerInfoToProject';
import DataMigrationBase from './DataMigrationBase';
import MigrateDefaultUserNotificationRule from './MigrateDefaultUserNotificationRule';
import MigrateDefaultUserNotificationSetting from './MigrateDefaultUserSettingNotification';
import MigrateToMeteredSubscription from './MigrateToMeteredSubscription';
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
];

export default DataMigrations;
