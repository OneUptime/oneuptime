import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { getOpenStackNetworkIpPercent } from "Common/Types/OpenStack/OpenStackHealthRules";
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
import {
  OpenStackFloatingIpList,
  OpenStackRouterList,
  OpenStackSubnetList,
  getOpenStackAddressesText,
} from "../../../Components/OpenStack/OpenStackLists";
import {
  formatOpenStackCount,
  formatOpenStackPercent,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackForecastTile from "../../../Components/OpenStack/Part/OpenStackForecastTile";
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
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  fetchOpenStackDhcpAgents,
  fetchOpenStackNetworkForecast,
} from "../Utils/OpenStackPartData";
import {
  OPENSTACK_NETWORK_ALERT_TEMPLATE_IDS,
  OpenStackForecast,
  OpenStackNetworkBackend,
  OpenStackSubnetAddresses,
  getOpenStackAddressesFree,
  getOpenStackAddressesTone,
  getOpenStackNetworkDhcpAgentIds,
  getOpenStackNetworkSubnets,
  getOpenStackPartExplanation,
  isOpenStackNetworkExternal,
  isOpenStackNetworkShared,
} from "../Utils/OpenStackPartFacts";
import {
  getOpenStackFactNumber,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * One network: how many of its addresses are in use, subnet by subnet, because a full
 * subnet is what stops an instance booting, whatever the network's total says. An external
 * one is the pool floating IPs and routers draw from, so its page also says when it runs
 * out, which routers go through it and which addresses came from it.
 */

const NetworkOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();
  const isExternal: boolean = isOpenStackNetworkExternal(row);

  const forecast: OpenStackRead<OpenStackForecast> =
    useOpenStackRead<OpenStackForecast>(() => {
      return fetchOpenStackNetworkForecast({
        cloudName: part.cloudName,
        network: row,
      });
    }, [part.externalId, part.refreshToken]);

  // Only where a probe has said which, so an agent's cloud never makes this read.
  const dhcpAgentIds: Array<string> = getOpenStackNetworkDhcpAgentIds(row);
  const dhcpAgents: OpenStackRead<Array<OpenStackResource>> = useOpenStackRead<
    Array<OpenStackResource>
  >(() => {
    return dhcpAgentIds.length > 0
      ? fetchOpenStackDhcpAgents({
          openStackCloudId: part.openStackCloudId,
          regionName: row.regionName,
        })
      : Promise.resolve([]);
  }, [dhcpAgentIds.join(","), part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const percent: number | null = getOpenStackNetworkIpPercent(
    row.facts as JSONObject,
  );
  const free: number | null = getOpenStackAddressesFree(row);
  const subnets: Array<OpenStackSubnetAddresses> =
    getOpenStackNetworkSubnets(row);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Network ID",
      value: part.externalId,
      mono: true,
      copyText: part.externalId,
    },
  ];
  const addFact: (key: string, label: string, name: string) => void = (
    key: string,
    label: string,
    name: string,
  ): void => {
    const value: string = getOpenStackFactText(row, name);
    if (value) {
      detailRows.push({ key, label, value });
    }
  };
  addFact("type", translationKey("Type"), "networkType");
  addFact("physical", translationKey("Physical network"), "physicalNetwork");
  addFact("mtu", translationKey("MTU"), "mtu");
  if (dhcpAgentIds.length > 0) {
    detailRows.push({
      key: "dhcp-agents",
      label: "DHCP agents",
      description:
        "The agents Neutron has serving this network, as it last said.",
      value: (
        <span className="flex flex-col gap-1">
          {dhcpAgentIds.map((agentId: string): ReactElement => {
            const agent: OpenStackResource | undefined = (
              dhcpAgents.data || []
            ).find((candidate: OpenStackResource): boolean => {
              return getOpenStackFactText(candidate, "agentId") === agentId;
            });
            const route: Route | undefined = agent
              ? part.routes.routeFor(agent)
              : undefined;
            const name: string = agent
              ? getOpenStackFactText(agent, "host") || agentId
              : agentId;
            return route ? (
              <Link
                key={agentId}
                to={route}
                className="text-indigo-600 hover:text-indigo-700 hover:underline"
                dataTestId="openstack-network-dhcp-agent"
              >
                <bdi>{name}</bdi>
              </Link>
            ) : (
              <span key={agentId} data-testid="openstack-network-dhcp-agent">
                <bdi>{name}</bdi>
              </span>
            );
          })}
        </span>
      ),
    });
  }
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-network-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-network-explanation"
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-network-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Network}/${part.externalId}`,
          label: translationKey("This network"),
        }}
        description="What about this network is broken or needs a look."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="openstack-network-tiles"
      >
        <GoldenMetricTile
          title="Addresses used"
          icon={IconProp.Globe}
          iconColor="blue"
          value={percent === null ? "—" : formatOpenStackPercent(percent)}
          sublabel={
            percent === null ? "Not reported" : getOpenStackAddressesText(row)
          }
          percent={percent}
          // Only an external network ever asks anyone for anything.
          tone={isExternal ? getOpenStackAddressesTone(row) : "positive"}
          description="IPv4 addresses in use out of those this network's subnets hold. An IPv6 subnet is left out, because a /64 is 2^64 addresses. Takes the Full view or Infrastructure only credential."
        />
        <GoldenMetricTile
          title="Addresses free"
          icon={IconProp.SquareStack}
          iconColor="emerald"
          value={free === null ? "—" : formatOpenStackCount(free)}
          sublabel={
            getOpenStackFactNumber(row, "ipsTotal") === null
              ? "Not reported"
              : undefined
          }
          description="IPv4 addresses this network's subnets can still give out."
        />
        <OpenStackForecastTile
          forecast={forecast.data}
          description="When this network runs out of addresses, at its growth over the last day. It says so when there isn't enough history yet to tell."
        />
      </div>

      {subnets.length > 0 ? (
        <div className="mb-6" data-testid="openstack-network-subnets">
          <Card
            title="Addresses by subnet"
            description="A full subnet stops an instance booting on it, whatever the network's total says."
          >
            <ul className={listClassName}>
              {subnets.map((subnet: OpenStackSubnetAddresses): ReactElement => {
                return (
                  <li
                    key={subnet.name}
                    data-testid="openstack-network-subnet"
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900">
                        <bdi>{subnet.name}</bdi>
                      </span>
                      {subnet.cidr ? (
                        <span className="ml-2 font-mono text-xs text-gray-500">
                          <bdi>{subnet.cidr}</bdi>
                        </span>
                      ) : (
                        <></>
                      )}
                    </span>
                    <span className="text-xs text-gray-600">
                      {subnet.percent === null
                        ? translator.translateTemplate("{{used}} used", {
                            used: formatOpenStackCount(subnet.used || 0),
                          })
                        : translator.translateTemplate(
                            "{{used}} of {{total}} ({{percent}})",
                            {
                              used: formatOpenStackCount(subnet.used || 0),
                              total: formatOpenStackCount(subnet.total || 0),
                              percent: formatOpenStackPercent(subnet.percent),
                            },
                          )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId="openstack-network-open"
        title="Open on this network"
        description="Unresolved incidents and alerts about this network, incidents first."
        part={part}
        row={row}
      />

      {isExternal ? (
        <OpenStackPartAlerts
          testId="openstack-network-alerts"
          title="External network alerts"
          description="The cloud's alerts that watch every external network, this one included: each is one monitor that fires for any pool that crosses it."
          templateIds={OPENSTACK_NETWORK_ALERT_TEMPLATE_IDS}
          part={part}
        />
      ) : (
        <></>
      )}

      <ResourcePartDetailsCard
        testId="openstack-network-details"
        description="What Neutron reports about this network."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudNetworkDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Network);
  const backend: OpenStackNetworkBackend = useOpenStackNetworkBackend(
    part.openStackCloudId,
  );
  const row: OpenStackResource | null = part.row;

  const badges: Array<ResourcePartBadge> = [];
  if (isOpenStackNetworkExternal(row)) {
    badges.push({ key: "external", label: "External", tone: "neutral" });
  }
  if (isOpenStackNetworkShared(row)) {
    badges.push({ key: "shared", label: "Shared", tone: "neutral" });
  }

  return (
    <OpenStackPartPage
      part={part}
      hero={{ badges }}
      overview={(overviewRow: OpenStackResource): ReactElement => {
        return <NetworkOverview part={part} row={overviewRow} />;
      }}
      tabs={(tabRow: OpenStackResource): Array<Tab> => {
        const subnetFacts: JSONObject = { networkId: part.externalId };
        const routerFacts: JSONObject = { externalNetworkId: part.externalId };
        const floatingIpFacts: JSONObject = {
          floatingNetworkId: part.externalId,
        };
        return [
          {
            name: "Subnets",
            children: (
              <OpenStackSubnetList
                openStackCloudId={part.openStackCloudId}
                query={{ facts: subnetFacts }}
                tableId="openstack-network-subnets-table"
                title="Subnets of this network"
                description="Each subnet of this network, as Neutron reports it."
                emptyTitle="No subnets reported"
                emptyDescription="Neutron says this network has no subnets, or this credential can't see them."
              />
            ),
          },
          ...(isOpenStackNetworkExternal(tabRow)
            ? [
                {
                  name: "Routers",
                  children: (
                    <OpenStackRouterList
                      openStackCloudId={part.openStackCloudId}
                      query={{ facts: routerFacts }}
                      backend={backend}
                      tableId="openstack-network-routers-table"
                      title="Routers through this network"
                      description="The routers using this network as their way out."
                      emptyTitle="No routers through this network"
                      emptyDescription="No router uses this network as its gateway, or this credential can't see the ones that do."
                    />
                  ),
                },
                {
                  name: "Floating IPs",
                  children: (
                    <OpenStackFloatingIpList
                      openStackCloudId={part.openStackCloudId}
                      query={{ facts: floatingIpFacts }}
                      tableId="openstack-network-floating-ips-table"
                      title="Floating IPs from this network"
                      description="The addresses drawn from this pool, in use or spare."
                      emptyTitle="No floating IPs from this network"
                      emptyDescription="No address has been drawn from this pool, or this credential can't see the ones that have."
                    />
                  ),
                },
              ]
            : []),
          {
            name: "Metrics",
            children: (
              <Card
                title="Addresses over time"
                description="Addresses in use on each of this network's subnets, over the selected time range."
              >
                <ResourceMetricsTab
                  queryConfigs={[
                    getOpenStackMetricQuery({
                      part,
                      variable: "network_addresses_used",
                      title: "Addresses used",
                      description:
                        "Addresses in use on each of this network's subnets.",
                      metricName:
                        "openstack_neutron_network_ip_availabilities_used",
                      legend: "Used",
                      attributes: { network_id: part.externalId },
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

export default OpenStackCloudNetworkDetail;
