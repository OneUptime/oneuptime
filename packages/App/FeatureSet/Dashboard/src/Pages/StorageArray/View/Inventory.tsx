import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayInventoryColumns,
  StorageArrayKindDefinition,
  StorageArrayKindPage,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Column from "Common/UI/Components/ModelTable/Column";
import {
  StorageUsage,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import { STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS } from "../Utils/StorageArrayHealth";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import { getStorageArrayKindColumns } from "../../../Components/StorageArray/StorageArrayKindView";
import { getStorageArrayInventoryPartRoute } from "../../../Components/StorageArray/Part/StorageArrayPartRoutes";
import StorageArrayResourceUtils, {
  INVENTORY_SELECT,
} from "../Utils/StorageArrayResourceUtils";
import {
  StorageArrayPlatformState,
  getKindPageFor,
  useStorageArrayPlatform,
} from "../Utils/UseStorageArrayPlatform";

/*
 * The inventory of a kind a platform has of its own (#11000) - a NetApp
 * cluster's aggregates, SVMs, LUNs or SnapMirror relationships - which no
 * page of its own lists: the kind is the route's last segment, and its
 * words are its platform's (StorageArrayPlatform.kindDefinitions).
 *
 * A platform that draws the kind itself (StorageArrayPlatform.kindPages,
 * #11122) chooses its columns - an aggregate's node and how full it is, a
 * relationship's lag behind its schedule - and, when it charts the kind's
 * parts, each name opens the part's own page (InventoryPart). A platform
 * that only says what its objects report (StorageArrayKindDefinition.
 * inventoryColumns, as a PowerStore does) shows those, each under the
 * kind's own words. Any other kind shows what every object can report:
 * its status, size, data reduction, latest performance and when it was
 * last seen.
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


const NOTHING_HERE_YET: string = translationKey("Nothing here yet.");

const StorageArrayInventory: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const kind: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const platform: StorageArrayPlatformState = useStorageArrayPlatform(modelId);

  if (platform.isLoading) {
    return <PageSkeleton shape="table" />;
  }

  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(
      kind,
      platform.storageSystem,
    );
  const page: StorageArrayKindPage | null = getKindPageFor(
    platform.storageSystem,
    kind,
  );
  const pluralName: string =
    definition?.pluralLabel ||
    StorageArrayResourceKindUtil.getPluralLabel(kind);
  const singularName: string =
    definition?.singularLabel ||
    StorageArrayResourceKindUtil.getSingularLabel(kind);

  return (
    <StorageArrayResourceTable
      key={kind}
      storageArrayId={modelId}
      kind={kind}
      tableId={`storage-array-inventory-${kind.toLowerCase()}-table`}
      name={pluralName}
      singularName={singularName}
      pluralName={pluralName}
      title={pluralName}
      description={page?.description || definition?.description || ""}
      noItemsMessage={
        page?.noItemsMessage || definition?.noItemsMessage || NOTHING_HERE_YET
      }
      // What the platform's columns read is any of the row's values.
      {...(page?.columns
        ? {
            selectMoreFields: INVENTORY_SELECT as Select<StorageArrayResource>,
          }
        : {})}
      {...(page?.part
        ? {
            getDetailRoute: (item: StorageArrayResource): Route => {
              return getStorageArrayInventoryPartRoute({
                storageArrayId: modelId,
                kind: kind,
                externalId: item.externalId || "",
              });
            },
          }
        : {})}
      columns={
        page?.columns
          ? getStorageArrayKindColumns(page.columns)
          : getInventoryColumns(definition)
      }
    />
  );
};

export default StorageArrayInventory;
