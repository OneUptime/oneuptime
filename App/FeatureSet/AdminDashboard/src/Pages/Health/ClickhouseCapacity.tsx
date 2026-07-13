import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red } from "Common/Types/BrandColors";
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

const asArray: (value: unknown) => JSONArray = (value: unknown): JSONArray => {
  return (value || []) as JSONArray;
};

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return (value || {}) as JSONObject;
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

const formatNumber: (value: unknown) => string = (value: unknown): string => {
  const parsed: number | null = toNumberOrNull(value);
  return parsed === null ? "—" : parsed.toLocaleString();
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

const ClickhouseCapacity: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadCapacity: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/clickhouse-capacity",
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
    loadCapacity().catch(() => {
      // handled via setError
    });
  }, []);

  if (isInitialLoading && !data) {
    return <ComponentLoader />;
  }

  const connected: boolean = Boolean(data?.["connected"]);
  const diskByNode: JSONArray = asArray(data?.["diskByNode"]);
  const topTables: JSONArray = asArray(data?.["topTables"]);
  const localTableSizes: JSONArray = asArray(data?.["localTableSizesByShard"]);

  const diskTotal: number | null = toNumberOrNull(data?.["diskTotalInBytes"]);
  const diskFree: number | null = toNumberOrNull(data?.["diskFreeInBytes"]);
  const diskUsed: number | null =
    diskTotal !== null && diskFree !== null ? diskTotal - diskFree : null;
  const diskPercent: number | null =
    diskTotal !== null && diskTotal > 0 && diskUsed !== null
      ? (diskUsed / diskTotal) * 100
      : null;

  const renderDiskBars: () => ReactElement = (): ReactElement => {
    const bars: Array<ReactElement> = [];

    diskByNode.forEach((value: unknown, index: number): void => {
      const node: JSONObject = asObject(value);
      const total: number | null = toNumberOrNull(node["totalInBytes"]);
      const free: number | null = toNumberOrNull(node["freeInBytes"]);
      const used: number | null =
        total !== null && free !== null ? total - free : null;
      const percent: number | null =
        total !== null && total > 0 && used !== null
          ? (used / total) * 100
          : null;

      if (percent === null) {
        return;
      }

      const shard: number | null = toNumberOrNull(node["shardNum"]);
      const host: string = String(node["host"] || "");
      const diskName: string = String(node["diskName"] || "");
      const labels: Array<string> = [];

      if (shard !== null) {
        labels.push(`Shard ${shard}`);
      }
      if (host) {
        labels.push(host);
      }
      if (diskName) {
        labels.push(diskName);
      }

      bars.push(
        <ResourceUsageBar
          key={`clickhouse-disk-${index}`}
          label={
            labels.length > 0
              ? `ClickHouse disk · ${labels.join(" · ")}`
              : "ClickHouse disk"
          }
          value={percent}
          valueLabel={`${percent.toFixed(0)}%`}
          secondaryLabel={`${bytesToReadable(used)} / ${bytesToReadable(
            total,
          )}`}
        />,
      );
    });

    if (bars.length > 0) {
      return <>{bars}</>;
    }

    if (diskPercent !== null) {
      return (
        <ResourceUsageBar
          label="ClickHouse disk"
          value={diskPercent}
          valueLabel={`${diskPercent.toFixed(0)}%`}
          secondaryLabel={`${bytesToReadable(diskUsed)} / ${bytesToReadable(
            diskTotal,
          )}`}
        />
      );
    }

    return <></>;
  };

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

  return (
    <>
      <Card
        title="ClickHouse capacity"
        description="Disk utilization is shown per node so a full shard or replica cannot be hidden by a cluster-wide average."
        buttons={[
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: isRefreshing,
            onClick: () => {
              setIsRefreshing(true);
              loadCapacity().catch(() => {
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

          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                ClickHouse is {connected ? "reachable" : "not reachable"} from
                this instance.
              </div>
              <Statusbubble
                text={connected ? "Connected" : "Unreachable"}
                color={connected ? Green : Red}
                shouldAnimate={connected}
              />
            </div>

            {connected ? (
              <>
                <div className="space-y-4">{renderDiskBars()}</div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {renderStat(
                    "ClickHouse data",
                    bytesToReadable(data?.["dataSizeInBytes"]),
                  )}
                  {renderStat("Disk used", bytesToReadable(diskUsed))}
                  {renderStat("Disk total", bytesToReadable(diskTotal))}
                </div>

                {topTables.length > 0 ? (
                  <div>
                    <div className="text-sm font-semibold text-gray-900 mb-2">
                      Largest tables across the cluster
                    </div>
                    <div className="space-y-1">
                      {topTables.map(
                        (value: unknown, index: number): ReactElement => {
                          const table: JSONObject = asObject(value);
                          return (
                            <div
                              key={`clickhouse-top-table-${index}`}
                              className="flex justify-between gap-4 text-sm text-gray-600"
                            >
                              <span className="font-mono truncate">
                                {String(table["name"] || "—")}
                              </span>
                              <span className="tabular-nums whitespace-nowrap">
                                {bytesToReadable(table["sizeInBytes"])}
                              </span>
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                ) : (
                  <></>
                )}
              </>
            ) : (
              <></>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Local table sizes by shard"
        description="Physical local-table data stored on each ClickHouse shard. Replicas can legitimately report the same shard data on different hosts."
      >
        {localTableSizes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Shard</th>
                  <th className="pb-2 px-4">Host</th>
                  <th className="pb-2 px-4">Local table</th>
                  <th className="pb-2 px-4 text-right">Data</th>
                  <th className="pb-2 px-4 text-right">Rows</th>
                  <th className="pb-2 pl-4 text-right">Active parts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {localTableSizes.map(
                  (value: unknown, index: number): ReactElement => {
                    const table: JSONObject = asObject(value);
                    return (
                      <tr key={`clickhouse-local-table-${index}`}>
                        <td className="py-2 pr-4 text-sm text-gray-700 tabular-nums">
                          {formatNumber(table["shardNum"])}
                        </td>
                        <td className="py-2 px-4 text-sm text-gray-600 font-mono whitespace-nowrap">
                          {String(table["host"] || "—")}
                        </td>
                        <td className="py-2 px-4 text-sm text-gray-900 font-mono whitespace-nowrap">
                          {String(table["tableName"] || "—")}
                        </td>
                        <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums whitespace-nowrap">
                          {bytesToReadable(table["sizeInBytes"])}
                        </td>
                        <td className="py-2 px-4 text-sm text-right text-gray-700 tabular-nums">
                          {formatNumber(table["rowCount"])}
                        </td>
                        <td className="py-2 pl-4 text-sm text-right text-gray-700 tabular-nums">
                          {formatNumber(table["partCount"])}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            No local ClickHouse table sizes were reported.
          </div>
        )}
      </Card>
    </>
  );
};

export default ClickhouseCapacity;
