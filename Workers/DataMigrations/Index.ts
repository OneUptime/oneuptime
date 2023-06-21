import DataMigrationBase from './DataMigrationBase';
import MigrateDefaultUserNotificationRule from './MigrateDefaultUserNotificationRule';

// This is the order in which the migrations will be run. Add new migrations to the end of the array.

const DataMigrations: Array<DataMigrationBase> = [
    new MigrateDefaultUserNotificationRule(),
];

export default DataMigrations;
