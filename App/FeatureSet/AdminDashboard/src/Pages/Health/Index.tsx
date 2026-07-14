import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface HealthStatus {
  text: string;
  color: Color;
}

interface HealthTile {
  key: string;
  title: string;
  route: Route;
  status: HealthStatus;
  secondary: string;
}

interface Shortcut {
  title: string;
  description: string;
  icon: IconProp;
  route: Route;
}

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

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return (value || {}) as JSONObject;
};

// A datastore is either reachable (green) or it is not (red) — nothing in between.
const datastoreStatus: (connected: boolean) => HealthStatus = (
  connected: boolean,
): HealthStatus => {
  return connected
    ? { text: "Operational", color: Green }
    : { text: "Unreachable", color: Red };
};

const route: (page: PageMap) => Route = (page: PageMap): Route => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
};

const HealthOverview: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadOverview: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/overview",
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
    loadOverview().catch(() => {
      // handled via setError
    });
  }, []);

  if (isInitialLoading && !data) {
    return <ComponentLoader />;
  }

  const summary: JSONObject = asObject(data?.["summary"]);
  const postgres: JSONObject = asObject(summary["postgres"]);
  const clickhouse: JSONObject = asObject(summary["clickhouse"]);
  const redis: JSONObject = asObject(summary["redis"]);
  const queues: JSONObject = asObject(summary["queues"]);

  const postgresConnected: boolean = Boolean(postgres["connected"]);
  const clickhouseConnected: boolean = Boolean(clickhouse["connected"]);
  const redisConnected: boolean = Boolean(redis["connected"]);

  const totalQueues: number = toNumberOrNull(queues["totalQueues"]) || 0;
  const healthyQueues: number = toNumberOrNull(queues["healthyQueues"]) || 0;
  const failingQueues: number = toNumberOrNull(queues["failingQueues"]) || 0;
  const unavailableQueues: number =
    toNumberOrNull(queues["unavailableQueues"]) || 0;
  const failedJobs: number = toNumberOrNull(queues["failedJobs"]) || 0;

  let queueStatus: HealthStatus;
  if (unavailableQueues > 0) {
    queueStatus = { text: "Degraded", color: Red };
  } else if (failingQueues > 0) {
    queueStatus = {
      text: `${failingQueues.toLocaleString()} failing`,
      color: Red,
    };
  } else {
    queueStatus = { text: "Healthy", color: Green };
  }

  const redisMax: number | null = toNumberOrNull(redis["maxMemoryInBytes"]);

  const healthTiles: Array<HealthTile> = [
    {
      key: "postgres",
      title: "PostgreSQL",
      route: route(PageMap.HEALTH_POSTGRES),
      status: datastoreStatus(postgresConnected),
      secondary: postgresConnected
        ? `Database ${bytesToReadable(postgres["databaseSizeInBytes"])}`
        : "Not reachable from this instance",
    },
    {
      key: "clickhouse",
      title: "ClickHouse",
      route: route(PageMap.HEALTH_CLICKHOUSE),
      status: datastoreStatus(clickhouseConnected),
      secondary: clickhouseConnected
        ? "Capacity, tables & cluster"
        : "Not reachable from this instance",
    },
    {
      key: "redis",
      title: "Redis",
      route: route(PageMap.HEALTH_REDIS),
      status: datastoreStatus(redisConnected),
      secondary: redisConnected
        ? `Memory ${bytesToReadable(redis["usedMemoryInBytes"])}${
            redisMax ? ` / ${bytesToReadable(redisMax)}` : ""
          }`
        : "Not reachable from this instance",
    },
    {
      key: "queues",
      title: "Background queues",
      route: route(PageMap.HEALTH_QUEUES),
      status: queueStatus,
      secondary:
        totalQueues > 0
          ? `${healthyQueues}/${totalQueues} queues healthy${
              failedJobs > 0
                ? ` · ${failedJobs.toLocaleString()} failed jobs`
                : ""
            }`
          : "Worker backlog & failures",
    },
  ];

  const shortcuts: Array<Shortcut> = [
    {
      title: "Query Console",
      description:
        "Run read-only queries against Postgres, ClickHouse and Redis.",
      icon: IconProp.Terminal,
      route: route(PageMap.HEALTH_QUERY),
    },
    {
      title: "Instance Logs",
      description:
        "Audit trail of capacity notifications and automatic pruning work.",
      icon: IconProp.Logs,
      route: route(PageMap.HEALTH_INSTANCE_LOGS),
    },
    {
      title: "Diagnostic Logs",
      description: "Recent application and datastore diagnostic output.",
      icon: IconProp.List,
      route: route(PageMap.HEALTH_LOGS),
    },
    {
      title: "Global Probes",
      description: "Connectivity and status of the global monitoring probes.",
      icon: IconProp.Signal,
      route: route(PageMap.HEALTH_PROBES),
    },
    {
      title: "Migrations",
      description: "Database schema migration status and history.",
      icon: IconProp.Database,
      route: route(PageMap.HEALTH_MIGRATIONS),
    },
    {
      title: "Support Bundle",
      description: "Download a diagnostic bundle to share with support.",
      icon: IconProp.File,
      route: route(PageMap.HEALTH_SUPPORT_BUNDLE),
    },
  ];

  return (
    <div>
      {error ? (
        <Alert type={AlertType.DANGER} title={error} className="mb-5" />
      ) : (
        <></>
      )}

      <Card
        title="Cluster health"
        description="At-a-glance reachability of every datastore plus the background-queue workers. Select a subsystem to drill into its detail."
        buttons={[
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: isRefreshing,
            onClick: () => {
              setIsRefreshing(true);
              loadOverview().catch(() => {
                // handled via setError
              });
            },
          },
        ]}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {healthTiles.map((tile: HealthTile): ReactElement => {
            return (
              <Link
                key={tile.key}
                to={tile.route}
                className="block rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900">
                    {tile.title}
                  </div>
                  <Statusbubble
                    text={tile.status.text}
                    color={tile.status.color}
                    shouldAnimate={false}
                  />
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {tile.secondary}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>

      <Card
        title="Explore"
        description="Jump to the diagnostics, maintenance and tooling for this instance."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((shortcut: Shortcut): ReactElement => {
            return (
              <Link
                key={shortcut.title}
                to={shortcut.route}
                className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
                  <Icon
                    icon={shortcut.icon}
                    size={SizeProp.Regular}
                    className="h-5 w-5"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                    {shortcut.title}
                    <Icon
                      icon={IconProp.ChevronRight}
                      size={SizeProp.Small}
                      className="h-3.5 w-3.5 text-gray-400 transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {shortcut.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

const Health: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Overview"
      currentRoute={RouteMap[PageMap.HEALTH] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Instance Health Dashboard"
      enterpriseFeatureDescription="A cluster-health summary of every datastore and the background-queue workers, with shortcuts into the full diagnostics for this OneUptime deployment."
    >
      <HealthOverview />
    </HealthPage>
  );
};

export default Health;
