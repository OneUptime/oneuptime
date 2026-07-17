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

// Format a millisecond count (pg_stat_statements timings) into a compact human string.
const formatMilliseconds: (value: unknown) => string = (
  value: unknown,
): string => {
  const milliseconds: number = Number(value);

  if (value === null || value === undefined || isNaN(milliseconds)) {
    return "—";
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  return formatDuration(milliseconds / 1000);
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

/*
 * A table's share of the whole database, for the largest-tables list. Returns an
 * empty string when the database size is missing or zero, so callers can render
 * nothing rather than a misleading 0%.
 */
const formatShareOfDatabase: (
  sizeInBytes: unknown,
  databaseSizeInBytes: number,
) => string = (sizeInBytes: unknown, databaseSizeInBytes: number): string => {
  if (databaseSizeInBytes <= 0 || !isNum(sizeInBytes)) {
    return "";
  }

  const percent: number = (toNum(sizeInBytes) / databaseSizeInBytes) * 100;

  if (percent <= 0) {
    return "";
  }

  if (percent < 0.1) {
    return "<0.1% of database";
  }

  return `${percent.toFixed(1)}% of database`;
};

const PostgresCluster: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [activity, setActivity] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [activityError, setActivityError] = useState<string>("");

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
    }
  };

  const loadActivity: () => Promise<void> = async (): Promise<void> => {
    setActivityError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/postgres-activity",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setActivity(response.data);
    } catch (err) {
      setActivityError(API.getFriendlyMessage(err));
    }
  };

  // Both cards refresh together so the topology and the live activity agree.
  const loadAll: () => Promise<void> = async (): Promise<void> => {
    try {
      await Promise.all([loadClusterHealth(), loadActivity()]);
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll().catch(() => {
      // handled via setError / setActivityError
    });
  }, []);

  const refresh: () => void = (): void => {
    setIsRefreshing(true);
    loadAll().catch(() => {
      // handled via setError / setActivityError
    });
  };

  // A small labelled stat cell, with an optional context line under the value.
  const renderStat: (
    label: string,
    value: string,
    hint?: string,
  ) => ReactElement = (
    label: string,
    value: string,
    hint?: string,
  ): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-base font-semibold text-gray-900 mt-1">
          {value}
        </div>
        {hint ? (
          <div className="text-xs text-gray-400 mt-0.5">{hint}</div>
        ) : (
          <></>
        )}
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

    /*
     * Counters in pg_stat_database accumulate since the last stats reset, so
     * big numbers (commits, deadlocks) only mean something next to their age.
     */
    const statsResetHint: string | undefined = database["statsReset"]
      ? `since stats reset ${timeAgo(database["statsReset"])}`
      : undefined;

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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {renderStat(
            "Database size",
            bytesToReadable(data?.["databaseSizeInBytes"]),
          )}
          {renderStat(
            "Commits",
            formatNumber(database["xactCommit"]),
            statsResetHint,
          )}
          {renderStat(
            "Rollbacks",
            formatNumber(database["xactRollback"]),
            statsResetHint,
          )}
          {renderStat(
            "Temp files",
            formatNumber(database["tempFiles"]),
            isNum(database["tempBytes"])
              ? `${bytesToReadable(database["tempBytes"])} written`
              : undefined,
          )}
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
          {renderStat(
            "Deadlocks",
            formatNumber(database["deadlocks"]),
            statsResetHint,
          )}
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

  /*
   * Largest tables by total relation size. Mirrors renderContent()'s early
   * returns so this card never shows a broken table while the first load is in
   * flight or when Postgres is unreachable.
   */
  const renderLargestTables: () => ReactElement = (): ReactElement => {
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

    const tablesBySize: JSONArray = asArray(data?.["topTablesBySize"]);

    if (tablesBySize.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          No table sizes were reported.
        </div>
      );
    }

    const databaseSizeInBytes: number = toNum(data?.["databaseSizeInBytes"]);

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="pb-2 pr-4">Table</th>
              <th className="pb-2 px-4 text-right">Total</th>
              <th className="pb-2 px-4 text-right">Heap</th>
              <th className="pb-2 px-4 text-right">Indexes</th>
              <th className="pb-2 px-4 text-right">Toast</th>
              <th className="pb-2 px-4 text-right">Live rows</th>
              <th className="pb-2 pl-4 text-right">Dead rows</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tablesBySize
              .slice(0, MAX_ROWS_TO_SHOW)
              .map((value: unknown, index: number): ReactElement => {
                const table: JSONObject = asObject(value);
                const share: string = formatShareOfDatabase(
                  table["totalSizeInBytes"],
                  databaseSizeInBytes,
                );

                return (
                  <tr key={`postgres-table-by-size-${index}`}>
                    <td className="py-2 pr-4">
                      <div className="text-sm text-gray-900 font-mono whitespace-nowrap">
                        {String(table["name"] || "—")}
                      </div>
                      {share ? (
                        <div className="text-xs text-gray-500 whitespace-nowrap">
                          {share}
                        </div>
                      ) : (
                        <></>
                      )}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-900 tabular-nums whitespace-nowrap">
                      {bytesToReadable(table["totalSizeInBytes"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                      {bytesToReadable(table["tableSizeInBytes"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                      {bytesToReadable(table["indexSizeInBytes"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                      {bytesToReadable(table["toastSizeInBytes"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums">
                      {formatNumber(table["liveTuples"])}
                    </td>
                    <td className="py-2 pl-4 text-sm text-right text-gray-700 tabular-nums">
                      {formatNumber(table["deadTuples"])}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    );
  };

  /*
   * Live activity — blocked sessions, running queries (longest first) and
   * vacuum progress. Mirrors renderContent()'s early returns so the card never
   * shows a broken table while the first load is in flight or when Postgres is
   * unreachable.
   */
  const renderActivity: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !activity) {
      return <ComponentLoader />;
    }

    /*
     * No payload at all means the /postgres-activity request itself failed
     * (the alert above this content carries the actual error) — distinct from
     * a payload that reports Postgres as unreachable.
     */
    if (!activity) {
      return (
        <div className="text-sm text-gray-500">
          Live activity could not be loaded.
        </div>
      );
    }

    const connected: boolean = Boolean(activity["connected"]);
    if (!connected) {
      return (
        <div className="text-sm text-gray-500">
          PostgreSQL is not reachable from this instance.
        </div>
      );
    }

    const activeQueries: JSONArray = asArray(activity?.["activeQueries"]);
    const blockedSessions: JSONArray = asArray(activity?.["blockedSessions"]);
    const vacuumProgress: JSONArray = asArray(activity?.["vacuumProgress"]);

    return (
      <div className="space-y-6">
        {/* Blocked sessions first — when any exist, they are the story. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Blocked sessions
          </div>
          {blockedSessions.length === 0 ? (
            <div className="text-xs text-gray-500">
              No sessions are blocked on locks.
            </div>
          ) : (
            <div className="space-y-2">
              {blockedSessions
                .slice(0, MAX_ROWS_TO_SHOW)
                .map((value: unknown, index: number): ReactElement => {
                  const pair: JSONObject = asObject(value);
                  return (
                    <div
                      key={index}
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-1"
                    >
                      <div className="text-xs font-medium text-red-800">
                        PID {formatNumber(pair["blockedPid"])}
                        {pair["blockedUser"]
                          ? ` (${String(pair["blockedUser"])})`
                          : ""}{" "}
                        · waiting {formatDuration(pair["blockedForSeconds"])}
                      </div>
                      <div
                        className="text-xs font-mono text-gray-900 truncate"
                        title={String(pair["blockedQuery"] ?? "")}
                      >
                        {String(pair["blockedQuery"] ?? "—")}
                      </div>
                      <div className="text-xs text-gray-600">
                        blocked by PID {formatNumber(pair["blockingPid"])}
                        {pair["blockingUser"]
                          ? ` (${String(pair["blockingUser"])})`
                          : ""}
                        {pair["blockingState"]
                          ? ` · ${String(pair["blockingState"])}`
                          : ""}
                      </div>
                      <div
                        className="text-xs font-mono text-gray-700 truncate"
                        title={String(pair["blockingQuery"] ?? "")}
                      >
                        {String(pair["blockingQuery"] ?? "—")}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Running queries, longest first — idle-in-transaction included. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Running queries
          </div>
          {activeQueries.length === 0 ? (
            <div className="text-xs text-gray-500">
              Nothing is running right now. (This page&apos;s own health probe
              is excluded.)
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pb-2 pr-4">PID</th>
                    <th className="pb-2 px-4">State</th>
                    <th className="pb-2 px-4 text-right">Running</th>
                    <th className="pb-2 px-4 text-right">In txn</th>
                    <th className="pb-2 pl-4">Query</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeQueries.map(
                    (value: unknown, index: number): ReactElement => {
                      const session: JSONObject = asObject(value);
                      const sessionMeta: string = [
                        session["username"] ? String(session["username"]) : "",
                        session["applicationName"]
                          ? String(session["applicationName"])
                          : "",
                        session["clientAddr"]
                          ? String(session["clientAddr"])
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ");

                      return (
                        <tr key={`postgres-active-query-${index}`}>
                          <td className="py-2 pr-4 text-sm text-gray-900 tabular-nums">
                            {formatNumber(session["pid"])}
                          </td>
                          <td className="py-2 px-4">
                            <div className="text-sm text-gray-900 whitespace-nowrap">
                              {String(session["state"] ?? "—")}
                            </div>
                            {session["waitEventType"] ? (
                              <div className="text-xs text-gray-500 whitespace-nowrap">
                                waits on {String(session["waitEventType"])}
                                {session["waitEvent"]
                                  ? `: ${String(session["waitEvent"])}`
                                  : ""}
                              </div>
                            ) : (
                              <></>
                            )}
                          </td>
                          <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                            {formatDuration(session["queryAgeSeconds"])}
                          </td>
                          <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                            {isNum(session["transactionAgeSeconds"])
                              ? formatDuration(session["transactionAgeSeconds"])
                              : "—"}
                          </td>
                          <td className="py-2 pl-4">
                            <div
                              className="text-xs font-mono text-gray-900 truncate max-w-lg"
                              title={String(session["query"] ?? "")}
                            >
                              {String(session["query"] ?? "—")}
                            </div>
                            {sessionMeta ? (
                              <div className="text-xs text-gray-500 truncate max-w-lg">
                                {sessionMeta}
                              </div>
                            ) : (
                              <></>
                            )}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Vacuum progress — pairs with the autovacuum hotspots list above. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Vacuum progress
          </div>
          {vacuumProgress.length === 0 ? (
            <div className="text-xs text-gray-500">
              No vacuum is running right now.
            </div>
          ) : (
            <div className="space-y-2">
              {vacuumProgress.map(
                (value: unknown, index: number): ReactElement => {
                  const vacuum: JSONObject = asObject(value);
                  const percent: number | null = isNum(vacuum["percentScanned"])
                    ? toNum(vacuum["percentScanned"])
                    : null;
                  const label: string = `${
                    vacuum["tableName"]
                      ? String(vacuum["tableName"])
                      : `PID ${formatNumber(vacuum["pid"])}`
                  } · ${String(vacuum["phase"] ?? "—")}`;

                  return percent !== null ? (
                    <ResourceUsageBar
                      key={index}
                      label={label}
                      value={percent}
                      valueLabel={`${percent.toFixed(0)}%`}
                      secondaryLabel={`${formatNumber(
                        vacuum["heapBlocksScanned"],
                      )} / ${formatNumber(vacuum["heapBlocksTotal"])} blocks`}
                    />
                  ) : (
                    <div key={index} className="text-xs text-gray-700">
                      {label}
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  /*
   * Cumulative statement statistics from pg_stat_statements — or setup
   * instructions when the extension is not available on this instance.
   */
  const renderTopStatements: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !activity) {
      return <ComponentLoader />;
    }

    // Same failed-request vs unreachable-database distinction as renderActivity().
    if (!activity) {
      return (
        <div className="text-sm text-gray-500">
          Statement statistics could not be loaded.
        </div>
      );
    }

    const connected: boolean = Boolean(activity["connected"]);
    if (!connected) {
      return (
        <div className="text-sm text-gray-500">
          PostgreSQL is not reachable from this instance.
        </div>
      );
    }

    if (!activity?.["statementsAvailable"]) {
      return (
        <div className="text-sm text-gray-500">
          The <span className="font-mono">pg_stat_statements</span> extension is
          not available on this instance. Add{" "}
          <span className="font-mono">pg_stat_statements</span> to{" "}
          <span className="font-mono">shared_preload_libraries</span>, restart
          PostgreSQL, then run{" "}
          <span className="font-mono">
            CREATE EXTENSION pg_stat_statements;
          </span>{" "}
          to unlock cumulative query statistics.
        </div>
      );
    }

    const topStatements: JSONArray = asArray(activity?.["topStatements"]);

    if (topStatements.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          No statements have been recorded yet.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="pb-2 pr-4">Query</th>
              <th className="pb-2 px-4 text-right">Calls</th>
              <th className="pb-2 px-4 text-right">Total</th>
              <th className="pb-2 px-4 text-right">Mean</th>
              <th className="pb-2 px-4 text-right">Max</th>
              <th className="pb-2 px-4 text-right">Rows</th>
              <th className="pb-2 pl-4 text-right">Cache hit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {topStatements.map(
              (value: unknown, index: number): ReactElement => {
                const statement: JSONObject = asObject(value);
                return (
                  <tr key={`postgres-top-statement-${index}`}>
                    <td className="py-2 pr-4">
                      <div
                        className="text-xs font-mono text-gray-900 truncate max-w-lg"
                        title={String(statement["query"] ?? "")}
                      >
                        {String(statement["query"] ?? "—")}
                      </div>
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums">
                      {formatNumber(statement["calls"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-900 tabular-nums whitespace-nowrap">
                      {formatMilliseconds(statement["totalMilliseconds"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                      {formatMilliseconds(statement["meanMilliseconds"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                      {formatMilliseconds(statement["maxMilliseconds"])}
                    </td>
                    <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums">
                      {formatNumber(statement["rows"])}
                    </td>
                    <td className="py-2 pl-4 text-sm text-right text-gray-700 tabular-nums">
                      {isNum(statement["cacheHitRatio"])
                        ? `${toNum(statement["cacheHitRatio"]).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <Card
        title="PostgreSQL cluster"
        description="Replication lag, slots, connection saturation, locks and transaction-ID wraparound — the signals behind a failed failover or a stalled primary."
        buttons={[
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: isRefreshing,
            onClick: refresh,
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

      <Card
        title="Live activity"
        description="What Postgres is executing right now — blocked sessions, longest-running queries and vacuum progress. Statement text is shown to master admins here and is never part of the support bundle."
        buttons={[
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: isRefreshing,
            onClick: refresh,
          },
        ]}
      >
        <div>
          {activityError ? (
            <Alert
              type={AlertType.DANGER}
              title={activityError}
              className="mb-4"
            />
          ) : (
            <></>
          )}
          {renderActivity()}
        </div>
      </Card>

      <Card
        title="Slow statements"
        description="The statements that cost the most total execution time since stats were reset (pg_stat_statements). Queries are normalized — literals are replaced with $n placeholders — so no row data appears here."
      >
        <div>
          {activityError ? (
            <Alert
              type={AlertType.DANGER}
              title={activityError}
              className="mb-4"
            />
          ) : (
            <></>
          )}
          {renderTopStatements()}
        </div>
      </Card>

      <Card
        title="Largest tables"
        description="Total splits into heap, indexes and toast, so the biggest table is not always the biggest win — an index-heavy, toast-heavy or dead-tuple-heavy table each want a different fix."
      >
        {renderLargestTables()}
      </Card>
    </>
  );
};

export default PostgresCluster;
