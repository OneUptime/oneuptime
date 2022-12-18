import { DataSource, DataSourceOptions } from 'typeorm';
import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseUsername,
    Env,
} from '../Config';
import Entities from 'Model/Models/Index';
import Migrations from 'Model/Migrations/Index';
import DatabaseType from 'Common/Types/DatabaseType';
import AppEnvironment from 'Common/Types/AppEnvironment';
import Faker from 'Common/Utils/Faker';

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
    //logging: 'all',
    synchronize: Env === AppEnvironment.Development,
};

export const datasource: DataSource = new DataSource(dataSourceOptions);

export const testDataSourceOptions: DataSourceOptions = {
    type: DatabaseType.Postgres,
    host: DatabaseHost.toString(),
    port: DatabasePort.toNumber(),
    username: DatabaseUsername,
    password: DatabasePassword,
    database: DatabaseName + Faker.random16Numbers(),
    entities: Entities,
    synchronize:
        Env === AppEnvironment.Test || Env === AppEnvironment.Development,
};
