import { DataSource } from "typeorm";
import dataSourceOptions from "./DataSourceOptions";

const dataSourceOptionToMigrate: any = {
    ...dataSourceOptions,
    host: 'localhost',
    port: 5400
}

const PostgresDataSource: DataSource = new DataSource(
    dataSourceOptionToMigrate
);

export default PostgresDataSource;
