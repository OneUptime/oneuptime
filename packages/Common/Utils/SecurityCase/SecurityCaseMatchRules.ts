import yaml from "js-yaml";
import { JSONValue } from "../../Types/JSON";
import {
  SECURITY_CASE_MATCHES_GUIDANCE_MAX_LENGTH,
  SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH,
  SECURITY_CASE_MATCHES_MAX_GUIDANCE_LINES,
  SECURITY_CASE_MATCHES_MAX_LOOK_FOR,
  SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS,
  SECURITY_CASE_MATCHES_PADDING_IN_MINUTES,
  SecurityCaseMatchLookForJson,
} from "../../Types/SecurityCase/SecurityCaseMatches";
import SigmaRule, {
  SigmaConditionNode,
  SigmaFieldRequirement,
  SigmaSelection,
} from "../../Types/SecurityEvent/SigmaRule";

/*
 * WHAT A DETECTION MATCHED, the pure half of SecurityCaseMatches
 * (Server/Utils/SecurityCase/Context/SecurityCaseMatches.ts): what a rule's
 * condition looks for, so the case can mark it in each event it matched;
 * the guidance a rule's own Sigma YAML gives (when it is known to fire on
 * something harmless, and where to read more); and the time a detection's
 * events are read over.
 *
 * Free of anything server-only and of React, so the server, the Dashboard
 * and a plain test agree on every rule of it.
 */

/*
 * The modifiers whose values are text a matching field holds as written:
 * contains, startswith, endswith and an equality, with all, cased and
 * windash only changing how. A value read through any other modifier - a
 * regular expression, a network range, a comparison, a watchlist, exists -
 * is no text to find in the event.
 */
const TEXT_MODIFIERS: ReadonlySet<string> = new Set<string>([
  "contains",
  "startswith",
  "endswith",
  "all",
  "cased",
  "windash",
]);

/*
 * Columns that hold a category, not text a person reads: a rule's
 * "className: Authentication" says what kind of event it reads, and finding
 * "Authentication" in the event's message tells nobody anything.
 */
const CATEGORY_FIELDS: ReadonlySet<string> = new Set<string>([
  "classname",
  "classuid",
  "categoryname",
  "categoryuid",
  "activityname",
  "severityname",
  "severityid",
  "statusname",
  "vendorname",
  "productname",
  "requestoutcome",
]);

// The field keyword selections are matched against.
export const KEYWORD_FIELD: string = "message";

// A fragment shorter than this marks too much of an event to say anything.
const MIN_FRAGMENT_LENGTH: number = 2;

/*
 * The selections a condition needs to match, never the ones it needs not
 * to: under an even number of "not"s. "selection and not filter" looks for
 * the selection's values, never the filter's.
 */
export function getPositiveSelectionNames(rule: SigmaRule): Set<string> {
  const names: Set<string> = new Set<string>();
  const allNames: Array<string> = rule.selections.map(
    (selection: SigmaSelection): string => {
      return selection.name;
    },
  );

  const namesFor: (pattern: string) => Array<string> = (
    pattern: string,
  ): Array<string> => {
    if (pattern === "them") {
      return allNames;
    }

    if (pattern.endsWith("*")) {
      const prefix: string = pattern.slice(0, -1);

      return allNames.filter((name: string): boolean => {
        return name.startsWith(prefix);
      });
    }

    return allNames.filter((name: string): boolean => {
      return name === pattern;
    });
  };

  const walk: (node: SigmaConditionNode, isNegated: boolean) => void = (
    node: SigmaConditionNode,
    isNegated: boolean,
  ): void => {
    switch (node.kind) {
      case "selection":
        if (!isNegated) {
          names.add(node.name);
        }
        return;
      case "not":
        walk(node.child, !isNegated);
        return;
      case "and":
      case "or":
        for (const child of node.children) {
          walk(child, isNegated);
        }
        return;
      case "of":
        if (!isNegated) {
          for (const name of namesFor(node.pattern)) {
            names.add(name);
          }
        }
        return;
    }
  };

  walk(rule.condition, false);

  return names;
}

/*
 * The literal text in a Sigma value: the runs between its wildcards (`*`
 * any text, `?` one character), with an escaped character (a backslash
 * before it) kept as the character. "cmd*.exe /c" is "cmd" and ".exe /c";
 * "/etc/passwd" with a wildcard either side is "/etc/passwd".
 */
