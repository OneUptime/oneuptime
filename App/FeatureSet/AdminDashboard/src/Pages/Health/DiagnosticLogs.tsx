import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement, useState } from "react";

type LogTab = "application" | "clickhouse" | "postgres" | "redis";

const TABS: Array<{ key: LogTab; label: string }> = [
  { key: "application", label: "Application" },
  { key: "clickhouse", label: "ClickHouse" },
  { key: "postgres", label: "Postgres" },
  { key: "redis", label: "Redis" },
];

// Tailwind text colour for a log level.
const levelClass: (level: string) => string = (level: string): string => {
  const normalized: string = level.toUpperCase();

  if (normalized.includes("ERROR") || normalized === "FATAL") {
    return "text-red-400";
  }

  if (normalized.includes("WARN") || normalized === "CRITICAL") {
    return "text-amber-400";
  }

  if (normalized === "DEBUG" || normalized === "TRACE") {
    return "text-gray-500";
  }

  return "text-gray-300";
};

// A dark, scrollable, monospace panel — the shared look for every log surface.
const LogPanel: FunctionComponent<{
  children: ReactElement | Array<ReactElement>;
}> = (props: {
  children: ReactElement | Array<ReactElement>;
}): ReactElement => {
  return (
    <div className="mt-3 max-h-[28rem] overflow-auto rounded-md bg-gray-900 p-3 font-mono text-xs leading-relaxed text-gray-100">
      {props.children}
    </div>
  );
};

const EmptyNote: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return <div className="mt-3 text-sm italic text-gray-400">{props.text}</div>;
};

const SectionNote: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return <div className="mt-1 text-xs text-gray-500">{props.text}</div>;
};

/*
 * Diagnostic logs card for the master-admin health dashboard. Loads on demand
 * (logs can be large) and shows the four reachable log surfaces in tabs:
 *   - Application: this app process's own recent in-memory log lines.
 *   - ClickHouse: system.errors / text_log / query_log / crash_log.
 *   - Postgres: server log tail (only when logging_collector is on).
 *   - Redis: SLOWLOG + INFO counters (server log files aren't reachable).
 * Container stdout/stderr is not reachable from the app process — see the note
 * at the foot of the card.
 */
