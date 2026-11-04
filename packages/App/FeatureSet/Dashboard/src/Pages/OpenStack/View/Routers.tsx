import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Column from "Common/UI/Components/ModelTable/Column";
import Navigation from "Common/UI/Utils/Navigation";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import {
  getOpenStackFact,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * Which L3 agents hold a router, and how many of them are alive. A router whose
 * agents are all dead carries no traffic, whatever its own status says.
 */
function getL3AgentsText(row: OpenStackResource): string {
  const agents: JSONValue | undefined = getOpenStackFact(row, "l3Agents");

  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return "";
  }

  const entries: Array<JSONValue> = Object.values(agents as JSONObject);
  const alive: number = entries.filter((agent: JSONValue): boolean => {
    return (agent as JSONObject)?.["isAlive"] === true;
  }).length;

  return translateTemplate("{{alive}} of {{total}} alive", {
    alive: String(alive),
    total: String(entries.length),
  });
}

const COLUMNS: Array<OpenStackColumn | Column<OpenStackResource>> = [
  OpenStackColumn.Status,
  getOpenStackFactColumn({
    id: "l3-agents",
    title: "L3 Agents",
    getText: getL3AgentsText,
  }),
  getOpenStackFactColumn({
    id: "external-network",
    title: "External Network",
    hideOnMobile: true,
    getText: (row: OpenStackResource): string => {
      return getOpenStackFactText(row, "externalNetworkId");
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

const OpenStackCloudRouters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <OpenStackResourceList
      openStackCloudId={modelId}
      kind={OpenStackResourceKind.Router}
      tableId="openstack-routers-table"
      title="Routers"
      description="Every router in this cloud, and the L3 agents that hold each one."
      singularName="router"
      pluralName="routers"
      emptyTitle="No routers reported yet"
      emptyDescription="These come from Neutron. Only the Full view credential sees every project's: Neutron answers any other with its own project, and no error."
      columns={COLUMNS}
      filters={FILTERS}
      searchPlaceholder="Search by name or ID"
    />
  );
};

export default OpenStackCloudRouters;
