import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Route from "Common/Types/API/Route";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumn,
  ResourceColumnTone,
} from "../../../Components/Infrastructure/ResourceTable";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import CephResourceUtils from "../Utils/CephResourceUtils";
import {
  CephPoolPgStates,
  CephPoolReadings,
  assessCephPool,
  getCephNewestSeenAt,
  getCephPoolReadings,
} from "../Utils/CephHealth";
import {
  CEPH_USED_PERCENT_ATTRIBUTE,
  CephPoolPgSummary,
  formatCephReadingNumber,
  getCephPoolPgSummary,
  getCephPoolUsedTone,
  readCephRowNumber,
  withCephStatus,
} from "../Utils/CephPartFacts";
import { CephPgStateReadings, loadCephPgStates } from "../Utils/CephReadings";
import {
  CephPartRoutes,
  getCephPartRoutes,
} from "../../../Components/Ceph/Part/CephPartRoutes";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Pools list reads the CephResource Postgres inventory (kind=Pool).
 * Each row's status is the cluster's rules' (CephHealth): a pool in amber
 * past the Pool Near Full alert's 85% of its writable space or with
 * degraded or undersized placement groups, in red past 95% or with
 * inactive ones - with why under it, as the Overview's Needs attention
 * says it. The placement groups come from the pools' latest ceph_pg_*
 * readings, and the inventory deliberately stores ceph_pool_rd / _wr as
 * raw cumulative counters (readOpsCounter / writeOpsCounter), so the IOPS
 * columns come from ClickHouse rate math over a short recent window -
 * never from the counter columns. Both are supplementary: a ClickHouse
 * hiccup leaves their columns at a dash, never the list blank. The detail
 * route param is the pool's externalId (its `pool_id`).
 */

const IOPS_WINDOW_MINUTES: number = 15;

/*
 * The list's own columns beside ResourceTable's Name and Status: how full
 * each pool is, what it stores, its placement groups and its I/O. Max Avail
 * and Objects fold into Stored and the name below a large screen.
 */
const POOL_COLUMNS: Array<ResourceColumn> = [
  {
    title: "Used",
    key: "usedPercent",
    description: CEPH_METRIC_DESCRIPTIONS.poolUsedColumn,
    getTone: (
      resource: InfrastructureResource,
    ): ResourceColumnTone | undefined => {
      return getCephPoolUsedTone(
        readCephRowNumber(resource, CEPH_USED_PERCENT_ATTRIBUTE),
      );
    },
  },
  {
    title: "Stored",
    key: "stored",
    description: CEPH_METRIC_DESCRIPTIONS.poolStoredColumn,
  },
  {
    title: "Max Avail",
    key: "maxAvail",
    description: CEPH_METRIC_DESCRIPTIONS.poolMaxAvailColumn,
    foldInto: "stored",
    showTitleWhenFolded: true,
  },
  {
    title: "PGs",
    key: "pgs",
    description: CEPH_METRIC_DESCRIPTIONS.poolPgsColumn,
  },
  {
    title: "Objects",
    key: "objects",
    description: CEPH_METRIC_DESCRIPTIONS.poolObjectsColumn,
    foldInto: "name",
    showTitleWhenFolded: true,
  },
  {
    title: "Read IOPS",
    key: "readIops",
    description: CEPH_METRIC_DESCRIPTIONS.poolReadIopsColumn,
  },
  {
    title: "Write IOPS",
    key: "writeIops",
    description: CEPH_METRIC_DESCRIPTIONS.poolWriteIopsColumn,
  },
];

