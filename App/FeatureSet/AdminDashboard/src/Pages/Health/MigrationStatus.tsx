import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// Maximum number of pending migration names to list before collapsing the rest.
const MAX_PENDING_TO_SHOW: number = 10;

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return (value || {}) as JSONObject;
};

const asArray: (value: unknown) => JSONArray = (value: unknown): JSONArray => {
  return (value || []) as JSONArray;
};

const countLabel: (value: unknown) => string = (value: unknown): string => {
  const parsed: number = Number(value);
  return isNaN(parsed) ? "—" : parsed.toLocaleString();
};

// Render an ISO timestamp as readable local date/time; blank/unparseable -> em dash.
const formatDateTime: (value: unknown) => string = (
  value: unknown,
): string => {
  const raw: string = String(value || "");
  if (!raw) {
    return "—";
  }
  const date: Date = new Date(raw);
  if (isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString();
};

/*
 * Latest failure per migration name. recentFailures arrives newest-first, so
 * the first row seen for a name is its most recent failed attempt.
 */
const buildFailureMap: (failures: JSONArray) => Map<string, JSONObject> = (
  failures: JSONArray,
): Map<string, JSONObject> => {
  const map: Map<string, JSONObject> = new Map();
  for (const failure of failures) {
    const failureObject: JSONObject = asObject(failure);
    const name: string = String(failureObject["migrationName"] || "");
    if (name && !map.has(name)) {
      map.set(name, failureObject);
    }
  }
  return map;
};

// One failed attempt: error message + when/where it ran + collapsible stack.
const renderFailureDetail: (failure: JSONObject) => ReactElement = (
  failure: JSONObject,
): ReactElement => {
  const errorMessage: string = String(failure["errorMessage"] || "Unknown error");
  const errorStack: string = String(failure["errorStack"] || "");
  const hostName: string = String(failure["hostName"] || "");
  const appVersion: string = String(failure["appVersion"] || "");

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="font-mono font-medium text-red-800 break-all">
          {String(failure["migrationName"] || "—")}
        </span>
        <span className="text-red-600">
          Failed {formatDateTime(failure["attemptedAt"])}
        </span>
      </div>
      <div className="mt-1.5 text-xs font-mono text-red-700 whitespace-pre-wrap break-words">
        {errorMessage}
      </div>
      {hostName || appVersion ? (
        <div className="mt-1 text-xs text-red-500">
          {hostName ? <span>on {hostName}</span> : <></>}
          {hostName && appVersion ? <span> · </span> : <></>}
          {appVersion ? <span>build {appVersion}</span> : <></>}
        </div>
      ) : (
        <></>
      )}
      {errorStack ? (
        <details className="mt-2">
          <summary className="text-xs text-red-600 cursor-pointer select-none">
            Stack trace
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-red-100 p-2 text-xs text-red-800 whitespace-pre">
            {errorStack}
          </pre>
        </details>
      ) : (
        <></>
      )}
    </div>
  );
};

