import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  OpenStackRouteFor,
  getOpenStackAttentionItems,
} from "./OpenStackHealth";

/*
 * WHAT NEEDS ATTENTION ON AN OPENSTACK PART'S PAGE.
 *
 * One list per page, read once by the cloud's rules (OpenStackHealth): its
 * Needs attention card draws it, and the hero's status opens it when it
 * says something is wrong ("Error", "Down", "Lost"), so the two can never
 * disagree (#9594). Most parts' lists are the part alone; an instance's
 * holds the nova-compute of the host it runs on, a hypervisor's its
 * nova-compute and the instances on it that may need someone. The part
 * itself reads as its card names it - "This instance" - under the card's
 * own words.
 *
 * React-free, so App tests can read it.
 */

export interface OpenStackPartAttentionWords {
  description: string;
  current: string;
}

export const OPENSTACK_PART_ATTENTION_WORDS: Partial<
  Record<OpenStackResourceKind, OpenStackPartAttentionWords>
> = {
  [OpenStackResourceKind.BareMetalNode]: {
    description: translationKey(
      "What about this node is broken or needs a look.",
    ),
    current: translationKey("This node"),
  },
  [OpenStackResourceKind.ContainerCluster]: {
    description: translationKey(
      "What about this cluster is broken or needs a look.",
    ),
    current: translationKey("This cluster"),
  },
  [OpenStackResourceKind.FloatingIp]: {
    description: translationKey(
      "What about this address is broken or needs a look.",
    ),
    current: translationKey("This floating IP"),
  },
  [OpenStackResourceKind.Hypervisor]: {
    description: translationKey(
      "What on this hypervisor is broken or needs a look, the most urgent first.",
    ),
    current: translationKey("This hypervisor"),
  },
  [OpenStackResourceKind.Image]: {
    description: translationKey(
      "What about this image is broken or needs a look.",
    ),
    current: translationKey("This image"),
  },
  [OpenStackResourceKind.Instance]: {
    description: translationKey(
      "What about this instance, and the host it runs on, is broken or needs a look.",
    ),
    current: translationKey("This instance"),
  },
  // A Service row on the network agent's page.
  [OpenStackResourceKind.Service]: {
    description: translationKey(
      "What about this agent is broken or needs a look.",
    ),
    current: translationKey("This agent"),
  },
  [OpenStackResourceKind.Network]: {
    description: translationKey(
      "What about this network is broken or needs a look.",
    ),
    current: translationKey("This network"),
  },
  [OpenStackResourceKind.Router]: {
    description: translationKey(
      "What about this router is broken or needs a look, the most urgent first.",
    ),
    current: translationKey("This router"),
  },
  [OpenStackResourceKind.Stack]: {
    description: translationKey(
      "What about this stack is broken or needs a look.",
    ),
    current: translationKey("This stack"),
  },
  [OpenStackResourceKind.StoragePool]: {
    description: translationKey(
      "What about this pool is broken or needs a look.",
    ),
    current: translationKey("This storage pool"),
  },
  [OpenStackResourceKind.Volume]: {
    description: translationKey(
      "What about this volume is broken or needs a look.",
    ),
    current: translationKey("This volume"),
  },
};

// The key a part's own row carries in its page's list: "Instance/<id>".
export function getOpenStackPartAttentionKey(
  kind: OpenStackResourceKind,
  externalId: string,
): string {
  return `${kind}/${externalId}`;
}

export function getOpenStackPartAttention(data: {
  kind: OpenStackResourceKind;
  externalId: string;
  // The part's inventory row; null while it has not reported.
  row: OpenStackResource | null;
  // What else on its page the rules read beside it: an instance's host's nova-compute.
  aroundRows?: Array<OpenStackResource> | undefined;
  now: Date;
  routeFor?: OpenStackRouteFor | undefined;
  // What Nova says of the instance on a bare metal node, once read.
  instanceStatusOnNodeFor?:
    | ((row: OpenStackResource) => string | null | undefined)
    | undefined;
}): ResourcePartAttention {
  const words: OpenStackPartAttentionWords | undefined =
    OPENSTACK_PART_ATTENTION_WORDS[data.kind];
  return {
    items: data.row
      ? getOpenStackAttentionItems({
          rows: [data.row, ...(data.aroundRows || [])],
          now: data.now,
          routeFor: data.routeFor,
          instanceStatusOnNodeFor: data.instanceStatusOnNodeFor,
        })
      : [],
    description: words?.description,
    current: words
      ? {
          key: getOpenStackPartAttentionKey(data.kind, data.externalId),
          label: words.current,
        }
      : undefined,
  };
}
