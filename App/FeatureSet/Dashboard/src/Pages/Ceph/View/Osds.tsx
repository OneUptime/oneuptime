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

interface CephOsdRow {
  osdName: string;
  isUp: boolean;
  upStatus: string;
  isIn: boolean;
  inStatus: string;
}

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";
const OSD_ATTR: string = "ceph_daemon";

const CephClusterOsds: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [osds, setOsds] = useState<Array<CephOsdRow>>([]);
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

      const metricNames: Array<string> = ["ceph_osd_up", "ceph_osd_in"];

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
       * For each metric, take the latest value per OSD. The ceph-mgr
       * prometheus module keeps OSD identity in the `ceph_daemon`
       * datapoint label (`osd.3`).
       */
      const latestByMetric: Map<string, Map<string, Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        const perOsd: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> = results[idx]!;
        for (const metric of listResult.data) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const osd: string = (attrs[OSD_ATTR] as string) || "";
          if (!osd) {
            continue;
          }
          if (!perOsd.has(osd)) {
            perOsd.set(osd, metric);
          }
        }
        latestByMetric.set(name, perOsd);
      });

      // Collect union of OSD names.
      const osdNames: Set<string> = new Set();
      for (const perOsd of latestByMetric.values()) {
        for (const name of perOsd.keys()) {
          osdNames.add(name);
        }
      }

      const rows: Array<CephOsdRow> = [];
      for (const osdName of osdNames) {
        const upMetric: Metric | undefined = latestByMetric
          .get("ceph_osd_up")
          ?.get(osdName);
        const inMetric: Metric | undefined = latestByMetric
          .get("ceph_osd_in")
          ?.get(osdName);

        const isUp: boolean =
          upMetric !== undefined && Number(upMetric.value) >= 1;
        const isIn: boolean =
          inMetric !== undefined && Number(inMetric.value) >= 1;

        rows.push({
          osdName: osdName,
          isUp: isUp,
          upStatus: isUp ? "Up" : "Down",
          isIn: isIn,
          inStatus: isIn ? "In" : "Out",
        });
      }

      /*
       * Sort numerically by OSD id (`osd.10` after `osd.9`) with a
       * lexicographic fallback for unexpected daemon names.
       */
      rows.sort((a: CephOsdRow, b: CephOsdRow) => {
        const aNum: number = Number(a.osdName.split(".").pop());
        const bNum: number = Number(b.osdName.split(".").pop());
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
          return aNum - bNum;
        }
        return a.osdName.localeCompare(b.osdName);
      });

      setOsds(rows);
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

  const tableColumns: Array<Column<CephOsdRow>> = useMemo(() => {
    return [
      {
        title: "OSD",
        type: FieldType.Text,
        key: "osdName",
      },
      {
        title: "Up / Down",
        type: FieldType.Element,
        key: "upStatus",
        getElement: (row: CephOsdRow): ReactElement => {
          return (
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  row.isUp ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  row.isUp ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {row.upStatus}
              </span>
            </div>
          );
        },
      },
      {
        title: "In / Out",
        type: FieldType.Element,
        key: "inStatus",
        getElement: (row: CephOsdRow): ReactElement => {
          return (
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  row.isIn ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  row.isIn ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {row.inStatus}
              </span>
            </div>
          );
        },
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
      title="Ceph OSDs"
      description="Object storage daemons in this Ceph cluster (last 5 minutes). Up means the daemon is running; In means it participates in data placement."
      buttons={cardButtons}
    >
      <Table<CephOsdRow>
        id="ceph-osds-table"
        columns={tableColumns}
        data={osds}
        singularLabel="OSD"
        pluralLabel="OSDs"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={osds.length}
        itemsOnPage={osds.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage="No OSDs found in the last 5 minutes. Make sure the Ceph agent is sending metrics."
      />
    </Card>
  );
};

export default CephClusterOsds;
