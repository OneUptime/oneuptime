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
import {
  MetricInfo,
  MetricInfoTip,
  MetricInfoWrap,
  MetricSectionHeading,
} from "../../Components/HealthMetricTooltip/HealthMetricTooltip";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// How many distributed-DDL / replica / table rows to list before truncating.
const MAX_ROWS_TO_SHOW: number = 10;

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

const formatNumber: (value: unknown) => string = (value: unknown): string => {
  const parsed: number = Number(value);
  return isNaN(parsed) ? "—" : parsed.toLocaleString();
};

const toNumOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

// Human-readable byte count (base-1024), matching the other health cards.
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
 * Plain-language explanations for the cluster signals on this card. Kept in one
 * place so the copy is easy to review; each entry drives an info tooltip next
 * to a heading or the overall status badge.
 */
type MetricInfoKey =
  | "overallStatus"
  | "distributedDdlQueue"
  | "shards"
  | "keeperCoordination"
  | "unhealthyReplicas";

const METRIC_INFO: Record<MetricInfoKey, MetricInfo> = {
  overallStatus: {
    title: "Overall status",
    body: "A roll-up of the cluster signals below. Degraded (yellow) fires when a shard replica is still rebuilding — its estimated recovery time is above zero. Needs attention (red) fires on a hard problem: unfinished distributed-DDL tasks, an expired Keeper/ZooKeeper session, or a table that is read-only, lagging, or missing replicas.",
  },
  distributedDdlQueue: {
    title: "Distributed DDL queue",
    body: "Schema changes marked ON CLUSTER run through a shared queue that every node must complete. Unfinished tasks mean the change is stuck on at least one host — schema sync and the migrate job will hang until the queue drains.",
  },
  shards: {
    title: "Shards",
    body: "Each shard-replica node in the cluster, with its data footprint and disk headroom. 'Recovering' means the node is still rebuilding its parts from peers; 'Online' means it is serving normally.",
  },
  keeperCoordination: {
    title: "Keeper coordination",
    body: "ClickHouse Keeper (or ZooKeeper) coordinates replication and distributed DDL. An expired session means this node has lost coordination and can't replicate or run ON CLUSTER statements until it reconnects.",
  },
  unhealthyReplicas: {
    title: "Unhealthy replicas",
    body: "Replicated tables that are read-only, have an expired session, are missing active replicas, or are lagging behind (absolute delay). Any of these blocks writes or leaves replicas out of sync.",
  },
};

