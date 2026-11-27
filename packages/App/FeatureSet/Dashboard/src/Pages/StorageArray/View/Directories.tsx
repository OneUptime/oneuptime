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

// What the list says on a platform that says nothing of the kind.
const DIRECTORIES_DESCRIPTION: string = translationKey(
  "Managed directories of this array's file services, with the space they use and their latest performance.",
);
const DIRECTORIES_NO_ITEMS: string = translationKey(
  "No directories yet. They appear once the array serves files and the agent reads them.",
);

const StorageArrayDirectories: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const platform: StorageArrayPlatformState = useStorageArrayPlatform(modelId);

  if (platform.isLoading) {
    return <PageSkeleton shape="table" />;
  }

  const kindPage: StorageArrayKindPage | null = getKindPageFor(
    platform.storageSystem,
    StorageArrayResourceKind.Directory,
  );

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Directory}
      tableId="storage-array-directories-table"
      name="Storage Array Directories"
      singularName="Directory"
      pluralName="Directories"
      title="Directories"
      description={kindPage?.description || DIRECTORIES_DESCRIPTION}
      noItemsMessage={kindPage?.noItemsMessage || DIRECTORIES_NO_ITEMS}
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
