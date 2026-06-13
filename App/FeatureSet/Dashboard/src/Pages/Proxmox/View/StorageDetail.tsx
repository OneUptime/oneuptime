import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  externalIdFromRouteParam,
  fetchProxmoxInventoryRow,
  formatBytes,
  formatPercent,
  displayNameForResource,
  displayStatusForResource,
} from "../Utils/ProxmoxResourceUtils";
import OneUptimeDate from "Common/Types/Date";

/*
 * WI-29: window for the client-side linear growth fit — same 24 h
 * window as the Ceph capacity forecast (Pages/Ceph/View/Overview.tsx).
 */
const PROJECTION_WINDOW_HOURS: number = 24;

const ProxmoxClusterStorageDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../proxmox/:modelId/storage/:subModelId — subModelId
   * is the percent-encoded pve externalId ("storage/local", or
   * "storage/<node>/<storage>" on pve-exporter >= 3.x), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [row, setRow] = useState<ProxmoxResourceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * WI-29: days until this volume is 100% full at the linear growth
   * rate observed over the projection window. null = unknown or not
   * growing → the forecast row is hidden (never guess); 0 = already
   * full.
   */
  const [daysToFull, setDaysToFull] = useState<number | null>(null);

  /*
   * Least-squares fit of pve_disk_usage_bytes over the last 24 h
   * against the volume's capacity — pure client math on an
   * already-collected series, same approach as the Ceph cluster
   * capacity forecast (no server-side forecasting, no alerting — v4).
   * Best-effort: any failure just hides the forecast row.
   */
  const loadGrowthProjection: (
    clusterName: string,
    inventoryRow: ProxmoxResourceModel,
  ) => Promise<void> = async (
    clusterName: string,
    inventoryRow: ProxmoxResourceModel,
  ): Promise<void> => {
    try {
      const totalBytes: number | null =
        inventoryRow.maxDiskBytes !== null &&
        inventoryRow.maxDiskBytes !== undefined
          ? Number(inventoryRow.maxDiskBytes)
          : null;
      if (totalBytes === null || totalBytes <= 0) {
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(
        endDate,
        -PROJECTION_WINDOW_HOURS,
      );

      const aggregateUsed: AggregatedResult =
        await AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: {
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              time: new InBetween(startDate, endDate),
              name: "pve_disk_usage_bytes",
              attributes: {
                "resource.proxmox.cluster.name": clusterName,
                id: externalId,
              } as Dictionary<string | number | boolean>,
            },
            aggregationType: AggregationType.Avg,
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: startDate,
            endTimestamp: endDate,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          },
        });

      type Sample = { t: number; v: number };
      const samples: Array<Sample> = [];
      for (const p of (aggregateUsed.data || []) as Array<AggregatedModel>) {
        const raw: unknown =
          p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
        const t: number =
          raw instanceof Date
            ? raw.getTime()
            : new Date(raw as string).getTime();
        const v: number = Number(p["value"]);
        if (Number.isFinite(t) && Number.isFinite(v)) {
          samples.push({ t, v });
        }
      }
      samples.sort((a: Sample, b: Sample) => {
        return a.t - b.t;
      });

      if (samples.length < 3) {
        return;
      }

      const n: number = samples.length;
      const meanT: number =
        samples.reduce((sum: number, s: Sample) => {
          return sum + s.t;
        }, 0) / n;
      const meanV: number =
        samples.reduce((sum: number, s: Sample) => {
          return sum + s.v;
        }, 0) / n;
      let num: number = 0;
      let den: number = 0;
      for (const s of samples) {
        num += (s.t - meanT) * (s.v - meanV);
        den += (s.t - meanT) * (s.t - meanT);
      }
      const slopePerMs: number = den > 0 ? num / den : 0;
      const usedBytes: number = samples[samples.length - 1]!.v;

      if (usedBytes >= totalBytes) {
        setDaysToFull(0);
        return;
      }
      if (slopePerMs <= 0) {
        // Flat or shrinking — no projection (spec: hide, don't guess).
        return;
      }
      setDaysToFull(
        (totalBytes - usedBytes) / (slopePerMs * 1000 * 60 * 60 * 24),
      );
    } catch {
      // Forecast is supplementary — hide on failure.
    }
  };

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    let clusterName: string = "";
    try {
      const item: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
        id: modelId,
        select: {
          name: true,
        },
      });
      setCluster(item);
      clusterName = item?.name || "";
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);

    try {
      const inventoryRow: ProxmoxResourceModel | null =
        await fetchProxmoxInventoryRow({
          proxmoxClusterId: modelId,
          kind: "Storage",
          externalId: externalId,
        });
      setRow(inventoryRow);
      if (clusterName && inventoryRow) {
        void loadGrowthProjection(clusterName, inventoryRow);
      }
    } catch {
      // Graceful degradation — overview tab shows its empty state.
    }
    setIsLoadingRow(false);
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

  if (!cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = cluster.name;
  const storageName: string = row
    ? displayNameForResource(row)
    : externalId.replace(/^storage\//, "");

  const idAttributes: Record<string, string> = {
    "resource.proxmox.cluster.name": clusterName,
    id: externalId,
  };

  const usageQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "storage_usage",
      title: "Storage Usage",
      description: `Disk space used on storage volume ${storageName} over time.`,
      legend: "Used",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "pve_disk_usage_bytes",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  const sizeQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "storage_size",
      title: "Storage Size",
      description: `Total capacity of storage volume ${storageName}.`,
      legend: "Total",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "pve_disk_size_bytes",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  // Build overview summary fields from the inventory row.
  const summaryFields: Array<SummaryField> = [
    { title: "Storage Name", value: storageName },
    { title: "Cluster", value: clusterName },
  ];

  if (row) {
    const status: string = displayStatusForResource(row);
    if (status) {
      summaryFields.push({
        title: "Status",
        value: (
          <StatusBadge
            text={status}
            type={row.isUp ? StatusBadgeType.Success : StatusBadgeType.Danger}
          />
        ),
      });
    }

    if (row.parentNodeName) {
      summaryFields.push({ title: "Node", value: row.parentNodeName });
    }

    const used: number | null =
      row.latestDiskBytes !== null && row.latestDiskBytes !== undefined
        ? Number(row.latestDiskBytes)
        : null;
    const total: number | null =
      row.maxDiskBytes !== null && row.maxDiskBytes !== undefined
        ? Number(row.maxDiskBytes)
        : null;

    if (used !== null) {
      summaryFields.push({ title: "Used", value: formatBytes(used) });
    }
    if (total !== null) {
      summaryFields.push({ title: "Total", value: formatBytes(total) });
    }
    if (used !== null && total !== null && total > 0) {
      summaryFields.push({
        title: "Used %",
        value: formatPercent((used / total) * 100),
      });
    }

    /*
     * WI-29 growth forecast — only rendered when the volume is
     * verifiably growing and the projection lands within a year
     * (anything beyond is noise, mirroring the Ceph forecast cutoff).
     */
    if (
      daysToFull !== null &&
      Number.isFinite(daysToFull) &&
      daysToFull <= 365
    ) {
      const usedPctText: string =
        used !== null && total !== null && total > 0
          ? formatPercent((used / total) * 100)
          : "—";
      summaryFields.push({
        title: "Growth Forecast",
        value:
          daysToFull === 0
            ? "Full now"
            : `${usedPctText} full — at the current growth rate this volume will be full in ~${Math.max(
                1,
                Math.round(daysToFull),
              )} day${Math.max(1, Math.round(daysToFull)) === 1 ? "" : "s"} (linear fit over the last ${PROJECTION_WINDOW_HOURS} h)`,
      });
    }

    summaryFields.push({ title: "External ID", value: externalId });

    if (row.lastSeenAt) {
      summaryFields.push({
        title: "Last Seen",
        value: OneUptimeDate.fromNow(new Date(row.lastSeenAt as Date)),
      });
    }
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={row ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingRow}
          emptyMessage="Storage details not reported yet. Make sure the Proxmox agent is sending metrics."
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Storage Metrics: ${storageName}`}
          description="Usage against capacity for this storage volume over the selected time range."
        >
          <ResourceMetricsTab queryConfigs={[usageQuery, sizeQuery]} />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default ProxmoxClusterStorageDetail;
