import DatabaseType from "Common/Types/DatabaseType";
import { DatabaseName } from "../../EnvironmentConfig";
import Faker from "Common/Utils/Faker";
import { DataSourceOptions } from "typeorm";
import Entities from 'Model/Models/Index';

type GetTestDataSourceOptions = () => DataSourceOptions;

const getTestDataSourceOptions: GetTestDataSourceOptions =
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
            synchronize: true
        };
    };

export default getTestDataSourceOptions;
