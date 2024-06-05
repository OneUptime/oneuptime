import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseRejectUnauthorized,
    DatabaseSslCa,
    DatabaseSslCert,
    DatabaseSslKey,
    DatabaseUsername,
    Env,
    ShouldDatabaseSslEnable,
} from '../EnvironmentConfig';
import AppEnvironment from 'Common/Types/AppEnvironment';
import DatabaseType from 'Common/Types/DatabaseType';
import Faker from 'Common/Utils/Faker';
import Migrations from 'Model/Migrations/Index';
import Entities from 'Model/Models/Index';
import { DataSource, DataSourceOptions } from 'typeorm';

export const dataSourceOptions: DataSourceOptions = {
    type: DatabaseType.Postgres,
    host: DatabaseHost.toString(),
    port: DatabasePort.toNumber(),
    username: DatabaseUsername,
    password: DatabasePassword,
    database: DatabaseName,
    migrationsTableName: 'migrations',
    migrations: Migrations,
    entities: Entities,
    applicationName: 'oneuptime',
    ssl: ShouldDatabaseSslEnable
        ? {
              rejectUnauthorized: DatabaseRejectUnauthorized,
              ca: DatabaseSslCa,
              key: DatabaseSslKey,
              cert: DatabaseSslCert,
          }
        : false,
    // logging: 'all',
    // synchronize: Env === AppEnvironment.Development,
    synchronize: true,
};

export const datasource: DataSource = new DataSource(dataSourceOptions);

type GetTestDataSourceOptions = () => DataSourceOptions;

export const getTestDataSourceOptions: GetTestDataSourceOptions =
    (): DataSourceOptions => {
        // we use process.env values directly here because it can change during test runs and we need to get the latest values.
        return {
            type: DatabaseType.Postgres,
            host: process.env['DATABASE_HOST'] || 'localhost',
            port: parseInt(process.env['DATABASE_PORT']?.toString() || '5432'),
            username: process.env['DATABASE_USERNAME'] || 'postgres',
            password: process.env['DATABASE_PASSWORD'] || 'password',
            database: DatabaseName + Faker.randomNumbers(16),
            entities: Entities,
            synchronize:
                Env === AppEnvironment.Test ||
                Env === AppEnvironment.Development,
        };
    };
