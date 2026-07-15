import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
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

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return (value || {}) as JSONObject;
};

const asArray: (value: unknown) => JSONArray = (value: unknown): JSONArray => {
  return (value || []) as JSONArray;
};

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

const bytesToReadable: (value: unknown) => string = (
  value: unknown,
): string => {
  const bytes: number | null = toNumberOrNull(value);

  if (bytes === null) {
    return "—";
  }
  if (bytes === 0) {
    return "0 B";
  }

  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent: number = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const scaled: number = bytes / Math.pow(1024, exponent);
  const decimals: number = scaled >= 10 || exponent === 0 ? 0 : 1;

  return `${scaled.toFixed(decimals)} ${units[exponent]}`;
};

const formatPercent: (value: unknown) => string = (value: unknown): string => {
  const percent: number | null = toNumberOrNull(value);
  return percent === null ? "—" : `${percent.toFixed(1)}%`;
};

const formatDateTime: (value: unknown) => string = (value: unknown): string => {
  const raw: string = String(value || "");
  if (!raw) {
    return "—";
  }

  const date: Date = new Date(raw);
  return isNaN(date.getTime()) ? raw : date.toLocaleString();
};

const humanize: (value: unknown) => string = (value: unknown): string => {
  const raw: string = String(value || "OneUptime Health event");
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/click\s+house/gi, "ClickHouse")
    .replace(/^./, (character: string): string => {
      return character.toUpperCase();
    });
};

const getStatusColor: (status: string) => Color = (status: string): Color => {
  const normalized: string = status.toLowerCase();

  if (
    normalized.includes("success") ||
    normalized.includes("complete") ||
    normalized.includes("succeed") ||
    normalized.includes("resolved")
  ) {
    return Green;
  }
  if (
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("unreachable") ||
    normalized.includes("notificationactive")
  ) {
    return Red;
  }
  if (
    normalized.includes("start") ||
    normalized.includes("running") ||
    normalized.includes("progress") ||
    normalized.includes("waiting") ||
    normalized.includes("partial")
  ) {
    return Yellow;
  }

  return Gray500;
};

const hasMetadata: (value: unknown) => boolean = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return value !== null && value !== undefined && String(value).length > 0;
};

const InstanceHealthLogs: FunctionComponent = (): ReactElement => {
  const [logs, setLogs] = useState<JSONArray>([]);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadLogs: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/instance-health-logs",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setLogs(asArray(response.data["logs"]));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadLogs().catch(() => {
      // handled via setError
    });
  }, []);

  const renderMetric: (label: string, value: string) => ReactElement = (
    label: string,
    value: string,
  ): ReactElement => {
    return (
      <div className="rounded-md border border-gray-200 px-3 py-2">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-sm font-medium text-gray-900 mt-0.5 tabular-nums">
          {value}
        </div>
      </div>
    );
  };

  return (
    <Card
      title="OneUptime Health log"
      description="Capacity notifications and automatic ClickHouse pruning work performed by this instance."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isRefreshing,
          onClick: () => {
            setIsRefreshing(true);
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

        {isInitialLoading ? (
          <ComponentLoader />
        ) : logs.length === 0 ? (
          <div className="text-sm text-gray-500">
            No OneUptime Health work has been recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((value: unknown, index: number): ReactElement => {
              const log: JSONObject = asObject(value);
              const status: string = String(log["status"] || "Recorded");
              const before: number | null = toNumberOrNull(
                log["capacityBeforePercent"],
              );
              const after: number | null = toNumberOrNull(
                log["capacityAfterPercent"],
              );
              const threshold: number | null = toNumberOrNull(
                log["thresholdPercent"],
              );
              const target: number | null = toNumberOrNull(
                log["targetPercent"],
              );
              const freed: number | null = toNumberOrNull(
                log["estimatedFreedBytes"],
              );
              const metadata: unknown = log["metadata"];

              return (
                <div
                  key={String(
                    log["_id"] || log["id"] || `instance-health-log-${index}`,
                  )}
                  className="rounded-lg border border-gray-200 p-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900">
                        {humanize(log["eventType"])}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Recorded {formatDateTime(log["createdAt"])}
                        {log["completedAt"]
                          ? ` · Completed ${formatDateTime(log["completedAt"])}`
                          : ""}
                        {log["nextCheckAt"]
                          ? ` · Next check ${formatDateTime(log["nextCheckAt"])}`
                          : ""}
                      </div>
                    </div>
                    <Statusbubble
                      text={humanize(status)}
                      color={getStatusColor(status)}
                      shouldAnimate={false}
                    />
                  </div>

                  {log["message"] ? (
                    <div className="text-sm text-gray-700 mt-3 whitespace-pre-wrap break-words">
                      {String(log["message"])}
                    </div>
                  ) : (
                    <></>
                  )}

                  {before !== null ||
                  after !== null ||
                  threshold !== null ||
                  target !== null ||
                  freed !== null ? (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                      {before !== null
                        ? renderMetric("Capacity before", formatPercent(before))
                        : null}
                      {after !== null
                        ? renderMetric("Capacity after", formatPercent(after))
                        : null}
                      {threshold !== null
                        ? renderMetric("Trigger", formatPercent(threshold))
                        : null}
                      {target !== null
                        ? renderMetric("Target", formatPercent(target))
                        : null}
                      {freed !== null
                        ? renderMetric(
                            "Estimated space freed",
                            bytesToReadable(freed),
                          )
                        : null}
                    </div>
                  ) : (
                    <></>
                  )}

                  {hasMetadata(metadata) ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-gray-600">
                        Work details
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700 whitespace-pre-wrap break-all">
                        {JSON.stringify(metadata, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <></>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
};

export default InstanceHealthLogs;
