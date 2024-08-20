// This class checks the status of all the datasources.
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
    if (data.checkRedisStatus) {
      if (!(await Redis.checkConnnectionStatus())) {
        throw new DatabaseNotConnectedException("Redis is not connected");
      }
    }

    if (data.checkPostgresStatus) {
      if (!(await PostgresAppInstance.checkConnnectionStatus())) {
        throw new DatabaseNotConnectedException("Postgres is not connected");
      }
    }

    if (data.checkClickhouseStatus) {
      if (!(await ClickhouseAppInstance.checkConnnectionStatus())) {
        throw new DatabaseNotConnectedException("Clickhouse is not connected");
      }
    }
  }
}
