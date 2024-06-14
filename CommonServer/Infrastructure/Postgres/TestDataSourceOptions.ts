import { DatabaseName } from "../../EnvironmentConfig";
import ProdDataSourceOptions from "./DataSourceOptions";
import Faker from "Common/Utils/Faker";
import { DataSourceOptions } from "typeorm";

type GetTestDataSourceOptions = () => DataSourceOptions;

const getTestDataSourceOptions: GetTestDataSourceOptions =
  (): DataSourceOptions => {
    // we use process.env values directly here because it can change during test runs and we need to get the latest values.
    return {
      ...ProdDataSourceOptions,
      host: process.env["DATABASE_HOST"] || "localhost",
      port: parseInt(process.env["DATABASE_PORT"]?.toString() || "5432"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: DatabaseName + Faker.randomNumbers(16),
    } as DataSourceOptions;
  };

export default getTestDataSourceOptions;
