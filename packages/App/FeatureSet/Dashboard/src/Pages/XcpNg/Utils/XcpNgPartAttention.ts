import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  XcpNgBackupContext,
  XcpNgPartKind,
  XcpNgRouteFor,
  getXcpNgAttentionItems,
} from "./XcpNgHealth";

/*
 * WHAT NEEDS ATTENTION ON AN XCP-NG HOST'S, VM'S OR STORAGE REPOSITORY'S PAGE.
 *
 * One list per page, read once: its Needs attention card draws it, and the
 * hero's state opens it when it says something is wrong ("Halted", "93%
 * used"), so the two can never disagree (#9594). A host's list holds the
 * host, the VMs it runs and its local storage repositories; a VM's and a
 * storage repository's, the part alone. The part itself reads as its card
 * names it - "This host" - under the card's own words.
 *
 * React-free, so App tests can read it.
 */

export const XCP_NG_PART_ATTENTION_WORDS: Record<
  XcpNgPartKind,
  { description: string; current: string }
> = {
  Host: {
    description: translationKey(
      "What on this host, its VMs and its local storage repositories is broken or needs a look, the most urgent first.",
    ),
    current: translationKey("This host"),
  },
  VM: {
    description: translationKey(
      "What about this VM is broken or needs a look.",
    ),
    current: translationKey("This VM"),
  },
  StorageRepository: {
    description: translationKey(
      "What about this storage repository is broken or needs a look.",
    ),
    current: translationKey("This storage repository"),
  },
};

export function getXcpNgPartAttention(data: {
  kind: XcpNgPartKind;
  externalId: string;
  // The part's inventory row; null while it has not reported.
  row: XcpNgResource | null;
  // What a host holds (its VMs and local storage); nothing for the rest.
  hostRows?: Array<XcpNgResource> | undefined;
  routeFor: XcpNgRouteFor;
  now: Date;
  // The pool's backups, for a VM's backup rules (#10997).
  backups?: XcpNgBackupContext | undefined;
}): ResourcePartAttention {
  const words: { description: string; current: string } =
    XCP_NG_PART_ATTENTION_WORDS[data.kind];
  const rows: Array<XcpNgResource> = [
    ...(data.row ? [data.row] : []),
    ...(data.kind === "Host" ? data.hostRows || [] : []),
  ];
  return {
    items: getXcpNgAttentionItems({
      rows: rows,
      routeFor: data.routeFor,
      now: data.now,
      backups: data.backups,
    }),
    description: words.description,
    current: { key: `${data.kind}:${data.externalId}`, label: words.current },
  };
}
