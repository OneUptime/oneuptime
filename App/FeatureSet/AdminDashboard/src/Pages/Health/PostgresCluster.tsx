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
import ResourceUsageBar from "Common/UI/Components/ResourceUsageBar/ResourceUsageBar";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// How many standby / slot / table rows to list before truncating.
const MAX_ROWS_TO_SHOW: number = 10;

/*
 * ~2.1B (2^31) is the transaction-ID wraparound limit. Postgres aggressively
 * autovacuums as the oldest XID age approaches it and ultimately refuses new
 * write transactions, so headroom toward this number is the wraparound signal.
 */
const XID_WRAPAROUND_LIMIT: number = 2000000000;

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return (value || {}) as JSONObject;
};

const asArray: (value: unknown) => JSONArray = (value: unknown): JSONArray => {
  return (value || []) as JSONArray;
};

const toNum: (value: unknown) => number = (value: unknown): number => {
  const parsed: number = Number(value);
  return isNaN(parsed) ? 0 : parsed;
};

const isNum: (value: unknown) => boolean = (value: unknown): boolean => {
  return value !== null && value !== undefined && !isNaN(Number(value));
};

const formatNumber: (value: unknown) => string = (value: unknown): string => {
  const parsed: number = Number(value);
  return isNaN(parsed) ? "—" : parsed.toLocaleString();
};

