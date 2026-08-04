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
  | "memoryLimit"
  | "evictionPolicy"
  | "connections"
  | "blockedClients"
  | "evictedKeys"
  | "rejectedConnections"
  | "persistence";

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
  evictionPolicy: {
    title: "Eviction policy",
    body: "What Redis does at the memory limit. Any allkeys-* or volatile-* policy discards keys to make room, silently losing cached data and queued job state. 'noeviction' instead rejects writes outright, so background jobs start failing.",
  },
  connections: {
    title: "Client connections",
    body: "Clients connected right now against the maxclients limit. Redis refuses new connections once maxclients is reached, which stalls every OneUptime process that needs the cache or a job queue.",
  },
  blockedClients: {
    title: "Blocked clients",
    body: "Clients parked in a blocking command such as BLPOP — normal for job-queue workers waiting on work. A number far above your worker count suggests commands that are not completing.",
  },
  evictedKeys: {
    title: "Keys evicted",
    body: "Keys Redis has discarded since it last restarted because it hit its memory limit. Any non-zero value means cached data or queued job state was lost. This counter only resets when Redis restarts.",
  },
  rejectedConnections: {
    title: "Rejected connections",
    body: "Connection attempts Redis turned away since it last restarted, because maxclients was already reached. Any non-zero value means some part of OneUptime could not reach Redis.",
  },
  persistence: {
    title: "Persistence",
    body: "Whether Redis' last write to disk succeeded. When this is failing, Redis still serves from memory but everything since the last good write is lost on restart — usually a full disk or a permissions problem on the data directory.",
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
  const connectedClients: number | null = toNumberOrNull(
    data?.["connectedClients"],
  );
  const maxClients: number | null = toNumberOrNull(data?.["maxClients"]);
  const connectionPercent: number | null =
    maxClients !== null && maxClients > 0 && connectedClients !== null
      ? (connectedClients / maxClients) * 100
      : null;
  const evictedKeys: number | null = toNumberOrNull(data?.["evictedKeys"]);
  const rejectedConnections: number | null = toNumberOrNull(
    data?.["rejectedConnections"],
  );
  const isAofEnabled: boolean = Boolean(data?.["aofEnabled"]);
  const rdbStatus: string = String(data?.["rdbLastBgsaveStatus"] || "unknown");
  const aofWriteStatus: string = String(
    data?.["aofLastWriteStatus"] || "unknown",
  );

  /*
   * "unknown" means the field was missing from INFO, not that a write failed, so
   * it must not read as a failure on the card.
   */
  const isStatusFailing: (status: string) => boolean = (
    status: string,
  ): boolean => {
    return status !== "ok" && status !== "unknown";
  };
  const isPersistenceFailing: boolean =
    isStatusFailing(rdbStatus) ||
    (isAofEnabled && isStatusFailing(aofWriteStatus));
  const persistenceLabel: string = isPersistenceFailing
    ? "Failing"
    : isAofEnabled
      ? `RDB ${rdbStatus} · AOF ${aofWriteStatus}`
      : `RDB ${rdbStatus}`;

  const renderStat: (
    label: string,
    value: string,
    info: MetricInfo,
    isBad?: boolean,
  ) => ReactElement = (
    label: string,
    value: string,
    info: MetricInfo,
    isBad?: boolean,
  ): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="text-xs text-gray-500 flex items-center">
          {label}
          <MetricInfoTip info={info} />
        </div>
        <div
          className={`text-base font-semibold mt-1 ${
            isBad ? "text-red-600" : "text-gray-900"
          }`}
        >
          {value}
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Redis capacity"
      description="Connectivity, memory and connection utilization, key eviction and persistence status for the Redis backing this instance."
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

                {connectionPercent !== null ? (
                  <MetricInfoWrap info={METRIC_INFO.connections}>
                    <div className="cursor-help">
                      <ResourceUsageBar
                        label="Redis connections"
                        value={connectionPercent}
                        valueLabel={`${connectionPercent.toFixed(0)}%`}
                        secondaryLabel={`${connectedClients} / ${maxClients} clients`}
                      />
                    </div>
                  </MetricInfoWrap>
                ) : (
                  <></>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {renderStat(
                    "Memory used",
                    bytesToReadable(usedMemory),
                    METRIC_INFO.memoryUsed,
                  )}
                  {renderStat(
                    "Memory limit",
                    maxMemory !== null && maxMemory > 0
                      ? bytesToReadable(maxMemory)
                      : "Not configured",
                    METRIC_INFO.memoryLimit,
                  )}
                  {renderStat(
                    "Eviction policy",
                    String(data?.["maxMemoryPolicy"] || "—"),
                    METRIC_INFO.evictionPolicy,
                  )}
                  {renderStat(
                    "Blocked clients",
                    data?.["blockedClients"] === null ||
                      data?.["blockedClients"] === undefined
                      ? "—"
                      : String(data["blockedClients"]),
                    METRIC_INFO.blockedClients,
                  )}
                  {renderStat(
                    "Keys evicted",
                    evictedKeys === null ? "—" : evictedKeys.toLocaleString(),
                    METRIC_INFO.evictedKeys,
                    evictedKeys !== null && evictedKeys > 0,
                  )}
                  {renderStat(
                    "Rejected connections",
                    rejectedConnections === null
                      ? "—"
                      : rejectedConnections.toLocaleString(),
                    METRIC_INFO.rejectedConnections,
                    rejectedConnections !== null && rejectedConnections > 0,
                  )}
                  {renderStat(
                    "Persistence",
                    persistenceLabel,
                    METRIC_INFO.persistence,
                    isPersistenceFailing,
                  )}
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
