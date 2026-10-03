import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How a relationship reads in a sentence, in both directions.
 *
 * The stored edge is directed and its type is named from the source's point
 * of view — `runs-on` means "the from-entity runs on the to-entity". The
 * relationships list shows edges pointing both ways, so an incoming edge
 * rendered with the stored label says exactly the wrong thing: a node showing
 * "runs-on: checkout-pod" claims the node runs on the pod.
 *
 * So each type declares both readings, and the list picks by direction. The
 * tests pin that every type has both — a missing one falls back to the raw
 * hyphenated string, which is where that inversion would creep back in.
 */

export interface RelationshipPhrasing {
  /** This item is the edge's source: "runs on". */
  outgoing: string;
  /** This item is the edge's target: "is run by". */
  incoming: string;
}

const PHRASINGS: Record<EntityRelationshipType, RelationshipPhrasing> = {
  [EntityRelationshipType.RunsOn]: {
    outgoing: translationKey("runs on"),
    incoming: translationKey("runs"),
  },
  [EntityRelationshipType.MemberOf]: {
    outgoing: translationKey("is a member of"),
    incoming: translationKey("has member"),
  },
  [EntityRelationshipType.HostedOn]: {
    outgoing: translationKey("is hosted on"),
    incoming: translationKey("hosts"),
  },
  [EntityRelationshipType.PartOf]: {
    outgoing: translationKey("is part of"),
    incoming: translationKey("contains"),
  },
  [EntityRelationshipType.InstanceOf]: {
    outgoing: translationKey("is an instance of"),
    incoming: translationKey("has instance"),
  },
  [EntityRelationshipType.DependsOn]: {
    outgoing: translationKey("depends on"),
    incoming: translationKey("is depended on by"),
  },
};

export type RelationshipDirection = "outgoing" | "incoming";

export type GetRelationshipPhraseFunction = (
  relationshipType: string | undefined,
  direction: RelationshipDirection,
) => string;

/**
 * The phrase for an edge as read from this item's end. Unknown types degrade
 * to their raw value with hyphens turned into spaces, which at least reads as
 * words.
 */
export const getRelationshipPhrase: GetRelationshipPhraseFunction = (
  relationshipType: string | undefined,
  direction: RelationshipDirection,
): string => {
  if (!relationshipType) {
    return translationKey("is related to");
  }

  const phrasing: RelationshipPhrasing | undefined =
    PHRASINGS[relationshipType as EntityRelationshipType];

  if (!phrasing) {
    return relationshipType.replace(/-/g, " ");
  }

  return phrasing[direction];
};
