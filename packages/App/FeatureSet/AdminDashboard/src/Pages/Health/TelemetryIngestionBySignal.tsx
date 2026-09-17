import {
  averagePerHour,
  computeSharePercent,
  formatBytes,
  formatCompactCount,
  formatCount,
  parseSignalIngestion,
  sumOrNull,
  TelemetrySignalIngestionView,
  TelemetrySignalRow,
} from "./TelemetryIngestionUtils";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
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

// Same tint per signal as the by-project card, so the two read as one page.
const SIGNAL_STYLES: Record<string, string> = {
  Logs: "bg-indigo-500",
  Metrics: "bg-emerald-500",
  Traces: "bg-amber-500",
};

const SignalTile: FunctionComponent<{
  telemetryType: string;
  lastDay: number | null;
  lastHour: number | null;
  sharePercent: number;
}> = (props: {
  telemetryType: string;
  lastDay: number | null;
  lastHour: number | null;
  sharePercent: number;
}): ReactElement => {
  const barClass: string = SIGNAL_STYLES[props.telemetryType] || "bg-gray-400";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${barClass}`}
          aria-hidden="true"
        />
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {props.telemetryType}
        </div>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
        {formatCompactCount(props.lastDay)}
      </div>
      <div className="text-xs text-gray-500">
        rows / 24h · {formatCompactCount(props.lastHour)} in the last hour
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-1.5 rounded-full ${barClass}`}
          style={{ width: `${props.sharePercent}%` }}
        />
      </div>
    </div>
  );
};

/*
 * Ingestion throughput per signal: how many log, metric and trace rows landed in
 * ClickHouse over the last minute, hour and day, plus each signal's actual
 * (uncompressed) footprint. This is the "is the pipeline flowing, and how fast"
 * view; the by-project card beside it answers "who is filling it".
 */
const TelemetryIngestionBySignal: FunctionComponent = (): ReactElement => {
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

  const renderRow: (data: {
    label: string;
    counts: {
      lastMinute: number | null;
      lastHour: number | null;
      lastDay: number | null;
      uncompressedBytes: number | null;
    };
    isTotal: boolean;
  }) => ReactElement = (data: {
    label: string;
    counts: {
      lastMinute: number | null;
      lastHour: number | null;
      lastDay: number | null;
      uncompressedBytes: number | null;
    };
    isTotal: boolean;
  }): ReactElement => {
    const rowClass: string = data.isTotal
      ? "border-t border-gray-200 font-semibold text-gray-900"
      : "text-gray-700";

    return (
      <tr key={data.label} className={rowClass}>
        <td className="py-2 pr-4 text-sm">
          <span className="inline-flex items-center gap-2">
            {data.isTotal ? (
              <></>
            ) : (
              <span
                className={`h-2 w-2 rounded-full ${
                  SIGNAL_STYLES[data.label] || "bg-gray-400"
                }`}
                aria-hidden="true"
              />
            )}
            {data.label}
          </span>
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums">
          {formatBytes(data.counts.uncompressedBytes)}
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums">
          {formatCount(data.counts.lastMinute)}
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums">
          {formatCount(data.counts.lastHour)}
        </td>
        <td className="px-4 py-2 text-right text-sm tabular-nums">
          {formatCount(data.counts.lastDay)}
        </td>
        <td className="py-2 pl-4 text-right text-sm tabular-nums">
          {formatCount(averagePerHour(data.counts.lastDay))}
        </td>
      </tr>
    );
  };

  const renderContent: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !data) {
      return <ComponentLoader />;
    }

    const view: TelemetrySignalIngestionView = parseSignalIngestion(data);

    if (!view.connected) {
      return (
        <div className="text-sm text-gray-500">
          ClickHouse is not reachable from this instance.
        </div>
      );
    }

    if (view.signals.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          No telemetry tables reported on this instance.
        </div>
      );
    }

    const totalLastMinute: number | null = sumOrNull(
      view.signals.map((signal: TelemetrySignalRow): number | null => {
        return signal.lastMinute;
      }),
    );
    const totalLastHour: number | null = sumOrNull(
      view.signals.map((signal: TelemetrySignalRow): number | null => {
        return signal.lastHour;
      }),
    );
    const totalLastDay: number | null = sumOrNull(
      view.signals.map((signal: TelemetrySignalRow): number | null => {
        return signal.lastDay;
      }),
    );
    const totalUncompressedBytes: number | null = sumOrNull(
      view.signals.map((signal: TelemetrySignalRow): number | null => {
        return signal.uncompressedBytes;
      }),
    );

    // A pipeline that ingested nothing in the last hour is worth flagging.
    const isIngesting: boolean = (totalLastHour ?? 0) > 0;

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {formatCount(totalLastHour)} telemetry rows ingested in the last
            hour
            {totalUncompressedBytes === null
              ? ""
              : ` · ${formatBytes(totalUncompressedBytes)} total (actual size)`}
          </div>
          <Statusbubble
            text={isIngesting ? "Ingesting" : "Idle"}
            color={isIngesting ? Green : Gray500}
            shouldAnimate={isIngesting}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {view.signals.map((signal: TelemetrySignalRow): ReactElement => {
            return (
              <SignalTile
                key={signal.telemetryType}
                telemetryType={signal.telemetryType}
                lastDay={signal.lastDay}
                lastHour={signal.lastHour}
                sharePercent={computeSharePercent(signal.lastDay, totalLastDay)}
              />
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 text-left font-medium">Signal</th>
                <th className="px-4 py-2 text-right font-medium">
                  Actual size
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  Last minute
                </th>
                <th className="px-4 py-2 text-right font-medium">Last hour</th>
                <th className="px-4 py-2 text-right font-medium">
                  Last 24 hours
                </th>
                <th className="py-2 pl-4 text-right font-medium">Avg / hour</th>
              </tr>
            </thead>
            <tbody>
              {view.signals.map((signal: TelemetrySignalRow): ReactElement => {
                return renderRow({
                  label: signal.telemetryType,
                  counts: signal,
                  isTotal: false,
                });
              })}
              {view.signals.length > 1
                ? renderRow({
                    label: "Total",
                    counts: {
                      lastMinute: totalLastMinute,
                      lastHour: totalLastHour,
                      lastDay: totalLastDay,
                      uncompressedBytes: totalUncompressedBytes,
                    },
                    isTotal: true,
                  })
                : null}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-500">
          Counts use each signal&apos;s telemetry timestamp (event time), which
          tracks live ingestion. &quot;Avg / hour&quot; is the last 24 hours
          divided by 24; &quot;Last hour&quot; is the current hourly rate. The
          bar under each signal is its share of the last 24 hours&apos; rows.
          &quot;Actual size&quot; is the uncompressed data volume, not the
          compressed on-disk size.
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Telemetry ingestion rate"
      description="How many log, metric and trace rows landed in ClickHouse over the last minute, hour and day — the live telemetry ingestion throughput — plus each signal's actual (uncompressed) data size."
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

export default TelemetryIngestionBySignal;
