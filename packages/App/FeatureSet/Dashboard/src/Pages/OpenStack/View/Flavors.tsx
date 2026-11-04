import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import Navigation from "Common/UI/Utils/Navigation";
import { translateText } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  formatOpenStackBytes,
  formatOpenStackCount,
  getOpenStackFactColumn,
  getOpenStackSizeColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackFact } from "../Utils/OpenStackResourceUtils";

/*
 * A flavor's vCPUs, memory and disk are its size, what an instance of it asks for.
 * Nothing here is allocated or used, so these are the one list that says neither.
 */

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  getOpenStackSizeColumn({
    title: "vCPUs",
    field: "vcpuCapacity",
    format: formatOpenStackCount,
  }),
  getOpenStackSizeColumn({
    title: "Memory",
    field: "memoryCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackSizeColumn({
    title: "Disk",
    field: "diskCapacityBytes",
    format: formatOpenStackBytes,
  }),
  getOpenStackFactColumn({
    id: "visibility",
    title: "Visibility",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      const isPublic: JSONValue | undefined = getOpenStackFact(row, "isPublic");
      if (isPublic === undefined) {
        return "";
      }
      return (
        translateText(isPublic === true ? "Public" : "Private") ||
        (isPublic === true ? "Public" : "Private")
      );
    },
  }),
  OpenStackColumn.Region,
];

const FILTERS: Array<OpenStackFilter> = [OpenStackFilter.Region];

const OpenStackCloudFlavors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Flavor}
      tableId="openstack-flavors-table"
      title="Flavors"
      description="The sizes instances are created from, in each region."
      singularName="flavor"
      pluralName="flavors"
      emptyTitle="No flavors reported yet"
      emptyDescription="These come from Nova. A credential that can reach Nova lists the flavors it may use, so check that the agent is running and can read the Compute API."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudFlavors;
