import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import QueryConsole, {
  ConsoleDatastore,
  ConsoleState,
  emptyConsoleState,
} from "./QueryConsole";
import Route from "Common/Types/API/Route";
import CodeType from "Common/Types/Code/CodeType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Page from "Common/UI/Components/Page/Page";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Master-admin database console. Three tabs — PostgreSQL, Redis and ClickHouse
 * — each backed by POST /api/admin/health/query. The page owns one ConsoleState
 * per datastore so drafts, the write toggle and the last result survive tab
 * switches (each tab's editor unmounts while it is not active). The heavy
 * lifting — running the query, the write-confirm dialog, rendering results —
 * lives in <QueryConsole/>.
 */
const DatabaseConsole: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const [consoleStates, setConsoleStates] = useState<
    Record<ConsoleDatastore, ConsoleState>
  >({
    postgres: emptyConsoleState(),
    clickhouse: emptyConsoleState(),
    redis: emptyConsoleState(),
  });

  const makeOnStateChange: (
    datastore: ConsoleDatastore,
  ) => (patch: Partial<ConsoleState>) => void = (
    datastore: ConsoleDatastore,
  ): ((patch: Partial<ConsoleState>) => void) => {
    return (patch: Partial<ConsoleState>): void => {
      setConsoleStates(
        (
          previous: Record<ConsoleDatastore, ConsoleState>,
        ): Record<ConsoleDatastore, ConsoleState> => {
          return {
            ...previous,
            [datastore]: { ...previous[datastore], ...patch },
          };
        },
      );
    };
  };

  const tabs: Array<Tab> = [
    {
      name: "PostgreSQL",
      children: (
        <QueryConsole
          datastore="postgres"
          title="PostgreSQL"
          description="Run SQL against the application's PostgreSQL database."
          codeType={CodeType.SQL}
          editorPlaceholder="SELECT * FROM pg_stat_activity LIMIT 10;"
          examples={[
            {
              label: "Active queries",
              query:
                "SELECT pid, state, now() - query_start AS duration, left(query, 100) AS query\nFROM pg_stat_activity\nWHERE state <> 'idle'\nORDER BY duration DESC;",
            },
            {
              label: "Table sizes",
              query:
                "SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size\nFROM pg_stat_user_tables\nORDER BY pg_total_relation_size(relid) DESC\nLIMIT 20;",
            },
            {
              label: "Rows per table",
              query:
                "SELECT relname AS table, n_live_tup AS live_rows, n_dead_tup AS dead_rows\nFROM pg_stat_user_tables\nORDER BY n_live_tup DESC\nLIMIT 20;",
            },
            {
              label: "Lock waits",
              query:
                "SELECT pid, wait_event_type, wait_event, left(query, 100) AS query\nFROM pg_stat_activity\nWHERE wait_event_type = 'Lock';",
            },
            {
              label: "Cancel a query (write)",
              query:
                "-- Politely cancel a running statement by its PID (see “Active queries”).\nSELECT pg_cancel_backend(PID);",
            },
            {
              label: "Terminate a backend (write)",
              query:
                "-- Forcefully kill a backend connection by its PID.\nSELECT pg_terminate_backend(PID);",
            },
            {
              label: "Delete rows (write)",
              query: "DELETE FROM table_name\nWHERE condition;",
            },
            {
              label: "Drop a table (write)",
              query: "DROP TABLE IF EXISTS table_name;",
            },
            {
              label: "Vacuum a table (write)",
              query:
                "-- Reclaims dead-tuple bloat. Runs in autocommit (write mode).\nVACUUM (VERBOSE, ANALYZE) table_name;",
            },
          ]}
          state={consoleStates.postgres}
          onStateChange={makeOnStateChange("postgres")}
        />
      ),
    },
    {
      name: "Redis",
      children: (
        <QueryConsole
          datastore="redis"
          title="Redis"
          description="Run a Redis command, exactly as you would in redis-cli."
          codeType={CodeType.Text}
          editorPlaceholder="GET my-key"
          examples={[
            { label: "Server info", query: "INFO server" },
            { label: "Memory", query: "INFO memory" },
            { label: "Stats", query: "INFO stats" },
            { label: "Keyspace", query: "INFO keyspace" },
            { label: "DB size", query: "DBSIZE" },
            { label: "Sample keys", query: "SCAN 0 COUNT 20" },
            { label: "Delete a key (write)", query: "DEL my-key" },
            {
              label: "Set with TTL (write)",
              query: 'SET my-key "value" EX 60',
            },
            { label: "Expire a key (write)", query: "EXPIRE my-key 60" },
            { label: "Flush this DB (write)", query: "FLUSHDB" },
          ]}
          state={consoleStates.redis}
          onStateChange={makeOnStateChange("redis")}
        />
      ),
    },
    {
      name: "ClickHouse",
      children: (
        <QueryConsole
          datastore="clickhouse"
          title="ClickHouse"
          description="Run SQL against the telemetry ClickHouse database."
          codeType={CodeType.SQL}
          editorPlaceholder="SELECT name, engine FROM system.tables LIMIT 10"
          examples={[
            {
              label: "Largest tables",
              query:
                "SELECT table, formatReadableSize(sum(bytes_on_disk)) AS size, sum(rows) AS rows\nFROM system.parts\nWHERE active\nGROUP BY table\nORDER BY sum(bytes_on_disk) DESC\nLIMIT 20",
            },
            {
              label: "Running mutations",
              query:
                "SELECT database, table, mutation_id, command, is_done, latest_fail_reason\nFROM system.mutations\nWHERE is_done = 0",
            },
            {
              label: "Running queries",
              query:
                "SELECT query_id, elapsed, formatReadableSize(memory_usage) AS memory, left(query, 100) AS query\nFROM system.processes\nORDER BY elapsed DESC",
            },
            {
              label: "Tables",
              query:
                "SELECT name, engine, total_rows\nFROM system.tables\nWHERE database = currentDatabase()\nORDER BY total_rows DESC",
            },
            {
              label: "Kill a mutation (write)",
              query:
                "-- Find mutation_id via “Running mutations”, then kill it.\nKILL MUTATION\nWHERE database = currentDatabase()\n  AND table = 'TABLE_NAME'\n  AND mutation_id = 'MUTATION_ID';",
            },
            {
              label: "Kill all stuck mutations (write)",
              query:
                "-- Cancels every unfinished mutation in this database. Use with care.\nKILL MUTATION\nWHERE database = currentDatabase()\n  AND is_done = 0;",
            },
            {
              label: "Kill a query (write)",
              query:
                "-- Find query_id via “Running queries”, then kill it.\nKILL QUERY WHERE query_id = 'QUERY_ID';",
            },
            {
              label: "Optimize table (write)",
              query: "OPTIMIZE TABLE TABLE_NAME FINAL;",
            },
            {
              label: "Truncate table (write)",
              query: "TRUNCATE TABLE IF EXISTS TABLE_NAME;",
            },
            {
              label: "Drop a table (write)",
              query:
                "-- On a clustered ClickHouse add: ON CLUSTER '<cluster>'\nDROP TABLE IF EXISTS TABLE_NAME;",
            },
          ]}
          state={consoleStates.clickhouse}
          onStateChange={makeOnStateChange("clickhouse")}
        />
      ),
    },
  ];

  return (
    <Page
      title="Database Console"
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Database Console",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.HEALTH_DATABASE_CONSOLE] as Route,
          ),
        },
      ]}
    >
      <Alert
        type={AlertType.WARNING}
        title="You are querying live production databases. Queries are read-only by default; enable “Allow write queries” per tab to run writes or DDL. Every query is audit-logged."
      />

      <Tabs
        tabs={tabs}
        onTabChange={() => {
          // No-op: each tab manages its own state via the page.
        }}
      />
    </Page>
  );
};

export default DatabaseConsole;
