import PageComponentProps from "../../PageComponentProps";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Route from "Common/Types/API/Route";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumnTone,
} from "../../../Components/Infrastructure/ResourceTable";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
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
  formatCephReadingNumber,
  getCephOsdLatencyTone,
  getCephOsdStorageUsage,
  readCephRowNumber,
  withCephStatus,
} from "../Utils/CephPartFacts";
import {
  CephPartRoutes,
  getCephPartRoutes,
} from "../../../Components/Ceph/Part/CephPartRoutes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";
import { formatMilliseconds } from "../../../Utils/Milliseconds";

/*
 * What an OSD's Used cell says when it sent no size in the last 15 minutes:
 * in words, never an empty bar or a 0% it never measured.
 */
const OSD_USAGE_NOT_REPORTED: string = translationKey("Not reported");

/*
 * An OSD's apply or commit latency, whole, in the reader's words ("12 ms",
 * "۱۲ میلی‌ثانیه"; issue #7418), or a dash when it did not report one.
 */
export const formatOsdLatency: (
  milliseconds: number | null,
  translator: Translator,
) => string = (milliseconds: number | null, translator: Translator): string => {
  return milliseconds === null
    ? EMPTY_VALUE_MARK
    : formatMilliseconds(translator, milliseconds, {
        maximumFractionDigits: 0,
      });
};

/*
 * The OSDs list reads the CephResource Postgres inventory (kind=Osd)
 * instead of groupBy-ing ClickHouse metrics - the Kubernetes Nodes list's
 * architecture. Each row's status is the cluster's rules' (CephHealth): an
 * OSD down while still in the cluster in red, one down and out or up but
 * out in amber, a running one in amber past Ceph's nearfull ratio or the
 * OSD High Latency alert's 100 ms and in red past the full ratio - with
 * why under it, as the Overview's Needs attention says it. How full its
 * disk is reads in the shared Used and Free columns (#9646), amber and red
 * at the same two ratios, so the fullest OSD is a click away; its size
 * folds under them as Capacity. The detail route param is the OSD's
 * externalId (its `ceph_daemon` name, osd.3).
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
                deviceClass: row.deviceClass || EMPTY_VALUE_MARK,
                capacity:
                  readings.totalBytes !== null && readings.totalBytes > 0
                    ? formatStorageBytes(
                        readings.totalBytes,
                        translator.language,
                      )
                    : EMPTY_VALUE_MARK,
                pgs:
                  readings.pgCount !== null
                    ? Math.round(readings.pgCount).toString()
                    : EMPTY_VALUE_MARK,
                latency:
                  readings.applyLatencyMs !== null ||
                  readings.commitLatencyMs !== null
                    ? `${formatOsdLatency(readings.applyLatencyMs, translator)} / ${formatOsdLatency(readings.commitLatencyMs, translator)}`
                    : EMPTY_VALUE_MARK,
                [CEPH_APPLY_LATENCY_ATTRIBUTE]: formatCephReadingNumber(
                  readings.applyLatencyMs,
                ),
              },
              // Its disk, as the Used and Free columns draw it.
              storageUsage: {
                usage: getCephOsdStorageUsage(readings),
                noUsageText: OSD_USAGE_NOT_REPORTED,
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
    return <PageSkeleton shape="table" />;
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
      storageUsageColumns={{
        usedDescription: CEPH_METRIC_DESCRIPTIONS.osdUsedColumn,
        freeDescription: CEPH_METRIC_DESCRIPTIONS.osdFreeColumn,
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
          // The disk's size, under its Used and Free when room is short.
          title: "Capacity",
          key: "capacity",
          foldInto: "storageUsage",
          showTitleWhenFolded: true,
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
      emptyMessage="No OSDs in the inventory yet. OSDs appear here a few minutes after the Ceph agent starts sending metrics."
      getViewRoute={(resource: InfrastructureResource): Route => {
        return routes.getPartRoute("Osd", resource.name);
      }}
    />
  );
};

export default CephClusterOsds;
