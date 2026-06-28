import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CodeType from "Common/Types/Code/CodeType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

type QueryEngine = "postgres" | "clickhouse" | "redis";

interface EngineConfig {
  key: QueryEngine;
  label: string;
  codeType: CodeType;
  placeholder: string;
  // Whether this engine returns tabular results (and therefore supports a row limit).
  tabular: boolean;
  samples: Array<{ label: string; query: string }>;
}

const ENGINES: Array<EngineConfig> = [
  {
    key: "postgres",
    label: "PostgreSQL",
    codeType: CodeType.SQL,
    placeholder: 'SELECT * FROM "User" ORDER BY "createdAt" DESC LIMIT 50;',
    tabular: true,
    samples: [
      {
        label: "Database size",
        query:
          "SELECT pg_size_pretty(pg_database_size(current_database())) AS size;",
      },
      {
        label: "Largest tables",
        query:
          "SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size\nFROM pg_stat_user_tables\nORDER BY pg_total_relation_size(relid) DESC\nLIMIT 20;",
      },
      {
        label: "Active connections",
        query:
          "SELECT state, count(*)\nFROM pg_stat_activity\nWHERE datname = current_database()\nGROUP BY state\nORDER BY count DESC;",
      },
      {
        label: "List tables",
        query:
          "SELECT table_name\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name;",
      },
    ],
  },
  {
    key: "clickhouse",
    label: "ClickHouse",
    codeType: CodeType.SQL,
    placeholder:
      "SELECT * FROM system.tables WHERE database = currentDatabase() LIMIT 50;",
    tabular: true,
    samples: [
      {
        label: "Tables in database",
        query:
          "SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size\nFROM system.tables\nWHERE database = currentDatabase()\nORDER BY total_bytes DESC;",
      },
      {
        label: "Largest tables by parts",
        query:
          "SELECT table, count() AS parts, formatReadableSize(sum(bytes_on_disk)) AS size\nFROM system.parts\nWHERE active\nGROUP BY table\nORDER BY sum(bytes_on_disk) DESC\nLIMIT 20;",
      },
      {
        label: "Recent errors",
        query:
          "SELECT name, code, value AS count, last_error_time\nFROM system.errors\nWHERE value > 0\nORDER BY last_error_time DESC\nLIMIT 20;",
      },
      { label: "Server version", query: "SELECT version();" },
    ],
  },
  {
    key: "redis",
    label: "Redis",
    codeType: CodeType.Text,
    placeholder:
      "# One command per line, redis-cli style.\nDBSIZE\nINFO server\nKEYS *",
    tabular: false,
    samples: [
      { label: "Database size", query: "DBSIZE" },
      { label: "Server info", query: "INFO server" },
      { label: "Memory info", query: "INFO memory" },
      { label: "Scan first 50 keys", query: "SCAN 0 COUNT 50" },
    ],
  },
];

const ROW_LIMIT_OPTIONS: Array<number> = [50, 100, 500, 1000];
const HISTORY_LIMIT: number = 25;
const HISTORY_KEY_PREFIX: string = "oneuptime-admin-query-history-";

interface HistoryEntry {
  query: string;
  at: number;
}

// --- Result shapes the console renders -----------------------------------

interface TableResult {
  kind: "table";
  columns: Array<string>;
  columnTypes: Array<{ name: string; type: string }>;
  rows: JSONArray;
  rowsReturned: number;
  totalRows: number;
  affectedRows: number | null;
  truncated: boolean;
  readOnly: boolean;
  executionTimeMs: number;
  message: string | null;
}

interface RedisCommandResult {
  command: string;
  ok: boolean;
  reply?: JSONValue;
  error?: string;
}

interface RedisResult {
  kind: "redis";
  results: Array<RedisCommandResult>;
  commandsRun: number;
  readOnly: boolean;
  executionTimeMs: number;
}

interface ErrorResult {
  kind: "error";
  error: string;
  executionTimeMs: number | null;
}

