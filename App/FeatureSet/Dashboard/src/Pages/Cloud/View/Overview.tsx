import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Card from "Common/UI/Components/Card/Card";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import {
  fetchSpanRedMetrics,
  formatBytes,
  formatCompact,
  formatPercent,
  SpanRedMetrics,
} from "../../../Components/TelemetryResource/telemetryMetrics";

const CloudResourceOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cloudResource, setCloudResource] = useState<CloudResource | null>(
    null,
  );
  const [instances, setInstances] = useState<Array<CloudResourceInstance>>([]);
  const [instancesLoaded, setInstancesLoaded] = useState<boolean>(false);
  const [red, setRed] = useState<SpanRedMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: {
          name: true,
          description: true,
          resourceIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.resourceIdentifier) {
        setError("Cloud resource not found.");
        setIsLoading(false);
        return;
      }

      setCloudResource(item);
      setIsLoading(false);

      ModelAPI.getList({
        modelType: CloudResourceInstance,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: { cloudResourceId: modelId } as any,
        select: {
          instanceName: true,
          latestCpuPercent: true,
          latestMemoryBytes: true,
          lastSeenAt: true,
        },
        sort: { latestCpuPercent: SortOrder.Descending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      })
        .then((result: { data: Array<CloudResourceInstance> }) => {
          setInstances(result.data);
          setInstancesLoaded(true);
        })
        .catch(() => {
          setInstancesLoaded(true);
        });

      const attributes: Record<string, string> = {};
      if (item.cloudPlatform) {
        attributes["resource.cloud.platform"] = String(item.cloudPlatform);
      }
      if (item.cloudAccountId) {
        attributes["resource.cloud.account.id"] = String(item.cloudAccountId);
      }
      if (item.cloudRegion) {
        attributes["resource.cloud.region"] = String(item.cloudRegion);
      }
      const end: Date = OneUptimeDate.getCurrentDate();
      const start: Date = OneUptimeDate.addRemoveMinutes(end, -60);
      fetchSpanRedMetrics({ attributes, start, end })
        .then(setRed)
        .catch(() => {
          return setRed({
            total: 0,
            errors: 0,
            errorRatePercent: null,
            p95DurationMs: null,
          });
        });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloudResource) {
    return <ErrorMessage message="Cloud resource not found." />;
  }

  const r: CloudResource = cloudResource;

  const cpuValues: Array<number> = instances
    .map((i: CloudResourceInstance): number | undefined => {
      return i.latestCpuPercent;
    })
    .filter((n: number | undefined): n is number => {
      return typeof n === "number" && Number.isFinite(n);
    });
  const avgCpu: number | null =
    cpuValues.length > 0
      ? cpuValues.reduce((a: number, b: number): number => {
          return a + b;
        }, 0) / cpuValues.length
      : null;
  const totalMem: number = instances.reduce(
    (sum: number, i: CloudResourceInstance): number => {
      return sum + (i.latestMemoryBytes || 0);
    },
    0,
  );

  const chips: Array<ResourceOverviewChip> = [];
  if (r.cloudProvider) {
    chips.push({ icon: IconProp.Cloud, label: String(r.cloudProvider) });
  }
  if (r.cloudRegion) {
    chips.push({ icon: IconProp.Globe, label: String(r.cloudRegion) });
  }
  if (r.cloudAccountId) {
    chips.push({ icon: IconProp.Info, label: String(r.cloudAccountId) });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "CPU",
      value: instancesLoaded ? formatPercent(avgCpu) : "…",
      icon: IconProp.ChartBar,
      iconColor: "blue",
      sublabel: "avg across instances",
      percent: avgCpu,
    },
    {
      title: "Memory",
      value: instancesLoaded ? formatBytes(totalMem) : "…",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      sublabel: "total across instances",
    },
    {
      title: "Instances",
      value: instancesLoaded ? formatCompact(instances.length) : "…",
      icon: IconProp.Cube,
      iconColor: "amber",
      sublabel: "running tasks",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_INSTANCES),
    },
    {
      title: "Requests",
      value: red ? formatCompact(red.total) : "…",
      icon: IconProp.Workflow,
      iconColor: "sky",
      sublabel: "spans, last 1 hour",
    },
  ];

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Distributed traces across this environment",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Logs from workloads on this environment",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Metrics from this environment",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Cloud Platform", value: r.cloudPlatform },
    { label: "Cloud Provider", value: r.cloudProvider },
    { label: "Cloud Region", value: r.cloudRegion },
    { label: "Cloud Account ID", value: r.cloudAccountId },
    { label: "Environment Key", value: r.resourceIdentifier },
  ];

  const topInstances: Array<CloudResourceInstance> = instances.slice(0, 5);

  return (
    <Fragment>
      <ResourceOverview
        icon={IconProp.Cloud}
        title={(r.name as string) || "Cloud Environment"}
        identifier={(r.cloudPlatform as string) || ""}
        identifierLabel="cloud.platform"
        status={r.otelCollectorStatus}
        lastSeenAt={r.lastSeenAt}
        description={r.description as string}
        chips={chips}
        tiles={tiles}
        quickLinks={quickLinks}
        detailRows={detailRows}
        labels={r.labels}
      />

      {instancesLoaded && topInstances.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Top instances by CPU"
            description="Live CPU and memory per running task / instance."
          >
            <div className="-m-6 -mt-2 border-t border-gray-200 divide-y divide-gray-100">
              {topInstances.map(
                (i: CloudResourceInstance, idx: number): ReactElement => {
                  return (
                    <div
                      key={`inst-${idx}`}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 truncate font-mono text-sm text-gray-900">
                        {(i.instanceName as string) || "—"}
                      </div>
                      <div className="w-20 text-right text-sm text-gray-700">
                        {formatPercent(
                          typeof i.latestCpuPercent === "number"
                            ? i.latestCpuPercent
                            : null,
                        )}
                      </div>
                      <div className="w-24 text-right text-sm text-gray-500">
                        {formatBytes(
                          typeof i.latestMemoryBytes === "number"
                            ? i.latestMemoryBytes
                            : null,
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
        </div>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CloudResourceOverview;
