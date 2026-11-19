import CephResource from "Common/Models/DatabaseModels/CephResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  CephPartKind,
  CephPoolPgStates,
  CephRouteFor,
  getCephAttentionItems,
  getCephAttentionKey,
} from "./CephHealth";
import { THIS_OSD_LABEL, THIS_POOL_LABEL } from "./CephPartFacts";

/*
 * WHAT NEEDS ATTENTION ON AN OSD'S OR A POOL'S PAGE.
 *
 * One list per page, read once by the cluster's rules (CephHealth): its
 * Needs attention card draws it, and the hero's status opens it when it
 * says something is wrong ("Down", "Out", "Near full"), so the two can
 * never disagree (#9594). The part itself reads as its card names it -
 * "This OSD" - under the card's own words.
 *
 * React-free, so App tests can read it.
 */

export type CephPartPageKind = Extract<CephPartKind, "Osd" | "Pool">;

export const CEPH_PART_ATTENTION_WORDS: Record<
  CephPartPageKind,
  { description: string; current: string }
> = {
  Osd: {
    description: translationKey(
      "What about this OSD is broken or needs a look.",
    ),
    current: THIS_OSD_LABEL,
  },
  Pool: {
    description: translationKey(
      "What about this pool is broken or needs a look.",
    ),
    current: THIS_POOL_LABEL,
  },
};

export function getCephPartAttention(data: {
  kind: CephPartPageKind;
  externalId: string;
  // The part's inventory row; null while it has not reported.
  row: CephResource | null;
  // The newest report of the whole inventory: what tells a stale part.
  newestSeenAt: Date | null;
  // A pool's placement groups by state; null when they could not be read.
  pgStates?: CephPoolPgStates | null | undefined;
  routeFor: CephRouteFor;
  now: Date;
}): ResourcePartAttention {
  const words: { description: string; current: string } =
    CEPH_PART_ATTENTION_WORDS[data.kind];
  return {
    items: data.row
      ? getCephAttentionItems({
          rows: [data.row],
          pgStatesByPool:
            data.kind === "Pool" && data.pgStates
              ? new Map([[data.externalId, data.pgStates]])
              : null,
          routeFor: data.routeFor,
          now: data.now,
          newestSeenAt: data.newestSeenAt,
        })
      : [],
    description: words.description,
    current: {
      key: getCephAttentionKey(data.kind, data.externalId),
      label: words.current,
    },
  };
}
