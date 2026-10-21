import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils, {
  getFileSystemProtocols,
  getFileSystemProvisionedBytes,
} from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * FlashBlade file systems (kind=FileSystem), from
 * purefb_file_systems_space_bytes / _performance_* via the inventory.
 */
const StorageArrayFileSystems: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.FileSystem}
      tableId="storage-array-file-systems-table"
      name="Storage Array File Systems"
      singularName="File System"
      pluralName="File Systems"
      title="File Systems"
      description="File systems on this FlashBlade with the protocols they are shared over, their size, the flash they use and their latest performance."
      noItemsMessage="No file systems found in the inventory yet. File systems appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade."
      getDetailRoute={(item: StorageArrayResource): Route => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: StorageArrayResourceUtils.routeParamFromExternalId(
              item.externalId || "",
            ),
          },
        );
      }}
      columns={[
        {
          field: {
            details: true,
          },
          id: "protocols",
          title: "Protocols",
          headerTooltip:
            STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemProtocolsColumn,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            const protocols: string = getFileSystemProtocols(item).join(", ");
            if (!protocols) {
              return <span className="text-gray-400">—</span>;
            }
            return <span className="text-sm text-gray-700">{protocols}</span>;
          },
        },
        {
          field: {
            capacityBytes: true,
          },
          title: "Provisioned",
          headerTooltip:
            STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemProvisionedColumn,
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            const provisioned: number | null =
              getFileSystemProvisionedBytes(item);
            if (provisioned === null) {
              return <span className="text-gray-400">—</span>;
            }
            return (
              <span className="text-sm text-gray-700">
                {StorageArrayResourceUtils.formatBytes(provisioned)}
              </span>
            );
          },
        },
        StorageArrayResourceColumns.getPhysicalColumn(),
        StorageArrayResourceColumns.getDataReductionColumn(),
        ...StorageArrayResourceColumns.getPerformanceColumns(),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ]}
    />
  );
};

export default StorageArrayFileSystems;