const DiagnosticLogs: FunctionComponent = (): ReactElement => {
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [data, setData] = useState<JSONObject | null>(null);
  const [activeTab, setActiveTab] = useState<LogTab>("application");

  const loadLogs: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/logs",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setData(response.data);
      setHasLoaded(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const renderApplication: () => ReactElement = (): ReactElement => {
    const section: JSONObject = (data?.["application"] || {}) as JSONObject;
    const entries: JSONArray = (section["entries"] || []) as JSONArray;

    return (
      <div>
        <SectionNote text={String(section["note"] || "")} />
        {entries.length === 0 ? (
          <EmptyNote text="No recent application log lines captured." />
        ) : (
          <LogPanel>
            {entries.map((entry: unknown, index: number): ReactElement => {
              const entryObject: JSONObject = entry as JSONObject;
              const level: string = String(entryObject["level"] || "");

              return (
                <div key={index} className="whitespace-pre-wrap break-words">
                  <span className="text-gray-500">
                    {String(entryObject["time"] || "")}
                  </span>{" "}
                  <span className={`font-semibold ${levelClass(level)}`}>
                    {level}
                  </span>{" "}
                  <span>{String(entryObject["message"] || "")}</span>
                </div>
              );
            })}
          </LogPanel>
        )}
      </div>
    );
  };

  const renderClickhouse: () => ReactElement = (): ReactElement => {
    const section: JSONObject = (data?.["clickhouse"] || {}) as JSONObject;

    if (!section["connected"]) {
      return (
        <EmptyNote text="ClickHouse is not reachable from this instance." />
      );
    }

    const errors: JSONArray = (section["errors"] || []) as JSONArray;
    const logEntries: JSONArray = (section["recentLogEntries"] ||
      []) as JSONArray;
    const failedQueries: JSONArray = (section["failedQueries"] ||
      []) as JSONArray;
    const crashes: JSONArray = (section["crashes"] || []) as JSONArray;

    return (
      <div className="space-y-4">
        <SectionNote text={String(section["note"] || "")} />

        <div>
          <div className="text-sm font-medium text-gray-700">
            Error counters (system.errors)
          </div>
          {errors.length === 0 ? (
            <EmptyNote text="No errors recorded." />
          ) : (
            <LogPanel>
              {errors.map((row: unknown, index: number): ReactElement => {
                const rowObject: JSONObject = row as JSONObject;

                return (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    <span className="text-gray-500">
                      {String(rowObject["lastErrorTime"] || "")}
                    </span>{" "}
                    <span className="font-semibold text-red-400">
                      {String(rowObject["name"] || "")}
                    </span>{" "}
                    <span className="text-gray-400">
                      (×{String(rowObject["count"] || "0")})
                    </span>{" "}
                    <span>{String(rowObject["lastErrorMessage"] || "")}</span>
                  </div>
                );
              })}
            </LogPanel>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700">
            Recent server log (system.text_log)
          </div>
          {logEntries.length === 0 ? (
            <EmptyNote text="No recent warning/error log lines, or text_log is not enabled." />
          ) : (
            <LogPanel>
              {logEntries.map((row: unknown, index: number): ReactElement => {
                const rowObject: JSONObject = row as JSONObject;
                const level: string = String(rowObject["level"] || "");

                return (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    <span className="text-gray-500">
                      {String(rowObject["time"] || "")}
                    </span>{" "}
                    <span className={`font-semibold ${levelClass(level)}`}>
                      {level}
                    </span>{" "}
                    <span>{String(rowObject["message"] || "")}</span>
                  </div>
                );
              })}
            </LogPanel>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700">
            Failed queries (system.query_log)
          </div>
          {failedQueries.length === 0 ? (
            <EmptyNote text="No recent failed queries." />
          ) : (
            <LogPanel>
              {failedQueries.map(
                (row: unknown, index: number): ReactElement => {
                  const rowObject: JSONObject = row as JSONObject;

                  return (
                    <div
                      key={index}
                      className="whitespace-pre-wrap break-words"
                    >
                      <span className="text-gray-500">
                        {String(rowObject["time"] || "")}
                      </span>{" "}
                      <span className="font-semibold text-red-400">
                        {String(rowObject["type"] || "")}
                      </span>{" "}
                      <span>{String(rowObject["exception"] || "")}</span>
                    </div>
                  );
                },
              )}
            </LogPanel>
          )}
        </div>

        {crashes.length > 0 ? (
          <div>
            <div className="text-sm font-medium text-gray-700">
              Crashes (system.crash_log)
            </div>
            <LogPanel>
              {crashes.map((row: unknown, index: number): ReactElement => {
                const rowObject: JSONObject = row as JSONObject;

                return (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    <span className="text-gray-500">
                      {String(rowObject["time"] || "")}
                    </span>{" "}
                    <span className="font-semibold text-red-400">
                      signal {String(rowObject["signal"] || "")}
                    </span>
                    {"\n"}
                    {String(rowObject["trace"] || "")}
                  </div>
                );
              })}
            </LogPanel>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderPostgres: () => ReactElement = (): ReactElement => {
    const section: JSONObject = (data?.["postgres"] || {}) as JSONObject;

    if (!section["connected"]) {
      return <EmptyNote text="Postgres is not reachable from this instance." />;
    }

    if (!section["available"]) {
      return (
        <EmptyNote
          text={String(section["note"] || "Postgres logs are not available.")}
        />
      );
    }

    const logTail: JSONArray = (section["logTail"] || []) as JSONArray;

    return (
      <div>
        <SectionNote
          text={`Tailing ${String(section["logFile"] || "log file")}.`}
        />
        {logTail.length === 0 ? (
          <EmptyNote text="Log file is empty." />
        ) : (
          <LogPanel>
            {logTail.map((line: unknown, index: number): ReactElement => {
              return (
                <div key={index} className="whitespace-pre-wrap break-words">
                  {String(line)}
                </div>
              );
            })}
          </LogPanel>
        )}
      </div>
    );
  };

  const renderRedis: () => ReactElement = (): ReactElement => {
    const section: JSONObject = (data?.["redis"] || {}) as JSONObject;

    if (!section["connected"]) {
      return <EmptyNote text="Redis is not reachable from this instance." />;
    }

    const slowlog: JSONArray = (section["slowlog"] || []) as JSONArray;
    const errorStats: JSONArray = (section["errorStats"] || []) as JSONArray;
    const stats: JSONObject = (section["stats"] || {}) as JSONObject;

    return (
      <div className="space-y-4">
        <SectionNote text={String(section["note"] || "")} />

        <div>
          <div className="text-sm font-medium text-gray-700">
            Slow commands (SLOWLOG)
          </div>
          {slowlog.length === 0 ? (
            <EmptyNote text="No slow commands recorded." />
          ) : (
            <LogPanel>
              {slowlog.map((row: unknown, index: number): ReactElement => {
                const rowObject: JSONObject = row as JSONObject;

                return (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    <span className="text-gray-500">
                      {String(rowObject["at"] || "")}
                    </span>{" "}
                    <span className="font-semibold text-amber-400">
                      {String(rowObject["durationMs"] || "0")}ms
                    </span>{" "}
                    <span>{String(rowObject["command"] || "")}</span>
                  </div>
                );
              })}
            </LogPanel>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700">
            Error counters (INFO errorstats)
          </div>
          {errorStats.length === 0 ? (
            <EmptyNote text="No error counters reported." />
          ) : (
            <LogPanel>
              {errorStats.map((row: unknown, index: number): ReactElement => {
                const rowObject: JSONObject = row as JSONObject;

                return (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    <span className="font-semibold text-red-400">
                      {String(rowObject["error"] || "")}
                    </span>{" "}
                    <span>{String(rowObject["detail"] || "")}</span>
                  </div>
                );
              })}
            </LogPanel>
          )}
        </div>

        {Object.keys(stats).length > 0 ? (
          <div>
            <div className="text-sm font-medium text-gray-700">
              Counters (INFO stats)
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {Object.keys(stats).map(
                (key: string, index: number): ReactElement => {
                  return (
                    <div key={index} className="text-xs">
                      <span className="text-gray-400">{key}: </span>
                      <span className="font-medium text-gray-700">
                        {String(stats[key] ?? "—")}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderActiveTab: () => ReactElement = (): ReactElement => {
    if (activeTab === "clickhouse") {
      return renderClickhouse();
    }

    if (activeTab === "postgres") {
      return renderPostgres();
    }

    if (activeTab === "redis") {
      return renderRedis();
    }

    return renderApplication();
  };

  return (
    <Card
      title="Diagnostic logs"
      description="Recent application, ClickHouse, Postgres and Redis logs for this instance — for debugging without shelling into the cluster. May contain customer data; credentials are scrubbed."
      buttons={[
        {
          title: hasLoaded ? "Refresh" : "Load logs",
          icon: hasLoaded ? IconProp.Refresh : IconProp.Download,
          buttonStyle: hasLoaded
            ? ButtonStyleType.NORMAL
            : ButtonStyleType.PRIMARY,
          buttonSize: ButtonSize.Small,
          isLoading: isLoading,
          onClick: () => {
            loadLogs().catch(() => {
              // handled via setError
            });
          },
        },
      ]}
    >
      <div>
        {error ? (
          <Alert type={AlertType.DANGER} title={error} className="mb-4" />
        ) : (
          <></>
        )}

        {!hasLoaded && isLoading ? <ComponentLoader /> : <></>}

        {!hasLoaded && !isLoading ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            Logs are loaded on demand. Click{" "}
            <span className="font-medium text-gray-700">Load logs</span> to
            fetch this instance&apos;s recent application and datastore logs.
          </div>
        ) : (
          <></>
        )}

        {hasLoaded ? (
          <div>
            {/* Tabs */}
            <div className="flex flex-wrap gap-1 border-b border-gray-200">
              {TABS.map((tab: { key: LogTab; label: string }): ReactElement => {
                const isActive: boolean = activeTab === tab.key;

                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                      isActive
                        ? "border-indigo-500 text-indigo-600"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => {
                      setActiveTab(tab.key);
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3">{renderActiveTab()}</div>

            <div className="mt-5 rounded-md bg-gray-50 p-3 text-xs text-gray-500">
              {String(data?.["containerLogsNote"] || "")}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default DiagnosticLogs;
