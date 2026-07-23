import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ResourceUsageBar from "Common/UI/Components/ResourceUsageBar/ResourceUsageBar";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import {
  MetricInfo,
  MetricInfoTip,
  MetricInfoWrap,
} from "../../Components/HealthMetricTooltip/HealthMetricTooltip";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

const bytesToReadable: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || isNaN(value)) {
    return "—";
  }
  if (value === 0) {
    return "0 B";
  }

  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent: number = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const scaled: number = value / Math.pow(1024, exponent);
  const decimals: number = scaled >= 10 || exponent === 0 ? 0 : 1;

  return `${scaled.toFixed(decimals)} ${units[exponent]}`;
};

/*
 * Plain-language explanations for the Redis signals on this card. Kept in one
 * place so the copy is easy to review; each entry drives an info tooltip.
 */
type MetricInfoKey =
  | "overallStatus"
  | "memoryUtilization"
  | "memoryUsed"
  | "memoryLimit";

const METRIC_INFO: Record<MetricInfoKey, MetricInfo> = {
  overallStatus: {
    title: "Overall status",
    body: "Redis backs OneUptime's caching and queues. This card tracks reachability: Connected means this instance can reach Redis; Unreachable means it can't, which stalls cache reads and queued jobs. There is no partial state here — it's a binary reachability check, not a degraded/healthy scale.",
  },
  memoryUtilization: {
    title: "Redis memory utilization",
    body: "Used memory as a share of Redis' configured maxmemory. As this approaches 100%, Redis begins evicting keys per its eviction policy (or rejecting writes if no policy is set). If maxmemory is unset, no percentage can be shown.",
  },
  memoryUsed: {
    title: "Memory used",
    body: "Total memory Redis currently holds — cached data plus its own bookkeeping overhead (used_memory from INFO).",
  },
  memoryLimit: {
    title: "Memory limit",
    body: "The maxmemory ceiling Redis will use before it starts evicting keys or rejecting writes. 'Not configured' means Redis can grow until the host itself runs out of memory.",
  },
};

const RedisHealth: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadRedisHealth: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/redis",
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
    loadRedisHealth().catch(() => {
      // handled via setError
    });
  }, []);

  const connected: boolean = Boolean(data?.["connected"]);
  const usedMemory: number | null = toNumberOrNull(data?.["usedMemoryInBytes"]);
  const maxMemory: number | null = toNumberOrNull(data?.["maxMemoryInBytes"]);
  const memoryPercent: number | null =
    maxMemory !== null && maxMemory > 0 && usedMemory !== null
      ? (usedMemory / maxMemory) * 100
      : null;

  return (
    <Card
      title="Redis capacity"
      description="Connectivity and memory utilization for the Redis backing this instance."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isRefreshing,
          onClick: () => {
            setIsRefreshing(true);
            loadRedisHealth().catch(() => {
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

        {isInitialLoading && !data ? (
          <ComponentLoader />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Redis is {connected ? "reachable" : "not reachable"} from this
                instance.
              </div>
              <MetricInfoWrap info={METRIC_INFO.overallStatus}>
                <span className="inline-flex cursor-help">
                  <Statusbubble
                    text={connected ? "Connected" : "Unreachable"}
                    color={connected ? Green : Red}
                    shouldAnimate={connected}
                  />
                </span>
              </MetricInfoWrap>
            </div>

            {connected ? (
              <>
                {memoryPercent !== null ? (
                  <MetricInfoWrap info={METRIC_INFO.memoryUtilization}>
                    <div className="cursor-help">
                      <ResourceUsageBar
                        label="Redis memory"
                        value={memoryPercent}
                        valueLabel={`${memoryPercent.toFixed(0)}%`}
                        secondaryLabel={`${bytesToReadable(
                          usedMemory,
                        )} / ${bytesToReadable(maxMemory)}`}
                      />
                    </div>
                  </MetricInfoWrap>
                ) : (
                  <Alert
                    type={AlertType.INFO}
                    title="Redis maxmemory is not configured, so a memory utilization percentage is unavailable."
                  />
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500 flex items-center">
                      Memory used
                      <MetricInfoTip info={METRIC_INFO.memoryUsed} />
                    </div>
                    <div className="text-base font-semibold text-gray-900 mt-1">
                      {bytesToReadable(usedMemory)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500 flex items-center">
                      Memory limit
                      <MetricInfoTip info={METRIC_INFO.memoryLimit} />
                    </div>
                    <div className="text-base font-semibold text-gray-900 mt-1">
                      {maxMemory !== null && maxMemory > 0
                        ? bytesToReadable(maxMemory)
                        : "Not configured"}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <></>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default RedisHealth;
