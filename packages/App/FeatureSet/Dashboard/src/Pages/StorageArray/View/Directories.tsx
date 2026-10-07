import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * FlashArray file services' managed directories (kind=Directory), named
 * `<file system>:<directory>` by Purity. The agent scrapes their space
 * every 30 minutes, so their values stay current for 90 minutes
 * (StorageArrayResourceUtils.getMetricStaleMs).
 */
const StorageArrayDirectories: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Directory}
      tableId="storage-array-directories-table"
      name="Storage Array Directories"
      singularName="Directory"
      pluralName="Directories"
      title="Directories"
      description="Managed directories of this FlashArray's file services, with the flash they use and their latest performance. Directory space is read every 30 minutes."
      noItemsMessage="No directories found in the inventory yet. Directories appear here once the array serves files and the Storage Array Agent has read its directories, which it does every 30 minutes."
      columns={[
        StorageArrayResourceColumns.getPhysicalColumn({
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.directorySpaceColumn,
        }),
        StorageArrayResourceColumns.getDataReductionColumn(),
        ...StorageArrayResourceColumns.getPerformanceColumns(),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ]}
    />
  );
};

export default StorageArrayDirectories;
