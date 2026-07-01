import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Gray500 } from "Common/Types/BrandColors";
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

const asArray: (value: unknown) => JSONArray = (value: unknown): JSONArray => {
  return (value || []) as JSONArray;
};

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return (value || {}) as JSONObject;
};

// A missing count (probe failed / table absent) stays null and renders as "—".
const toNumOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

const formatCount: (value: number | null) => string = (
  value: number | null,
): string => {
  return value === null ? "—" : value.toLocaleString();
};

/*
 * Sum a list of possibly-null counts, treating null as "unknown" → the total is
 * only meaningful if at least one row reported a value, so null-only sums stay null.
 */
const sumOrNull: (values: Array<number | null>) => number | null = (
  values: Array<number | null>,
): number | null => {
  const known: Array<number> = values.filter(
    (value: number | null): value is number => {
      return value !== null;
    },
  );
  if (known.length === 0) {
    return null;
  }
  return known.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);
};

const ClickhouseTelemetryIngestion: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadIngestionRate: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/clickhouse-telemetry-ingestion",
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
    loadIngestionRate().catch(() => {
      // handled via setError
    });
  }, []);

  const renderRow: (
    label: string,
    lastMinute: number | null,
    lastHour: number | null,
    lastDay: number | null,
    isTotal: boolean,
  ) => ReactElement = (
    label: string,
    lastMinute: number | null,
    lastHour: number | null,
    lastDay: number | null,
    isTotal: boolean,
  ): ReactElement => {
    // Average rows/hour over the last day — the smoothed hourly ingestion rate.
    const avgPerHour: number | null =
      lastDay === null ? null : Math.round(lastDay / 24);

    const rowClass: string = isTotal
      ? "border-t border-gray-200 font-semibold text-gray-900"
      : "text-gray-700";

    return (
      <tr key={label} className={rowClass}>
        <td className="py-2 pr-4 text-sm">{label}</td>
        <td className="py-2 px-4 text-sm text-right tabular-nums">
          {formatCount(lastMinute)}
        </td>
        <td className="py-2 px-4 text-sm text-right tabular-nums">
          {formatCount(lastHour)}
        </td>
        <td className="py-2 px-4 text-sm text-right tabular-nums">
          {formatCount(lastDay)}
        </td>
        <td className="py-2 pl-4 text-sm text-right tabular-nums">
          {formatCount(avgPerHour)}
        </td>
      </tr>
    );
  };

  const renderContent: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !data) {
      return <ComponentLoader />;
    }

    const connected: boolean = Boolean(data?.["connected"]);
    if (!connected) {
      return (
        <div className="text-sm text-gray-500">
          ClickHouse is not reachable from this instance.
        </div>
      );
    }

    const tables: JSONArray = asArray(data?.["tables"]);
    if (tables.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          No telemetry tables reported on this instance.
        </div>
      );
    }

    const rows: Array<{
      label: string;
      lastMinute: number | null;
      lastHour: number | null;
      lastDay: number | null;
    }> = tables.map(
      (
        value: unknown,
      ): {
        label: string;
        lastMinute: number | null;
        lastHour: number | null;
        lastDay: number | null;
      } => {
        const row: JSONObject = asObject(value);
        return {
          label: String(row["telemetryType"] ?? row["table"] ?? "—"),
          lastMinute: toNumOrNull(row["lastMinute"]),
          lastHour: toNumOrNull(row["lastHour"]),
          lastDay: toNumOrNull(row["lastDay"]),
        };
      },
    );

    const totalLastMinute: number | null = sumOrNull(
      rows.map((row: { lastMinute: number | null }): number | null => {
        return row.lastMinute;
      }),
    );
    const totalLastHour: number | null = sumOrNull(
      rows.map((row: { lastHour: number | null }): number | null => {
        return row.lastHour;
      }),
    );
    const totalLastDay: number | null = sumOrNull(
      rows.map((row: { lastDay: number | null }): number | null => {
        return row.lastDay;
      }),
    );

    // A pipeline that ingested nothing in the last hour is worth flagging.
    const isIngesting: boolean = (totalLastHour ?? 0) > 0;
    const statusColor: Color = isIngesting ? Green : Gray500;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {formatCount(totalLastHour)} telemetry rows ingested in the last
            hour
          </div>
          <Statusbubble
            text={isIngesting ? "Ingesting" : "Idle"}
            color={statusColor}
            shouldAnimate={isIngesting}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 text-left font-medium">Signal</th>
                <th className="py-2 px-4 text-right font-medium">
                  Last minute
                </th>
                <th className="py-2 px-4 text-right font-medium">Last hour</th>
                <th className="py-2 px-4 text-right font-medium">
                  Last 24 hours
                </th>
                <th className="py-2 pl-4 text-right font-medium">Avg / hour</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(
                (row: {
                  label: string;
                  lastMinute: number | null;
                  lastHour: number | null;
                  lastDay: number | null;
                }): ReactElement => {
                  return renderRow(
                    row.label,
                    row.lastMinute,
                    row.lastHour,
                    row.lastDay,
                    false,
                  );
                },
              )}
              {rows.length > 1
                ? renderRow(
                    "Total",
                    totalLastMinute,
                    totalLastHour,
                    totalLastDay,
                    true,
                  )
                : null}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-500">
          Counts use each signal&apos;s telemetry timestamp (event time), which
          tracks live ingestion. &quot;Avg / hour&quot; is the last 24 hours
          divided by 24; &quot;Last hour&quot; is the current hourly rate.
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Telemetry ingestion rate"
      description="How many log, metric and trace rows landed in ClickHouse over the last minute, hour and day — the live telemetry ingestion throughput."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isRefreshing,
          onClick: () => {
            setIsRefreshing(true);
            loadIngestionRate().catch(() => {
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

export default ClickhouseTelemetryIngestion;
