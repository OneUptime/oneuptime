import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  OpenStackLatestReading,
  fetchOpenStackLatestByLabel,
} from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import OpenStackPartNotice from "./OpenStackPartNotice";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Security groups and ports are counts, and only counts. There is no row of either: a
 * security group's risky rules are for the audit issue, and listing ports can saturate
 * Neutron (openstack-exporter issue 540), so the agent leaves the per-port read off by
 * default and says how to turn it on rather than pretending there are none.
 */
const REGION_LABEL: string = "openstack.region.name";

const PORTS_OFF: string = translationKey(
  "Ports are not counted, by choice: the list behind the count can saturate Neutron, so the agent leaves it off. Delete the --disable-metric=neutron-ports line from the exporter to count them.",
);
const GROUPS_BY_PROJECT_OFF: string = translationKey(
  "Counted per region. Per project, these come from Neutron's quotas, which the agent leaves off: delete the --disable-metric=neutron-quota_network line from the exporter to see them.",
);

function sum(readings: Array<OpenStackLatestReading>): number {
  return readings.reduce(
    (total: number, reading: OpenStackLatestReading): number => {
      return total + reading.value;
    },
    0,
  );
}

export interface ComponentProps {
  cloudName: string;
}

const OpenStackNetworkCountsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const read: OpenStackRead<{
    groups: Array<OpenStackLatestReading>;
    groupsByProject: Array<OpenStackLatestReading>;
    ports: Array<OpenStackLatestReading>;
  }> = useOpenStackRead(async () => {
    const [groups, groupsByProject, ports]: [
      Array<OpenStackLatestReading>,
      Array<OpenStackLatestReading>,
      Array<OpenStackLatestReading>,
    ] = await Promise.all([
      fetchOpenStackLatestByLabel({
        cloudName: props.cloudName,
        metricName: "openstack_neutron_security_groups",
        groupByLabel: REGION_LABEL,
      }),
      fetchOpenStackLatestByLabel({
        cloudName: props.cloudName,
        metricName: "openstack_neutron_quota_security_group",
        groupByLabel: "tenant",
        attributes: { type: "used" },
      }),
      fetchOpenStackLatestByLabel({
        cloudName: props.cloudName,
        metricName: "openstack_neutron_ports",
        groupByLabel: REGION_LABEL,
      }),
    ]);
    return { groups, groupsByProject, ports };
  }, [props.cloudName]);

  /*
   * Supplementary: the lists above it are what a person came for, and a read of the metric
   * store that fails says nothing about the network.
   */
  if (!read.data) {
    return <></>;
  }

  const { groups, groupsByProject, ports } = read.data;

  return (
    <div data-testid="openstack-network-counts">
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GoldenMetricTile
          title="Security Groups"
          icon={IconProp.ShieldCheck}
          iconColor="sky"
          value={
            groups.length > 0
              ? translator.formatNumber(sum(groups))
              : translator.translateText("Not reported") || "Not reported"
          }
          description="How many security groups Neutron reports. Risky rules are for the audit page, not this one."
        />
        <GoldenMetricTile
          title="Ports"
          icon={IconProp.Share}
          iconColor="slate"
          value={
            ports.length > 0
              ? translator.formatNumber(sum(ports))
              : translator.translateText("Not counted") || "Not counted"
          }
          description="How many ports Neutron reports. A count, and off by default, because listing them can saturate Neutron."
        />
      </div>
      {groupsByProject.length > 0 ? (
        <ul
          className="mb-4 flex flex-wrap gap-1.5"
          data-testid="openstack-security-groups-by-project"
        >
          {groupsByProject.map(
            (reading: OpenStackLatestReading): ReactElement => {
              return (
                <li
                  key={reading.group}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                >
                  <span className="font-medium">
                    <bdi>{reading.group}</bdi>
                  </span>
                  <span>{translator.formatNumber(reading.value)}</span>
                </li>
              );
            },
          )}
        </ul>
      ) : (
        <OpenStackPartNotice
          testId="openstack-security-groups-by-project-off"
          text={GROUPS_BY_PROJECT_OFF}
        />
      )}
      {ports.length === 0 ? (
        <OpenStackPartNotice testId="openstack-ports-off" text={PORTS_OFF} />
      ) : (
        <></>
      )}
    </div>
  );
};

export default OpenStackNetworkCountsCard;
