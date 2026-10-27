import { CloudRelationshipKind } from "Common/Types/Cloud/CloudInventory";
import { CloudRelationshipDirection } from "Common/Types/Cloud/CloudResourceIndex";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How a cloud relationship reads from each end, in English
 * (translationKey): from the resource that lists it ("Runs in" a subnet)
 * and from the one it names ("Runs here", said by the subnet). A
 * resource's Connected Resources card and an account's topology use the
 * same words; the first ones are the words OneUptime AI reads
 * (CLOUD_RELATIONSHIP_LABELS), which a test holds equal.
 */
export interface CloudRelationshipWords {
  label: string;
  inverseLabel: string;
}

export const CLOUD_RELATIONSHIP_WORDS: Readonly<
  Record<CloudRelationshipKind, CloudRelationshipWords>
> = {
  [CloudRelationshipKind.RunsIn]: {
    label: translationKey("Runs in"),
    inverseLabel: translationKey("Runs here"),
  },
  [CloudRelationshipKind.PartOf]: {
    label: translationKey("Part of"),
    inverseLabel: translationKey("Includes"),
  },
  [CloudRelationshipKind.RoutesTo]: {
    label: translationKey("Sends traffic to"),
    inverseLabel: translationKey("Gets traffic from"),
  },
  [CloudRelationshipKind.ProtectedBy]: {
    label: translationKey("Protected by"),
    inverseLabel: translationKey("Protects"),
  },
  [CloudRelationshipKind.AttachedTo]: {
    label: translationKey("Attached to"),
    inverseLabel: translationKey("Has attached"),
  },
  [CloudRelationshipKind.DeadLettersTo]: {
    label: translationKey("Dead letters go to"),
    inverseLabel: translationKey("Takes dead letters from"),
  },
};

// The words a relationship reads with, seen from one of its ends.
export function getCloudRelationshipLabel(
  kind: CloudRelationshipKind,
  direction: CloudRelationshipDirection,
): string {
  const words: CloudRelationshipWords = CLOUD_RELATIONSHIP_WORDS[kind];

  return direction === "out" ? words.label : words.inverseLabel;
}
