import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { loadFileSystemAvailableRatios } from "../Utils/StorageArrayReadings";
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
import { getStorageArrayFileSystemUsage } from "../Utils/StorageArrayHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

// Until the FlashBlade's available share of a file system arrives.
const FILE_SYSTEM_USAGE_NOT_REPORTED: string = translationKey("Not reported");
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";

/*
 * FlashBlade file systems (kind=FileSystem), from
 * purefb_file_systems_space_bytes / _performance_* via the inventory.
 */
const StorageArrayFileSystems: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * Each file system's latest available share of its provisioned size (the
   * File System Near Full alert's series), which the inventory has no
   * column for: best-effort, a file system reads Available without it.
   */
  const [availableRatios, setAvailableRatios] = useState<Map<string, number>>(
    new Map(),
  );

  useEffect(() => {
    let ignore: boolean = false;
    ModelAPI.getItem<StorageArray>({
      modelType: StorageArray,
      id: modelId,
      select: { name: true },
    })
      .then((item: StorageArray | null): Promise<Map<string, number>> => {
        return item?.name
          ? loadFileSystemAvailableRatios(item.name)
          : Promise.resolve(new Map<string, number>());
      })
      .then((ratios: Map<string, number>): void => {
        if (!ignore) {
          setAvailableRatios(ratios);
        }
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [modelId.toString()]);

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
      noItemsMessage="No file systems in the inventory yet. File systems appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade."
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
        // By the rules: Near full in amber past 90% used, with why.
        StorageArrayResourceColumns.getRulesStatusColumn({
          title: "Status",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemStatusColumn,
          field: "usedBytes",
          disableSort: true,
          readingsFor: (item: StorageArrayResource) => {
            return {
              availableRatio: availableRatios.get(item.name || "") ?? null,
            };
          },
        }),
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
              return <TableEmptyValue />;
            }
            return <span className="text-sm text-gray-700">{protocols}</span>;
          },
        },
        /*
         * How full it is, with the shared bar (#9647): its provisioned size
         * and the available share the File System Near Full alert reads.
         */
        StorageArrayResourceColumns.getUsageColumn({
          title: "Used",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemUsedColumn,
          getUsage: (item: StorageArrayResource) => {
            return getStorageArrayFileSystemUsage({
              provisionedBytes: getFileSystemProvisionedBytes(item),
              availableRatio: availableRatios.get(item.name || "") ?? null,
            });
          },
          getNoUsageText: (): string => {
            return FILE_SYSTEM_USAGE_NOT_REPORTED;
          },
        }),
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
              return <TableEmptyValue />;
            }
            return (
              <span className="text-sm text-gray-700">
                {getValueOrQuietDash(
                  StorageArrayResourceUtils.formatBytes(provisioned),
                )}
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
