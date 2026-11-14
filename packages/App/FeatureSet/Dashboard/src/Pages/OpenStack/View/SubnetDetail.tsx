import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  formatOpenStackCount,
  formatOpenStackPercent,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { fetchOpenStackRow } from "../Utils/OpenStackPartData";
import {
  OpenStackSubnetAddresses,
  getOpenStackSubnetAddresses,
} from "../Utils/OpenStackPartFacts";
import {
  getOpenStackFact,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";

/*
 * One subnet. Its addresses are on its network's row, subnet by subnet, because that is the
 * series they come from. An IPv6 subnet says how many it has handed out and no share of
 * anything: a /64 is 2^64 addresses.
 */
const SubnetOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const networkId: string = getOpenStackFactText(row, "networkId");

  const network: OpenStackRead<OpenStackResource | null> =
    useOpenStackRead<OpenStackResource | null>(() => {
      return networkId
        ? fetchOpenStackRow({
            openStackCloudId: part.openStackCloudId,
            kind: OpenStackResourceKind.Network,
            externalId: networkId,
          })
        : Promise.resolve(null);
    }, [networkId, part.refreshToken]);

  const addresses: OpenStackSubnetAddresses | null =
    getOpenStackSubnetAddresses({ subnet: row, network: network.data });

  const enableDhcp: unknown = getOpenStackFact(row, "enableDhcp");

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "id",
      label: "Subnet ID",
      value: part.externalId,
      mono: true,
      copyText: part.externalId,
    },
  ];
  const cidr: string = getOpenStackFactText(row, "cidr");
  if (cidr) {
    detailRows.push({
      key: "cidr",
      label: "CIDR",
      value: cidr,
      mono: true,
      copyText: cidr,
    });
  }
  const gateway: string = getOpenStackFactText(row, "gatewayIp");
  if (gateway) {
    detailRows.push({
      key: "gateway",
      label: "Gateway",
      value: gateway,
      mono: true,
    });
  }
  if (enableDhcp !== undefined) {
    detailRows.push({
      key: "dhcp",
      label: "DHCP",
      value:
        translator.translateText(enableDhcp === true ? "On" : "Off") ||
        (enableDhcp === true ? "On" : "Off"),
    });
  }
  if (networkId) {
    detailRows.push({
      key: "network",
      label: "Network",
      value: (
        <Link
          to={part.routes.getPartRoute(
            OpenStackResourceKind.Network,
            networkId,
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{network.data?.name || networkId}</bdi>
        </Link>
      ),
    });
  }
  if (row.regionName) {
    detailRows.push({ key: "region", label: "Region", value: row.regionName });
  }

  return (
    <div data-testid="openstack-subnet-overview">
      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="openstack-subnet-tiles"
      >
        <GoldenMetricTile
          title="Addresses used"
          icon={IconProp.Globe}
          iconColor="blue"
          value={
            !addresses
              ? "—"
              : addresses.percent === null
                ? formatOpenStackCount(addresses.used || 0)
                : formatOpenStackPercent(addresses.percent)
          }
          sublabel={
            !addresses
              ? "Not reported"
              : addresses.percent === null
                ? "in use"
                : translator.translateTemplate("{{used}} of {{total}}", {
                    used: formatOpenStackCount(addresses.used || 0),
                    total: formatOpenStackCount(addresses.total || 0),
                  })
          }
          percent={addresses?.percent ?? undefined}
          description="Addresses in use on this subnet, from Neutron's IP availability, which takes the Full view or Infrastructure only credential."
        />
      </div>
      <ResourcePartDetailsCard
        testId="openstack-subnet-details"
        description="What Neutron reports about this subnet."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudSubnetDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(OpenStackResourceKind.Subnet);

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        return <SubnetOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudSubnetDetail;
