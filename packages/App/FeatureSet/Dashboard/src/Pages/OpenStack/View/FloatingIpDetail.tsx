import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  OpenStackPartAlerts,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
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
import {
  ResourcePartBadge,
  ResourcePartTone,
} from "../../../Components/ResourcePart/ResourcePartTypes";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import { fetchOpenStackNames } from "../Utils/OpenStackPartData";
import {
  OPENSTACK_FLOATING_IP_ALERT_TEMPLATE_IDS,
  OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS,
  OpenStackFloatingIpAssociation,
  getOpenStackFloatingIpAssociation,
  getOpenStackPartExplanation,
} from "../Utils/OpenStackPartFacts";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One floating IP: whether it is in use, and through what. The exporter has no port label,
 * so what it is attached to is not known here, only the router it goes through. Neutron
 * says DOWN for one with nothing behind it, which is an address waiting and nothing wrong.
 */
const SPARE_NOTICE: string = translationKey(
  "This address is spare: nothing is behind it, so Neutron says DOWN and nothing is wrong. It still holds an address of its pool, which is worth releasing if nobody needs it.",
);

const ASSOCIATION_TONES: Record<
  OpenStackFloatingIpAssociation,
  ResourcePartTone
> = {
  associated: "positive",
  unassociated: "neutral",
  "associated-not-active": "warning",
};

const FloatingIpOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
}): ReactElement => {
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();
  const routerId: string = getOpenStackFactText(row, "routerId");
  const networkId: string = getOpenStackFactText(row, "floatingNetworkId");

  const names: OpenStackRead<{
    routerName: string;
    networkName: string;
  }> = useOpenStackRead(async () => {
    const [routers, networks]: [
      Record<string, string>,
      Record<string, string>,
    ] = await Promise.all([
      fetchOpenStackNames({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Router,
        externalIds: routerId ? [routerId] : [],
      }),
      fetchOpenStackNames({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Network,
        externalIds: networkId ? [networkId] : [],
      }),
    ]);
    return {
      routerName: routers[routerId] || "",
      networkName: networks[networkId] || "",
    };
  }, [routerId, networkId, part.refreshToken]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row],
    now,
    routeFor: part.routes.routeFor,
  });

  const explanation: string | null = getOpenStackPartExplanation(row, now);
  const association: OpenStackFloatingIpAssociation =
    getOpenStackFloatingIpAssociation(row);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "association",
      label: "Association",
      value: OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS[association],
      description:
        "Whether anything is behind this address. Neutron only names a router once an address is associated.",
    },
  ];
  if (routerId) {
    detailRows.push({
      key: "router",
      label: "Router",
      value: (
        <Link
          to={part.routes.getPartRoute(OpenStackResourceKind.Router, routerId)}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{names.data?.routerName || routerId}</bdi>
        </Link>
      ),
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
          <bdi>{names.data?.networkName || networkId}</bdi>
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
  detailRows.push({
    key: "id",
    label: "Floating IP ID",
    value: part.externalId,
    mono: true,
    copyText: part.externalId,
  });

  return (
    <div data-testid="openstack-floating-ip-overview">
      {explanation ? (
        <OpenStackPartNotice
          testId="openstack-floating-ip-explanation"
          tone="warning"
          text={explanation}
        />
      ) : association === "unassociated" ? (
        <OpenStackPartNotice
          testId="openstack-floating-ip-spare"
          text={SPARE_NOTICE}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-floating-ip-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.FloatingIp}/${part.externalId}`,
          label: translationKey("This floating IP"),
        }}
        description="What about this address is broken or needs a look."
      />

      <OpenStackPartAlerts
        testId="openstack-floating-ip-alerts"
        title="Floating IP alerts"
        description="The cloud's alert that watches floating IPs. It counts per region, because that is what the exporter keeps, so it says how many and not which."
        templateIds={OPENSTACK_FLOATING_IP_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-floating-ip-details"
        description="What Neutron reports about this address. It does not say which port it is attached to."
        rows={detailRows}
      />
    </div>
  );
};

const OpenStackCloudFloatingIpDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.FloatingIp,
  );

  const badges: Array<ResourcePartBadge> = [];
  if (part.row) {
    const association: OpenStackFloatingIpAssociation =
      getOpenStackFloatingIpAssociation(part.row);
    badges.push({
      key: "association",
      label: OPENSTACK_FLOATING_IP_ASSOCIATION_WORDS[association],
      tone: ASSOCIATION_TONES[association],
    });
  }

  return (
    <OpenStackPartPage
      part={part}
      hero={{ badges }}
      overview={(row: OpenStackResource): ReactElement => {
        return <FloatingIpOverview part={part} row={row} />;
      }}
    />
  );
};

export default OpenStackCloudFloatingIpDetail;
