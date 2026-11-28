import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE,
} from "../../Types/SecurityEvent/ThreatIntelConstants";
import { writeOwnValue } from "../LookupTable";
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

  return changed ? `${prefix}${unnamed.join(GROUP_VALUE_PART_SEPARATOR)}` : key;
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

      /*
       * The keys are what an event's sender wrote: a "__proto__" one is
       * kept as the copy's own, never dropped or made its prototype.
       */
      for (const [key, inner] of Object.entries(
        item as Record<string, unknown>,
      )) {
        writeOwnValue(result, key, visit(inner));
      }

      return result;
    }

    return item;
  };

  const visited: unknown = visit(value);

  return { value: (changed ? visited : value) as T, changed };
}

/*
 * A JSON value of what OneUptime wrote in Markdown - a playbook run's step
 * results, whose summary and details set a value apart as inline code - with
 * every whole string that is one of the names, and every name written as a
 * value of its own inside one (unnameDescription's places), replaced by
 * what the rule left. A key is never changed. Says whether anything was.
 */
export function unnameJsonMarkdown<T extends JSONValue | undefined | null>(
  value: T,
  names: ReadonlyArray<ErasedName>,
): { value: T; changed: boolean } {
  let changed: boolean = false;

  const visit: (item: unknown) => unknown = (item: unknown): unknown => {
    if (typeof item === "string") {
      const replaced: string = (unnameDescription(
        unnameValue(item, names) as string,
        names,
      ) || "") as string;

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
        writeOwnValue(result, key, visit(inner));
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

/*
 * WHAT A CORRELATION'S GROUP VALUE WAS, FROM WHAT IS LEFT OF IT (#11231).
 *
 * A Sigma correlation that groups on several fields names its group by
 * their values joined ("alice@example.com / 203.0.113.7"), and what it
 * opened carries the fingerprint of that value: its alerts and incidents,
 * and the firings its group's other entities' risk counted. When it writes
 * no Detection Findings and opens no cases, nothing else keeps the value,
 * so an erasure works out candidates from what is there - and keeps one
 * only when its fingerprint is the record's own, which the hash proves:
 *
 *   - an alert's or an incident's title, "[Detection] <rule> — <value>":
 *     whatever follows a " — ";
 *   - a firing its group's other entities' risk counted: the name, with the
 *     other entities that counted the same firing, in each order.
 *
 * A candidate is no more than a guess until its fingerprint matches, so
 * these offer every reading and leave the proof to the caller.
 */

// What an incident's title may end in after its value, as some are written.
const EVENT_COUNT_SUFFIX: RegExp = / \([0-9][0-9,.]* events?\)$/;

/*
 * The values a title OneUptime made as "<rule> — <value>" may end in:
 * whatever follows each " — ", and the same without an event count after
 * it. Longest first; each once.
 */
export function getTitleValueCandidates(
  title: string | undefined | null,
): Array<string> {
  if (typeof title !== "string" || !title) {
    return [];
  }

  const candidates: Array<string> = [];
  let at: number = title.indexOf(TITLE_VALUE_SEPARATOR);

  while (at >= 0) {
    const value: string = title.slice(at + TITLE_VALUE_SEPARATOR.length);

    candidates.push(value, value.replace(EVENT_COUNT_SUFFIX, ""));
    at = title.indexOf(TITLE_VALUE_SEPARATOR, at + 1);
  }

  return Array.from(new Set<string>(candidates)).filter(
    (value: string): boolean => {
      return value.length > 0;
    },
  );
}

// The most values a correlation groups on: a Sigma correlation's one to three.
export const MAX_GROUP_VALUE_PARTS: number = 3;

/*
 * The group values a correlation may have named `name` by, with the other
 * entities its risk was added to for the same firing: every order of the
 * name and one or more of them, up to MAX_GROUP_VALUE_PARTS values, joined
 * as a correlation joins them. Each once.
 */
export function getGroupValueCandidates(data: {
  name: string;
  others: ReadonlyArray<string>;
  maxParts?: number | undefined;
}): Array<string> {
  const others: Array<string> = Array.from(
    new Set<string>(
      data.others.filter((other: string): boolean => {
        return Boolean(other) && other !== data.name;
      }),
    ),
  );
  const maxParts: number = Math.max(2, data.maxParts ?? MAX_GROUP_VALUE_PARTS);
  const candidates: Set<string> = new Set<string>();

  // Every arrangement of `parts` that is short enough, each other value once.
  const arrange: (parts: Array<string>, left: Array<string>) => void = (
    parts: Array<string>,
    left: Array<string>,
  ): void => {
    if (parts.length >= 2 && parts.includes(data.name)) {
      candidates.add(parts.join(GROUP_VALUE_PART_SEPARATOR));
    }

    if (parts.length >= maxParts) {
      return;
    }

    left.forEach((value: string, index: number): void => {
      arrange(
        [...parts, value],
        left.filter((_other: string, other: number): boolean => {
          return other !== index;
        }),
      );
    });
  };

  if (data.name) {
    arrange([], [data.name, ...others]);
  }

  return Array.from(candidates);
}

/*
 * THE FEED'S INDICATOR, OUT OF WHAT OneUptime WROTE ABOUT A MATCH ON THE
 * PERSON (#11230).
 *
 * A threat intel feed can list the person's email address. What OneUptime
 * wrote about the match named the feed's indicator, by its id and by its
 * name, and the feed keeps the address beside both in clear: following
 * either named the person. Once the indicator's value is out (it is one of
 * the names, so it gets the token), the indicator is taken out with it:
 *
 *   - a detection's description, and the case's it opened
 *     (SecurityCaseMarkdown.threatIntelMatchMarkdown): "STIX indicator:
 *     `indicator--...`" says the erased indicator id instead, and the line
 *     "Indicator: <its name>" goes;
 *   - an alert's or an incident's description, and the feed item that
 *     announced it: its "STIX indicator: indicator--..." says the erased
 *     indicator id. The rest of an alert stays as it was written, as an
 *     erasure leaves alerts and incidents;
 *   - an event a detection kept: its threat intel stamp
 *     (threat.indicator_value, threat.indicator_id) about the person says
 *     the token and the erased indicator id.
 *
 * The erased indicator id is the keyed fingerprint of the match once the
 * person is out, made where the project's key is (`erasedIndicatorIdOf`,
 * Server/Utils/SecurityEvent/DetectionFingerprint.erasedIndicatorIdOf), so
 * every place says the same for the same match. Only OneUptime's own lines
 * are read: a description a person rewrote stays as they wrote it.
 */

// How a threat intel match's description opens, and the lines after it.
export const THREAT_INTEL_MATCH_SENTENCE_PREFIX: string = "Indicator ";
export const THREAT_INTEL_INDICATOR_NAME_PREFIX: string = "Indicator: ";
export const THREAT_INTEL_STIX_INDICATOR_PREFIX: string = "STIX indicator: ";

// Between the paragraphs of a description OneUptime wrote.
const PARAGRAPH_SEPARATOR: string = "\n\n";

/*
 * A line that names a STIX indicator by its id, as an alert's description
 * (ThreatIntelMatcher.buildMatchDescription) writes it: the id is captured.
 */
const STIX_INDICATOR_LINE: RegExp =
  /^STIX indicator: (indicator--[^\s`]+)\s*$/m;

/*
 * The name whose match a threat intel description is about: its first
 * paragraph is the match's sentence, its indicator's value one of the names
 * or what the rule left of one, as inline code. What the rule left, or null.
 */
function getMatchValueOf(
  firstParagraph: string,
  names: ReadonlyArray<ErasedName>,
): string | null {
  for (const name of names) {
    for (const value of [name.named, name.hashed]) {
      if (
        value &&
        firstParagraph.startsWith(
          `${THREAT_INTEL_MATCH_SENTENCE_PREFIX}${asDescriptionCode(value)} (`,
        )
      ) {
        return name.hashed;
      }
    }
  }

  return null;
}

/*
 * A threat intel detection's description, or the case's it opened, with the
 * feed's indicator taken out when the match was about one of the names (see
 * above). Any other description stays.
 */
export function unnameThreatIntelDescription(
  description: string | undefined | null,
  data: {
    names: ReadonlyArray<ErasedName>;
    erasedIndicatorIdOf: (value: string) => string;
  },
): string | undefined | null {
  if (typeof description !== "string" || !description) {
    return description;
  }

  const paragraphs: Array<string> = description.split(PARAGRAPH_SEPARATOR);
  const value: string | null = getMatchValueOf(paragraphs[0] || "", data.names);

  if (!value) {
    return description;
  }

  const erasedId: string = data.erasedIndicatorIdOf(value);
  const result: string = [
    paragraphs[0]!,
    ...paragraphs
      .slice(1)
      .filter((paragraph: string): boolean => {
        return !paragraph.startsWith(THREAT_INTEL_INDICATOR_NAME_PREFIX);
      })
      .map((paragraph: string): string => {
        return paragraph.startsWith(THREAT_INTEL_STIX_INDICATOR_PREFIX)
          ? `${THREAT_INTEL_STIX_INDICATOR_PREFIX}${asDescriptionCode(erasedId)}`
          : paragraph;
      }),
  ].join(PARAGRAPH_SEPARATOR);

  return result === description ? description : result;
}

// The STIX indicator an alert's description names, or null.
export function getStixIndicatorIdOf(
  text: string | undefined | null,
): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const match: RegExpMatchArray | null = text.match(STIX_INDICATOR_LINE);

  return match ? match[1]! : null;
}

/*
 * An alert's or an incident's text - its description, or the feed item that
 * announced it - with `erasedId` where it says "STIX indicator:
 * <stixId>". Any other text stays.
 */
export function withErasedStixIndicator(
  text: string | undefined | null,
  data: { stixId: string; erasedId: string },
): string | undefined | null {
  if (typeof text !== "string" || !text || !data.stixId) {
    return text;
  }

  const stated: string = `${THREAT_INTEL_STIX_INDICATOR_PREFIX}${data.stixId}`;
  const result: string = text
    .split(stated)
    .join(`${THREAT_INTEL_STIX_INDICATOR_PREFIX}${data.erasedId}`);

  return result === text ? text : result;
}

// A value as the enricher matched it: trimmed, in lower case.
function asEnrichedValue(value: string): string {
  return (value || "").trim().toLowerCase();
}

/*
 * The name a threat intel stamp holds, or what the rule left of one: the
 * enricher stamps the value it matched in lower case, so it is matched so.
 */
function getStampedNameOf(
  stamp: string,
  names: ReadonlyArray<ErasedName>,
): ErasedName | null {
  const exact: ErasedName | undefined = names.find(
    (name: ErasedName): boolean => {
      return name.named === stamp || name.hashed === stamp;
    },
  );

  if (exact) {
    return exact;
  }

  return (
    names.find((name: ErasedName): boolean => {
      return asEnrichedValue(name.named) === asEnrichedValue(stamp);
    }) || null
  );
}

/*
 * The events a detection kept (Types/SecurityCase/
 * SecurityDetectionMatchedEvents), with each threat intel stamp about one
 * of the names saying what the rule left and the erased indicator id (see
 * above). Says whether any did.
 */
export function unnameKeptEventStamps<T extends JSONObject | undefined | null>(
  matchedEvents: T,
  data: {
    names: ReadonlyArray<ErasedName>;
    erasedIndicatorIdOf: (value: string) => string;
  },
): { value: T; changed: boolean } {
  const events: unknown = (matchedEvents as JSONObject | null | undefined)?.[
    "events"
  ];

  if (!Array.isArray(events)) {
    return { value: matchedEvents, changed: false };
  }

  let changed: boolean = false;

  const kept: Array<unknown> = events.map((event: unknown): unknown => {
    const attributes: unknown = (event as JSONObject | null)?.["attributes"];

    if (!attributes || typeof attributes !== "object") {
      return event;
    }

    const record: Record<string, unknown> = attributes as Record<
      string,
      unknown
    >;
    const stamp: unknown = record[ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE];

    if (typeof stamp !== "string" || !stamp) {
      return event;
    }

    const name: ErasedName | null = getStampedNameOf(stamp, data.names);

    if (!name) {
      return event;
    }

    const indicatorId: string = data.erasedIndicatorIdOf(name.hashed);

    if (
      record[ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE] === name.hashed &&
      record[ENRICHMENT_INDICATOR_ID_ATTRIBUTE] === indicatorId
    ) {
      return event;
    }

    changed = true;

    const stamped: Record<string, unknown> = {};

    for (const [key, inner] of Object.entries(record)) {
      writeOwnValue(stamped, key, inner);
    }

    stamped[ENRICHMENT_INDICATOR_VALUE_ATTRIBUTE] = name.hashed;
    stamped[ENRICHMENT_INDICATOR_ID_ATTRIBUTE] = indicatorId;

    return { ...(event as JSONObject), attributes: stamped };
  });

  return changed
    ? {
        value: {
          ...(matchedEvents as JSONObject),
          events: kept,
        } as unknown as T,
        changed,
      }
    : { value: matchedEvents, changed };
}
