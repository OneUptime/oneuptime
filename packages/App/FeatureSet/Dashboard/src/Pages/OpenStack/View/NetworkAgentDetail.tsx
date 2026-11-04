import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Search from "Common/Types/BaseDatabase/Search";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackRouterList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackBlastRadiusCard from "../../../Components/OpenStack/Part/OpenStackBlastRadiusCard";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackNetworkBackend from "../../../Components/OpenStack/Part/UseOpenStackNetworkBackend";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  OPENSTACK_NETWORK_AGENT_ALERT_TEMPLATE_IDS,
  OpenStackNetworkBackend,
  isOpenStackL3Agent,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One Neutron agent, and what it serves where the backend reports that. Only an L3 agent's
 * routers are in what the agent collects, by the l3_agent_of_router series. Nothing the
 * agent collects says which networks a DHCP agent serves, and OVN's agents hold no routers,
 * so those pages say that rather than listing nothing.
 */
const NOTHING_REPORTED: string = translationKey(
  "What this agent serves isn't in what's collected: the exporter only says which routers an L3 agent holds. openstack network agent show has what it reports about itself.",
);

const AgentOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const host: string = getOpenStackFactText(row, "host");
  const agentId: string = getOpenStackFactText(row, "agentId");

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "binary",
      label: "Agent",
      value: row.name || part.externalId,
    },
  ];
  if (host) {
    detailRows.push({ key: "host", label: "Host", value: host });
  }
  if (row.status) {
    detailRows.push({
      key: "state",
      label: "State",
      value: row.status,
      description: "Whether Neutron says this agent is alive, in its own word.",
    });
  }
  if (row.adminState) {
    detailRows.push({
      key: "admin-state",
      label: "Admin State",
      value: row.adminState,
      description:
        "What an operator set, in Neutron's word: up or down. An agent set down is planned work, not a failure.",
    });
  }
  if (row.disabledReason) {
    detailRows.push({
      key: "disabled-reason",
      label: "Disabled because",
      value: row.disabledReason,
    });
  }
  if (row.availabilityZone) {
    detailRows.push({
      key: "zone",
      label: "Availability Zone",
      value: row.availabilityZone,
    });
  }
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }
  if (agentId) {
    detailRows.push({
      key: "agent-id",
      label: "Agent ID",
      value: agentId,
      mono: true,
      copyText: agentId,
    });
  }

  return (
    <div data-testid="openstack-network-agent-overview">
      <NeedsAttentionCard
        testId="openstack-network-agent-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Service}/${part.externalId}`,
          label: translationKey("This agent"),
        }}
        description="What about this agent is broken or needs a look."
      />

      {isOpenStackL3Agent(row) ? (
        <></>
      ) : (
        <OpenStackPartNotice
          testId="openstack-network-agent-serves-unknown"
          text={NOTHING_REPORTED}
        />
      )}

      <OpenStackPartOpenEvents
        testId="openstack-network-agent-open"
        title="Open on this agent"
        description="Unresolved incidents and alerts about this agent, incidents first."
        part={part}
        row={row}
      />

      <OpenStackBlastRadiusCard
        testId="openstack-network-agent-blast"
        openStackCloudId={part.openStackCloudId}
        kind={OpenStackResourceKind.Service}
        externalId={part.externalId}
        routes={part.routes}
        description="The routers only this agent holds, and the floating IPs going through them. A router another alive agent also holds has lost nothing."
        refreshToken={part.refreshToken}
      />

      <OpenStackPartAlerts
        testId="openstack-network-agent-alerts"
        title="Network agent alerts"
        description="The cloud's alert that watches every enabled Neutron agent, this one included."
        templateIds={OPENSTACK_NETWORK_AGENT_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-network-agent-details"
        description="What Neutron reports about this agent."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudNetworkAgentDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Service);
  const backend: OpenStackNetworkBackend = useOpenStackNetworkBackend(
    part.openStackCloudId,
  );
  const row: OpenStackResource | null = part.row;
  const host: string = row ? getOpenStackFactText(row, "host") : "";

  return (
    <OpenStackPartPage
      part={part}
      hero={{
        location: host ? (
          <TranslatedSentence
            template="On host {{host}} of cloud {{cloud}}, and on its {{services}} page"
            slots={{
              host: <bdi>{host}</bdi>,
              cloud: (
                <Link
                  to={part.routes.cloudRoute}
                  className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  {part.cloudName}
                </Link>
              ),
              services: (
                <Link
                  to={part.routes.getServicesRoute()}
                  className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  {translator.translateText("Services")}
                </Link>
              ),
            }}
          />
        ) : undefined,
      }}
      overview={(overviewRow: OpenStackResource): ReactElement => {
        return <AgentOverview part={part} row={overviewRow} />;
      }}
      tabs={(tabRow: OpenStackResource): Array<Tab> => {
        const agentId: string = getOpenStackFactText(tabRow, "agentId");
        if (!isOpenStackL3Agent(tabRow) || !agentId) {
          return [];
        }
        /*
         * A router names the agents holding it as the keys of one fact. There is one
         * series per router and agent, so the search can only match an agent's own id.
         */
        const facts: JSONObject = { l3Agents: new Search(agentId) as never };
        return [
          {
            name: "Routers",
            children: (
              <OpenStackRouterList
                openStackCloudId={part.openStackCloudId}
                query={{ facts: facts }}
                backend={backend}
                tableId="openstack-network-agent-routers-table"
                title="Routers this agent holds"
                description="The routers Neutron has scheduled on this L3 agent."
                emptyTitle="No routers on this agent"
                emptyDescription="Neutron has scheduled no router here, or this credential can't see the ones it has."
              />
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudNetworkAgentDetail;
