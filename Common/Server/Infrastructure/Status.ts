// This class checks the status of all the datasources.
import logger from "../Utils/Logger";
import { ClickhouseAppInstance } from "./ClickhouseDatabase";
import PostgresAppInstance from "./PostgresDatabase";
import Redis from "./Redis";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";

export default class InfrastructureStatus {
  public static async checkStatus(data: {
    checkRedisStatus: boolean;
    checkPostgresStatus: boolean;
    checkClickhouseStatus: boolean;
  }): Promise<void> {
    logger.debug("Checking infrastructure status");

    if (data.checkRedisStatus) {
      logger.debug("Checking Redis status");
      if (!(await Redis.checkConnnectionStatus())) {
        logger.debug("Redis is not connected");
        throw new DatabaseNotConnectedException("Redis is not connected");
      }
      logger.debug("Redis is connected");
    }

    if (data.checkPostgresStatus) {
      logger.debug("Checking Postgres status");
      if (!(await PostgresAppInstance.checkConnnectionStatus())) {
        logger.debug("Postgres is not connected");
        throw new DatabaseNotConnectedException("Postgres is not connected");
      }
      logger.debug("Postgres is connected");
    }

    if (data.checkClickhouseStatus) {
      logger.debug("Checking Clickhouse status");
      if (!(await ClickhouseAppInstance.checkConnnectionStatus())) {
        logger.debug("Clickhouse is not connected");
        throw new DatabaseNotConnectedException("Clickhouse is not connected");
      }
      logger.debug("Clickhouse is connected");
    }
  }
}
