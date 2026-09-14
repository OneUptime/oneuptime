// This class checks the status of all the datasources.
import Sleep from "../../Types/Sleep";
import logger from "../Utils/Logger";
import { ClickhouseAppInstance } from "./ClickhouseDatabase";
import PostgresAppInstance from "./PostgresDatabase";
import Redis from "./Redis";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class InfrastructureStatus {
  @CaptureSpan()
  public static async checkStatus(data: {
    checkRedisStatus: boolean;
    checkPostgresStatus: boolean;
    checkClickhouseStatus: boolean;
  }): Promise<void> {
    logger.info("Checking infrastructure status");

    if (data.checkRedisStatus) {
      logger.info("Checking Valkey status");
      if (!(await Redis.checkConnnectionStatus())) {
        logger.info("Valkey is not connected");
        /*
         * This message is not log-only: StatusAPI passes it straight to
         * sendErrorResponse, so it is the body of GET /api/status/global-cache,
         * /ready and /live. It is the first thing an operator curls when the
         * cache is down, which is why it says what the container actually is.
         */
        throw new DatabaseNotConnectedException("Valkey is not connected");
      }
      logger.info("Valkey is connected");
    }

    if (data.checkPostgresStatus) {
      logger.info("Checking Postgres status");
      if (!(await PostgresAppInstance.checkConnnectionStatus())) {
        logger.info("Postgres is not connected");
        throw new DatabaseNotConnectedException("Postgres is not connected");
      }
      logger.info("Postgres is connected");
    }

    if (data.checkClickhouseStatus) {
      logger.info("Checking Clickhouse status");
      if (!(await ClickhouseAppInstance.checkConnnectionStatus())) {
        logger.info("Clickhouse is not connected");
        throw new DatabaseNotConnectedException("Clickhouse is not connected");
      }
      logger.info("Clickhouse is connected");
    }
  }

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
