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
          <Statusbubble
            text={statusText}
            color={statusColor}
            shouldAnimate={shouldAnimate}
          />
        </div>

        {/* Distributed DDL queue — unfinished tasks are the wedge signature. */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-900">
              Distributed DDL queue
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
          <div className="text-sm font-semibold text-gray-900 mb-2">Shards</div>
          {renderShards(shards)}
        </div>

        {/* Keeper / ZooKeeper coordination. */}
        <div>
          <div className="text-sm font-semibold text-gray-900 mb-2">
            Keeper coordination
          </div>
          {renderKeeper(keeper)}
        </div>

        {/* Unhealthy replicas (read-only / lagging / missing peers). */}
        {unhealthyReplicas.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-900">
                Unhealthy replicas
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
