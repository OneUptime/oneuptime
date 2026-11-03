/*
 * The made-up database fleets the Databases pages fixture serves, for an
 * "Acme Commerce" workspace. Nothing here is a real customer's data.
 *
 * buildFleet(scenario, loadedAt) returns the databases (DatabaseServer
 * rows, the shape discovery and the metrics ingest write - each engine's
 * latest readings and the verdict stored with them included) for one of:
 *
 *   busy   (default) ten databases on seven engines: two PostgreSQL servers
 *          past a critical line (connections nearly exhausted and a replica
 *          behind; transaction IDs near wraparound and a transaction open
 *          for two hours), an Elasticsearch cluster gone red, a Memcached
 *          whose engine metrics stopped three hours ago, a MySQL replica
 *          behind its source, a SQL Server with blocked sessions, a Redis
 *          near maxmemory, a calm MongoDB, a PostgreSQL only traces know
 *          (no engine metrics) and a ClickHouse whose metrics arrive with
 *          nothing to judge them by;
 *   calm   one healthy database for each of the nine engines OneUptime
 *          recommends alerts for;
 *   new    a project with no database yet.
 *
 * Each reading is keyed the way the ingest keys it
 * (DatabaseEngineReadings: "<aggregation>|<metric>|<attribute=value>"), per
 * reporting instance, and the stored verdict (engineHealth) is what the
 * ingest works out from the same readings with the same rules.
 */
import {
  getDatabaseEngineHealthVerdict,
  judgeDatabaseEngineReadings,
} from "Common/Types/DatabaseServer/DatabaseHealth";

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DATABASE_IDS = {
  ordersDb: uuid("73000000", 1),
  paymentsPg: uuid("73000000", 2),
  searchEs: uuid("73000000", 3),
  cacheMemcached: uuid("73000000", 4),
  catalogMysql: uuid("73000000", 5),
  ledgerMssql: uuid("73000000", 6),
  sessionsRedis: uuid("73000000", 7),
  analyticsMongo: uuid("73000000", 8),
  inventoryPg: uuid("73000000", 9),
  eventsClickhouse: uuid("73000000", 10),
  billingOracle: uuid("73000000", 11),
  docsCouch: uuid("73000000", 12),
};

/*
 * What each engine reports when nothing needs attention, keyed as the
 * ingest keys the recommended alerts' queries.
 */
const CALM = {
  postgresql: {
    "Count|postgresql.connection.max|": 1,
    "Sum|postgresql.backends|": 24,
    "Sum|postgresql.connection.max|": 100,
    "Max|postgresql.wal.delay|operation=replay": 0.4,
    "Max|postgresql.replication.data_delay|": 2048,
    "Max|postgresql.db_size|": 48_000_000_000,
    "Min|postgresql.uptime|": 40 * 86_400,
    "Max|postgresql.xid.oldest_age|": 180_000_000,
    "Max|postgresql.transaction.longest_duration|": 3,
    "Max|postgresql.sessions.waiting_on_lock|": 0,
  },
  mysql: {
    "Count|mysql.uptime|": 1,
    "Min|mysql.uptime|": 21 * 86_400,
    "Max|mysql.threads|kind=connected": 31,
    "Max|mysql.threads|kind=running": 4,
    "Sum|mysql.buffer_pool.data_pages|status=dirty": 300,
    "Sum|mysql.buffer_pool.pages|kind=total": 8192,
    "Max|mysql.replica.time_behind_source|": 0,
  },
  redis: {
    "Count|redis.uptime|": 1,
    "Min|redis.uptime|": 12 * 86_400,
    "Sum|redis.memory.used|": 310_000_000,
    "Sum|redis.maxmemory|": 1_000_000_000,
    "Avg|redis.memory.fragmentation_ratio|": 1.08,
    "Avg|redis.memory.used|": 310_000_000,
    "Max|redis.clients.connected|": 64,
  },
  mongodb: {
    "Count|mongodb.database.count|": 1,
    "Min|mongodb.uptime|": 9 * 86_400_000,
    "Sum|mongodb.connection.count|type=current": 52,
    "Sum|mongodb.connection.count|type=available": 819,
  },
  sqlserver: {
    "Count|sqlserver.user.connection.count|": 1,
    "Min|sqlserver.page.buffer_cache.hit_ratio|": 99.7,
    "Min|sqlserver.page.life_expectancy|": 5200,
    "Max|sqlserver.processes.blocked|": 0,
    "Max|sqlserver.memory.grants.pending.count|": 0,
  },
  oracle: {
    "Count|oracledb.sessions.usage|": 6,
    "Max|oracledb.tablespace.utilization|": 0.41,
  },
  elasticsearch: {
    "Count|elasticsearch.cluster.health|": 3,
    "Max|elasticsearch.cluster.health|status=red": 0,
    "Max|elasticsearch.cluster.health|status=yellow": 0,
    "Max|elasticsearch.cluster.pending_tasks|": 0,
    "Max|jvm.memory.heap.utilization|": 0.52,
  },
  memcached: {
    "Count|memcached.threads|": 1,
    "Max|memcached.connections.current|": 18,
  },
  couchdb: {
    "Count|couchdb.database.open|": 1,
    "Max|couchdb.average_request_time|": 24,
  },
};

