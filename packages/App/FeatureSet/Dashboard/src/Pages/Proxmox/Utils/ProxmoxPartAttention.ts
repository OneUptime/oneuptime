import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  ProxmoxPartKind,
  ProxmoxRouteFor,
  getProxmoxAttentionItems,
} from "./ProxmoxHealth";

/*
 * WHAT NEEDS ATTENTION ON A PROXMOX NODE'S, GUEST'S OR STORAGE'S PAGE.
 *
 * One list per page, read once: its Needs attention card draws it, and the
 * hero's status opens it when it says something is wrong ("Offline",
 * "Stopped", "Unavailable"), so the two can never disagree (#9594). A
 * node's list holds the node, its guests and its storage; a guest's and a
 * storage's, the part alone. The part itself reads as its card names it -
 * "This node" - under the card's own words.
 *
 * React-free, so App tests can read it.
 */

export const PROXMOX_PART_ATTENTION_WORDS: Record<
  ProxmoxPartKind,
  { description: string; current: string }
> = {
  Node: {
    description: translationKey(
      "What on this node, its guests and its storage is broken or needs a look, the most urgent first.",
    ),
    current: translationKey("This node"),
  },
  Guest: {
    description: translationKey(
      "What about this guest is broken or needs a look, the most urgent first.",
    ),
    current: translationKey("This guest"),
  },
  Storage: {
    description: translationKey(
      "What about this storage is broken or needs a look.",
    ),
    current: translationKey("This storage"),
  },
};

export function getProxmoxPartAttention(data: {
  kind: ProxmoxPartKind;
  externalId: string;
  // The part's inventory row; null while it has not reported.
  row: ProxmoxResource | null;
  // A node's guests and storage; nothing for a guest or a storage.
  nodeRows?: Array<ProxmoxResource> | undefined;
  routeFor: ProxmoxRouteFor;
}): ResourcePartAttention {
  const words: { description: string; current: string } =
    PROXMOX_PART_ATTENTION_WORDS[data.kind];
  const rows: Array<ProxmoxResource> = [
    ...(data.row ? [data.row] : []),
    ...(data.kind === "Node" ? data.nodeRows || [] : []),
  ];
  return {
    items: getProxmoxAttentionItems({ rows: rows, routeFor: data.routeFor }),
    description: words.description,
    current: { key: `${data.kind}:${data.externalId}`, label: words.current },
  };
}
