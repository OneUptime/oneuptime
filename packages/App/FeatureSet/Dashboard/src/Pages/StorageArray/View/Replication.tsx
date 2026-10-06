import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceStatusBadge from "../../../Components/StorageArray/StorageArrayResourceStatusBadge";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * FlashArray pods (kind=Pod) — the unit of ActiveCluster and ActiveDR
 * replication. A pod's lag and link status come from its worst replica
 * link (purefa_pod_replica_links_lag_max_msec), its mediator status from
 * purefa_pod_mediator_status (ingest keeps any status other than online
 * that one of the pod's arrays reports).
 */

function textCell(text: string): ReactElement {
  if (!text) {
    return <span className="text-gray-400">—</span>;
  }
  return <span className="text-sm text-gray-700">{text}</span>;
}

const StorageArrayReplication: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Pod}
      tableId="storage-array-replication-table"
      name="Storage Array Pods"
      singularName="Pod"
      pluralName="Pods"
      title="Replication"
      description="Pods on this FlashArray and their replica links: how far each remote copy is behind, the link's status, and whether stretched pods reach their mediator."
      noItemsMessage="No pods found in the inventory yet. Pods appear here a few minutes after the Storage Array Agent starts scraping the array, if the array has any."
      columns={[
        StorageArrayResourceColumns.getStatusColumn({
          title: "Link Status",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.podLinkStatusColumn,
        }),
        {
          field: {
            replicationLagMs: true,
          },
          title: "Replication Lag",
          headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.podLagColumn,
          type: FieldType.Element,
          getElement: (item: StorageArrayResource): ReactElement => {
            const lag: number | null =
              StorageArrayResourceUtils.freshMetricValue(
                item,
                item.replicationLagMs,
              );
            if (lag === null) {
              return textCell("");
            }
            return textCell(StorageArrayResourceUtils.formatDurationMs(lag));
          },
        },
        {
          field: {
            details: true,
          },
          id: "average-lag",
          title: "Average Lag",
          headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.podAverageLagColumn,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            const averageLag: number | null =
              StorageArrayResourceUtils.getDetailNumber(item, "averageLagMs");
            return textCell(
              averageLag === null
                ? ""
                : StorageArrayResourceUtils.formatDurationMs(averageLag),
            );
          },
        },
        {
          field: {
            details: true,
          },
          id: "remote",
          title: "Remote",
          headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.podRemoteColumn,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            return textCell(
              [
                StorageArrayResourceUtils.getDetailString(item, "remote"),
                StorageArrayResourceUtils.getDetailString(item, "remotePod"),
              ]
                .filter(Boolean)
                .join(" / "),
            );
          },
        },
        {
          field: {
            details: true,
          },
          id: "direction",
          title: "Direction",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            return textCell(
              StorageArrayResourceUtils.formatStatusLabel(
                StorageArrayResourceUtils.getDetailString(item, "direction"),
              ),
            );
          },
        },
        {
          field: {
            details: true,
          },
          id: "mediator",
          title: "Mediator",
          headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.podMediatorColumn,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            return (
              <StorageArrayResourceStatusBadge
                status={StorageArrayResourceUtils.getDetailString(
                  item,
                  "mediatorStatus",
                )}
              />
            );
          },
        },
        StorageArrayResourceColumns.getPhysicalColumn(),
        ...StorageArrayResourceColumns.getLatencyColumns(),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ]}
    />
  );
};

export default StorageArrayReplication;