/*
 * One database, as its record reads: discovered by the Database Agent and
 * reporting, unless `fields` says otherwise.
 */
function database(id, fields, loadedAt) {
  return {
    _id: id,
    projectId: PROJECT_ID,
    isArchived: false,
    discoverySource: "collector",
    lastSeenAt: new Date(loadedAt - MINUTE),
    createdAt: new Date(loadedAt - 60 * DAY),
    memberEntityKeys: [],
    instanceCount: 1,
    labels: [],
    ...fields,
  };
}

/*
 * What an agent reported for the database at `at`: its readings, when they
 * arrived, and the verdict the ingest stored with them.
 */
function reporting(row, family, overrides, readAt, loadedAt) {
  const instance = `${row.serverAddress}:${row.serverPort}`;
  const readings = {
    instances: {
      [instance]: {
        at: new Date(readAt).toISOString(),
        values: { ...CALM[family], ...overrides },
      },
    },
  };
  const judged = judgeDatabaseEngineReadings({
    dbSystem: row.dbSystem,
    readings: readings,
    now: new Date(readAt),
  });
  return {
    ...row,
    otelCollectorStatus:
      readAt >= loadedAt - 10 * MINUTE ? "connected" : "disconnected",
    collectorLastSeenAt: new Date(readAt),
    agentVersion: "0.161.1",
    engineReadings: readings,
    engineReadingsAt: new Date(readAt),
    engineHealth: getDatabaseEngineHealthVerdict(judged),
  };
}

