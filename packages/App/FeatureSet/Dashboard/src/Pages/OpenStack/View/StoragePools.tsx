import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  formatOpenStackBytes,
  getOpenStackAmountColumn,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import {
  getOpenStackFactNumber,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  getOpenStackAmountColumn({
    title: "Used",
    field: "diskAllocatedBytes",
    capacityField: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "free",
    title: "Free",
    getText: (row: OpenStackResource): string => {
      const free: number | null = getOpenStackFactNumber(row, "freeBytes");
      return free === null ? "" : formatOpenStackBytes(free);
    },
  }),
  getOpenStackFactColumn({
    id: "backend",
    title: "Backend",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "backend");
    },
  }),
  getOpenStackFactColumn({
    id: "vendor",
    title: "Vendor",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "vendor");
    },
  }),
  OpenStackColumn.Region,
];

const FILTERS: Array<OpenStackFilter> = [OpenStackFilter.Region];

const OpenStackCloudStoragePools: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.StoragePool}
      tableId="openstack-storage-pools-table"
      title="Storage Pools"
      description="Cinder's storage pools, and how much of each is used, as the pools report it."
      singularName="storage pool"
      pluralName="storage pools"
      emptyTitle="No storage pools reported yet"
      emptyDescription="These come from Cinder's scheduler, which takes the Full view or Infrastructure only credential. A Project view credential can't list storage pools."
      nameTitle="Pool"
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search storage pools"
    />
  );
};

export default OpenStackCloudStoragePools;
