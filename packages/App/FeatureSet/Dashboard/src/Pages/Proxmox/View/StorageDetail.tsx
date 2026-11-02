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
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ProxmoxPartHero from "../../../Components/Proxmox/Part/ProxmoxPartHero";
import ProxmoxStorageOverview from "../../../Components/Proxmox/Part/ProxmoxStorageOverview";
import ProxmoxPartReadError from "../../../Components/Proxmox/Part/ProxmoxPartReadError";
import {
  ProxmoxPartRoutes,
  getProxmoxPartRoutes,
} from "../../../Components/Proxmox/Part/ProxmoxPartRoutes";
import {
  externalIdFromRouteParam,
  fetchProxmoxInventoryRow,
  formatBytes,
  displayNameForResource,
} from "../Utils/ProxmoxResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * WI-29: window for the client-side linear growth fit — same 24 h
 * window as the Ceph capacity forecast (Pages/Ceph/View/Index.tsx).
 */
const PROJECTION_WINDOW_HOURS: number = 24;

const ProxmoxClusterStorageDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
  /*
   * Why the storage's inventory could not be read: its Overview says so,
   * with Refresh, instead of "Storage details not reported yet" about an
   * agent that may be reporting fine.
   */
  const [rowError, setRowError] = useState<string>("");
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

  // The storage's own inventory row: its size, its use and its sharing.
  const fetchRow: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      const inventoryRow: ProxmoxResourceModel | null =
        await fetchProxmoxInventoryRow({
          proxmoxClusterId: modelId,
          kind: "Storage",
          externalId: externalId,
        });
      setRow(inventoryRow);
      setRowError("");
      if (clusterName && inventoryRow) {
        void loadGrowthProjection(clusterName, inventoryRow);
      }
    } catch (err) {
      setRowError(API.getFriendlyMessage(err));
    }
    setIsLoadingRow(false);
  };

  // Refresh after a failed read: the loader while it reads again.
  const retryRow: () => void = (): void => {
    setIsLoadingRow(true);
    fetchRow(cluster?.name || "").catch((err: Error) => {
      setRowError(API.getFriendlyMessage(err));
      setIsLoadingRow(false);
    });
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

    await fetchRow(clusterName);
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
      description: translator.translateTemplate(
        "Disk space used on storage volume {{storageName}} over time.",
        { storageName: storageName },
      ),
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
      description: translator.translateTemplate(
        "Total capacity of storage volume {{storageName}}.",
        { storageName: storageName },
      ),
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

  const routes: ProxmoxPartRoutes = getProxmoxPartRoutes(modelId);

  /*
   * WI-29 growth forecast — only shown when the volume is verifiably
   * growing and the projection lands within a year (anything beyond is
   * noise, mirroring the Ceph forecast cutoff).
   */
  const forecastDays: number | null =
    daysToFull !== null && Number.isFinite(daysToFull) && daysToFull <= 365
      ? daysToFull
      : null;

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: isLoadingRow ? (
        <PageLoader isVisible={true} />
      ) : rowError ? (
        <ProxmoxPartReadError
          kind="Storage"
          message={rowError}
          onRetry={retryRow}
        />
      ) : (
        <ProxmoxStorageOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={externalId}
          row={row}
          routes={routes}
          daysToFull={forecastDays}
          forecastWindowHours={PROJECTION_WINDOW_HOURS}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(
            "Storage Metrics: {{storageName}}",
            { storageName: storageName },
          )}
          description="Usage against capacity for this storage volume over the selected time range."
        >
          <ResourceMetricsTab queryConfigs={[usageQuery, sizeQuery]} />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="proxmox-storage-page">
      <ProxmoxPartHero
        kind="Storage"
        row={row}
        externalId={externalId}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        getPartRoute={routes.getPartRoute}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default ProxmoxClusterStorageDetail;