function busyFleet(loadedAt) {
  const now = loadedAt - MINUTE;
  return [
    reporting(
      database(
        DATABASE_IDS.ordersDb,
        {
          name: "orders-db",
          description: "The checkout stack's orders, carts and invoices.",
          dbSystem: "postgresql",
          dbVersion: "16.4",
          serverAddress: "orders-db.prod.internal",
          serverPort: 5432,
        },
        loadedAt,
      ),
      "postgresql",
      {
        "Sum|postgresql.backends|": 96,
        "Max|postgresql.wal.delay|operation=replay": 75,
      },
      now,
      loadedAt,
    ),
    reporting(
      database(
        DATABASE_IDS.paymentsPg,
        {
          name: "payments-pg",
          dbSystem: "postgresql",
          dbVersion: "15.6",
          serverAddress: "payments-pg.prod.internal",
          serverPort: 5432,
        },
        loadedAt,
      ),
      "postgresql",
      {
        "Max|postgresql.xid.oldest_age|": 1_600_000_000,
        "Max|postgresql.transaction.longest_duration|": 7300,
      },
      now,
      loadedAt,
    ),
    reporting(
      database(
        DATABASE_IDS.searchEs,
        {
          name: "search-es",
          dbSystem: "elasticsearch",
          dbVersion: "8.13.0",
          serverAddress: "search-es.prod.internal",
          serverPort: 9200,
        },
        loadedAt,
      ),
      "elasticsearch",
      {
        "Max|elasticsearch.cluster.health|status=red": 1,
      },
      now,
      loadedAt,
    ),
    // Its agent stopped three hours ago: what it said then is not the truth now.
    reporting(
      database(
        DATABASE_IDS.cacheMemcached,
        {
          name: "cache-memcached",
          dbSystem: "memcached",
          dbVersion: "1.6.27",
          serverAddress: "cache-memcached.prod.internal",
          serverPort: 11211,
          lastSeenAt: new Date(loadedAt - 3 * HOUR),
        },
        loadedAt,
      ),
      "memcached",
      { "Max|memcached.connections.current|": 990 },
      loadedAt - 3 * HOUR,
      loadedAt,
    ),
    reporting(
      database(
        DATABASE_IDS.catalogMysql,
        {
          name: "catalog-mysql",
          dbSystem: "mysql",
          dbVersion: "8.0.36",
          serverAddress: "catalog-mysql.prod.internal",
          serverPort: 3306,
        },
        loadedAt,
      ),
      "mysql",
      { "Max|mysql.replica.time_behind_source|": 45 },
      now,
      loadedAt,
    ),
    reporting(
      database(
        DATABASE_IDS.ledgerMssql,
        {
          name: "ledger-mssql",
          dbSystem: "microsoft.sql_server",
          dbVersion: "16.0.4135.4",
          serverAddress: "ledger-mssql.prod.internal",
          serverPort: 1433,
        },
        loadedAt,
      ),
      "sqlserver",
      { "Max|sqlserver.processes.blocked|": 3 },
      now,
      loadedAt,
    ),
    reporting(
      database(
        DATABASE_IDS.sessionsRedis,
        {
          name: "sessions-redis",
          dbSystem: "redis",
          dbVersion: "7.2.4",
          serverAddress: "sessions-redis.prod.internal",
          serverPort: 6379,
        },
        loadedAt,
      ),
      "redis",
      {
        "Sum|redis.memory.used|": 930_000_000,
        "Avg|redis.memory.used|": 930_000_000,
      },
      now,
      loadedAt,
    ),
    reporting(
      database(
        DATABASE_IDS.analyticsMongo,
        {
          name: "analytics-mongo",
          dbSystem: "mongodb",
          dbVersion: "7.0.8",
          serverAddress: "analytics-mongo.prod.internal",
          serverPort: 27017,
        },
        loadedAt,
      ),
      "mongodb",
      {},
      now,
      loadedAt,
    ),
    // Only the applications' traces know it: no agent has ever reported.
    database(
      DATABASE_IDS.inventoryPg,
      {
        name: "inventory-pg",
        dbSystem: "postgresql",
        serverAddress: "inventory-pg.prod.internal",
        serverPort: 5432,
        discoverySource: "client-spans",
      },
      loadedAt,
    ),
    // Its own Prometheus endpoint, scraped: metrics, but no alert lines.
    {
      ...database(
        DATABASE_IDS.eventsClickhouse,
        {
          name: "events-clickhouse",
          dbSystem: "clickhouse",
          dbVersion: "24.3.2",
          serverAddress: "events-clickhouse.prod.internal",
          serverPort: 9000,
        },
        loadedAt,
      ),
      otelCollectorStatus: "connected",
      collectorLastSeenAt: new Date(now),
    },
  ];
}

function calmFleet(loadedAt) {
  const now = loadedAt - MINUTE;
  const rows = [
    ["ordersDb", "orders-db", "postgresql", "16.4", 5432, "postgresql"],
    ["catalogMysql", "catalog-mysql", "mysql", "8.0.36", 3306, "mysql"],
    ["ledgerMssql", "ledger-mssql", "microsoft.sql_server", "16.0", 1433, "sqlserver"],
    ["billingOracle", "billing-oracle", "oracle.db", "23.4", 1521, "oracle"],
    ["sessionsRedis", "sessions-redis", "redis", "7.2.4", 6379, "redis"],
    ["analyticsMongo", "analytics-mongo", "mongodb", "7.0.8", 27017, "mongodb"],
    ["searchEs", "search-es", "elasticsearch", "8.13.0", 9200, "elasticsearch"],
    ["cacheMemcached", "cache-memcached", "memcached", "1.6.27", 11211, "memcached"],
    ["docsCouch", "docs-couch", "couchdb", "3.3.3", 5984, "couchdb"],
  ];
  return rows.map(([key, name, dbSystem, dbVersion, port, family]) => {
    return reporting(
      database(
        DATABASE_IDS[key],
        {
          name: name,
          dbSystem: dbSystem,
          dbVersion: dbVersion,
          serverAddress: `${name}.prod.internal`,
          serverPort: port,
        },
        loadedAt,
      ),
      family,
      {},
      now,
      loadedAt,
    );
  });
}

export function buildFleet(scenario, loadedAt) {
  if (scenario.fleet === "new") {
    return [];
  }
  if (scenario.fleet === "calm") {
    return calmFleet(loadedAt);
  }
  return busyFleet(loadedAt);
}

/*
 * The database's endpoint, as discovery records it: its address and port,
 * primary.
 */
export function buildEndpoints(databases) {
  return databases.map((row, index) => {
    return {
      _id: uuid("74000000", index + 1),
      projectId: PROJECT_ID,
      databaseServerId: row._id,
      endpoint: `${row.serverAddress}:${row.serverPort}`,
      isPrimary: true,
    };
  });
}