export function getSigmaLiteralFragments(value: string): Array<string> {
  const fragments: Array<string> = [];
  let current: string = "";
  let index: number = 0;

  const flush: () => void = (): void => {
    if (current.trim().length >= MIN_FRAGMENT_LENGTH) {
      fragments.push(current);
    }

    current = "";
  };

  while (index < value.length) {
    const character: string = value[index]!;

    if (character === "\\" && index + 1 < value.length) {
      current += value[index + 1]!;
      index += 2;
      continue;
    }

    if (character === "*" || character === "?") {
      flush();
    } else {
      current += character;
    }

    index++;
  }

  flush();

  return fragments;
}

function readRequirementValues(
  requirement: SigmaFieldRequirement,
): Array<string> {
  const isText: boolean = requirement.modifiers.every(
    (modifier: string): boolean => {
      return TEXT_MODIFIERS.has(modifier);
    },
  );

  if (!isText || CATEGORY_FIELDS.has(requirement.field.toLowerCase())) {
    return [];
  }

  return requirement.values.flatMap((value: JSONValue): Array<string> => {
    return typeof value === "string" ? getSigmaLiteralFragments(value) : [];
  });
}

/*
 * What a detection's rules look for, field by field: the literal text of
 * every value their conditions need to match - the selections a "not" does
 * not take away, through a modifier that matches text as written. A
 * correlation's rules are read alike. At most
 * SECURITY_CASE_MATCHES_MAX_LOOK_FOR values, each once (whatever its
 * case) and at most SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH long.
 */
export function getSigmaRuleLookFor(
  rules: ReadonlyArray<SigmaRule>,
): Array<SecurityCaseMatchLookForJson> {
  const byField: Map<string, Array<string>> = new Map();
  const seen: Set<string> = new Set<string>();
  let total: number = 0;

  const add: (field: string, value: string) => void = (
    field: string,
    value: string,
  ): void => {
    const text: string =
      value.length > SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH
        ? value.slice(0, SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH)
        : value;
    const key: string = text.toLowerCase();

    if (seen.has(key) || total >= SECURITY_CASE_MATCHES_MAX_LOOK_FOR) {
      return;
    }

    seen.add(key);
    total++;
    byField.set(field, [...(byField.get(field) || []), text]);
  };

  for (const rule of rules) {
    const positive: Set<string> = getPositiveSelectionNames(rule);

    for (const selection of rule.selections) {
      if (!positive.has(selection.name)) {
        continue;
      }

      for (const keyword of selection.keywords) {
        for (const fragment of getSigmaLiteralFragments(keyword)) {
          add(KEYWORD_FIELD, fragment);
        }
      }

      for (const fieldMap of selection.fieldMaps) {
        for (const requirement of fieldMap) {
          for (const value of readRequirementValues(requirement)) {
            add(requirement.field, value);
          }
        }
      }
    }
  }

  return Array.from(byField.entries()).map(
    (entry: [string, Array<string>]): SecurityCaseMatchLookForJson => {
      return { field: entry[0], values: entry[1] };
    },
  );
}

// ---------- A rule's own guidance ----------

export interface SigmaRuleGuidance {
  // When the rule is known to fire on something harmless, as its author wrote.
  falsePositives: Array<string>;
  // Where to read more about what it finds: http and https links only.
  references: Array<string>;
}

// What a Sigma rule writes when it knows of no false positive.
const NO_FALSE_POSITIVE_WORDS: ReadonlySet<string> = new Set<string>([
  "unknown",
  "none",
  "n/a",
  "na",
  "-",
]);

function readLines(value: unknown): Array<string> {
  const items: Array<unknown> = Array.isArray(value) ? value : [value];
  const lines: Array<string> = [];

  for (const item of items) {
    if (typeof item !== "string") {
      continue;
    }

    const text: string = item.trim();

    if (text) {
      lines.push(
        text.length > SECURITY_CASE_MATCHES_GUIDANCE_MAX_LENGTH
          ? `${text.slice(0, SECURITY_CASE_MATCHES_GUIDANCE_MAX_LENGTH - 1)}…`
          : text,
      );
    }
  }

  return lines;
}

function addOnce(list: Array<string>, value: string): void {
  if (
    list.length < SECURITY_CASE_MATCHES_MAX_GUIDANCE_LINES &&
    !list.some((item: string): boolean => {
      return item.toLowerCase() === value.toLowerCase();
    })
  ) {
    list.push(value);
  }
}