// Format a byte count into a human-readable string. Accepts unknown because values arrive as JSON.
const bytesToReadable: (value: unknown) => string = (
  value: unknown,
): string => {
  const bytes: number = typeof value === "number" ? value : Number(value);

  if (value === null || value === undefined || isNaN(bytes)) {
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

// Format a duration in seconds into a compact human string (lag, transaction age, uptime).
const formatDuration: (value: unknown) => string = (value: unknown): string => {
  const seconds: number = Number(value);

  if (value === null || value === undefined || isNaN(seconds)) {
    return "—";
  }

  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }

  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h`;
  }

  return `${Math.round(seconds / 86400)}d`;
};

// Relative "x ago" from an ISO timestamp, for last-autovacuum hints.
const timeAgo: (value: unknown) => string = (value: unknown): string => {
  if (!value) {
    return "never";
  }

  const time: number = new Date(String(value)).getTime();

  if (isNaN(time)) {
    return "—";
  }

  return `${formatDuration((Date.now() - time) / 1000)} ago`;
};

const PostgresCluster: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadClusterHealth: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/postgres-cluster",
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
    loadClusterHealth().catch(() => {
      // handled via setError
    });
  }, []);

  // A small labelled stat cell.
  const renderStat: (label: string, value: string) => ReactElement = (
    label: string,
    value: string,
  ): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-base font-semibold text-gray-900 mt-1">
          {value}
        </div>
      </div>
    );
  };

  const renderReplication: (
    replication: JSONArray,
    isInRecovery: boolean,
  ) => ReactElement = (
    replication: JSONArray,
    isInRecovery: boolean,
  ): ReactElement => {
    if (replication.length === 0) {
      return (
        <div className="text-xs text-gray-500">
          {isInRecovery
            ? "This node is a standby; replication is observed from the primary."
            : "No standbys connected (single-node deployment, or streaming replication is not configured)."}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {replication
          .slice(0, MAX_ROWS_TO_SHOW)
          .map((value: unknown, index: number): ReactElement => {
            const standby: JSONObject = asObject(value);
            const state: string = String(standby["state"] ?? "unknown");
            const streaming: boolean = state === "streaming";
            const lag: number = toNum(standby["replayLagSeconds"]);

            let statusText: string = "Streaming";
            let statusColor: Color = Green;
            let shouldAnimate: boolean = true;

            if (!streaming) {
              statusText = state;
              statusColor = Yellow;
              shouldAnimate = false;
            } else if (lag > 60) {
              statusText = "Lagging";
              statusColor = Red;
              shouldAnimate = false;
            } else if (lag > 10) {
              statusText = "Catching up";
              statusColor = Yellow;
              shouldAnimate = false;
            }

            return (
              <div
                key={index}
                className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 font-mono truncate">
                    {String(standby["applicationName"] ?? "—")}
                    {standby["clientAddr"]
                      ? ` · ${String(standby["clientAddr"])}`
                      : ""}
                  </div>
                  <div className="text-xs text-gray-500">
                    {String(standby["syncState"] ?? "—")} · replay lag{" "}
                    {formatDuration(lag)}
                    {isNum(standby["bytesBehind"])
                      ? ` · ${bytesToReadable(standby["bytesBehind"])} behind`
                      : ""}
                  </div>
                </div>
                <Statusbubble
                  text={statusText}
                  color={statusColor}
                  shouldAnimate={shouldAnimate}
                />
              </div>
            );
          })}
      </div>
    );
  };

  const renderSlots: (slots: JSONArray) => ReactElement = (
    slots: JSONArray,
  ): ReactElement => {
    if (slots.length === 0) {
      return (
        <div className="text-xs text-gray-500">
          No replication slots on this node.
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {slots
          .slice(0, MAX_ROWS_TO_SHOW)
          .map((value: unknown, index: number): ReactElement => {
            const slot: JSONObject = asObject(value);
            const active: boolean = Boolean(slot["active"]);
            const walStatus: string = String(slot["walStatus"] ?? "unknown");
            const lost: boolean = walStatus === "lost";

            let statusText: string = "Active";
            let statusColor: Color = Green;
            let shouldAnimate: boolean = true;

            if (lost) {
              statusText = "WAL lost";
              statusColor = Red;
              shouldAnimate = false;
            } else if (!active) {
              statusText = "Inactive";
              statusColor = Yellow;
              shouldAnimate = false;
            }

            return (
              <div
                key={index}
                className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 font-mono truncate">
                    {String(slot["slotName"] ?? "—")}
                  </div>
                  <div className="text-xs text-gray-500">
                    {String(slot["slotType"] ?? "—")} · wal_status {walStatus}
                    {isNum(slot["retainedBytes"])
                      ? ` · retains ${bytesToReadable(slot["retainedBytes"])}`
                      : ""}
                  </div>
                </div>
                <Statusbubble
                  text={statusText}
                  color={statusColor}
                  shouldAnimate={shouldAnimate}
                />
              </div>
            );
          })}
      </div>
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
          PostgreSQL is not reachable from this instance.
        </div>
      );
    }

    const isInRecovery: boolean = Boolean(data?.["isInRecovery"]);
    const role: string = String(
      data?.["role"] ?? (isInRecovery ? "standby" : "primary"),
    );
    const replication: JSONArray = asArray(data?.["replication"]);
    const slots: JSONArray = asArray(data?.["replicationSlots"]);
    const connections: JSONObject = asObject(data?.["connections"]);
    const database: JSONObject = asObject(data?.["database"]);
    const wraparound: JSONObject = asObject(data?.["wraparound"]);
    const topTables: JSONArray = asArray(data?.["topTablesByDeadTuples"]);

    const maxConn: number = toNum(connections["maxConnections"]);
    const totalConn: number = toNum(connections["total"]);
    const connPercent: number | null =
      maxConn > 0 ? (totalConn / maxConn) * 100 : null;
    const blocked: number = toNum(connections["blocked"]);
    const idleInTransaction: number = toNum(connections["idleInTransaction"]);

    const lostSlots: number = slots.filter((value: unknown): boolean => {
      return String(asObject(value)["walStatus"]) === "lost";
    }).length;
    const inactiveSlots: number = slots.filter((value: unknown): boolean => {
      return !asObject(value)["active"];
    }).length;

    const maxReplayLag: number = replication.reduce(
      (max: number, value: unknown): number => {
        return Math.max(max, toNum(asObject(value)["replayLagSeconds"]));
      },
      0,
    );
    const nonStreaming: number = replication.filter(
      (value: unknown): boolean => {
        return String(asObject(value)["state"]) !== "streaming";
      },
    ).length;

    const maxXidAge: number = toNum(wraparound["maxXidAge"]);
    const wrapHeadroom: number | null =
      maxXidAge > 0
        ? Math.max(0, (1 - maxXidAge / XID_WRAPAROUND_LIMIT) * 100)
        : null;

    const cacheHit: number | null = isNum(database["cacheHitRatio"])
      ? toNum(database["cacheHitRatio"])
      : null;

    // Overall verdict — red for a hard problem, yellow for a soft one.
    let statusText: string = "Healthy";
    let statusColor: Color = Green;
    let shouldAnimate: boolean = true;

    const hasRedSignal: boolean =
      lostSlots > 0 ||
      blocked > 0 ||
      (connPercent !== null && connPercent >= 90) ||
      (wrapHeadroom !== null && wrapHeadroom < 10) ||
      maxReplayLag > 60;

    const hasYellowSignal: boolean =
      nonStreaming > 0 ||
      maxReplayLag > 10 ||
      inactiveSlots > 0 ||
      idleInTransaction > 10 ||
      (connPercent !== null && connPercent >= 75) ||
      (cacheHit !== null && cacheHit < 90);

    if (hasRedSignal) {
      statusText = "Needs attention";
      statusColor = Red;
      shouldAnimate = false;
    } else if (hasYellowSignal) {
      statusText = "Degraded";
      statusColor = Yellow;
      shouldAnimate = false;
    }

    // Topology summary line.
    let topology: string = "";
    if (role === "standby") {
      topology = "standby node";
    } else if (replication.length > 0) {
      topology = `1 primary + ${replication.length} ${
        replication.length === 1 ? "standby" : "standbys"
      }`;
    } else {
      topology = "single-node";
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Cluster{" "}
            <span className="font-mono text-gray-900">
              {String(data?.["clusterName"] || "—")}
            </span>{" "}
            · {topology}
            {data?.["serverVersion"]
              ? ` · pg ${String(data["serverVersion"])}`
              : ""}
            {isNum(data?.["uptimeSeconds"])
              ? ` · up ${formatDuration(data?.["uptimeSeconds"])}`
              : ""}
          </div>
          <Statusbubble
            text={statusText}
            color={statusColor}
            shouldAnimate={shouldAnimate}
          />
        </div>

        {/* Streaming replication — the primary's view of every standby. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Streaming replication
          </div>
          {renderReplication(replication, isInRecovery)}
        </div>

        {/* Replication slots — inactive / lost slots silently retain or drop WAL. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Replication slots
          </div>
          {renderSlots(slots)}
        </div>

        {/* Connection saturation + lock pressure. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Connections
          </div>
          {connPercent !== null ? (
            <ResourceUsageBar
              label="Connections"
              value={connPercent}
              valueLabel={`${connPercent.toFixed(0)}%`}
              secondaryLabel={`${formatNumber(totalConn)} / ${formatNumber(
                maxConn,
              )}`}
            />
          ) : (
            <></>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {renderStat("Active", formatNumber(connections["active"]))}
            {renderStat("Idle", formatNumber(connections["idle"]))}
            {renderStat(
              "Idle in txn",
              formatNumber(connections["idleInTransaction"]),
            )}
            {renderStat(
              "Waiting on lock",
              formatNumber(connections["waitingOnLock"]),
            )}
          </div>
          {blocked > 0 ? (
            <div className="text-xs text-red-700 mt-2">
              {formatNumber(blocked)} session
              {blocked === 1 ? "" : "s"} blocked waiting on a lock.
            </div>
          ) : (
            <></>
          )}
        </div>

        {/* Throughput, cache, transaction age and wraparound headroom. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {renderStat(
            "Cache hit ratio",
            cacheHit !== null ? `${cacheHit.toFixed(1)}%` : "—",
          )}
          {renderStat(
            "Longest transaction",
            formatDuration(connections["longestTransactionSeconds"]),
          )}
          {renderStat("Deadlocks", formatNumber(database["deadlocks"]))}
          {renderStat(
            "Wraparound headroom",
            wrapHeadroom !== null ? `${wrapHeadroom.toFixed(0)}%` : "—",
          )}
        </div>

        {/* Dead-tuple / autovacuum hotspots. */}
        {topTables.length > 0 ? (
          <div>
            <div className="text-sm font-semibold text-gray-900 mb-2">
              Autovacuum hotspots
            </div>
            <div className="space-y-1">
              {topTables
                .slice(0, MAX_ROWS_TO_SHOW)
                .map((value: unknown, index: number): ReactElement => {
                  const table: JSONObject = asObject(value);
                  return (
                    <div
                      key={index}
                      className="flex justify-between gap-4 text-xs"
                    >
                      <span className="font-mono text-gray-900 truncate">
                        {String(table["name"])}
                      </span>
                      <span className="text-gray-500 whitespace-nowrap">
                        {formatNumber(table["deadTuples"])} dead · vac{" "}
                        {timeAgo(table["lastAutovacuum"])}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="PostgreSQL cluster"
      description="Replication lag, slots, connection saturation, locks and transaction-ID wraparound — the signals behind a failed failover or a stalled primary."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isRefreshing,
          onClick: () => {
            setIsRefreshing(true);
            loadClusterHealth().catch(() => {
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

export default PostgresCluster;
