import { JSONValue } from "../../Types/JSON";
import FeedMarkdown from "../Markdown/FeedMarkdown";
import { escapeRegExp } from "../RegExpEscape";
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
 *   - a correlation's group value, which joins the values it grouped on
 *     ("alice@example.com / 203.0.113.7"), gets it in the place of each one
 *     that is the name (#11130) - and so do the title and the case's
 *     grouping key made of it;
 *   - a title OneUptime made as "<rule> — <name>" ends in what the rule left
 *     instead;
 *   - a detection's description, and its case's, where OneUptime wrote the
 *     name as a value: as inline code, or in a correlation's sentence;
 *   - a case's grouping key about the name is the one about the token.
 *
 * Only whole values, that one title shape and those places in a
 * description: never a name found inside other text. A short user id
 * ("bob") is a word of many sentences, and
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

/*
 * The separator between the values a correlation grouped on, in the one
 * value it names its group by ("alice@example.com / 203.0.113.7"): the
 * server's CORRELATION_GROUP_VALUE_SEPARATOR, which a test holds equal.
 */
export const GROUP_VALUE_PART_SEPARATOR: string = " / ";

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
 * The value a detection grouped on, with what the rule left in each name's
 * place (#11130): the whole value when it is a name, else each of a
 * correlation's values that is ("alice@example.com / 203.0.113.7" becomes
 * "[HASHED:...] / 203.0.113.7"). That is the value a rule groups on once
 * the events hold the token again, so what was fingerprinted by the old
 * value is fingerprinted by this one.
 */
export function unnameGroupValue(
  value: string | undefined | null,
  names: ReadonlyArray<ErasedName>,
): string | undefined | null {
  if (typeof value !== "string" || !value) {
    return value;
  }

  const whole: string | undefined | null = unnameValue(value, names);

  if (whole !== value) {
    return whole;
  }

  const parts: Array<string> = value.split(GROUP_VALUE_PART_SEPARATOR);

  if (parts.length < 2) {
    return value;
  }

  let changed: boolean = false;
  const unnamed: Array<string> = parts.map((part: string): string => {
    const replaced: string = unnameValue(part, names) as string;

    if (replaced !== part) {
      changed = true;
    }

    return replaced;
  });

  return changed ? unnamed.join(GROUP_VALUE_PART_SEPARATOR) : value;
}

/*
 * A title OneUptime made of a rule's name and the value it grouped on,
 * "<rule> — <name>", with what the rule left in the name's place - or, for a
 * correlation that grouped on several values ("<rule> — alice@example.com /
 * 203.0.113.7"), in the place of each one that is a name. A title that is
 * the name alone becomes what the rule left. Any other title stays.
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

  // A correlation's values, after the last separator.
  const at: number = title.lastIndexOf(TITLE_VALUE_SEPARATOR);

  if (at < 0) {
    return title;
  }

  const value: string = title.slice(at + TITLE_VALUE_SEPARATOR.length);
  const unnamed: string | undefined | null = unnameGroupValue(value, names);

  return unnamed !== value
    ? `${title.slice(0, at)}${TITLE_VALUE_SEPARATOR}${unnamed}`
    : title;
}

/*
 * A detection's description, and the case's it opened (SecurityCaseIngest
 * starts a case with it), with what the rule left in the name's place
 * wherever OneUptime wrote the name as a value of its own
 * (SecurityCaseMarkdown):
 *
 *   - as inline code: the observables a detection lists ("Observables:
 *     `alice@example.com`, `203.0.113.7`"), a threat intel indicator, the
 *     entity an entity risk detection is about, the groups an overflow
 *     lists;
 *   - in the sentence that says what a correlation rule matched, which
 *     lists the new values it saw ("What happened: First principalUser in
 *     7 days: alice@example.com, bob and 3 more."), each value where the
 *     sentence sets it apart.
 *
 * Only those: a name inside other words or inside a longer code span
 * ("Sample event: `Failed sign-in for bob`") stays as written, as in a
 * title. Each spelling is the one FeedMarkdown writes, so a name with "_"
 * or "*" in it is found as the description escaped it.
 */
export const CORRELATION_SENTENCE_PREFIX: string = "What happened: ";

// A name as a description writes it as inline code.
function asDescriptionCode(value: string): string {
  return FeedMarkdown.code(value).toString();
}

// A name as a description's sentence writes it, after other words on its line.
function asDescriptionText(value: string): string {
  return FeedMarkdown.textInLine(value).toString();
}

/*
 * A value the correlation sentence sets apart: after ": ", ", " or " / ",
 * and before ", ", " / ", " and " or the full stop that ends the sentence.
 */
function correlationValuePattern(text: string): RegExp {
  return new RegExp(
    `(?<=: |, | / )${escapeRegExp(text)}(?=, | / | and |\\.$)`,
    "g",
  );
}

export function unnameDescription(
  description: string | undefined | null,
  names: ReadonlyArray<ErasedName>,
): string | undefined | null {
  if (typeof description !== "string" || !description) {
    return description;
  }

  let result: string = description;

  for (const name of names) {
    const named: string = asDescriptionCode(name.named);

    if (named) {
      result = result.split(named).join(asDescriptionCode(name.hashed));
    }
  }

  result = result
    .split("\n")
    .map((line: string): string => {
      if (!line.startsWith(CORRELATION_SENTENCE_PREFIX)) {
        return line;
      }

      let sentence: string = line;

      for (const name of names) {
        const named: string = asDescriptionText(name.named);

        if (!named) {
          continue;
        }

        const hashed: string = asDescriptionText(name.hashed);

        // A function, so a "$" in what the rule left is placed as written.
        sentence = sentence.replace(
          correlationValuePattern(named),
          (): string => {
            return hashed;
          },
        );
      }

      return sentence;
    })
    .join("\n");

  return result === description ? description : result;
}

/*
 * The texts a description that names one of the names holds, for a read
 * that finds the descriptions by text: each name as inline code, and as the
 * correlation sentence writes it.
 */
export function getDescriptionNameTexts(names: ReadonlyArray<ErasedName>): {
  code: Array<string>;
  text: Array<string>;
} {
  const code: Set<string> = new Set<string>();
  const text: Set<string> = new Set<string>();

  for (const name of names) {
    const asCode: string = asDescriptionCode(name.named);
    const asText: string = asDescriptionText(name.named);

    if (asCode) {
      code.add(asCode);
    }

    if (asText) {
      text.add(asText);
    }
  }

  return { code: Array.from(code), text: Array.from(text) };
}

/*
 * A case's grouping key, the one about what the rule left when it was
 * about one of the names (getEntityCaseGroupingKey): a later detection
 * about the token joins the case, and the key no longer holds the name. A
 * correlation that grouped on several values keys its case by all of them
 * ("entity:alice@example.com / 203.0.113.7", case folded): each that is a
 * name becomes what the rule left, as unnameGroupValue makes the value.
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

  const prefix: string = getEntityCaseGroupingKey("");

  if (!key.startsWith(prefix)) {
    return key;
  }

  const parts: Array<string> = key
    .slice(prefix.length)
    .split(GROUP_VALUE_PART_SEPARATOR);

  if (parts.length < 2) {
    return key;
  }

  let changed: boolean = false;
  const unnamed: Array<string> = parts.map((part: string): string => {
    const name: ErasedName | undefined = names.find(
      (candidate: ErasedName): boolean => {
        return getEntityRiskKey(candidate.named) === part;
      },
    );

    if (!name) {
      return part;
    }

    changed = true;

    return getEntityRiskKey(name.hashed);
  });

  return changed
    ? `${prefix}${unnamed.join(GROUP_VALUE_PART_SEPARATOR)}`
    : key;
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
