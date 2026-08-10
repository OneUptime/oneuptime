/*
 * External systems a project-level Data Source can connect to. Dashboards
 * bind widgets to a Data Source + a query written in that source's native
 * query language (PromQL, SQL, LogQL, ES Query DSL, or a REST request
 * descriptor), and the server-side connector for the type normalizes the
 * response into the same shapes OneUptime's own widgets already consume.
 */
enum DataSourceType {
  Prometheus = "Prometheus",
  PostgreSQL = "PostgreSQL",
  MySQL = "MySQL",
  MicrosoftSqlServer = "Microsoft SQL Server",
  ClickHouse = "ClickHouse",
  Loki = "Loki",
  Elasticsearch = "Elasticsearch",
  RestApi = "REST API",
}

export default DataSourceType;

export interface DataSourceTypeProps {
  dataSourceType: DataSourceType;
  title: string;
  description: string;
  queryLanguageTitle: string;
  queryPlaceholder: string;
}

export class DataSourceTypeUtil {
  public static getAllDataSourceTypes(): Array<DataSourceType> {
    return [
      DataSourceType.Prometheus,
      DataSourceType.PostgreSQL,
      DataSourceType.MySQL,
      DataSourceType.MicrosoftSqlServer,
      DataSourceType.ClickHouse,
      DataSourceType.Loki,
      DataSourceType.Elasticsearch,
      DataSourceType.RestApi,
    ];
  }

  /*
   * Sources reached over HTTP(S) at a base URL (Prometheus-compatible APIs,
   * Loki, Elasticsearch, arbitrary REST endpoints). These require `url` on
   * the Data Source and are queried through the SSRF-guarded HTTP client.
   */
  public static isHttpBasedType(dataSourceType: DataSourceType): boolean {
    return [
      DataSourceType.Prometheus,
      DataSourceType.Loki,
      DataSourceType.Elasticsearch,
      DataSourceType.RestApi,
    ].includes(dataSourceType);
  }

  /*
   * Sources reached with a database driver over host/port. These require
   * `databaseHost` (+ optionally port/databaseName/username/password) and
   * run read-only guarded SQL.
   */
  public static isDatabaseType(dataSourceType: DataSourceType): boolean {
    return [
      DataSourceType.PostgreSQL,
      DataSourceType.MySQL,
      DataSourceType.MicrosoftSqlServer,
      DataSourceType.ClickHouse,
    ].includes(dataSourceType);
  }

  /** Default port used to seed the settings form for database sources. */
  public static getDefaultPort(dataSourceType: DataSourceType): number | null {
    switch (dataSourceType) {
      case DataSourceType.PostgreSQL:
        return 5432;
      case DataSourceType.MySQL:
        return 3306;
      case DataSourceType.MicrosoftSqlServer:
        return 1433;
      case DataSourceType.ClickHouse:
        return 8123; // HTTP interface — the @clickhouse/client transport.
      default:
        return null;
    }
  }

  public static getProps(dataSourceType: DataSourceType): DataSourceTypeProps {
    switch (dataSourceType) {
      case DataSourceType.Prometheus:
        return {
          dataSourceType,
          title: "Prometheus",
          description:
            "Query a Prometheus-compatible API (Prometheus, Thanos, Cortex, Mimir, VictoriaMetrics) with PromQL.",
          queryLanguageTitle: "PromQL",
          queryPlaceholder: 'rate(http_requests_total{job="api"}[5m])',
        };
      case DataSourceType.PostgreSQL:
        return {
          dataSourceType,
          title: "PostgreSQL",
          description:
            "Run read-only SQL against a PostgreSQL-compatible database (PostgreSQL, TimescaleDB, CockroachDB).",
          queryLanguageTitle: "SQL",
          queryPlaceholder:
            "SELECT created_at AS time, COUNT(*) AS value FROM orders WHERE created_at BETWEEN $__startTime AND $__endTime GROUP BY 1 ORDER BY 1",
        };
      case DataSourceType.MySQL:
        return {
          dataSourceType,
          title: "MySQL",
          description: "Run read-only SQL against a MySQL or MariaDB database.",
          queryLanguageTitle: "SQL",
          queryPlaceholder:
            "SELECT created_at AS time, COUNT(*) AS value FROM orders WHERE created_at BETWEEN $__startTime AND $__endTime GROUP BY 1 ORDER BY 1",
        };
      case DataSourceType.MicrosoftSqlServer:
        return {
          dataSourceType,
          title: "Microsoft SQL Server",
          description:
            "Run read-only SQL against a Microsoft SQL Server or Azure SQL database.",
          queryLanguageTitle: "T-SQL",
          queryPlaceholder:
            "SELECT created_at AS time, COUNT(*) AS value FROM orders WHERE created_at BETWEEN $__startTime AND $__endTime GROUP BY created_at ORDER BY created_at",
        };
      case DataSourceType.ClickHouse:
        return {
          dataSourceType,
          title: "ClickHouse",
          description:
            "Run read-only SQL against a ClickHouse database over its HTTP interface.",
          queryLanguageTitle: "SQL",
          queryPlaceholder:
            "SELECT toStartOfMinute(timestamp) AS time, count() AS value FROM events WHERE timestamp BETWEEN $__startTime AND $__endTime GROUP BY time ORDER BY time",
        };
      case DataSourceType.Loki:
        return {
          dataSourceType,
          title: "Grafana Loki",
          description:
            "Query a Grafana Loki log aggregation endpoint with LogQL metric queries.",
          queryLanguageTitle: "LogQL",
          queryPlaceholder: 'sum(rate({app="api"} |= "error" [5m]))',
        };
      case DataSourceType.Elasticsearch:
        return {
          dataSourceType,
          title: "Elasticsearch",
          description:
            "Query an Elasticsearch or OpenSearch cluster with Query DSL (date-histogram aggregations for charts).",
          queryLanguageTitle: "Query DSL (JSON)",
          queryPlaceholder:
            '{ "query": { "match_all": {} }, "aggs": { "over_time": { "date_histogram": { "field": "@timestamp", "fixed_interval": "1m" }, "aggs": { "value": { "value_count": { "field": "_id" } } } } } }',
        };
      case DataSourceType.RestApi:
        return {
          dataSourceType,
          title: "REST API",
          description:
            "Fetch JSON from any HTTP(S) API and map fields into time series or tables.",
          queryLanguageTitle: "Request (JSON)",
          queryPlaceholder:
            '{ "path": "/api/stats", "method": "GET", "rowsPath": "data.items", "timestampField": "time", "valueField": "count" }',
        };
      default:
        return {
          dataSourceType,
          title: dataSourceType,
          description: "",
          queryLanguageTitle: "Query",
          queryPlaceholder: "",
        };
    }
  }
}
