import { DatabaseName } from "../../../Server/EnvironmentConfig";
import ProdDataSourceOptions from "./DataSourceOptions";
import Faker from "Common/Utils/Faker";
import { DataSourceOptions } from "typeorm";

type GetTestDataSourceOptions = () => DataSourceOptions;

const getTestDataSourceOptions: GetTestDataSourceOptions =
  (): DataSourceOptions => {
    // we use process.env values directly here because it can change during test runs and we need to get the latest values.
    return {
      ...ProdDataSourceOptions,
      host: "localhost",
      port: 5400,
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: DatabaseName + Faker.getRandomNumbers(16).toString(),
    } as DataSourceOptions;
  };

export default getTestDataSourceOptions;
