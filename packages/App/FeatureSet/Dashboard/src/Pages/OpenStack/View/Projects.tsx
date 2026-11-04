import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * Keystone's projects, which is OpenStack's word for its tenants. They belong to
 * the cloud rather than to a region, so this list has no Region.
 */

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  OpenStackColumn.Status,
  {
    field: { externalId: true },
    title: "ID",
    type: FieldType.Text,
    hideOnMobile: true,
  },
  getOpenStackFactColumn({
    id: "domain",
    title: "Domain",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "domainId");
    },
  }),
  getOpenStackFactColumn({
    id: "description",
    title: "Description",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "description");
    },
  }),
];

const FILTERS: Array<OpenStackFilter> = [OpenStackFilter.Status];

const OpenStackCloudProjects: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Project}
      tableId="openstack-projects-table"
      title="Projects"
      description="Every OpenStack project in this cloud. Instances, volumes and networks say which of these they belong to."
      singularName="project"
      pluralName="projects"
      emptyTitle="No projects reported yet"
      emptyDescription="These come from Keystone, which takes the Full view or Infrastructure only credential. A Project view credential sees only its own."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudProjects;
