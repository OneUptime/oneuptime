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
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  OpenStackColumn.Status,
  OpenStackColumn.Project,
  OpenStackColumn.Hypervisor,
  OpenStackColumn.Region,
  getOpenStackFactColumn({
    id: "flavor",
    title: "Flavor",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "flavorId");
    },
  }),
  getOpenStackFactColumn({
    id: "address",
    title: "Address",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return (
        getOpenStackFactText(row, "addressIpv4") ||
        getOpenStackFactText(row, "addressIpv6")
      );
    },
  }),
];

const FILTERS: Array<OpenStackFilter> = [
  OpenStackFilter.Status,
  OpenStackFilter.Region,
  OpenStackFilter.Project,
  OpenStackFilter.Hypervisor,
];

const OpenStackCloudInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Instance}
      tableId="openstack-instances-table"
      title="Instances"
      description="Every instance in this cloud, its status in Nova's own words, whose it is and where it runs."
      singularName="instance"
      pluralName="instances"
      emptyTitle="No instances reported yet"
      emptyDescription="These come from Nova. Only the Full view credential sees every project's. With Infrastructure only or Project view, only the projects it has a role on are listed."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudInstances;
