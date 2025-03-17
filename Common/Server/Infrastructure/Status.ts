// This class checks the status of all the datasources.
import Sleep from "../../Types/Sleep";
import logger from "../Utils/Logger";
import { ClickhouseAppInstance } from "./ClickhouseDatabase";
import PostgresAppInstance from "./PostgresDatabase";
import Redis from "./Redis";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class InfrastructureStatus {
  @CaptureSpan()
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

  @CaptureSpan()
  @CaptureSpan()
  public static async checkStatusWithRetry(data: {
    retryCount: number;
    checkRedisStatus: boolean;
    checkPostgresStatus: boolean;
    checkClickhouseStatus: boolean;
  }): Promise<void> {
    let retry: number = 0;

    while (retry < data.retryCount) {
      try {
        await this.checkStatus({
          checkRedisStatus: data.checkRedisStatus,
          checkPostgresStatus: data.checkPostgresStatus,
          checkClickhouseStatus: data.checkClickhouseStatus,
        });
        break;
      } catch (err) {
        logger.error("Error checking infrastructure status");
        logger.error(err);
        retry++;
        await Sleep.sleep(1000);
      }
    }
  }
}
