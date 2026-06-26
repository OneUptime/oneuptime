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
      statusText = totalPending === 1 ? "1 pending" : `${totalPending} pending`;
      statusColor = Yellow;
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
        </div>

        {totalPending > 0 ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-gray-700 mb-1">
              Pending migrations (run in order)
            </div>
            <ul className="space-y-0.5">
              {pending
                .slice(0, MAX_PENDING_TO_SHOW)
                .map((name: unknown, index: number): ReactElement => {
                  return (
                    <li
                      key={index}
                      className="text-xs font-mono text-yellow-700 truncate"
                    >
                      {String(name)}
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
