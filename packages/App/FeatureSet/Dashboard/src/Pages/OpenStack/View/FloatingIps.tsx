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
  getOpenStackFactColumn({
    id: "fixed-address",
    title: "Fixed Address",
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "fixedIp");
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

const OpenStackCloudFloatingIps: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.FloatingIp}
      tableId="openstack-floating-ips-table"
      title="Floating IPs"
      description="Every floating IP in this cloud. Neutron says DOWN for one with nothing behind it, which is an address waiting to be used."
      singularName="floating IP"
      pluralName="floating IPs"
      emptyTitle="No floating IPs reported yet"
      emptyDescription="These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error."
      nameTitle="Address"
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by address or ID"
    />
  );
};

export default OpenStackCloudFloatingIps;
