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
    id: "visibility",
    title: "Visibility",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "visibility");
    },
  }),
  getOpenStackFactColumn({
    id: "image-type",
    title: "Type",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "imageType");
    },
  }),
  OpenStackColumn.Project,
  OpenStackColumn.Region,
];

const FILTERS: Array<OpenStackFilter> = [
  OpenStackFilter.Status,
  OpenStackFilter.Region,
  OpenStackFilter.Project,
];

const OpenStackCloudImages: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Image}
      tableId="openstack-images-table"
      title="Images"
      description="The Glance images instances boot from, and who can use each one."
      singularName="image"
      pluralName="images"
      emptyTitle="No images reported yet"
      emptyDescription="These come from Glance. A credential lists the public images and its own project's, so check that the agent is running and can read the Image API."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudImages;
