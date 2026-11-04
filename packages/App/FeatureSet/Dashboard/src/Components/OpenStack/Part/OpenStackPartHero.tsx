import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  getOpenStackPartName,
  getOpenStackPartStatus,
} from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartAccent,
  ResourcePartBadge,
  ResourcePartChip,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * The top of a part's page, above its tabs: which part it is, its state in OpenStack's
 * own word, where it sits (each place one step away), and the facts an operator looks for
 * first. The shared ResourcePartHero draws it.
 */

export const OPENSTACK_PART_SLUGS: Partial<
  Record<OpenStackResourceKind, string>
> = {
  [OpenStackResourceKind.Hypervisor]: "hypervisor",
  [OpenStackResourceKind.Instance]: "instance",
  [OpenStackResourceKind.Flavor]: "flavor",
  [OpenStackResourceKind.Network]: "network",
  [OpenStackResourceKind.Subnet]: "subnet",
  [OpenStackResourceKind.Router]: "router",
  [OpenStackResourceKind.FloatingIp]: "floating-ip",
  [OpenStackResourceKind.Service]: "network-agent",
  [OpenStackResourceKind.Volume]: "volume",
  [OpenStackResourceKind.StoragePool]: "storage-pool",
  [OpenStackResourceKind.Image]: "image",
};

const ICONS: Partial<Record<OpenStackResourceKind, IconProp>> = {
  [OpenStackResourceKind.Hypervisor]: IconProp.ServerStack,
  [OpenStackResourceKind.Instance]: IconProp.Cube,
  [OpenStackResourceKind.Flavor]: IconProp.SquareStack,
  [OpenStackResourceKind.Network]: IconProp.Globe,
  [OpenStackResourceKind.Subnet]: IconProp.Layers,
  [OpenStackResourceKind.Router]: IconProp.Share,
  [OpenStackResourceKind.FloatingIp]: IconProp.MapPin,
  [OpenStackResourceKind.Api]: IconProp.Activity,
  [OpenStackResourceKind.Service]: IconProp.Activity,
  [OpenStackResourceKind.Volume]: IconProp.Disc,
  [OpenStackResourceKind.StoragePool]: IconProp.Database,
  [OpenStackResourceKind.Image]: IconProp.Image,
};

const ACCENTS: Partial<Record<OpenStackResourceKind, ResourcePartAccent>> = {
  [OpenStackResourceKind.Hypervisor]: "orange",
  [OpenStackResourceKind.Instance]: "sky",
  [OpenStackResourceKind.Flavor]: "sky",
  [OpenStackResourceKind.Network]: "indigo",
  [OpenStackResourceKind.Subnet]: "indigo",
  [OpenStackResourceKind.Router]: "indigo",
  [OpenStackResourceKind.FloatingIp]: "indigo",
  [OpenStackResourceKind.Service]: "indigo",
  [OpenStackResourceKind.Volume]: "emerald",
  [OpenStackResourceKind.StoragePool]: "emerald",
  [OpenStackResourceKind.Image]: "emerald",
};

const LOCATION_LINK_CLASS_NAME: string =
  "font-medium text-gray-700 hover:text-indigo-600 hover:underline";

export interface ComponentProps {
  part: OpenStackPart;
  // Its name, when its name is not its row's (a floating IP's address is).
  name?: string | undefined;
  badges?: Array<ResourcePartBadge> | undefined;
  chips?: Array<ResourcePartChip> | undefined;
  // Where it sits. Defaults to its region of its cloud.
  location?: ReactNode | undefined;
  /*
   * What its test ids call it, when its kind does not say: a Service row is a network
   * agent on one page and a nova-compute on another.
   */
  slug?: string | undefined;
}

const OpenStackPartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { part } = props;
  const row: OpenStackResource | null = part.row;
  const status: ResourcePartStatus | null = row
    ? getOpenStackPartStatus(row, OneUptimeDate.getCurrentDate())
    : null;

  const cloudLink: ReactElement = (
    <Link to={part.routes.cloudRoute} className={LOCATION_LINK_CLASS_NAME}>
      {part.cloudName}
    </Link>
  );

  const defaultLocation: ReactNode = row?.regionName ? (
    <TranslatedSentence
      template="In region {{region}} of cloud {{cloud}}"
      slots={{ region: <bdi>{row.regionName}</bdi>, cloud: cloudLink }}
    />
  ) : (
    <TranslatedSentence template="In cloud {{cloud}}" slots={{ cloud: cloudLink }} />
  );

  return (
    <ResourcePartHero
      testId={`openstack-${props.slug || OPENSTACK_PART_SLUGS[part.kind] || "part"}-hero`}
      icon={ICONS[part.kind] || IconProp.Cube}
      accent={ACCENTS[part.kind] || "indigo"}
      name={props.name || getOpenStackPartName(row, part.externalId)}
      status={status || undefined}
      badges={props.badges}
      location={props.location || defaultLocation}
      lastReportAt={row?.lastSeenAt ? new Date(row.lastSeenAt) : null}
      chips={props.chips}
    />
  );
};

export default OpenStackPartHero;