const MigrationStatus: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadMigrations: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/migrations",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setData(response.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadMigrations().catch(() => {
      // handled via setError
    });
  }, []);

  const renderMigrationBlock: (
    label: string,
    description: string,
    info: JSONObject,
  ) => ReactElement = (
    label: string,
    description: string,
    info: JSONObject,
  ): ReactElement => {
    const connected: boolean = Boolean(info["connected"]);
    const isUpToDate: boolean = Boolean(info["isUpToDate"]);
    const totalPending: number = Number(info["totalPending"] || 0);
    const pending: JSONArray = asArray(info["pendingMigrations"]);
    const latestDefined: JSONObject = asObject(info["latestDefinedMigration"]);
    const latestApplied: JSONObject = asObject(info["latestAppliedMigration"]);
    const lastExecuted: JSONObject = asObject(info["lastExecutedMigration"]);
    const recentFailures: JSONArray = asArray(info["recentFailures"]);
    const lastFailedAt: unknown = info["lastFailedAt"];

    // Latest failure per migration name so a pending row can show why it failed.
    const failureByName: Map<string, JSONObject> =
      buildFailureMap(recentFailures);

    // Does any migration still pending have a recorded failure? (i.e. is stuck)
    const hasBlockingFailure: boolean = pending.some(
      (name: unknown): boolean => {
        return failureByName.has(String(name));
      },
    );

    // The newest migration the database has actually run, however each system records it.
    const appliedName: string =
      String(latestApplied["name"] || "") ||
      String(lastExecuted["name"] || "") ||
      "—";

    let statusText: string = "Up to date";
    let statusColor: Color = Green;
    let shouldAnimate: boolean = true;

    if (!connected) {
      statusText = "Unreachable";
      statusColor = Red;
      shouldAnimate = false;
    } else if (!isUpToDate) {
      const pendingText: string =
        totalPending === 1 ? "1 pending" : `${totalPending} pending`;
      statusText = hasBlockingFailure ? `${pendingText} · failed` : pendingText;
      statusColor = hasBlockingFailure ? Red : Yellow;
      shouldAnimate = false;
    }

    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">{label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{description}</div>
          </div>
          <Statusbubble
            text={statusText}
            color={statusColor}
            shouldAnimate={shouldAnimate}
          />
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div>
            <div className="text-xs text-gray-500">Applied</div>
            <div className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">
              {countLabel(info["totalApplied"])}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Shipped in build</div>
            <div className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">
              {countLabel(info["totalDefined"])}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Pending</div>
            <div
              className={`text-base font-semibold mt-0.5 tabular-nums ${
                totalPending > 0 ? "text-yellow-600" : "text-gray-900"
              }`}
            >
              {countLabel(info["totalPending"])}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-1 text-xs text-gray-600">
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Latest in build</span>
            <span className="font-mono truncate">
              {String(latestDefined["name"] || "—")}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Latest applied</span>
            <span className="font-mono truncate">{appliedName}</span>
          </div>
          {lastFailedAt ? (
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Last failed attempt</span>
              <span className="font-mono truncate text-red-600">
                {formatDateTime(lastFailedAt)}
              </span>
            </div>
          ) : (
            <></>
          )}
        </div>

        {totalPending > 0 ? (
          <div className="mt-4">
            {/*
             * Explain WHY these are pending: a recorded failure means the runner
             * stopped at the first bad migration; no failure means they simply
             * have not been applied yet (e.g. the migrate job has not run).
             */}
            {hasBlockingFailure ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                A migration failed to apply. The runner stops at the first
                failure, so every migration after it stays pending until it is
                fixed and re-run. See the error below.
              </div>
            ) : (
              <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
                These migrations have not been applied yet and nothing has been
                recorded as failing. If you just deployed, the migration job may
                still be running or may not have run for this build.
              </div>
            )}

            <div className="text-xs font-medium text-gray-700 mb-1">
              Pending migrations (run in order)
            </div>
            <ul className="space-y-1">
              {pending
                .slice(0, MAX_PENDING_TO_SHOW)
                .map((name: unknown, index: number): ReactElement => {
                  const migrationName: string = String(name);
                  const failure: JSONObject | undefined =
                    failureByName.get(migrationName);

                  return (
                    <li key={index}>
                      {failure ? (
                        renderFailureDetail(failure)
                      ) : (
                        <span className="text-xs font-mono text-yellow-700 truncate block">
                          {migrationName}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
            {pending.length > MAX_PENDING_TO_SHOW ? (
              <div className="text-xs text-gray-500 mt-1">
                and {pending.length - MAX_PENDING_TO_SHOW} more…
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {/*
         * Full history of recorded failed attempts — including migrations that
         * later succeeded — so an operator can see what failed and when even
         * after the schema has caught up.
         */}
        {recentFailures.length > 0 ? (
          <details className="mt-4">
            <summary className="text-xs font-medium text-gray-700 cursor-pointer select-none">
              Recent failed attempts ({recentFailures.length})
            </summary>
            <div className="mt-2 space-y-2">
              {recentFailures.map(
                (failure: unknown, index: number): ReactElement => {
                  return (
                    <div key={index}>{renderFailureDetail(asObject(failure))}</div>
                  );
                },
              )}
            </div>
          </details>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderContent: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !data) {
      return <ComponentLoader />;
    }

    const postgres: JSONObject = asObject(data?.["postgres"]);
    const dataMigrations: JSONObject = asObject(data?.["dataMigrations"]);

    return (
      <div className="space-y-4">
        {renderMigrationBlock(
          "PostgreSQL schema migrations",
          "Structural schema migrations applied to the Postgres database.",
          postgres,
        )}
        {renderMigrationBlock(
          "ClickHouse & data migrations",
          "ClickHouse schema and data backfill migrations.",
          dataMigrations,
        )}
      </div>
    );
  };

  return (
    <Card
      title="Database migrations"
      description="Whether this instance has fully applied the migrations shipped in this build. A 'pending' count means the schema is behind the running code."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isRefreshing,
          onClick: () => {
            setIsRefreshing(true);
            loadMigrations().catch(() => {
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
        {renderContent()}
      </div>
    </Card>
  );
};

export default MigrationStatus;
