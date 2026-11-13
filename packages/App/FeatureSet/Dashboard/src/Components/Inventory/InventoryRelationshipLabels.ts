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
 *
 * Each reading is a whole sentence about this item, with the other item in
 * it as {{item}} ("runs {{item}}": this node runs checkout-pod), drawn with
 * the link in that slot (TranslatedSentence). A reading used to be a bare
 * phrase in front of the link, looked up by its English: "runs" and "hosts"
 * read alone as nouns, "hosts" is the host lists' noun too, so most
 * languages worded the noun ("exécutions: checkout-pod", "Hosts:
 * checkout-pod") and said nothing about which way the edge goes (#7326). A
 * sentence key no noun shares is worded as a verb, and each language puts
 * the other item where its grammar wants it (Persian and Japanese before
 * the verb, German inside "führt {{item}} aus").
 */

// The placeholder each reading draws the other item in.
export const RELATIONSHIP_ITEM_SLOT: string = "item";

export interface RelationshipPhrasing {
  /** This item is the edge's source: "runs on {{item}}". */
  outgoing: string;
  /** This item is the edge's target: "runs {{item}}" (it runs on this). */
  incoming: string;
}

export const RELATIONSHIP_PHRASINGS: Readonly<
  Record<EntityRelationshipType, RelationshipPhrasing>
> = {
  [EntityRelationshipType.RunsOn]: {
    outgoing: translationKey("runs on {{item}}"),
    incoming: translationKey("runs {{item}}"),
  },
  [EntityRelationshipType.MemberOf]: {
    outgoing: translationKey("is a member of {{item}}"),
    incoming: translationKey("has member {{item}}"),
  },
  [EntityRelationshipType.HostedOn]: {
    outgoing: translationKey("is hosted on {{item}}"),
    incoming: translationKey("hosts {{item}}"),
  },
  [EntityRelationshipType.PartOf]: {
    outgoing: translationKey("is part of {{item}}"),
    incoming: translationKey("contains {{item}}"),
  },
  [EntityRelationshipType.InstanceOf]: {
    outgoing: translationKey("is an instance of {{item}}"),
    incoming: translationKey("has instance {{item}}"),
  },
  [EntityRelationshipType.DependsOn]: {
    outgoing: translationKey("depends on {{item}}"),
    incoming: translationKey("is depended on by {{item}}"),
  },
};

// An edge with no type: neutral, and still read in the reader's language.
export const RELATED_TO_SENTENCE: string = translationKey(
  "is related to {{item}}",
);

export type RelationshipDirection = "outgoing" | "incoming";

export type GetRelationshipPhraseFunction = (
  relationshipType: string | undefined,
  direction: RelationshipDirection,
) => string;

// A type's hyphens, and braces that could be read as a placeholder.
const HYPHENS: RegExp = /-/g;
const BRACES: RegExp = /[{}]/g;

/**
 * The sentence for an edge as read from this item's end, with the other
 * item as {{item}}. An unknown type (a newer server's) degrades to its raw
 * value with hyphens turned into spaces, which at least reads as words; it
 * is no key, so it reads in English with the item after it.
 */
export const getRelationshipPhrase: GetRelationshipPhraseFunction = (
  relationshipType: string | undefined,
  direction: RelationshipDirection,
): string => {
  if (!relationshipType) {
    return RELATED_TO_SENTENCE;
  }

  const phrasing: RelationshipPhrasing | undefined =
    RELATIONSHIP_PHRASINGS[relationshipType as EntityRelationshipType];

  if (!phrasing) {
    const words: string = relationshipType
      .replace(HYPHENS, " ")
      .replace(BRACES, "")
      .trim();

    return words
      ? `${words} {{${RELATIONSHIP_ITEM_SLOT}}}`
      : RELATED_TO_SENTENCE;
  }

  return phrasing[direction];
};
