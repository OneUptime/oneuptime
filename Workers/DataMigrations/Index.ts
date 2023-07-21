import AddOwnerInfoToProjects from './AddOwnerInfoToProject';
import DataMigrationBase from './DataMigrationBase';
import MigrateDefaultUserNotificationRule from './MigrateDefaultUserNotificationRule';
import MigrateDefaultUserNotificationSetting from './MigrateDefaultUserSettingNotification';

// This is the order in which the migrations will be run. Add new migrations to the end of the array.

const DataMigrations: Array<DataMigrationBase> = [
    new MigrateDefaultUserNotificationRule(),
    new AddOwnerInfoToProjects(),
    new MigrateDefaultUserNotificationSetting(),
];

export default DataMigrations;
