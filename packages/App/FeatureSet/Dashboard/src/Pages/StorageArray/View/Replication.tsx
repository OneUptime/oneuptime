import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { StorageArrayKindPage } from "Common/Types/StorageArray/StorageArrayPlatform";
import {
  StorageArrayPlatformState,
  getKindPageFor,
  useStorageArrayPlatform,
} from "../Utils/UseStorageArrayPlatform";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceStatusBadge from "../../../Components/StorageArray/StorageArrayResourceStatusBadge";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import { STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS } from "../Utils/StorageArrayHealth";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";

/*
 * FlashArray pods (kind=Pod) — the unit of ActiveCluster and ActiveDR
 * replication. A pod's lag and link status come from its worst replica
 * link (its replica links' maximum lag), its mediator status from its
 * mediator series (ingest keeps any status other than online
 * that one of the pod's arrays reports).
 */

function textCell(text: string): ReactElement {
  if (!text) {
    return <TableEmptyValue />;
  }
  return <span className="text-sm text-gray-700">{text}</span>;
}


// What the list says on a platform that says nothing of the kind.
const PODS_DESCRIPTION: string = translationKey(
  "What this array replicates and to where: how far each remote copy is behind, and the status of its link.",
);
const PODS_NO_ITEMS: string = translationKey(
  "Nothing replicated in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the array, if the array replicates anything.",
);

const StorageArrayReplication: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const platform: StorageArrayPlatformState = useStorageArrayPlatform(modelId);

  if (platform.isLoading) {
    return <PageSkeleton shape="table" />;
  }

  const kindPage: StorageArrayKindPage | null = getKindPageFor(
    platform.storageSystem,
    StorageArrayResourceKind.Pod,
  );

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Pod}
      tableId="storage-array-replication-table"
      name="Storage Array Pods"
      singularName="Pod"
      pluralName="Pods"
      title="Replication"
      description={kindPage?.description || PODS_DESCRIPTION}
      noItemsMessage={kindPage?.noItemsMessage || PODS_NO_ITEMS}
      columns={[
        // By the rules: a link more than a minute behind is amber, with why.
        StorageArrayResourceColumns.getRulesStatusColumn({
          title: "Link Status",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.podLinkStatusColumn,
          field: "status",
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
            // Past the Replication Lag Above 1 Minute alert's line.
            if (lag > STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS) {
              return (
                <span
                  data-tone="warning"
                  className="text-sm font-medium text-amber-700"
                >
                  {getValueOrQuietDash(
                    StorageArrayResourceUtils.formatDurationMs(lag),
                  )}
                </span>
              );
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
