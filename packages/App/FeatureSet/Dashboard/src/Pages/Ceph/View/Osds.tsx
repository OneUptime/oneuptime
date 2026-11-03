import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import OneUptimeDate from "Common/Types/Date";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Route from "Common/Types/API/Route";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumnTone,
} from "../../../Components/Infrastructure/ResourceTable";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import CephResourceUtils, {
  getOsdPlacementText,
} from "../Utils/CephResourceUtils";
import {
  CephOsdReadings,
  assessCephOsd,
  getCephNewestSeenAt,
  getCephOsdReadings,
} from "../Utils/CephHealth";
import {
  CEPH_APPLY_LATENCY_ATTRIBUTE,
  CEPH_USED_PERCENT_ATTRIBUTE,
  formatCephReadingNumber,
  getCephOsdLatencyTone,
  getCephOsdUsedTone,
  readCephRowNumber,
  withCephStatus,
} from "../Utils/CephPartFacts";
import {
  CephPartRoutes,
  getCephPartRoutes,
} from "../../../Components/Ceph/Part/CephPartRoutes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";

/*
 * The OSDs list reads the CephResource Postgres inventory (kind=Osd)
 * instead of groupBy-ing ClickHouse metrics - the Kubernetes Nodes list's
 * architecture. Each row's status is the cluster's rules' (CephHealth): an
 * OSD down while still in the cluster in red, one down and out or up but
 * out in amber, a running one in amber past Ceph's nearfull ratio or the
 * OSD High Latency alert's 100 ms and in red past the full ratio - with
 * why under it, as the Overview's Needs attention says it. The detail route
 * param is the OSD's externalId (its `ceph_daemon` name, osd.3).
 */
const CephClusterOsds: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();
  const routes: CephPartRoutes = getCephPartRoutes(modelId);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const rows: Array<CephResourceModel> =
        await CephResourceUtils.fetchCephResources({
          cephClusterId: modelId,
          kinds: ["Osd"],
        });
      const now: Date = OneUptimeDate.getCurrentDate();
      const newestSeenAt: Date | null = getCephNewestSeenAt(rows);

      rows.sort((a: CephResourceModel, b: CephResourceModel) => {
        return CephResourceUtils.compareDaemonNames(
          a.externalId || "",
          b.externalId || "",
        );
      });

      const list: Array<InfrastructureResource> = rows.map(
        (row: CephResourceModel): InfrastructureResource => {
          const readings: CephOsdReadings = getCephOsdReadings(row, now);

          return withCephStatus(
            {
              name: row.externalId || "",
              namespace: row.hostname || "",
              cpuUtilization: null,
              memoryUsageBytes: null,
              memoryLimitBytes: null,
              status: "",
              age: CephResourceUtils.formatAge(row.createdAt),
              additionalAttributes: {
                in: getOsdPlacementText(row.isIn),
                deviceClass: row.deviceClass || "—",
                used:
                  readings.usedPercent !== null
                    ? `${CephResourceUtils.formatBytes(readings.usedBytes)} / ${CephResourceUtils.formatBytes(readings.totalBytes)} (${readings.usedPercent.toFixed(1)}%)`
                    : "—",
                pgs:
                  readings.pgCount !== null
                    ? Math.round(readings.pgCount).toString()
                    : "—",
                latency:
                  readings.applyLatencyMs !== null ||
                  readings.commitLatencyMs !== null
                    ? `${readings.applyLatencyMs !== null ? readings.applyLatencyMs.toFixed(0) : "—"} / ${readings.commitLatencyMs !== null ? readings.commitLatencyMs.toFixed(0) : "—"} ms`
                    : "—",
                [CEPH_USED_PERCENT_ATTRIBUTE]: formatCephReadingNumber(
                  readings.usedPercent,
                ),
                [CEPH_APPLY_LATENCY_ATTRIBUTE]: formatCephReadingNumber(
                  readings.applyLatencyMs,
                ),
              },
            },
            assessCephOsd(row, { now: now, newestSeenAt: newestSeenAt }),
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
      title="OSDs"
      description="Object storage daemons in this cluster: whether each is up and in, how full it is and how fast it writes."
      resources={resources}
      tableIdPrefix="ceph"
      groupColumnTitle="Host"
      /*
       * No Age column, as the Pools and Daemons lists have none: Ceph sends
       * no OSD's age, so it could only say when OneUptime first saw the OSD
       * - and it pushed the list past its card at 1280 beside the side
       * menu, the latency header cut under the View column.
       */
      showAge={false}
      showResourceMetrics={false}
      builtInColumnDescriptions={{
        status: CEPH_METRIC_DESCRIPTIONS.osdStatusColumn,
      }}
      columns={[
        {
          title: "In / Out",
          key: "in",
          description: CEPH_METRIC_DESCRIPTIONS.osdInOutColumn,
          // The OSD's placement, in the reader's words when it is drawn.
          getValue: (resource: InfrastructureResource): string => {
            return (
              translator.translateText(resource.additionalAttributes["in"]) ||
              ""
            );
          },
        },
        { title: "Class", key: "deviceClass" },
        {
          title: "Used / Total",
          key: "used",
          description: CEPH_METRIC_DESCRIPTIONS.osdUsedColumn,
          getTone: (
            resource: InfrastructureResource,
          ): ResourceColumnTone | undefined => {
            return getCephOsdUsedTone(
              readCephRowNumber(resource, CEPH_USED_PERCENT_ATTRIBUTE),
            );
          },
        },
        {
          title: "PGs",
          key: "pgs",
          description: CEPH_METRIC_DESCRIPTIONS.osdPgsColumn,
        },
        {
          title: "Apply / Commit Latency",
          key: "latency",
          description: CEPH_METRIC_DESCRIPTIONS.osdLatencyColumn,
          getTone: (
            resource: InfrastructureResource,
          ): ResourceColumnTone | undefined => {
            return getCephOsdLatencyTone(
              readCephRowNumber(resource, CEPH_APPLY_LATENCY_ATTRIBUTE),
            );
          },
        },
      ]}
      emptyMessage="No OSDs found in the inventory yet. OSDs appear here a few minutes after the Ceph agent starts sending metrics."
      getViewRoute={(resource: InfrastructureResource): Route => {
        return routes.getPartRoute("Osd", resource.name);
      }}
    />
  );
};

export default CephClusterOsds;
