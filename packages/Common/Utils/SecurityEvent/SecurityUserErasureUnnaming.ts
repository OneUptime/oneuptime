import { JSONValue } from "../../Types/JSON";
import {
  getEntityCaseGroupingKey,
  getEntityRiskKey,
} from "../SecurityCase/SecurityEntityRiskScore";

/*
 * TAKING AN ERASED PERSON OUT OF WHAT SECURITY EVENTS WROTE ABOUT THEM
 * (#10908).
 *
 * Once the user vault named an event's user, Security Events copied the
 * name onward: into the detections and cases the events raised, their
 * kept events, the entity risk it scores, and the playbook runs and
 * OneUptime AI actions that would act on the person. An erasure puts the
 * token back in each place Security Events wrote the name itself, as the
 * rule left it in the logs:
 *
 *   - a value that IS the name (an entity, a detection's group value, an
 *     action's target, a value in a kept event or a step's result) becomes
 *     what the rule left in its place;
 *   - a title OneUptime made as "<rule> — <name>" ends in what the rule left
 *     instead;
 *   - a case's grouping key about the name is the one about the token.
 *
 * Only whole values and that one title shape: never a name found inside
 * other text. A short user id ("bob") is a word of many sentences, and
 * what people wrote - notes, closing notes, tasks - is theirs to change,
 * not an erasure's.
 *
 * Pure, so the server that writes and the tests that pin it agree.
 */

// A user the vault named, and what the Hash rule had left in their place.
export interface ErasedName {
  named: string;
  hashed: string;
}

// The separator OneUptime puts between a rule's name and the value it grouped on.
export const TITLE_VALUE_SEPARATOR: string = " — ";

// What a whole value becomes: what the rule left, when it is one of the names.
export function unnameValue(
  value: string | undefined | null,
  names: ReadonlyArray<ErasedName>,
): string | undefined | null {
  if (typeof value !== "string") {
    return value;
  }

  const found: ErasedName | undefined = names.find(
    (name: ErasedName): boolean => {
      return name.named === value;
    },
  );

  return found ? found.hashed : value;
}

/*
 * A title OneUptime made of a rule's name and the value it grouped on,
 * "<rule> — <name>", with what the rule left in the name's place. A title
 * that is the name alone becomes what the rule left. Any other title stays.
 */
export function unnameTitle(
  title: string | undefined | null,
  names: ReadonlyArray<ErasedName>,
): string | undefined | null {
  if (typeof title !== "string") {
    return title;
  }

  for (const name of names) {
    if (title === name.named) {
      return name.hashed;
    }

    const suffix: string = `${TITLE_VALUE_SEPARATOR}${name.named}`;

    if (title.endsWith(suffix)) {
      return `${title.slice(0, title.length - suffix.length)}${TITLE_VALUE_SEPARATOR}${name.hashed}`;
    }
  }

  return title;
}

/*
 * A case's grouping key, the one about what the rule left when it was
 * about one of the names (getEntityCaseGroupingKey): a later detection
 * about the token joins the case, and the key no longer holds the name.
 */
export function unnameGroupingKey(
  key: string | undefined | null,
  names: ReadonlyArray<ErasedName>,
): string | undefined | null {
  if (typeof key !== "string") {
    return key;
  }

  for (const name of names) {
    if (key === getEntityCaseGroupingKey(name.named)) {
      return getEntityCaseGroupingKey(name.hashed);
    }
  }

  return key;
}

// The entity risk keys of the names: the rows of their risk.
export function getErasedRiskKeys(
  names: ReadonlyArray<ErasedName>,
): Array<string> {
  return Array.from(
    new Set<string>(
      names
        .map((name: ErasedName): string => {
          return getEntityRiskKey(name.named);
        })
        .filter((key: string): boolean => {
          return key.length > 0;
        }),
    ),
  );
}

/*
 * A JSON value with every whole string that is one of the names replaced
 * by what the rule left, at any depth: an entity list, a detection's kept
 * events, a step's results. A key is never changed. Says whether anything
 * was.
 */
export function unnameJson<T extends JSONValue | undefined | null>(
  value: T,
  names: ReadonlyArray<ErasedName>,
): { value: T; changed: boolean } {
  let changed: boolean = false;

  const visit: (item: unknown) => unknown = (item: unknown): unknown => {
    if (typeof item === "string") {
      const replaced: string | undefined | null = unnameValue(item, names);

      if (replaced !== item) {
        changed = true;
      }

      return replaced;
    }

    if (Array.isArray(item)) {
      return item.map(visit);
    }

    if (item && typeof item === "object") {
      const result: Record<string, unknown> = {};

      for (const [key, inner] of Object.entries(
        item as Record<string, unknown>,
      )) {
        result[key] = visit(inner);
      }

      return result;
    }

    return item;
  };

  const visited: unknown = visit(value);

  return { value: (changed ? visited : value) as T, changed };
}

// Whether a JSON value holds one of the names as a whole string, at any depth.
export function namesAnyone(
  value: JSONValue | undefined | null,
  names: ReadonlyArray<ErasedName>,
): boolean {
  return unnameJson(value, names).changed;
}
