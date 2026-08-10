import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import DataSourceTableResult from "../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";

/*
 * Decrypted, server-side-only connection settings for one Data Source.
 * Built by DataSourceService from the DataSource record (secret columns
 * decrypted with root props) and handed straight to a connector — this
 * object must NEVER be serialized into an API response or a log line.
 */
export interface DataSourceConnectionSettings {
  dataSourceType: DataSourceType;

  // HTTP-based sources (Prometheus, Loki, Elasticsearch, REST API).
  url?: string | undefined;

  // Database sources (PostgreSQL, MySQL, SQL Server, ClickHouse).
  databaseHost?: string | undefined;
  databasePort?: number | undefined;
  databaseName?: string | undefined;

  /*
   * Credentials. `username`+`password` double as HTTP basic auth for
   * HTTP-based sources; `apiToken` is sent as a Bearer token (Prometheus /
   * Loki / Elasticsearch behind auth proxies, REST APIs).
   */
  username?: string | undefined;
  password?: string | undefined;
  apiToken?: string | undefined;

  // Extra HTTP headers (REST APIs, auth proxies). May contain secrets.
  customHeaders?: Dictionary<string> | undefined;

  /*
   * Per-type extras that don't warrant their own column, e.g.
   * { sslEnabled: true, elasticsearchIndex: "logs-*" }.
   */
  additionalOptions?: JSONObject | undefined;
}

export interface DataSourceQueryWindow {
  startDate: Date;
  endDate: Date;
  /*
   * Range-query resolution. Absent ⇒ derived server-side from the window
   * via DataSourceLimitsUtil.getStepInSeconds.
   */
  stepInSeconds?: number | undefined;
}

/*
 * One connector per DataSourceType. Implementations MUST:
 *  - validate their egress target through DataSourceEgressGuard before
 *    every connection (test and query alike);
 *  - enforce read-only semantics where the protocol allows writes (SQL
 *    engines via SqlQueryGuard + engine-level read-only sessions);
 *  - apply the DataSourceLimits timeouts and row/series/response caps;
 *  - normalize failures into thrown Exceptions with operator-actionable
 *    messages (bad credentials vs unreachable host vs bad query), never
 *    raw driver errors that could leak connection internals.
 */
export interface DataSourceConnector {
  dataSourceType: DataSourceType;

  /*
   * Cheap connectivity + credential probe used by the "Test Connection"
   * button. Resolves on success; throws a friendly Exception on failure.
   */
  testConnection(settings: DataSourceConnectionSettings): Promise<void>;

  /*
   * Run `query` and normalize to the AggregatedResult shape chart widgets
   * already consume: data points of { timestamp, value, ...groupKeys },
   * where non-timestamp/value keys (e.g. Prometheus labels or a SQL
   * `series` column) become the series grouping.
   */
  queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult>;

  /*
   * Run `query` and return rows for the table widget.
   */
  queryTable(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<DataSourceTableResult>;
}