type ConsoleResult = TableResult | RedisResult | ErrorResult;

// --- Helpers --------------------------------------------------------------

const getEngineConfig: (engine: QueryEngine) => EngineConfig = (
  engine: QueryEngine,
): EngineConfig => {
  return (
    ENGINES.find((config: EngineConfig): boolean => {
      return config.key === engine;
    }) || ENGINES[0]!
  );
};

const loadHistory: (engine: QueryEngine) => Array<HistoryEntry> = (
  engine: QueryEngine,
): Array<HistoryEntry> => {
  try {
    const raw: string | null = window.localStorage.getItem(
      `${HISTORY_KEY_PREFIX}${engine}`,
    );
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Array<HistoryEntry>) : [];
  } catch {
    return [];
  }
};

const saveHistory: (
  engine: QueryEngine,
  entries: Array<HistoryEntry>,
) => void = (engine: QueryEngine, entries: Array<HistoryEntry>): void => {
  try {
    window.localStorage.setItem(
      `${HISTORY_KEY_PREFIX}${engine}`,
      JSON.stringify(entries),
    );
  } catch {
    // Best-effort — history is a convenience, not critical.
  }
};

// Convert a single cell to a readable string for CSV / copy export.
const cellToText: (value: JSONValue) => string = (value: JSONValue): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

