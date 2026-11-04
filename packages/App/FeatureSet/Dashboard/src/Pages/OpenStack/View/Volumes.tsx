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
  getOpenStackFactColumn,
  getOpenStackSizeColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  OpenStackColumn.Status,
  getOpenStackSizeColumn({
    title: "Size",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "volume-type",
    title: "Type",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "volumeType");
    },
  }),
  getOpenStackFactColumn({
    id: "attached-to",
    title: "Attached To",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "attachedToInstance");
    },
  }),
  OpenStackColumn.Project,
  OpenStackColumn.Region,
  OpenStackColumn.AvailabilityZone,
];

const FILTERS: Array<OpenStackFilter> = [
  OpenStackFilter.Status,
  OpenStackFilter.Region,
  OpenStackFilter.Project,
];

const OpenStackCloudVolumes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Volume}
      tableId="openstack-volumes-table"
      title="Volumes"
      description="Every Cinder volume in this cloud, its status in Cinder's own words, and whose it is."
      singularName="volume"
      pluralName="volumes"
      emptyTitle="No volumes reported yet"
      emptyDescription="These come from Cinder. Only the Full view credential sees every project's: Cinder answers any other with its own project, and no error."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudVolumes;
