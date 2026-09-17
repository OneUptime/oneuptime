import BadDataException from "../../../Types/Exception/BadDataException";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { DataSourceConnector } from "./Types";
import PrometheusConnector from "./Connectors/PrometheusConnector";
import PostgresConnector from "./Connectors/PostgresConnector";
import MySqlConnector from "./Connectors/MySqlConnector";
import SqlServerConnector from "./Connectors/SqlServerConnector";
import ClickHouseConnector from "./Connectors/ClickHouseConnector";
import LokiConnector from "./Connectors/LokiConnector";
import ElasticsearchConnector from "./Connectors/ElasticsearchConnector";
import RestApiConnector from "./Connectors/RestApiConnector";

/*
 * One connector instance per DataSourceType. Connectors are stateless
 * (each call opens and tears down its own connection), so singletons are
 * safe to share across requests.
 */
export default class ConnectorRegistry {
  private static connectors: Array<DataSourceConnector> = [
    new PrometheusConnector(),
    new PostgresConnector(),
    new MySqlConnector(),
    new SqlServerConnector(),
    new ClickHouseConnector(),
    new LokiConnector(),
    new ElasticsearchConnector(),
    new RestApiConnector(),
  ];

  public static getConnector(
    dataSourceType: DataSourceType,
  ): DataSourceConnector {
    const connector: DataSourceConnector | undefined = this.connectors.find(
      (candidate: DataSourceConnector) => {
        return candidate.dataSourceType === dataSourceType;
      },
    );

    if (!connector) {
      throw new BadDataException(
        `No connector is registered for data source type: ${dataSourceType}`,
      );
    }

    return connector;
  }

  public static getRegisteredTypes(): Array<DataSourceType> {
    return this.connectors.map((connector: DataSourceConnector) => {
      return connector.dataSourceType;
    });
  }
}
