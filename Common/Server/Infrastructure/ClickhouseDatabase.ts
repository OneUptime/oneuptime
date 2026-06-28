import logger from "../Utils/Logger";
import {
  ClickHouseClientConfigOptions,
  dataSourceOptions,
  ingestDataSourceOptions,
  backgroundDataSourceOptions,
  migrationDataSourceOptions,
  testDataSourceOptions,
} from "./ClickhouseConfig";
import { PingResult, createClient, ClickHouseClient } from "@clickhouse/client";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import Sleep from "../../Types/Sleep";
import API from "../../Utils/API";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import GracefulShutdown, { ShutdownPriority } from "../Utils/GracefulShutdown";

export type ClickhouseClient = ClickHouseClient;

export default class ClickhouseDatabase {
  private dataSource!: ClickhouseClient | null;
  private options: ClickHouseClientConfigOptions;

  /*
   * Each instance owns its own pool (App vs. Ingest), so each needs a
   * distinct shutdown-handler name. The two instances share a database name,
   * so a per-instance counter is what makes the names unique.
   */
  private static instanceCounter: number = 0;
  private readonly instanceId: number = ++ClickhouseDatabase.instanceCounter;

  public constructor(
    options: ClickHouseClientConfigOptions = dataSourceOptions,
  ) {
    this.options = options;
  }

  public getDatasourceOptions(): ClickHouseClientConfigOptions {
    return this.options;
  }

  public getTestDatasourceOptions(): ClickHouseClientConfigOptions {
    return testDataSourceOptions;
  }

  public getDataSource(): ClickhouseClient | null {
    return this.dataSource;
  }

  public isConnected(): boolean {
    return Boolean(this.dataSource);
  }

  @CaptureSpan()
  public async connect(
    dataSourceOptions: ClickHouseClientConfigOptions,
  ): Promise<ClickhouseClient> {
    let retry: number = 0;

    try {
      type ConnectToDatabaseFunction = () => Promise<ClickhouseClient>;
      const connectToDatabase: ConnectToDatabaseFunction =
        async (): Promise<ClickhouseClient> => {
          try {
            const defaultDbClient: ClickhouseClient = createClient({
              ...dataSourceOptions,
              database: "default",
            });
            await defaultDbClient.exec({
              query: `CREATE DATABASE IF NOT EXISTS ${dataSourceOptions.database}`,
            });

            await defaultDbClient.close();

            const clickhouseClient: ClickhouseClient =
              createClient(dataSourceOptions);
            this.dataSource = clickhouseClient;

            const result: PingResult = await clickhouseClient.ping();

            if (result.success === false) {
              throw new DatabaseNotConnectedException(
                "Clickhouse Database is not connected",
              );
            }

            logger.debug(
              `Clickhouse Database Connected: ${dataSourceOptions.host?.toString()}`,
            );

            return clickhouseClient;
          } catch (err) {
            if (retry < 3) {
              logger.debug(
                "Cannot connect to Clickhouse. Retrying again in 5 seconds",
              );
              // sleep for 5 seconds.

              await Sleep.sleep(5000);

              retry++;
              return await connectToDatabase();
            }
            throw err;
          }
        };

      const client: ClickhouseClient = await connectToDatabase();

      // Close this Clickhouse pool on shutdown.
      GracefulShutdown.registerHandler(
        `ClickhouseDatabase#${this.instanceId}`,
        ShutdownPriority.DataStores,
        () => {
          return this.disconnect();
        },
      );

      return client;
    } catch (err) {
      logger.error("Clickhouse Database Connection Failed");
      logger.error(err);
      throw err;
    }
  }

  @CaptureSpan()
  public async disconnect(): Promise<void> {
    if (this.dataSource) {
      await this.dataSource.close();
      this.dataSource = null;
    }
  }

  @CaptureSpan()
  public async checkConnnectionStatus(): Promise<boolean> {
    // Ping clickhouse to check if the connection is still alive
    try {
      logger.debug(
        "Checking Clickhouse Connection Status - pinging clickhouse",
      );

      const dbUrl: string | undefined = this.getDatasourceOptions().url as
        | string
        | undefined;

      if (!dbUrl) {
        throw new DatabaseNotConnectedException("Clickhouse URL not found");
      }

      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(dbUrl.toString()),
        });

      logger.debug("Clickhouse Connection Status Result");
      logger.debug(result);

      if (!result) {
        throw new DatabaseNotConnectedException(
          "Clickhouse Database is not connected",
        );
      }

      if (result instanceof HTTPErrorResponse) {
        throw new DatabaseNotConnectedException(
          "Clickhouse Database is not connected",
        );
      }

      if (
        result.data &&
        ((result.data as JSONObject)["data"] as string) &&
        ((result.data as JSONObject)["data"] as string).toString().trim() ===
          "Ok."
      ) {
        return true;
      }

      throw new DatabaseNotConnectedException(
        "Clickhouse Database is not connected",
      );
    } catch (err) {
      logger.error("Clickhouse Connection Lost");
      logger.error(err);
      return false;
    }
  }
}

export const ClickhouseAppInstance: ClickhouseDatabase = new ClickhouseDatabase(
  dataSourceOptions,
);

/*
 * Separate pool for high-volume telemetry inserts. Reads/DDL keep using
 * ClickhouseAppInstance so dashboard queries are not starved of HTTP
 * sockets when ingest is bursting.
 */
export const ClickhouseIngestInstance: ClickhouseDatabase =
  new ClickhouseDatabase(ingestDataSourceOptions);

/*
 * Separate pool for background / cron analytics reads (telemetry-monitor
 * evaluation, etc). Isolates heavy background count/aggregate bursts from the
 * App pool so dashboard reads keep their HTTP sockets. Connected at boot in
 * App/Index.ts alongside the App + Ingest pools.
 */
export const ClickhouseBackgroundInstance: ClickhouseDatabase =
  new ClickhouseDatabase(backgroundDataSourceOptions);

/*
 * Separate pool for schema sync + data migrations. Identical to the App pool
 * except for a much higher request_timeout (see migrationDataSourceOptions):
 * the App pool's 58s socket-idle timer is correct for dashboard reads but
 * would destroy a long-running migration DDL/mutation mid-flight and crash
 * boot. Schema sync and migrations route through this instance via
 * MigrationExecuteOptions (AnalyticsDatabaseService).
 */
export const ClickhouseMigrationInstance: ClickhouseDatabase =
  new ClickhouseDatabase(migrationDataSourceOptions);
