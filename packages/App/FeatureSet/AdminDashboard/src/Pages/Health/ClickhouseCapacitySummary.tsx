import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
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
import Navigation from "Common/UI/Utils/Navigation";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ClickhouseDiskUsage {
  label: string;
  usedInBytes: number;
  totalInBytes: number;
  percent: number;
}

export interface ClickhouseCapacitySummaryData {
  connected: boolean;
  dataSizeInBytes: number | null;
  // The fullest disk: a full shard is what stops ingestion, not the average.
  fullestDisk: ClickhouseDiskUsage | null;
  diskCount: number;
}

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

export const formatBytes: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null) {
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

const toDiskUsage: (
  label: string,
  totalValue: unknown,
  freeValue: unknown,
) => ClickhouseDiskUsage | null = (
  label: string,
  totalValue: unknown,
  freeValue: unknown,
): ClickhouseDiskUsage | null => {
  const total: number | null = toNumberOrNull(totalValue);
  const free: number | null = toNumberOrNull(freeValue);

  if (total === null || free === null || total <= 0) {
    return null;
  }

  const used: number = Math.max(0, total - free);

  return {
    label,
    usedInBytes: used,
    totalInBytes: total,
    percent: (used / total) * 100,
  };
};

/*
 * Reduces GET /admin/health/clickhouse-capacity to what the Health landing
 * page shows: whether ClickHouse is reachable, how much data it holds, and its
 * FULLEST disk. A cluster-wide average would hide the one full shard that is
 * already refusing inserts, so the summary always names the worst disk. When
 * no per-node figures are reported it falls back to the aggregate totals.
 */
export const summarizeClickhouseCapacity: (
  data: JSONObject | null,
) => ClickhouseCapacitySummaryData = (
  data: JSONObject | null,
): ClickhouseCapacitySummaryData => {
  const nodes: JSONArray = (data?.["diskByNode"] || []) as JSONArray;
  let fullestDisk: ClickhouseDiskUsage | null = null;
  let diskCount: number = 0;

  for (const value of nodes) {
    const node: JSONObject = (value || {}) as JSONObject;
    const labels: Array<string> = [];
    const shard: number | null = toNumberOrNull(node["shardNum"]);

    if (shard !== null) {
      labels.push(`Shard ${shard}`);
    }
    if (node["host"]) {
      labels.push(String(node["host"]));
    }
    if (node["diskName"]) {
      labels.push(String(node["diskName"]));
    }

    const usage: ClickhouseDiskUsage | null = toDiskUsage(
      labels.length > 0 ? labels.join(" · ") : "ClickHouse disk",
      node["totalInBytes"],
      node["freeInBytes"],
    );

    if (!usage) {
      continue;
    }

    diskCount++;

    if (!fullestDisk || usage.percent > fullestDisk.percent) {
      fullestDisk = usage;
    }
  }

  if (!fullestDisk) {
    fullestDisk = toDiskUsage(
      "ClickHouse disk",
      data?.["diskTotalInBytes"],
      data?.["diskFreeInBytes"],
    );
    diskCount = fullestDisk ? 1 : 0;
  }

  return {
    connected: Boolean(data?.["connected"]),
    dataSizeInBytes: toNumberOrNull(data?.["dataSizeInBytes"]),
    fullestDisk,
    diskCount,
  };
};

/*
 * ClickHouse capacity at a glance, for the Health landing page on every
 * edition: capacity notifications and automatic pruning are Community
 * features, and so is the view that tells an operator when to turn them on.
 * The full per-node breakdown and the settings are on the ClickHouse page.
 */
const ClickhouseCapacitySummary: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
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
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // handled via setError
    });
  }, []);

  const summary: ClickhouseCapacitySummaryData =
    summarizeClickhouseCapacity(data);

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <Alert type={AlertType.DANGER} title={error} />;
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            ClickHouse is {summary.connected ? "reachable" : "not reachable"}{" "}
            from this instance.
          </div>
          <Statusbubble
            text={summary.connected ? "Connected" : "Unreachable"}
            color={summary.connected ? Green : Red}
            shouldAnimate={false}
          />
        </div>

        {summary.connected && summary.fullestDisk ? (
          <ResourceUsageBar
            label={
              summary.diskCount > 1
                ? `Fullest of ${summary.diskCount} disks · ${summary.fullestDisk.label}`
                : summary.fullestDisk.label
            }
            value={summary.fullestDisk.percent}
            valueLabel={`${summary.fullestDisk.percent.toFixed(0)}%`}
            secondaryLabel={`${formatBytes(summary.fullestDisk.usedInBytes)} / ${formatBytes(summary.fullestDisk.totalInBytes)}`}
          />
        ) : (
          <></>
        )}

        {summary.connected ? (
          <div className="text-xs text-gray-500">
            ClickHouse data: {formatBytes(summary.dataSizeInBytes)}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="ClickHouse capacity"
      description="The fullest ClickHouse disk. Capacity notifications and automatic pruning are set up on the ClickHouse page."
      buttons={[
        {
          title: "View ClickHouse",
          icon: IconProp.Database,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.HEALTH_CLICKHOUSE] as Route,
              ),
            );
          },
        },
      ]}
    >
      {renderBody()}
    </Card>
  );
};

export default ClickhouseCapacitySummary;
