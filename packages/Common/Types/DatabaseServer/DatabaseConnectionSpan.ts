/*
 * Connection-management spans: the CLIENT spans a database client library
 * emits for opening, checking out or negotiating a connection rather than
 * for running a query. They carry the same `db.system.name` and
 * `server.address` as the queries, so a count of "calls" that includes them
 * roughly doubles for a pooled client (node-postgres emits `pg-pool.connect`
 * and `pg.connect` around each checkout), and 4 real queries plus their
 * connects reach a 10-call threshold.
 *
 * The rule is by span NAME, exact and case-insensitive, because nothing
 * else tells them apart across instrumentations:
 *   - a positive rule ("a query carries db.query.text / db.statement /
 *     db.operation.name / db.query.summary") does not hold: ioredis stamps
 *     its `connect` span with `db.query.text = 'connect'`, and .NET's
 *     SqlClient instrumentation leaves the statement off real queries by
 *     default;
 *   - the names below are what the instrumentations themselves call these
 *     spans, and no query span is ever named exactly like one of them (a
 *     query span is named after its operation and target: `SELECT orders`,
 *     `pg.query:SELECT orders`, `get`, `redis-GET`, `find orders`).
 *
 * Isomorphic: the client-span discovery SQL (DatabaseEndpointDiscovery)
 * and the database pages' "Queries" counts read the same list, so the
 * min-calls threshold and the counts people see agree.
 */
export const DATABASE_CONNECTION_SPAN_NAMES: ReadonlyArray<string> = [
  // node-postgres (@opentelemetry/instrumentation-pg): client and pool connects.
  "pg.connect",
  "pg-pool.connect",
  // ioredis (@opentelemetry/instrumentation-ioredis), SQLAlchemy (Python), pgx (otelpgx, Go).
  "connect",
  // node-redis v4 / v5 (@opentelemetry/instrumentation-redis).
  "redis-connect",
  // go-redis (redisotel): opening a pooled connection.
  "redis.dial",
  // database/sql (otelsql, Go): opening and resetting a pooled connection.
  "sql.connector.connect",
  "sql.conn.reset_session",
  // PHP PDO (opentelemetry-auto-pdo): opening the connection.
  "PDO::__construct",
  "PDO::connect",
  /*
   * node-oracledb (@opentelemetry/instrumentation-oracledb): getting a
   * connection, creating a pool, the connect-time protocol, data-type and
   * authentication round trips, logging off and closing.
   */
  "oracledb.getConnection",
  "oracledb.Pool.getConnection",
  "oracledb.createPool",
  "oracledb.ProtocolMessage",
  "oracledb.DataTypeMessage",
  "oracledb.AuthMessage",
  "oracledb.FastAuthMessage",
  "oracledb.LogOffMessage",
  "oracledb.Connection.close",
];

const CONNECTION_SPAN_NAME_SET: ReadonlySet<string> = new Set<string>(
  DATABASE_CONNECTION_SPAN_NAMES.map((name: string): string => {
    return name.toLowerCase();
  }),
);

/**
 * True when a database CLIENT span is connection management, not a query
 * (see DATABASE_CONNECTION_SPAN_NAMES). Compared trimmed and
 * case-insensitively; a missing name is never a connection span.
 */
export function isDatabaseConnectionSpanName(
  name: string | null | undefined,
): boolean {
  if (typeof name !== "string") {
    return false;
  }

  return CONNECTION_SPAN_NAME_SET.has(name.trim().toLowerCase());
}
