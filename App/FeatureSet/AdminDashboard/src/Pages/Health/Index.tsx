import AdminModelAPI from "../../Utils/ModelAPI";
import EnterpriseFeatureUpgrade from "../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import ResourceUsageBar from "Common/UI/Components/ResourceUsageBar/ResourceUsageBar";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL, IS_ENTERPRISE_EDITION, VERSION } from "Common/UI/Config";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

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

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
};

const countLabel: (value: unknown) => string = (value: unknown): string => {
  const parsed: number | null = toNumberOrNull(value);
  return parsed === null ? "—" : parsed.toLocaleString();
};

const Health: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

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
    // Only the Enterprise Edition build surfaces this page, so skip the fetch otherwise.
    if (!IS_ENTERPRISE_EDITION) {
      setIsInitialLoading(false);
      return;
    }

    loadOverview().catch(() => {
      // handled via setError
    });
  }, []);

  if (!IS_ENTERPRISE_EDITION) {
    return (
      <Page
        title="Health"
        breadcrumbLinks={[
          {
            title: t("breadcrumbs.adminDashboard"),
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
          },
          {
            title: "Health",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.HEALTH] as Route,
            ),
          },
        ]}
      >
        <EnterpriseFeatureUpgrade
          title="Instance health"
          description="Operational health of this OneUptime instance."
          featureName="Instance Health Dashboard"
          featureDescription="Live status, datastore capacity, queue backlogs and instance footprint for your OneUptime deployment."
          benefits={[
            {
              icon: IconProp.Activity,
              title: "Live component health",
              subtitle:
                "Postgres, ClickHouse, Redis and queue health at a glance.",
            },
            {
              icon: IconProp.Database,
              title: "Datastore capacity",
              subtitle:
                "Track database disk and memory utilization before you run out.",
            },
            {
              icon: IconProp.List,
              title: "Queue & worker insight",
              subtitle:
                "Spot job backlogs and failures before they cause incidents.",
            },
            {
              icon: IconProp.Folder,
              title: "Instance footprint",
              subtitle:
                "Projects, users, monitors and incidents across the instance.",
            },
          ]}
        />
      </Page>
    );
  }

  const postgres: JSONObject = (data?.["postgres"] || {}) as JSONObject;
  const clickhouse: JSONObject = (data?.["clickhouse"] || {}) as JSONObject;
  const redis: JSONObject = (data?.["redis"] || {}) as JSONObject;
  const queues: JSONArray = (data?.["queues"] || []) as JSONArray;
  const counts: JSONObject = (data?.["counts"] || {}) as JSONObject;
  const topTables: JSONArray = (clickhouse["topTables"] || []) as JSONArray;

  // ClickHouse disk utilization (the one datastore that reports volume capacity directly).
  const chDiskTotal: number | null = toNumberOrNull(
    clickhouse["diskTotalInBytes"],
  );
  const chDiskFree: number | null = toNumberOrNull(
    clickhouse["diskFreeInBytes"],
  );
  const chDiskUsed: number | null =
    chDiskTotal !== null && chDiskFree !== null
      ? chDiskTotal - chDiskFree
      : null;
  const chDiskPercent: number | null =
    chDiskTotal && chDiskUsed !== null && chDiskTotal > 0
      ? (chDiskUsed / chDiskTotal) * 100
      : null;

  // Redis memory utilization (only meaningful when a maxmemory is configured).
  const redisUsed: number | null = toNumberOrNull(redis["usedMemoryInBytes"]);
  const redisMax: number | null = toNumberOrNull(redis["maxMemoryInBytes"]);
  const redisPercent: number | null =
    redisMax && redisUsed !== null && redisMax > 0
      ? (redisUsed / redisMax) * 100
      : null;

  const componentStatusRow: (
    label: string,
    connected: boolean,
    detail: string,
  ) => ReactElement = (
    label: string,
    connected: boolean,
    detail: string,
  ): ReactElement => {
    return (
      <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
        <span className="text-sm font-medium text-gray-800">{label}</span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500 tabular-nums">{detail}</span>
          <Statusbubble
            text={connected ? "Connected" : "Unreachable"}
            color={connected ? Green : Red}
            shouldAnimate={connected}
          />
        </div>
      </div>
    );
  };

  const renderOverview: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !data) {
      return <ComponentLoader />;
    }

    return (
      <div>
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5 mb-5">
          <InfoCard
            title="Version"
            value={VERSION.toString()}
            textClassName="text-2xl font-semibold text-gray-900"
          />
          <InfoCard
            title="Projects"
            value={countLabel(counts["projects"])}
            textClassName="text-2xl font-semibold text-gray-900"
          />
          <InfoCard
            title="Users"
            value={countLabel(counts["users"])}
            textClassName="text-2xl font-semibold text-gray-900"
          />
          <InfoCard
            title="Monitors"
            value={countLabel(counts["monitors"])}
            textClassName="text-2xl font-semibold text-gray-900"
          />
          <InfoCard
            title="Incidents"
            value={countLabel(counts["incidents"])}
            textClassName="text-2xl font-semibold text-gray-900"
          />
        </div>

        {/* System components */}
        <Card
          title="System components"
          description="Status of the core datastores this OneUptime instance depends on."
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
          <div>
            {componentStatusRow(
              "PostgreSQL",
              Boolean(postgres["connected"]),
              `${bytesToReadable(postgres["databaseSizeInBytes"])} data`,
            )}
            {componentStatusRow(
              "ClickHouse",
              Boolean(clickhouse["connected"]),
              `${bytesToReadable(clickhouse["dataSizeInBytes"])} data`,
            )}
            {componentStatusRow(
              "Redis",
              Boolean(redis["connected"]),
              `${bytesToReadable(redis["usedMemoryInBytes"])} used`,
            )}
          </div>
        </Card>

        {/* Datastore capacity */}
        <Card
          title="Datastore capacity"
          description="Disk and memory utilization of the databases backing this instance."
        >
          <div className="space-y-4">
            {chDiskPercent !== null ? (
              <ResourceUsageBar
                label="ClickHouse disk"
                value={chDiskPercent}
                valueLabel={`${chDiskPercent.toFixed(0)}%`}
                secondaryLabel={`${bytesToReadable(chDiskUsed)} / ${bytesToReadable(chDiskTotal)}`}
              />
            ) : (
              <></>
            )}

            {redisPercent !== null ? (
              <ResourceUsageBar
                label="Redis memory"
                value={redisPercent}
                valueLabel={`${redisPercent.toFixed(0)}%`}
                secondaryLabel={`${bytesToReadable(redisUsed)} / ${bytesToReadable(redisMax)}`}
              />
            ) : (
              <></>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500">Postgres data</div>
                <div className="text-base font-semibold text-gray-900 mt-1">
                  {bytesToReadable(postgres["databaseSizeInBytes"])}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500">ClickHouse data</div>
                <div className="text-base font-semibold text-gray-900 mt-1">
                  {bytesToReadable(clickhouse["dataSizeInBytes"])}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500">Redis memory</div>
                <div className="text-base font-semibold text-gray-900 mt-1">
                  {bytesToReadable(redis["usedMemoryInBytes"])}
                </div>
              </div>
            </div>

            {topTables.length > 0 ? (
              <div className="pt-2">
                <div className="text-sm font-medium text-gray-700 mb-2">
                  Largest ClickHouse tables
                </div>
                <div className="space-y-1">
                  {topTables.map(
                    (table: unknown, index: number): ReactElement => {
                      const tableObject: JSONObject = table as JSONObject;
                      return (
                        <div
                          key={index}
                          className="flex justify-between text-sm text-gray-600"
                        >
                          <span className="truncate mr-4">
                            {String(tableObject["name"])}
                          </span>
                          <span className="tabular-nums">
                            {bytesToReadable(tableObject["sizeInBytes"])}
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
          </div>
        </Card>

        {/* Background queues */}
        <Card
          title="Background queues"
          description="Job backlog across the queue workers. A growing backlog or failures indicate workers are unhealthy."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-2 pr-4 font-medium">Queue</th>
                  <th className="py-2 px-4 font-medium tabular-nums">
                    Waiting
                  </th>
                  <th className="py-2 px-4 font-medium tabular-nums">Active</th>
                  <th className="py-2 px-4 font-medium tabular-nums">
                    Completed
                  </th>
                  <th className="py-2 px-4 font-medium tabular-nums">Failed</th>
                  <th className="py-2 pl-4 font-medium tabular-nums">
                    Delayed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queues.map((queue: unknown, index: number): ReactElement => {
                  const queueObject: JSONObject = queue as JSONObject;
                  const queueName: string = String(queueObject["name"]);

                  if (queueObject["error"]) {
                    return (
                      <tr key={index}>
                        <td className="py-2 pr-4 font-medium text-gray-800">
                          {queueName}
                        </td>
                        <td
                          className="py-2 px-4 text-gray-400 italic"
                          colSpan={5}
                        >
                          Unavailable
                        </td>
                      </tr>
                    );
                  }

                  const failed: number | null = toNumberOrNull(
                    queueObject["failed"],
                  );

                  return (
                    <tr key={index}>
                      <td className="py-2 pr-4 font-medium text-gray-800">
                        {queueName}
                      </td>
                      <td className="py-2 px-4 tabular-nums text-gray-700">
                        {countLabel(queueObject["waiting"])}
                      </td>
                      <td className="py-2 px-4 tabular-nums text-gray-700">
                        {countLabel(queueObject["active"])}
                      </td>
                      <td className="py-2 px-4 tabular-nums text-gray-700">
                        {countLabel(queueObject["completed"])}
                      </td>
                      <td
                        className={`py-2 px-4 tabular-nums ${
                          failed && failed > 0
                            ? "text-red-600 font-semibold"
                            : "text-gray-700"
                        }`}
                      >
                        {countLabel(queueObject["failed"])}
                      </td>
                      <td className="py-2 pl-4 tabular-nums text-gray-700">
                        {countLabel(queueObject["delayed"])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <Page
      title="Health"
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Health",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HEALTH] as Route),
        },
      ]}
    >
      {error ? (
        <Alert type={AlertType.DANGER} title={error} className="mb-5" />
      ) : (
        <></>
      )}

      {renderOverview()}

      {/* Global probes — read straight from the Probe model, no new backend needed. */}
      <ModelTable<Probe>
        modelType={Probe}
        modelAPI={AdminModelAPI}
        id="admin-health-probes-table"
        name="Health > Probes"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        query={{
          projectId: new IsNull(),
          isGlobalProbe: true,
        }}
        cardProps={{
          title: "Global probes",
          description:
            "Probes that run monitoring checks for this instance, and whether they are currently reporting in.",
        }}
        noItemsMessage="No global probes have been configured."
        showRefreshButton={true}
        selectMoreFields={{
          lastAlive: true,
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: Probe): ReactElement => {
              return <ProbeElement probe={item} />;
            },
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Text,
            getElement: (item: Probe): ReactElement => {
              if (
                item &&
                item["lastAlive"] &&
                OneUptimeDate.getNumberOfMinutesBetweenDates(
                  OneUptimeDate.fromString(item["lastAlive"]),
                  OneUptimeDate.getCurrentDate(),
                ) < 5
              ) {
                return (
                  <Statusbubble
                    text="Connected"
                    color={Green}
                    shouldAnimate={true}
                  />
                );
              }

              return (
                <Statusbubble
                  text="Disconnected"
                  color={Red}
                  shouldAnimate={false}
                />
              );
            },
          },
          {
            field: {
              probeVersion: true,
            },
            title: "Version",
            type: FieldType.Text,
            hideOnMobile: true,
            getElement: (item: Probe): ReactElement => {
              return <span>{item["probeVersion"]?.toString() || "-"}</span>;
            },
          },
        ]}
        userPreferencesKey="admin-health-probes-table"
      />
    </Page>
  );
};

export default Health;
