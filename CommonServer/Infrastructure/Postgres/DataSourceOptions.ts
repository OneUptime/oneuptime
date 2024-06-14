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
  ShouldDatabaseSslEnable,
} from "../../EnvironmentConfig";
import Migrations from "./SchemaMigrations/Index";
import DatabaseType from "Common/Types/DatabaseType";
import Entities from "Model/Models/Index";
import { DataSourceOptions } from "typeorm";

const dataSourceOptions: DataSourceOptions = {
  type: DatabaseType.Postgres,
  host: DatabaseHost.toString(),
  port: DatabasePort.toNumber(),
  username: DatabaseUsername,
  password: DatabasePassword,
  database: DatabaseName,
  migrationsTableName: "migrations",
  migrations: Migrations,
  migrationsRun: true,
  entities: Entities,
  applicationName: "oneuptime",
  ssl: ShouldDatabaseSslEnable
    ? {
        rejectUnauthorized: DatabaseRejectUnauthorized,
        ca: DatabaseSslCa,
        key: DatabaseSslKey,
        cert: DatabaseSslCert,
      }
    : false,
  // logging: 'all',
  synchronize: false,
};

export default dataSourceOptions;