const CephClusterPools: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const routes: CephPartRoutes = getCephPartRoutes(modelId);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchPoolRates: (
    clusterName: string,
    metricName: string,
  ) => Promise<Map<string, number>> = async (
    clusterName: string,
    metricName: string,
  ): Promise<Map<string, number>> => {
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveMinutes(
      endDate,
      -IOPS_WINDOW_MINUTES,
    );

    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: {
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          time: new InBetween(startDate, endDate),
          name: metricName,
          attributes: {
            "resource.ceph.cluster.name": clusterName,
          } as Dictionary<string | number | boolean>,
        },
        // Max preserves the raw counter value per bucket (no delta skew).
        aggregationType: AggregationType.Max,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: startDate,
        endTimestamp: endDate,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        groupBy: {
          attributes: true,
        },
      },
    });

    return CephResourceUtils.computeRatePerSeriesKey(result, "pool_id");
  };

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const rows: Array<CephResourceModel> =
        await CephResourceUtils.fetchCephResources({
          cephClusterId: modelId,
          kinds: ["Pool"],
        });
      const now: Date = OneUptimeDate.getCurrentDate();
      const newestSeenAt: Date | null = getCephNewestSeenAt(rows);

      let readRates: Map<string, number> = new Map();
      let writeRates: Map<string, number> = new Map();
      let pgStatesByPool: Map<string, CephPoolPgStates> = new Map();
      try {
        const cluster: CephCluster | null = await ModelAPI.getItem({
          modelType: CephCluster,
          id: modelId,
          select: {
            name: true,
          },
        });
        if (cluster?.name) {
          const clusterName: string = cluster.name;
          const [reads, writes, pgStates]: [
            Map<string, number>,
            Map<string, number>,
            CephPgStateReadings | null,
          ] = await Promise.all([
            fetchPoolRates(clusterName, "ceph_pool_rd").catch(() => {
              return new Map<string, number>();
            }),
            fetchPoolRates(clusterName, "ceph_pool_wr").catch(() => {
              return new Map<string, number>();
            }),
            loadCephPgStates(clusterName).catch(() => {
              return null;
            }),
          ]);
          readRates = reads;
          writeRates = writes;
          pgStatesByPool = pgStates?.byPool || new Map();
        }
      } catch {
        // Rate and placement-group columns render "—" when unread.
      }

      rows.sort((a: CephResourceModel, b: CephResourceModel) => {
        return (a.name || a.externalId || "").localeCompare(
          b.name || b.externalId || "",
        );
      });

      const list: Array<InfrastructureResource> = rows.map(
        (row: CephResourceModel): InfrastructureResource => {
          const readings: CephPoolReadings = getCephPoolReadings(row, now);
          const poolId: string = row.externalId || "";
          const readRate: number | undefined = readRates.get(poolId);
          const writeRate: number | undefined = writeRates.get(poolId);
          const pgStates: CephPoolPgStates | null =
            pgStatesByPool.get(poolId) || null;
          const pgSummary: CephPoolPgSummary | null =
            getCephPoolPgSummary(pgStates);

          return withCephStatus(
            {
              name: row.name || `pool ${poolId}`,
              namespace: "",
              cpuUtilization: null,
              memoryUsageBytes: null,
              memoryLimitBytes: null,
              status: "",
              age: CephResourceUtils.formatAge(row.createdAt),
              additionalAttributes: {
                externalId: poolId,
                stored: CephResourceUtils.formatBytes(readings.storedBytes),
                maxAvail: CephResourceUtils.formatBytes(readings.maxAvailBytes),
                usedPercent: CephResourceUtils.formatPercent(
                  readings.usedPercent,
                ),
                pgs: pgSummary
                  ? translator.translateTemplate(
                      "{{clean}} of {{total}} clean",
                      {
                        clean: translator.formatNumber(pgSummary.clean),
                        total: translator.formatNumber(pgSummary.total),
                      },
                    )
                  : "—",
                objects: CephResourceUtils.formatCount(readings.objects),
                readIops:
                  readRate !== undefined ? `${readRate.toFixed(1)}/s` : "—",
                writeIops:
                  writeRate !== undefined ? `${writeRate.toFixed(1)}/s` : "—",
                [CEPH_USED_PERCENT_ATTRIBUTE]: formatCephReadingNumber(
                  readings.usedPercent,
                ),
              },
            },
            assessCephPool(row, {
              now: now,
              newestSeenAt: newestSeenAt,
              pgStates: pgStates,
            }),
          );
        },
      );

      setResources(list);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
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

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Pools"
      description={translator.translateTemplate(
        "Storage pools in this cluster: how full each is and whether its placement groups are clean, by the cluster's rules. Read / write IOPS are averaged over the last {{minutes}} minutes.",
        { minutes: translator.formatNumber(IOPS_WINDOW_MINUTES) },
      )}
      resources={resources}
      tableIdPrefix="ceph"
      showGroupColumn={false}
      showAge={false}
      showResourceMetrics={false}
      builtInColumnDescriptions={{
        status: CEPH_METRIC_DESCRIPTIONS.poolStatusColumn,
      }}
      columns={POOL_COLUMNS}
      emptyMessage="No pools found in the inventory yet. Pools appear here a few minutes after the Ceph agent starts sending metrics."
      getViewRoute={(resource: InfrastructureResource): Route => {
        return routes.getPartRoute(
          "Pool",
          resource.additionalAttributes["externalId"] || "",
        );
      }}
    />
  );
};

export default CephClusterPools;
