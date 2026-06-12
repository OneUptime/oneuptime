import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

interface CephPoolRow {
  poolName: string;
  storedBytes: string;
  maxAvail: string;
  objects: string;
  readBytes: string;
  writeBytes: string;
}

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";
const POOL_ID_ATTR: string = "pool_id";
const POOL_NAME_ATTR: string = "name";

const formatBytes: (bytes: number) => string = (bytes: number): string => {
  if (!isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let value: number = bytes;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const formatCount: (value: number) => string = (value: number): string => {
  if (!isFinite(value) || value < 0) {
    return "—";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.round(value).toString();
};

const CephClusterPools: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [pools, setPools] = useState<Array<CephPoolRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const cluster: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!cluster?.name) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);

      const metricNames: Array<string> = [
        "ceph_pool_stored",
        "ceph_pool_max_avail",
        "ceph_pool_objects",
        "ceph_pool_rd_bytes",
        "ceph_pool_wr_bytes",
      ];

      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildQuery: (metricName: string) => any = (metricName: string) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              [CLUSTER_ATTR]: cluster.name,
            },
          },
          limit: 500,
          skip: 0,
          select: {
            time: true,
            value: true,
            attributes: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          requestOptions: {},
        };
      };

      const results: Array<ListResult<Metric>> = await Promise.all(
        metricNames.map((n: string) => {
          return AnalyticsModelAPI.getList<Metric>(buildQuery(n));
        }),
      );

      /*
       * For each metric, take the latest value per pool. The ceph-mgr
       * prometheus module keys pool series by the `pool_id` datapoint
       * label; the human-readable pool name rides along in the `name`
       * label on the same series.
       */
      const latestByMetric: Map<string, Map<string, Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        const perPool: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> = results[idx]!;
        for (const metric of listResult.data) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const poolId: string = String(attrs[POOL_ID_ATTR] ?? "");
          if (!poolId) {
            continue;
          }
          if (!perPool.has(poolId)) {
            perPool.set(poolId, metric);
          }
        }
        latestByMetric.set(name, perPool);
      });

      // Collect union of pool ids.
      const poolIds: Set<string> = new Set();
      for (const perPool of latestByMetric.values()) {
        for (const id of perPool.keys()) {
          poolIds.add(id);
        }
      }

      const rows: Array<CephPoolRow> = [];
      for (const poolId of poolIds) {
        // Pick the pool name from whichever metric carries it.
        let poolName: string = `pool ${poolId}`;
        for (const perPool of latestByMetric.values()) {
          const m: Metric | undefined = perPool.get(poolId);
          if (m) {
            const attrs: Record<string, unknown> =
              (m.attributes as Record<string, unknown>) || {};
            const name: string = (attrs[POOL_NAME_ATTR] as string) || "";
            if (name) {
              poolName = name;
              break;
            }
          }
        }

        const storedMetric: Metric | undefined = latestByMetric
          .get("ceph_pool_stored")
          ?.get(poolId);
        const maxAvailMetric: Metric | undefined = latestByMetric
          .get("ceph_pool_max_avail")
          ?.get(poolId);
        const objectsMetric: Metric | undefined = latestByMetric
          .get("ceph_pool_objects")
          ?.get(poolId);
        const readBytesMetric: Metric | undefined = latestByMetric
          .get("ceph_pool_rd_bytes")
          ?.get(poolId);
        const writeBytesMetric: Metric | undefined = latestByMetric
          .get("ceph_pool_wr_bytes")
          ?.get(poolId);

        rows.push({
          poolName: poolName,
          storedBytes:
            storedMetric && storedMetric.value !== undefined
              ? formatBytes(Number(storedMetric.value))
              : "—",
          maxAvail:
            maxAvailMetric && maxAvailMetric.value !== undefined
              ? formatBytes(Number(maxAvailMetric.value))
              : "—",
          objects:
            objectsMetric && objectsMetric.value !== undefined
              ? formatCount(Number(objectsMetric.value))
              : "—",
          readBytes:
            readBytesMetric && readBytesMetric.value !== undefined
              ? formatBytes(Number(readBytesMetric.value))
              : "—",
          writeBytes:
            writeBytesMetric && writeBytesMetric.value !== undefined
              ? formatBytes(Number(writeBytesMetric.value))
              : "—",
        });
      }

      rows.sort((a: CephPoolRow, b: CephPoolRow) => {
        return a.poolName.localeCompare(b.poolName);
      });

      setPools(rows);
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

  const tableColumns: Array<Column<CephPoolRow>> = useMemo(() => {
    return [
      {
        title: "Pool",
        type: FieldType.Text,
        key: "poolName",
      },
      {
        title: "Stored",
        type: FieldType.Text,
        key: "storedBytes",
      },
      {
        title: "Max Available",
        type: FieldType.Text,
        key: "maxAvail",
      },
      {
        title: "Objects",
        type: FieldType.Text,
        key: "objects",
      },
      {
        title: "Read (total)",
        type: FieldType.Text,
        key: "readBytes",
      },
      {
        title: "Write (total)",
        type: FieldType.Text,
        key: "writeBytes",
      },
    ];
  }, []);

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Ceph Pools"
      description="Storage pools in this Ceph cluster (last 5 minutes). Read / write totals are cumulative byte counters."
      buttons={cardButtons}
    >
      <Table<CephPoolRow>
        id="ceph-pools-table"
        columns={tableColumns}
        data={pools}
        singularLabel="Pool"
        pluralLabel="Pools"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={pools.length}
        itemsOnPage={pools.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage="No pools found in the last 5 minutes. Make sure the Ceph agent is sending metrics."
      />
    </Card>
  );
};

export default CephClusterPools;
