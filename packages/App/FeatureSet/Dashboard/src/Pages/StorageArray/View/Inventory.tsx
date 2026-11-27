import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayInventoryColumns,
  StorageArrayKindDefinition,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Column from "Common/UI/Components/ModelTable/Column";
import {
  StorageUsage,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import { STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS } from "../Utils/StorageArrayHealth";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";

/*
 * The inventory of a kind a platform has of its own (#11000) - a NetApp
 * array's aggregates or SVMs, say - which no page of its own lists: the
 * kind is the route's last segment, and its words are its platform's
 * (StorageArrayPlatform.kindDefinitions). Every object of every kind has
 * the same columns (StorageArrayResource), so the table shows what any of
 * them can report: its status, size, data reduction, latest performance
 * and when it was last seen - or, when its platform says what its objects
 * report (StorageArrayKindDefinition.inventoryColumns), only those, each
 * under the kind's own words. A kind that earns a page of its own (as
 * volumes and hosts have) gets one; this is where it starts.
 */

const USAGE_NOT_REPORTED: string = translationKey("Not reported");

// What an object of a kind no platform describes may report: everything.
const EVERY_COLUMN: StorageArrayInventoryColumns = {
  status: true,
  capacity: true,
  used: "bytes",
  dataReduction: true,
  performance: "all",
};

/*
 * How full an object is, as the shared bar reads it: what of its size is
 * used, amber and red at the array's capacity lines. Null without both.
 */
export function getInventoryUsage(
  item: StorageArrayResource,
): StorageUsage | null {
  const capacity: number | null = StorageArrayResourceUtils.freshMetricValue(
    item,
    item.capacityBytes,
  );
  const used: number | null = StorageArrayResourceUtils.freshMetricValue(
    item,
    item.usedBytes,
  );
  if (capacity === null || capacity <= 0 || used === null) {
    return null;
  }
  return getStorageUsage(
    { capacity: capacity, used: used },
    STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS,
  );
}

function hiddenAtFirst(
  columns: Columns<StorageArrayResource>,
): Columns<StorageArrayResource> {
  return columns.map(
    (column: Column<StorageArrayResource>): Column<StorageArrayResource> => {
      return { ...column, isHiddenByDefault: true };
    },
  );
}

function getUsedColumns(
  shown: StorageArrayInventoryColumns,
): Columns<StorageArrayResource> {
  if (shown.used === "bar") {
    return [
      StorageArrayResourceColumns.getUsageColumn({
        title: shown.usedTitle || "Used",
        description:
          shown.usedDescription ||
          STORAGE_ARRAY_METRIC_DESCRIPTIONS.physicalColumn,
        getUsage: getInventoryUsage,
        getNoUsageText: (): string => {
          return USAGE_NOT_REPORTED;
        },
      }),
    ];
  }
  if (shown.used === "bytes") {
    return [
      StorageArrayResourceColumns.getPhysicalColumn({
        title: shown.usedTitle,
        description: shown.usedDescription,
      }),
    ];
  }
  return [];
}

function getPerformanceColumns(
  shown: StorageArrayInventoryColumns,
): Columns<StorageArrayResource> {
  if (shown.performance === "all") {
    return StorageArrayResourceColumns.getPerformanceColumns();
  }
  if (shown.performance === "latency") {
    return [
      ...StorageArrayResourceColumns.getLatencyColumns(),
      ...hiddenAtFirst([
        ...StorageArrayResourceColumns.getIopsColumns(),
        ...StorageArrayResourceColumns.getBandwidthColumns(),
      ]),
    ];
  }
  return [];
}

export function getInventoryColumns(
  definition: StorageArrayKindDefinition | null,
): Columns<StorageArrayResource> {
  const shown: StorageArrayInventoryColumns =
    definition?.inventoryColumns || EVERY_COLUMN;
  const capacity: Columns<StorageArrayResource> = shown.capacity
    ? [
        StorageArrayResourceColumns.getProvisionedColumn({
          title: shown.capacityTitle,
          description: shown.capacityDescription,
        }),
      ]
    : [];
  const used: Columns<StorageArrayResource> = getUsedColumns(shown);
  return [
    ...(shown.idTitle
      ? [
          StorageArrayResourceColumns.getTextColumn({
            field: "externalId",
            title: shown.idTitle,
          }),
        ]
      : []),
    ...(shown.status
      ? [StorageArrayResourceColumns.getStatusColumn({ title: "Status" })]
      : []),
    // How full it is first, as the file systems and buckets show it.
    ...(shown.used === "bar" ? [...used, ...capacity] : [...capacity, ...used]),
    ...(shown.dataReduction
      ? [StorageArrayResourceColumns.getDataReductionColumn()]
      : []),
    ...getPerformanceColumns(shown),
    StorageArrayResourceColumns.getLastSeenColumn(),
  ];
}

const StorageArrayInventory: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const kind: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(kind);
  const pluralName: string = StorageArrayResourceKindUtil.getPluralLabel(kind);

  return (
    <StorageArrayResourceTable
      key={kind}
      storageArrayId={modelId}
      kind={kind as StorageArrayResourceKind}
      tableId={`storage-array-inventory-${kind.toLowerCase()}-table`}
      name={pluralName}
      singularName={StorageArrayResourceKindUtil.getSingularLabel(kind)}
      pluralName={pluralName}
      title={pluralName}
      description={definition?.description || ""}
      noItemsMessage={definition?.noItemsMessage || "Nothing here yet."}
      columns={getInventoryColumns(definition)}
    />
  );
};

export default StorageArrayInventory;
