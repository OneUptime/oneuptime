import URL from "Common/Types/API/URL";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import { formatHealthDateTime as formatDateTime } from "./HealthTime";
import EmptyValue, {
  EMPTY_VALUE_MARK,
} from "Common/UI/Components/Detail/EmptyValue";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";

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
  return isNaN(parsed)
    ? EMPTY_VALUE_MARK
    : parsed.toLocaleString(getReaderNumberLocale());
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
const renderFailureDetail: (
  failure: JSONObject,
  translator: Translator,
) => ReactElement = (
  failure: JSONObject,
  translator: Translator,
): ReactElement => {
  const errorMessage: string =
    String(failure["errorMessage"] || "") ||
    (translator.translateText("Unknown error") as string);
  const errorStack: string = String(failure["errorStack"] || "");
  const hostName: string = String(failure["hostName"] || "");
  const appVersion: string = String(failure["appVersion"] || "");

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="font-mono font-medium text-red-800 break-all">
          {String(failure["migrationName"] || "") || (
            <EmptyValue isSmall={true} />
          )}
        </span>
        <span className="text-red-600">
          {translator.translateTemplate(
            "Failed {{time}}",
            { time: formatDateTime(failure["attemptedAt"]) },
            { setsValuesApart: true },
          )}
        </span>
      </div>
      <div className="mt-1.5 text-xs font-mono text-red-700 whitespace-pre-wrap break-words">
        {errorMessage}
      </div>
      {hostName || appVersion ? (
        <div className="mt-1 text-xs text-red-500">
          {hostName ? (
            <span>
              {translator.translateTemplate(
                "on {{host}}",
                { host: hostName },
                { setsValuesApart: true },
              )}
            </span>
          ) : (
            <></>
          )}
          {hostName && appVersion ? (
            <span>
              <InlineSeparator />
            </span>
          ) : (
            <></>
          )}
          {appVersion ? (
            <span>
              {translator.translateTemplate(
                "build {{version}}",
                { version: appVersion },
                { setsValuesApart: true },
              )}
            </span>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      {errorStack ? (
        <details className="mt-2">
          <summary className="text-xs text-red-600 cursor-pointer select-none">
            {translator.translateText("Stack trace")}
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
  const translator: Translator = useTranslator();
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
      EMPTY_VALUE_MARK;

    // The status in the reader's language, so the bubble draws it as given.
    let statusText: string = translator.translateText("Up to date") as string;
    let statusColor: Color = Green;
    let shouldAnimate: boolean = true;

    if (!connected) {
      statusText = translator.translateText("Unreachable") as string;
      statusColor = Red;
      shouldAnimate = false;
    } else if (!isUpToDate) {
      statusText = hasBlockingFailure
        ? translator.translatePlural(
            {
              one: "{{count}} pending · failed",
              other: "{{count}} pending · failed",
            },
            totalPending,
          )
        : translator.translatePlural(
            { one: "{{count}} pending", other: "{{count}} pending" },
            totalPending,
          );
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
            isUserContent={true}
            color={statusColor}
            shouldAnimate={shouldAnimate}
          />
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div>
            <div className="text-xs text-gray-500">
              {translator.translateText("Applied")}
            </div>
            <div className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">
              {getValueOrQuietDash(countLabel(info["totalApplied"]))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">
              {translator.translateText("Shipped in build")}
            </div>
            <div className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">
              {getValueOrQuietDash(countLabel(info["totalDefined"]))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">
              {translator.translateText("Pending")}
            </div>
            <div
              className={`text-base font-semibold mt-0.5 tabular-nums ${
                totalPending > 0 ? "text-yellow-600" : "text-gray-900"
              }`}
            >
              {getValueOrQuietDash(countLabel(info["totalPending"]))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-1 text-xs text-gray-600">
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">
              {translator.translateText("Latest in build")}
            </span>
            <span className="font-mono truncate">
              {String(latestDefined["name"] || "") || (
                <TableEmptyValue isSmall={true} />
              )}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">
              {translator.translateText("Latest applied")}
            </span>
            <span className="font-mono truncate">
              {getValueOrQuietDash(appliedName, { isSmall: true })}
            </span>
          </div>
          {lastFailedAt ? (
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">
                {translator.translateText("Last failed attempt")}
              </span>
              <span className="font-mono truncate text-red-600">
                {getValueOrQuietDash(formatDateTime(lastFailedAt), {
                  isSmall: true,
                })}
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
                {translator.translateText(
                  "A migration failed to apply. The runner stops at the first failure, so every migration after it stays pending until it is fixed and re-run. See the error below.",
                )}
              </div>
            ) : (
              <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
                {translator.translateText(
                  "These migrations have not been applied yet and nothing has been recorded as failing. If you just deployed, the migration job may still be running or may not have run for this build.",
                )}
              </div>
            )}

            <div className="text-xs font-medium text-gray-700 mb-1">
              {translator.translateText("Pending migrations (run in order)")}
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
                        renderFailureDetail(failure, translator)
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
                {translator.translatePlural(
                  { one: "and {{count}} more…", other: "and {{count}} more…" },
                  pending.length - MAX_PENDING_TO_SHOW,
                )}
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
              {translator.translateTemplate(
                "Recent failed attempts ({{count}})",
                { count: translator.formatNumber(recentFailures.length) },
              )}
            </summary>
            <div className="mt-2 space-y-2">
              {recentFailures.map(
                (failure: unknown, index: number): ReactElement => {
                  return (
                    <div key={index}>
                      {renderFailureDetail(asObject(failure), translator)}
                    </div>
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
      return <DetailListSkeleton fields={4} />;
    }

    const postgres: JSONObject = asObject(data?.["postgres"]);
    const dataMigrations: JSONObject = asObject(data?.["dataMigrations"]);

    return (
      <div className="space-y-4">
        {renderMigrationBlock(
          translator.translateText("PostgreSQL schema migrations") as string,
          translator.translateText(
            "Structural schema migrations applied to the Postgres database.",
          ) as string,
          postgres,
        )}
        {renderMigrationBlock(
          translator.translateText("ClickHouse & data migrations") as string,
          translator.translateText(
            "ClickHouse schema and data backfill migrations.",
          ) as string,
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