// A CSV value needs quoting when it contains a quote, comma or newline.
const CSV_QUOTE_PATTERN: RegExp = /[",\n\r]/;

const toCSV: (columns: Array<string>, rows: JSONArray) => string = (
  columns: Array<string>,
  rows: JSONArray,
): string => {
  const escape: (value: string) => string = (value: string): string => {
    if (CSV_QUOTE_PATTERN.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const header: string = columns.map(escape).join(",");
  const body: Array<string> = rows.map((row: JSONValue): string => {
    const rowObject: JSONObject = (row || {}) as JSONObject;
    return columns
      .map((column: string): string => {
        return escape(cellToText(rowObject[column] as JSONValue));
      })
      .join(",");
  });

  return [header, ...body].join("\n");
};

const downloadFile: (
  content: string,
  filename: string,
  mimeType: string,
) => void = (content: string, filename: string, mimeType: string): void => {
  const blob: Blob = new Blob([content], { type: mimeType });
  const url: string = window.URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
};

const renderCell: (value: JSONValue) => ReactElement = (
  value: JSONValue,
): ReactElement => {
  if (value === null || value === undefined) {
    return <span className="text-gray-300 italic">NULL</span>;
  }
  if (typeof value === "object") {
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="font-mono">{value ? "true" : "false"}</span>;
  }
  return <span>{String(value)}</span>;
};

// --- Component ------------------------------------------------------------

const QueryConsoleContent: FunctionComponent = (): ReactElement => {
  const [engine, setEngine] = useState<QueryEngine>("postgres");
  const [queries, setQueries] = useState<Record<QueryEngine, string>>({
    postgres: "",
    clickhouse: "",
    redis: "",
  });
  const [readOnly, setReadOnly] = useState<boolean>(true);
  const [maxRows, setMaxRows] = useState<number>(100);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [history, setHistory] = useState<Array<HistoryEntry>>([]);

  const config: EngineConfig = getEngineConfig(engine);

  useEffect(() => {
    setHistory(loadHistory(engine));
  }, [engine]);

  const addToHistory: (query: string) => void = (query: string): void => {
    const trimmed: string = query.trim();
    if (!trimmed) {
      return;
    }

    const existing: Array<HistoryEntry> = loadHistory(engine).filter(
      (entry: HistoryEntry): boolean => {
        return entry.query !== trimmed;
      },
    );
    const updated: Array<HistoryEntry> = [
      { query: trimmed, at: Date.now() },
      ...existing,
    ].slice(0, HISTORY_LIMIT);

    saveHistory(engine, updated);
    setHistory(updated);
  };

  const runQuery: () => Promise<void> = async (): Promise<void> => {
    const query: string = (queries[engine] || "").trim();

    if (!query || isRunning) {
      return;
    }

    setIsRunning(true);
    setResult(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/admin/health/query/${engine}`,
          ),
          data: {
            query,
            readOnly,
            maxRows,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data;

      if (!data["success"]) {
        setResult({
          kind: "error",
          error: String(data["error"] || "Query failed."),
          executionTimeMs:
            typeof data["executionTimeMs"] === "number"
              ? (data["executionTimeMs"] as number)
              : null,
        });
      } else if (engine === "redis") {
        setResult({
          kind: "redis",
          results: (data["results"] ||
            []) as unknown as Array<RedisCommandResult>,
          commandsRun: Number(data["commandsRun"] || 0),
          readOnly: Boolean(data["readOnly"]),
          executionTimeMs: Number(data["executionTimeMs"] || 0),
        });
      } else {
        setResult({
          kind: "table",
          columns: (data["columns"] || []) as Array<string>,
          columnTypes: (data["columnTypes"] || []) as Array<{
            name: string;
            type: string;
          }>,
          rows: (data["rows"] || []) as JSONArray,
          rowsReturned: Number(data["rowsReturned"] || 0),
          totalRows: Number(data["totalRows"] || 0),
          affectedRows:
            typeof data["affectedRows"] === "number"
              ? (data["affectedRows"] as number)
              : null,
          truncated: Boolean(data["truncated"]),
          readOnly: Boolean(data["readOnly"]),
          executionTimeMs: Number(data["executionTimeMs"] || 0),
          message:
            typeof data["message"] === "string"
              ? (data["message"] as string)
              : null,
        });
      }

      addToHistory(query);
    } catch (err) {
      setResult({
        kind: "error",
        error: API.getFriendlyMessage(err),
        executionTimeMs: null,
      });
    } finally {
      setIsRunning(false);
    }
  };

  // Keep the latest runQuery reachable from the (once-bound) keydown handler.
  const runQueryRef: React.MutableRefObject<() => Promise<void>> =
    useRef(runQuery);
  runQueryRef.current = runQuery;

  useEffect(() => {
    const handler: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runQueryRef.current().catch(() => {
          // handled via setResult
        });
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const setQueryForEngine: (value: string) => void = (value: string): void => {
    setQueries((previous: Record<QueryEngine, string>) => {
      return { ...previous, [engine]: value };
    });
  };

  const renderEngineSelector: () => ReactElement = (): ReactElement => {
    return (
      <div className="inline-flex rounded-md border border-gray-300 bg-gray-50 p-1">
        {ENGINES.map((engineConfig: EngineConfig): ReactElement => {
          const isActive: boolean = engineConfig.key === engine;
          return (
            <button
              key={engineConfig.key}
              type="button"
              onClick={() => {
                setEngine(engineConfig.key);
                setResult(null);
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                isActive
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {engineConfig.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderControls: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-4 mt-4">
        <Button
          title="Run"
          icon={IconProp.Play}
          buttonStyle={ButtonStyleType.PRIMARY}
          buttonSize={ButtonSize.Normal}
          isLoading={isRunning}
          disabled={!(queries[engine] || "").trim()}
          onClick={() => {
            runQuery().catch(() => {
              // handled via setResult
            });
          }}
        />
        <span className="text-xs text-gray-400 -ml-2">⌘ / Ctrl + ↵</span>

        <div className="flex items-center gap-2">
          <Toggle
            value={readOnly}
            onChange={(value: boolean) => {
              setReadOnly(value);
            }}
          />
          <span className="text-sm text-gray-600">Read-only</span>
        </div>

        {config.tabular ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Row limit</span>
            <select
              value={maxRows}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                setMaxRows(Number(event.target.value));
              }}
              className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-8 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {ROW_LIMIT_OPTIONS.map((option: number): ReactElement => {
                return (
                  <option key={option} value={option}>
                    {option}
                  </option>
                );
              })}
            </select>
          </div>
        ) : (
          <></>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Examples</span>
          <select
            value=""
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              const selected: EngineConfig["samples"][number] | undefined =
                config.samples.find(
                  (sample: { label: string; query: string }): boolean => {
                    return sample.label === event.target.value;
                  },
                );
              if (selected) {
                setQueryForEngine(selected.query);
              }
            }}
            className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-8 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Load an example… (replaces editor)</option>
            {config.samples.map(
              (sample: { label: string; query: string }): ReactElement => {
                return (
                  <option key={sample.label} value={sample.label}>
                    {sample.label}
                  </option>
                );
              },
            )}
          </select>
        </div>

        <Button
          title="Clear"
          icon={IconProp.Close}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Normal}
          onClick={() => {
            setQueryForEngine("");
            setResult(null);
          }}
        />
      </div>
    );
  };

  const renderTableResult: (tableResult: TableResult) => ReactElement = (
    tableResult: TableResult,
  ): ReactElement => {
    /*
     * Only statements with NO result set at all (DDL, writes, ClickHouse
     * command() no-ops) collapse into a success alert. A read that returns
     * columns but zero rows is still a real (empty) result set - render it as
     * an empty table below so "ran but matched nothing" is distinguishable
     * from "non-query statement".
     */
    if (tableResult.columns.length === 0) {
      return (
        <Alert
          type={AlertType.SUCCESS}
          title={
            tableResult.message ||
            (tableResult.affectedRows !== null
              ? `Statement executed in ${tableResult.executionTimeMs} ms. ${tableResult.affectedRows} row(s) affected.`
              : `Statement executed in ${tableResult.executionTimeMs} ms. No rows returned.`)
          }
        />
      );
    }

    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">
              {tableResult.rowsReturned.toLocaleString()}
            </span>{" "}
            {tableResult.rowsReturned === 1 ? "row" : "rows"}
            {tableResult.truncated ? (
              <span className="text-yellow-600">
                {" "}
                (truncated — more rows available; increase the row limit to see
                more)
              </span>
            ) : (
              <></>
            )}{" "}
            · {tableResult.executionTimeMs} ms
          </div>
          <div className="flex items-center gap-2">
            <Button
              title="Copy JSON"
              icon={IconProp.Copy}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                navigator.clipboard
                  ?.writeText(JSON.stringify(tableResult.rows, null, 2))
                  .catch(() => {
                    // clipboard may be unavailable — non-critical.
                  });
              }}
            />
            <Button
              title="Download CSV"
              icon={IconProp.Download}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                downloadFile(
                  toCSV(tableResult.columns, tableResult.rows),
                  `query-result-${engine}.csv`,
                  "text/csv",
                );
              }}
            />
          </div>
        </div>

        <div className="overflow-auto max-h-[28rem] rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 w-12">
                  #
                </th>
                {tableResult.columns.map(
                  (column: string, index: number): ReactElement => {
                    const columnType:
                      | { name: string; type: string }
                      | undefined = tableResult.columnTypes.find(
                      (entry: { name: string }): boolean => {
                        return entry.name === column;
                      },
                    );
                    return (
                      <th
                        key={`${column}-${index}`}
                        className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                      >
                        {column}
                        {columnType ? (
                          <span className="ml-1 font-normal text-gray-400">
                            {columnType.type}
                          </span>
                        ) : (
                          <></>
                        )}
                      </th>
                    );
                  },
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {tableResult.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableResult.columns.length + 1}
                    className="px-3 py-6 text-center text-sm text-gray-400"
                  >
                    0 rows — the query ran successfully but matched no rows.
                  </td>
                </tr>
              ) : (
                <></>
              )}
              {tableResult.rows.map(
                (row: JSONValue, rowIndex: number): ReactElement => {
                  const rowObject: JSONObject = (row || {}) as JSONObject;
                  return (
                    <tr key={rowIndex} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs text-gray-300 tabular-nums">
                        {rowIndex + 1}
                      </td>
                      {tableResult.columns.map(
                        (column: string, columnIndex: number): ReactElement => {
                          return (
                            <td
                              key={`${rowIndex}-${columnIndex}`}
                              className="px-3 py-2 text-gray-700 max-w-md truncate align-top"
                              title={cellToText(rowObject[column] as JSONValue)}
                            >
                              {renderCell(rowObject[column] as JSONValue)}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderRedisResult: (redisResult: RedisResult) => ReactElement = (
    redisResult: RedisResult,
  ): ReactElement => {
    return (
      <div>
        <div className="text-sm text-gray-500 mb-3">
          <span className="font-medium text-gray-700">
            {redisResult.commandsRun}
          </span>{" "}
          {redisResult.commandsRun === 1 ? "command" : "commands"} ·{" "}
          {redisResult.executionTimeMs} ms
        </div>
        <div className="space-y-3">
          {redisResult.results.map(
            (item: RedisCommandResult, index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="rounded-lg border border-gray-200 overflow-hidden"
                >
                  <div className="bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 border-b border-gray-200">
                    {item.command}
                  </div>
                  <div className="px-3 py-2">
                    {item.ok ? (
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800">
                        {typeof item.reply === "object" && item.reply !== null
                          ? JSON.stringify(item.reply, null, 2)
                          : item.reply === null || item.reply === undefined
                            ? "(nil)"
                            : String(item.reply)}
                      </pre>
                    ) : (
                      <span className="text-sm text-red-600">{item.error}</span>
                    )}
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>
    );
  };

  const renderResult: () => ReactElement = (): ReactElement => {
    if (!result) {
      return (
        <div className="text-sm text-gray-400 py-8 text-center">
          Run a query to see results here.
        </div>
      );
    }

    if (result.kind === "error") {
      return (
        <Alert
          type={AlertType.DANGER}
          strongTitle="Query failed"
          title={
            <span className="font-mono whitespace-pre-wrap break-words">
              {result.error}
            </span>
          }
        />
      );
    }

    if (result.kind === "redis") {
      return renderRedisResult(result);
    }

    return renderTableResult(result);
  };

  return (
    <div>
      {!readOnly ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle="Read-only mode is off"
          title="Write and DDL statements WILL be executed against the live datastore. Proceed with caution."
          className="mb-5"
        />
      ) : (
        <></>
      )}

      <Card
        title="Query console"
        description="Run ad-hoc queries against the datastores backing this instance. Queries run with the instance's own credentials. Read-only mode (on by default) prevents database mutations, but it is not a full sandbox — treat this as direct database access."
      >
        <div>
          {renderEngineSelector()}

          <div className="mt-4">
            <CodeEditor
              key={engine}
              type={config.codeType}
              initialValue={queries[engine]}
              value={queries[engine]}
              placeholder={config.placeholder}
              showLineNumbers={true}
              onChange={(value: string) => {
                setQueryForEngine(value);
              }}
            />
          </div>

          {renderControls()}
        </div>
      </Card>

      <Card title="Results">{renderResult()}</Card>

      {history.length > 0 ? (
        <Card
          title="Query history"
          description={`Your last ${config.label} queries (stored in this browser only).`}
        >
          <div className="space-y-2">
            {history.map((entry: HistoryEntry, index: number): ReactElement => {
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setQueryForEngine(entry.query);
                  }}
                  className="block w-full text-left rounded-md border border-gray-200 px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                >
                  <span className="font-mono text-xs text-gray-700 line-clamp-2 whitespace-pre-wrap break-words">
                    {entry.query}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : (
        <></>
      )}
    </div>
  );
};

const QueryConsole: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Query Console"
      currentRoute={RouteMap[PageMap.HEALTH_QUERY] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Query console"
      enterpriseFeatureDescription="Run ad-hoc Postgres, ClickHouse and Redis queries against the datastores backing this instance, with read-only safety and result export."
    >
      <QueryConsoleContent />
    </HealthPage>
  );
};

export default QueryConsole;
