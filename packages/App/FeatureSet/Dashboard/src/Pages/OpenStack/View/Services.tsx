import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * What `openstack compute service list`, `network agent list` and `volume service
 * list` answer between them, without anyone running them, one table for each and
 * one for the APIs above them. Each family keeps its own words: Nova and Cinder
 * say enabled and disabled, Neutron says up and down.
 *
 * `down` sorts ahead of `up`, so what stopped is at the top of each table. A row
 * someone disabled reads Disabled with their reason, never as a failure.
 */

/*
 * The fact goes in as a JSONObject rather than a literal: checking a literal
 * against a JSON column's query type is too deep for TypeScript (TS2589).
 */
function getFamilyQuery(
  family: OpenStackServiceFamily,
): Query<OpenStackResource> {
  const facts: JSONObject = { family: family };
  return { facts: facts };
}

const COMPUTE_QUERY: Query<OpenStackResource> = getFamilyQuery(
  OpenStackServiceFamily.Compute,
);
const NETWORK_QUERY: Query<OpenStackResource> = getFamilyQuery(
  OpenStackServiceFamily.Network,
);
const VOLUME_QUERY: Query<OpenStackResource> = getFamilyQuery(
  OpenStackServiceFamily.Volume,
);

const NOVA_AND_CINDER_ADMIN_WORDS: ReadonlyArray<string> = [
  "enabled",
  "disabled",
];
const NEUTRON_ADMIN_WORDS: ReadonlyArray<string> = ["up", "down"];

const API_COLUMNS: Array<OpenStackColumn> = [
  OpenStackColumn.Status,
  OpenStackColumn.Region,
];

const HOST_COLUMN: Column<OpenStackResource> = getOpenStackFactColumn({
  id: "host",
  title: "Host",
  getText: (row: OpenStackResource): string => {
    return getOpenStackFactText(row, "host");
  },
});

const SERVICE_COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  HOST_COLUMN,
  OpenStackColumn.Status,
  OpenStackColumn.AdminState,
  OpenStackColumn.DisabledReason,
  OpenStackColumn.Region,
  OpenStackColumn.AvailabilityZone,
];

const API_FILTERS: Array<OpenStackFilter> = [
  OpenStackFilter.Status,
  OpenStackFilter.Region,
];

const SERVICE_FILTERS: Array<OpenStackFilter> = [
  OpenStackFilter.Status,
  OpenStackFilter.AdminState,
  OpenStackFilter.Region,
];

// "Compute (Nova)" for an API's row, whose name is the service's type.
function getApiName(row: OpenStackResource): string {
  return (
    OPENSTACK_SERVICE_TITLES[row.name as OpenStackServiceType] || row.name || ""
  );
}

const OpenStackCloudServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackResourceList
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Api}
        tableId="openstack-apis-table"
        title="APIs"
        description="Each OpenStack service's API, by region, as the agent last read it."
        singularName="API"
        pluralName="APIs"
        emptyTitle="No APIs reported yet"
        emptyDescription="The agent reports each service's API once it can reach Keystone. Check that it is running, and that the machine it runs on can reach your cloud."
        nameTitle="Service"
        getName={getApiName}
        statusTitle="State"
        columns={API_COLUMNS}
        filters={API_FILTERS}
        searchPlaceholder="Search APIs"
        sortBy="status"
        sortOrder={SortOrder.Ascending}
      />
      <OpenStackResourceList
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Service}
        query={COMPUTE_QUERY}
        tableId="openstack-compute-services-table"
        title="Compute Services"
        description="Nova's workers, as openstack compute service list shows them: nova-compute on each host, nova-scheduler and nova-conductor."
        singularName="compute service"
        pluralName="compute services"
        emptyTitle="No compute services reported yet"
        emptyDescription="These come from Nova's service list, which takes the Full view or Infrastructure only credential. A Project view credential can't list services."
        nameTitle="Service"
        statusTitle="State"
        columns={SERVICE_COLUMNS}
        filters={SERVICE_FILTERS}
        adminStateWords={NOVA_AND_CINDER_ADMIN_WORDS}
        searchPlaceholder="Search by service or host"
        sortBy="status"
        sortOrder={SortOrder.Ascending}
      />
      <OpenStackResourceList
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Service}
        query={NETWORK_QUERY}
        tableId="openstack-network-agents-table"
        title="Network Agents"
        description="Neutron's agents, as openstack network agent list shows them, on every host that runs one."
        singularName="network agent"
        pluralName="network agents"
        emptyTitle="No network agents reported yet"
        emptyDescription="These come from Neutron's agent list, which takes the Full view or Infrastructure only credential. A Project view credential can't list agents."
        nameTitle="Agent"
        statusTitle="State"
        columns={SERVICE_COLUMNS}
        filters={SERVICE_FILTERS}
        adminStateWords={NEUTRON_ADMIN_WORDS}
        searchPlaceholder="Search by agent or host"
        sortBy="status"
        sortOrder={SortOrder.Ascending}
      />
      <OpenStackResourceList
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Service}
        query={VOLUME_QUERY}
        tableId="openstack-volume-services-table"
        title="Volume Services"
        description="Cinder's workers, as openstack volume service list shows them: cinder-volume for each backend, cinder-scheduler and cinder-backup."
        singularName="volume service"
        pluralName="volume services"
        emptyTitle="No volume services reported yet"
        emptyDescription="These come from Cinder's service list, which takes the Full view or Infrastructure only credential. A cloud that doesn't run Cinder has none."
        nameTitle="Service"
        statusTitle="State"
        columns={SERVICE_COLUMNS}
        filters={SERVICE_FILTERS}
        adminStateWords={NOVA_AND_CINDER_ADMIN_WORDS}
        searchPlaceholder="Search by service or host"
        sortBy="status"
        sortOrder={SortOrder.Ascending}
      />
    </Fragment>
  );
};

export default OpenStackCloudServices;