const ClickhouseCluster: FunctionComponent = (): ReactElement => {
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
            "/admin/health/clickhouse-cluster",
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

  const renderShards: (shards: JSONArray) => ReactElement = (
    shards: JSONArray,
  ): ReactElement => {
    if (shards.length === 0) {
      return (
        <div className="text-xs text-gray-500">
          No cluster topology reported (single-node deployment, or
          system.clusters is unavailable on this ClickHouse).
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shards.map((value: unknown, index: number): ReactElement => {
          const shard: JSONObject = asObject(value);
          const recovering: boolean = toNum(shard["estimatedRecoveryTime"]) > 0;
          const errors: number = toNum(shard["errorsCount"]);

          // Per-node storage: data footprint + disk headroom for this replica.
          const dataSize: number | null = toNumOrNull(shard["dataSizeInBytes"]);
          const diskTotal: number | null = toNumOrNull(
            shard["diskTotalInBytes"],
          );
          const diskFree: number | null = toNumOrNull(shard["diskFreeInBytes"]);
          const diskUsed: number | null =
            diskTotal !== null && diskFree !== null
              ? diskTotal - diskFree
              : null;
          const diskPercent: number | null =
            diskTotal && diskUsed !== null && diskTotal > 0
              ? Math.round((diskUsed / diskTotal) * 100)
              : null;

          const storageParts: Array<string> = [];
          if (dataSize !== null) {
            storageParts.push(`${bytesToReadable(dataSize)} data`);
          }
          if (diskTotal !== null) {
            storageParts.push(
              `disk ${bytesToReadable(diskUsed)} / ${bytesToReadable(diskTotal)}${
                diskPercent !== null ? ` · ${diskPercent}%` : ""
              }`,
            );
          }

          return (
            <div
              key={index}
              className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  Shard {String(shard["shardNum"] ?? "—")} · Replica{" "}
                  {String(shard["replicaNum"] ?? "—")}
                </div>
                <div className="text-xs text-gray-500 font-mono truncate">
                  {String(shard["hostName"] ?? "—")}
                </div>
                {storageParts.length > 0 ? (
                  <div className="text-xs text-gray-600 mt-0.5 tabular-nums">
                    {storageParts.join(" · ")}
                  </div>
                ) : (
                  <></>
                )}
                {errors > 0 ? (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatNumber(errors)} connection errors
                  </div>
                ) : (
                  <></>
                )}
              </div>
              <Statusbubble
                text={recovering ? "Recovering" : "Online"}
                color={recovering ? Yellow : Green}
                shouldAnimate={!recovering}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderKeeper: (keeper: JSONArray) => ReactElement = (
    keeper: JSONArray,
  ): ReactElement => {
    if (keeper.length === 0) {
      return (
        <div className="text-xs text-gray-500">
          No Keeper/ZooKeeper connection reported (single-node, or
          system.zookeeper_connection unavailable).
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {keeper.map((value: unknown, index: number): ReactElement => {
          const conn: JSONObject = asObject(value);
          const expired: boolean = toNum(conn["isExpired"]) > 0;
          const uptime: number = toNum(conn["sessionUptimeSeconds"]);

          return (
            <div
              key={index}
              className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 font-mono truncate">
                  {String(conn["host"] ?? conn["name"] ?? "—")}
                </div>
                <div className="text-xs text-gray-500">
                  session up {formatNumber(uptime)}s
                </div>
              </div>
              <Statusbubble
                text={expired ? "Expired" : "Connected"}
                color={expired ? Red : Green}
                shouldAnimate={!expired}
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
          ClickHouse is not reachable from this instance.
        </div>
      );
    }

    const shards: JSONArray = asArray(data?.["clusters"]);
    const keeper: JSONArray = asArray(data?.["keeperConnection"]);
    const ddl: JSONObject = asObject(data?.["distributedDdlQueue"]);
    const ddlUnfinished: number = toNum(ddl["unfinished"]);
    const ddlItems: JSONArray = asArray(ddl["items"]);
    const unhealthyReplicas: JSONArray = asArray(data?.["unhealthyReplicas"]);

    const shardsRecovering: number = shards.filter(
      (value: unknown): boolean => {
        return toNum(asObject(value)["estimatedRecoveryTime"]) > 0;
      },
    ).length;
    const keeperExpired: number = keeper.filter((value: unknown): boolean => {
      return toNum(asObject(value)["isExpired"]) > 0;
    }).length;

    // Overall verdict — red for a hard problem, yellow for a soft one.
    let statusText: string = "Healthy";
    let statusColor: Color = Green;
    let shouldAnimate: boolean = true;

    if (
      ddlUnfinished > 0 ||
      keeperExpired > 0 ||
      unhealthyReplicas.length > 0
    ) {
      statusText = "Needs attention";
      statusColor = Red;
      shouldAnimate = false;
    } else if (shardsRecovering > 0) {
      statusText = "Degraded";
      statusColor = Yellow;
      shouldAnimate = false;
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Cluster{" "}
            <span className="font-mono text-gray-900">
              {String(data?.["clusterName"] ?? "—")}
            </span>{" "}
            · {shards.length} {shards.length === 1 ? "node" : "nodes"}
          </div>
          <MetricInfoWrap info={METRIC_INFO.overallStatus}>
            <span className="inline-flex cursor-help">
              <Statusbubble
                text={statusText}
                color={statusColor}
                shouldAnimate={shouldAnimate}
              />
            </span>
          </MetricInfoWrap>
        </div>

        {/* Distributed DDL queue — unfinished tasks are the wedge signature. */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-900 flex items-center">
              Distributed DDL queue
              <MetricInfoTip info={METRIC_INFO.distributedDdlQueue} />
            </div>
            <Statusbubble
              text={
                ddlUnfinished > 0
                  ? `${formatNumber(ddlUnfinished)} unfinished`
                  : "Clear"
              }
              color={ddlUnfinished > 0 ? Red : Green}
              shouldAnimate={ddlUnfinished === 0}
            />
          </div>
          {ddlUnfinished > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-1">
              <div className="text-xs text-red-700">
                ON CLUSTER DDL is not finishing on every host — schema-sync and
                the migrate Job will time out until this drains.
              </div>
              {ddlItems
                .slice(0, MAX_ROWS_TO_SHOW)
                .map((value: unknown, index: number): ReactElement => {
                  const item: JSONObject = asObject(value);
                  return (
                    <div
                      key={index}
                      className="text-xs font-mono text-red-800 truncate"
                    >
                      {String(item["host"] ?? "—")} · {String(item["status"])}
                      {item["exceptionText"]
                        ? ` — ${String(item["exceptionText"])}`
                        : ""}
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              No unfinished distributed-DDL tasks.
            </div>
          )}
        </div>

        {/* Shard / node status. */}
        <div>
          <MetricSectionHeading text="Shards" info={METRIC_INFO.shards} />
          {renderShards(shards)}
        </div>

        {/* Keeper / ZooKeeper coordination. */}
        <div>
          <MetricSectionHeading
            text="Keeper coordination"
            info={METRIC_INFO.keeperCoordination}
          />
          {renderKeeper(keeper)}
        </div>

        {/* Unhealthy replicas (read-only / lagging / missing peers). */}
        {unhealthyReplicas.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-900 flex items-center">
                Unhealthy replicas
                <MetricInfoTip info={METRIC_INFO.unhealthyReplicas} />
              </div>
              <Statusbubble
                text={`${unhealthyReplicas.length}`}
                color={Red}
                shouldAnimate={false}
              />
            </div>
            <div className="space-y-1">
              {unhealthyReplicas
                .slice(0, MAX_ROWS_TO_SHOW)
                .map((value: unknown, index: number): ReactElement => {
                  const replica: JSONObject = asObject(value);
                  const flags: Array<string> = [];
                  if (toNum(replica["isReadonly"]) > 0) {
                    flags.push("read-only");
                  }
                  if (toNum(replica["isSessionExpired"]) > 0) {
                    flags.push("session expired");
                  }
                  if (
                    toNum(replica["activeReplicas"]) <
                    toNum(replica["totalReplicas"])
                  ) {
                    flags.push(
                      `${toNum(replica["activeReplicas"])}/${toNum(
                        replica["totalReplicas"],
                      )} active`,
                    );
                  }
                  if (toNum(replica["absoluteDelay"]) > 0) {
                    flags.push(
                      `${formatNumber(replica["absoluteDelay"])}s behind`,
                    );
                  }
                  return (
                    <div
                      key={index}
                      className="flex justify-between gap-4 text-xs"
                    >
                      <span className="font-mono text-gray-900 truncate">
                        {String(replica["database"])}.{String(replica["table"])}
                      </span>
                      <span className="text-red-700 whitespace-nowrap">
                        {flags.join(", ") || "—"}
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
      title="ClickHouse cluster"
      description="Shard reachability, distributed-DDL queue, replica and Keeper health — the signals that reveal a wedged ON CLUSTER schema sync."
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

export default ClickhouseCluster;
