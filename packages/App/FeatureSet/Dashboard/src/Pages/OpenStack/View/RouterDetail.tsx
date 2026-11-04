import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackL3AgentFact,
  getOpenStackRouterAgents,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import { OpenStackFloatingIpList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackBlastRadiusCard from "../../../Components/OpenStack/Part/OpenStackBlastRadiusCard";
import { getOpenStackMetricQuery } from "../../../Components/OpenStack/Part/OpenStackMetricQueries";
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
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import { fetchOpenStackRow } from "../Utils/OpenStackPartData";
import {
  OPENSTACK_ROUTER_ALERT_TEMPLATE_IDS,
  OpenStackNetworkBackend,
  OpenStackRouterAgentReading,
  getOpenStackL3AgentExternalId,
  getOpenStackPartExplanation,
  getOpenStackRouterAgentReading,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";
import { OpenStackPartRoutes } from "../../../Components/OpenStack/Part/OpenStackPartRoutes";

/*
 * One router: its status and admin state, which L3 agents hold it and in what HA state, its
 * way out, and the addresses going through it. A router whose agents are all dead carries
 * no traffic, whatever its own status says. On OVN no agent holds a router, so there is
 * nothing to be missing and the page says so.
 */

const OVN_NOTICE: string = translationKey(
  "This cloud runs OVN, which has no L3 agents: the router lives in OVN's own database. So there is no agent here to be missing, and this is not a fault.",
);
const AGENTS_NOT_REPORTED: string = translationKey(
  "No L3 agent is reported holding this router. The exporter only names agents that hold one, and this credential may not be able to list agents.",
);

const AgentRows: FunctionComponent<{
  row: OpenStackResource;
  routes: OpenStackPartRoutes;
}> = (props: {
  row: OpenStackResource;
  routes: OpenStackPartRoutes;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const agents: Array<OpenStackL3AgentFact> = getOpenStackRouterAgents(
    props.row.facts as JSONObject,
  );

  if (agents.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="openstack-router-agents">
      <Card
        title="L3 agents"
        description="The agents holding this router, whether each is alive, and which is active when it is highly available."
      >
        <ul className={listClassName}>
          {agents.map(
            (agent: OpenStackL3AgentFact, index: number): ReactElement => {
              const route: ReturnType<OpenStackPartRoutes["getNetworkAgentRoute"]> =
                agent.host
                  ? props.routes.getNetworkAgentRoute(
                      getOpenStackL3AgentExternalId(
                        props.row.regionName,
                        agent.host,
                      ),
                    )
                  : undefined;
              return (
                <li
                  key={`${agent.host || ""}-${index}`}
                  data-testid="openstack-router-agent"
                  data-alive={agent.isAlive && agent.isAdminUp ? "true" : "false"}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
                >
                  {route ? (
                    <Link
                      to={route}
                      className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                    >
                      <bdi>{agent.host}</bdi>
                    </Link>
                  ) : (
                    <span className="font-medium text-gray-900">
                      {translator.translateText("Host not reported")}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span
                      className={
                        agent.isAlive && agent.isAdminUp
                          ? "text-emerald-700"
                          : "font-medium text-red-700"
                      }
                    >
                      {translator.translateText(
                        !agent.isAdminUp
                          ? "Admin state down"
                          : agent.isAlive
                            ? "Alive"
                            : "Not alive",
                      )}
                    </span>
                    {agent.haState ? (
                      <span>
                        {translator.translateTemplate("HA: {{state}}", {
                          state: agent.haState,
                        })}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      </Card>
    </div>
  );
};

const RouterOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
  backend: OpenStackNetworkBackend;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
  backend: OpenStackNetworkBackend;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row, backend } = props;
  const now: Date = OneUptimeDate.getCurrentDate();
  const externalNetworkId: string = getOpenStackFactText(
    row,
    "externalNetworkId",
  );

  const externalNetwork: OpenStackRead<OpenStackResource | null> =
    useOpenStackRead<OpenStackResource | null>(() => {
      return externalNetworkId
        ? fetchOpenStackRow({
            openStackCloudId: part.openStackCloudId,
            kind: OpenStackResourceKind.Network,
            externalId: externalNetworkId,
          })
        : Promise.resolve(null);
    }, [externalNetworkId, part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const agents: OpenStackRouterAgentReading = getOpenStackRouterAgentReading({
    row,
    backend,
  });

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Router ID",
      value: part.externalId,
      mono: true,
      copyText: part.externalId,
    },
  ];
  if (row.status) {
    detailRows.push({ key: "status", label: "Status", value: row.status });
  }
  if (row.adminState) {
    detailRows.push({
      key: "admin-state",
      label: "Admin State",
      value: row.adminState,
      description:
        "What an operator set, in Neutron's word. A router set down is planned work, not a failure.",
    });
  }
  if (externalNetworkId) {
    detailRows.push({
      key: "external-network",
      label: "External Network",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.Network,
            externalNetworkId,
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{externalNetwork.data?.name || externalNetworkId}</bdi>
        </Link>
      ),
    });
  }
  if (row.openStackProjectId) {
    detailRows.push({
      key: "project",
      label: "Project",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.Project,
            row.openStackProjectId,
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{row.openStackProjectId}</bdi>
        </Link>
      ),
    });
  }
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-router-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-router-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-router-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Router}/${part.externalId}`,
          label: translationKey("This router"),
        }}
        description="What about this router is broken or needs a look, the most urgent first."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="openstack-router-tiles"
      >
        <GoldenMetricTile
          title="L3 agents"
          icon={IconProp.Share}
          iconColor="blue"
          value={
            agents.values
              ? translator.translateTemplate(agents.label, agents.values)
              : translator.translateText(agents.label) || agents.label
          }
          sublabel={
            agents.activeHost
              ? translator.translateTemplate("active on {{host}}", {
                  host: agents.activeHost,
                })
              : undefined
          }
          tone={
            agents.state === "alive"
              ? "positive"
              : agents.state === "not-applicable" ||
                  agents.state === "not-reported"
                ? undefined
                : "danger"
          }
          description="The L3 agents holding this router. OVN has no such agents, so there it reads Not applicable."
        />
      </div>

      {agents.state === "not-applicable" ? (
        <OpenStackPartNotice testId="openstack-router-ovn" text={OVN_NOTICE} />
      ) : (
        <></>
      )}
      {agents.state === "not-reported" ? (
        <OpenStackPartNotice
          testId="openstack-router-agents-not-reported"
          text={AGENTS_NOT_REPORTED}
        />
      ) : (
        <></>
      )}

      <AgentRows row={row} routes={part.routes} />

      <OpenStackPartOpenEvents
        testId="openstack-router-open"
        title="Open on this router"
        description="Unresolved incidents and alerts about this router, incidents first."
        part={part}
        row={row}
      />

      <OpenStackBlastRadiusCard
        testId="openstack-router-blast"
        openStackCloudId={part.openStackCloudId}
        kind={OpenStackResourceKind.Router}
        externalId={part.externalId}
        routes={part.routes}
        description="The floating IPs going through this router, and the projects they belong to. If it stops carrying traffic, these stop answering."
        refreshToken={part.refreshToken}
      />

      <OpenStackPartAlerts
        testId="openstack-router-alerts"
        title="Router alerts"
        description="The cloud's alerts that watch every router, this one included: each is one monitor on the cloud."
        templateIds={OPENSTACK_ROUTER_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-router-details"
        description="What Neutron reports about this router."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudRouterDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Router);
  const backend: OpenStackNetworkBackend = useOpenStackNetworkBackend(
    part.openStackCloudId,
  );

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <RouterOverview part={part} row={row} backend={backend} />;
      }}
      tabs={(): Array<Tab> => {
        const facts: JSONObject = { routerId: part.externalId };
        return [
          {
            name: "Floating IPs",
            children: (
              <OpenStackFloatingIpList
                openStackCloudId={part.openStackCloudId}
                query={{ facts: facts }}
                tableId="openstack-router-floating-ips-table"
                title="Floating IPs through this router"
                description="The addresses going through this router."
                emptyTitle="No floating IPs through this router"
                emptyDescription="No address goes through this router, or this credential can't see the ones that do."
              />
            ),
          },
          {
            name: "Metrics",
            children: (
              <Card
                title="L3 agents over time"
                description="Whether each agent holding this router was alive, over the selected time range."
              >
                <ResourceMetricsTab
                  queryConfigs={[
                    getOpenStackMetricQuery({
                      part,
                      variable: "router_agent_alive",
                      title: "L3 agent alive",
                      description:
                        "1 while an agent holding this router is alive, 0 when it is not. On OVN there are no such agents, so this stays empty.",
                      metricName: "openstack_neutron_l3_agent_of_router",
                      legend: "Alive",
                      attributes: { router_id: part.externalId },
                    }),
                  ]}
                />
              </Card>
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudRouterDetail;
