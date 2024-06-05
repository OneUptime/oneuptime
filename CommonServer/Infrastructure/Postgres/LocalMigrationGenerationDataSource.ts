import { DataSource } from "typeorm";
import dataSourceOptions from "./DataSourceOptions";

const dataSourceOptionToMigrate: any = {
    ...dataSourceOptions,
    host: 'localhost',
    database: 'oneuptimeabc',
    port: 5400
}

const PostgresDataSource: DataSource = new DataSource(
    dataSourceOptionToMigrate
);

export default PostgresDataSource;
