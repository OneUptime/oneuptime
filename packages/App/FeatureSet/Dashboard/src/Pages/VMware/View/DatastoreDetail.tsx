import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
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
import {
  VMwareResourceKind,
  externalIdFromRouteParam,
  fetchVMwareInventoryRow,
  formatBytes,
  displayNameForResource,
  identityAttributesForResource,
} from "../Utils/VMwareResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  VMWARE_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_WARNING_PERCENT,
} from "../Utils/VMwareHealth";
import VMwarePartHero from "../../../Components/VMware/Part/VMwarePartHero";
import VMwareDatastoreOverview from "../../../Components/VMware/Part/VMwareDatastoreOverview";
import {
  VMwarePartRoutes,
  getVMwarePartRoutes,
} from "../../../Components/VMware/Part/VMwarePartRoutes";

/*
 * Window for the client-side linear growth fit — same 24 h window as
 * the Ceph and Proxmox capacity forecasts.
 */
const PROJECTION_WINDOW_HOURS: number = 24;

const VMwareVCenterDatastoreDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // The charts draw their titles and legends as given: hand them the reader's words.
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  /*
   * Route shape: .../vmware/:modelId/datastores/:subModelId — subModelId
   * is the percent-encoded inventory externalId
   * ("datastore/<dc>/<datastore>"), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [row, setRow] = useState<VMwareResourceModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Days until this datastore is 100% full at the linear growth rate
   * observed over the projection window. null = unknown or not growing
   * → the forecast row is hidden (never guess); 0 = already full.
   */
  const [daysToFull, setDaysToFull] = useState<number | null>(null);

  /*
   * Least-squares fit of vcenter.datastore.disk.usage{disk_state=used}
   * over the last 24 h against the datastore's capacity — pure client
   * math on an already-collected series (no server-side forecasting).
   * Best-effort: any failure just hides the forecast row.
   */
  const loadGrowthProjection: (
    vcenterName: string,
    inventoryRow: VMwareResourceModel,
  ) => Promise<void> = async (
    vcenterName: string,
    inventoryRow: VMwareResourceModel,
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
              name: "vcenter.datastore.disk.usage",
              attributes: {
                ...identityAttributesForResource(vcenterName, inventoryRow),
                disk_state: "used",
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
        // Flat or shrinking — no projection (hide, don't guess).
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
    let vcenterName: string = "";
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
        },
      });
      setVCenter(item);
      vcenterName = item?.name || "";
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);

    try {
      const inventoryRow: VMwareResourceModel | null =
        await fetchVMwareInventoryRow({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Datastore,
          externalId: externalId,
        });
      setRow(inventoryRow);
      if (vcenterName && inventoryRow) {
        void loadGrowthProjection(vcenterName, inventoryRow);
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

  if (!vcenter?.name) {
    return <ErrorMessage message="vCenter not found." />;
  }

  const vcenterName: string = vcenter.name;
  const datastoreName: string = row
    ? displayNameForResource(row)
    : externalId.substring(externalId.lastIndexOf("/") + 1);

  const idAttributes: Record<string, string> = row
    ? identityAttributesForResource(vcenterName, row)
    : {
        "resource.vmware.vcenter.name": vcenterName,
        "resource.vcenter.datastore.name": datastoreName,
      };

  const usageQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "datastore_used",
      title: tx("Datastore Usage"),
      description: translator.translateTemplate(
        "Space used on this datastore over time.",
      ),
      legend: tx("Used"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.datastore.disk.usage",
        attributes: { ...idAttributes, disk_state: "used" },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  const availableQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "datastore_available",
      title: tx("Datastore Free Space"),
      description: translator.translateTemplate(
        "Free space left on this datastore over time.",
      ),
      legend: tx("Free"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.datastore.disk.usage",
        attributes: { ...idAttributes, disk_state: "available" },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  const utilizationQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "datastore_utilization",
      title: tx("Datastore Utilization"),
      description: translator.translateTemplate(
        "How full this datastore is, as a percentage. The built-in alert templates warn at {{warnPercent}}% and go critical at {{criticalPercent}}%.",
        {
          warnPercent: VMWARE_DATASTORE_WARNING_PERCENT,
          criticalPercent: VMWARE_DATASTORE_CRITICAL_PERCENT,
        },
      ),
      legend: tx("Used"),
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.datastore.disk.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const now: Date = OneUptimeDate.getCurrentDate();
  const routes: VMwarePartRoutes = getVMwarePartRoutes(modelId);

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: isLoadingRow ? (
        <PageLoader isVisible={true} />
      ) : (
        <VMwareDatastoreOverview
          vcenterId={modelId}
          vcenterName={vcenterName}
          externalId={externalId}
          row={row}
          routes={routes}
          daysToFull={
            daysToFull !== null &&
            Number.isFinite(daysToFull) &&
            daysToFull <= 365
              ? daysToFull
              : null
          }
          forecastWindowHours={PROJECTION_WINDOW_HOURS}
          now={now}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(
            "Datastore Metrics: {{datastoreName}}",
            { datastoreName: datastoreName },
          )}
          description="Usage, free space and utilization for this datastore over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[usageQuery, availableQuery, utilizationQuery]}
          />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="vmware-datastore-page">
      <VMwarePartHero
        kind={VMwareResourceKind.Datastore}
        row={isLoadingRow ? null : row}
        externalId={externalId}
        datacenters={[]}
        hosts={[]}
        now={now}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default VMwareVCenterDatastoreDetail;
