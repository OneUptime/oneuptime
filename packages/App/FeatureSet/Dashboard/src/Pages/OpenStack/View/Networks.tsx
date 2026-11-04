import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import Navigation from "Common/UI/Utils/Navigation";
import { translateText } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  formatOpenStackAmount,
  formatOpenStackCount,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import {
  getOpenStackFact,
  getOpenStackFactNumber,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "addresses-used",
    title: "Addresses Used",
    getText: (row: OpenStackResource): string => {
      return formatOpenStackAmount({
        taken: getOpenStackFactNumber(row, "ipsUsed"),
        capacity: getOpenStackFactNumber(row, "ipsTotal"),
        format: formatOpenStackCount,
      });
    },
  }),
  getOpenStackFactColumn({
    id: "network-type",
    title: "Type",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "networkType");
    },
  }),
  getOpenStackFactColumn({
    id: "network-scope",
    title: "Scope",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      if (getOpenStackFact(row, "isExternal") === true) {
        return translateText("External") || "External";
      }
      if (getOpenStackFact(row, "isShared") === true) {
        return translateText("Shared") || "Shared";
      }
      return "";
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

const OpenStackCloudNetworks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Network}
      tableId="openstack-networks-table"
      title="Networks"
      description="Every network in this cloud, and how many of its addresses are in use."
      singularName="network"
      pluralName="networks"
      emptyTitle="No networks reported yet"
      emptyDescription="These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error. Addresses used need Full view or Infrastructure only."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudNetworks;