function isWebLink(value: string): boolean {
  try {
    const url: globalThis.URL = new globalThis.URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/*
 * The guidance a rule's own YAML gives: its `falsepositives` - each once,
 * leaving out the "Unknown" Sigma writes when it knows of none - and its
 * `references` that are web links. Every document of the file is read, so a
 * correlation's rules give theirs too. A file that does not read gives
 * none: guidance is never a reason to fail.
 */
export function readSigmaRuleGuidance(ruleYaml: string): SigmaRuleGuidance {
  const guidance: SigmaRuleGuidance = { falsePositives: [], references: [] };

  if (!ruleYaml || !ruleYaml.trim()) {
    return guidance;
  }

  let documents: Array<unknown> = [];

  try {
    documents = yaml.loadAll(ruleYaml) as Array<unknown>;
  } catch {
    return guidance;
  }

  for (const document of documents) {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      continue;
    }

    const record: { [key: string]: unknown } = document as {
      [key: string]: unknown;
    };

    for (const line of readLines(record["falsepositives"])) {
      if (!NO_FALSE_POSITIVE_WORDS.has(line.toLowerCase())) {
        addOnce(guidance.falsePositives, line);
      }
    }

    for (const line of readLines(record["references"])) {
      if (isWebLink(line)) {
        addOnce(guidance.references, line);
      }
    }
  }

  return guidance;
}

// ---------- Marking what a rule looks for ----------

export interface TextMatchPart {
  text: string;
  // The part is text the rule looks for.
  isMatch: boolean;
}

/*
 * A text in parts, each occurrence of a value the rule looks for marked -
 * found whatever its case, the longest first where two overlap - so the
 * case draws "../../" in "/get_log_file/../../proc/self/environ" apart.
 */
export function splitTextByLookFor(
  text: string,
  values: ReadonlyArray<string>,
): Array<TextMatchPart> {
  if (!text) {
    return [];
  }

  const lowered: string = text.toLowerCase();
  const marked: Array<boolean> = new Array<boolean>(text.length).fill(false);
  const needles: Array<string> = values
    .map((value: string): string => {
      return value.toLowerCase();
    })
    .filter((value: string): boolean => {
      return value.trim().length >= MIN_FRAGMENT_LENGTH;
    })
    .sort((a: string, b: string): number => {
      return b.length - a.length;
    });

  for (const needle of needles) {
    let from: number = 0;

    while (from <= lowered.length - needle.length) {
      const at: number = lowered.indexOf(needle, from);

      if (at === -1) {
        break;
      }

      for (let index: number = at; index < at + needle.length; index++) {
        marked[index] = true;
      }

      from = at + needle.length;
    }
  }

  const parts: Array<TextMatchPart> = [];

  for (let index: number = 0; index < text.length; index++) {
    const isMatch: boolean = marked[index] === true;
    const last: TextMatchPart | undefined = parts[parts.length - 1];

    if (last && last.isMatch === isMatch) {
      last.text += text[index];
    } else {
      parts.push({ text: text[index]!, isMatch });
    }
  }

  return parts;
}

// Every value a detection's rules look for, whatever the field.
export function getLookForValues(
  lookFor: ReadonlyArray<SecurityCaseMatchLookForJson>,
): Array<string> {
  return lookFor.flatMap(
    (entry: SecurityCaseMatchLookForJson): Array<string> => {
      return entry.values;
    },
  );
}

// ---------- The time a detection's events are read over ----------

export interface SecurityCaseMatchWindow {
  start: Date;
  end: Date;
}

function readDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * The time a detection's events are read over: from a window before it
 * first fired to just after it last fired - a rule counts its matches in
 * windows of its interval, each window's firing stamped at the window's
 * end - at most SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS from its start
 * (what opened the case is at the start), and never past now.
 * `lookBackInMinutes` is how long a window the source counts in; a source
 * that does not say is read a few minutes either side of its firings. Null
 * for a detection with no time at all.
 */
export function getDetectionMatchWindow(data: {
  firstSeenAt: Date | string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
  lookBackInMinutes?: number | undefined;
  now: Date;
}): SecurityCaseMatchWindow | null {
  const first: Date | null = readDate(data.firstSeenAt);
  const last: Date | null = readDate(data.lastSeenAt) || first;

  if (!first || !last) {
    return null;
  }

  const minute: number = 60 * 1000;
  const padding: number = SECURITY_CASE_MATCHES_PADDING_IN_MINUTES * minute;
  const countsInWindows: boolean = Boolean(
    data.lookBackInMinutes && data.lookBackInMinutes > 0,
  );
  // A minute of slack either side of a window, for the seconds a run takes.
  const lookBack: number = countsInWindows
    ? data.lookBackInMinutes! * minute + minute
    : padding;
  const lookAhead: number = countsInWindows ? minute : padding;

  const start: number = Math.min(first.getTime(), last.getTime()) - lookBack;
  const end: number = Math.min(
    Math.max(first.getTime(), last.getTime()) + lookAhead,
    start + SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS * 60 * minute,
    data.now.getTime(),
  );

  return {
    start: new Date(start),
    end: new Date(Math.max(start, end)),
  };
}
