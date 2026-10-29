import { JSONValue } from "../../../Types/JSON";
import SigmaRule, {
  SigmaFieldRequirement,
  SigmaSelection,
} from "../../../Types/SecurityEvent/SigmaRule";
import {
  DetectionRuleDefinition,
  SigmaCorrelationStep,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import {
  SECURITY_WATCHLIST_MODIFIER,
  SigmaWatchlist,
  SigmaWatchlists,
  getSecurityWatchlistNameKey,
  readSecurityWatchlistPlaceholder,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import SigmaRuleSetParser, { sigmaRulesOf } from "./SigmaRuleSetParser";

/*
 * Which watchlists a detection rule reads, and the rule with them bound.
 *
 * A rule names a watchlist in its YAML (`principalUser|expand:
 * '%vip_users%'`); the project holds the list. Before a rule is compiled -
 * when it is saved, run, or run on past events - the server reads the lists
 * it names and binds them to its Sigma rules (bindSigmaWatchlists), so the
 * compiler turns each into the list's values. The Dashboard reads the same
 * names to say which rules read a list, and the API to refuse deleting or
 * renaming a list a rule still reads.
 *
 * React-free and project-free: plain data in, plain data out.
 */

export interface SigmaWatchlistReference {
  // As the rule wrote it, the first time it named the list.
  name: string;
  // getSecurityWatchlistNameKey(name): how lists are found, whatever the case.
  key: string;
}

function requirementsOf(rule: SigmaRule): Array<SigmaFieldRequirement> {
  return rule.selections.flatMap(
    (selection: SigmaSelection): Array<SigmaFieldRequirement> => {
      return selection.fieldMaps.flat();
    },
  );
}

// The watchlists one Sigma rule names, each once, in the order the rule names them.
export function getSigmaRuleWatchlistReferences(
  rule: SigmaRule,
): Array<SigmaWatchlistReference> {
  const references: Array<SigmaWatchlistReference> = [];
  const seen: Set<string> = new Set();

  for (const requirement of requirementsOf(rule)) {
    if (!requirement.modifiers.includes(SECURITY_WATCHLIST_MODIFIER)) {
      continue;
    }

    for (const value of requirement.values) {
      const name: string | null = readSecurityWatchlistPlaceholder(value);

      if (!name) {
        continue;
      }

      const key: string = getSecurityWatchlistNameKey(name);

      if (!seen.has(key)) {
        seen.add(key);
        references.push({ name, key });
      }
    }
  }

  return references;
}

/*
 * The watchlists a detection rule's YAML names, each once: every Sigma rule
 * of the file - a single rule, or a correlation's steps. A rule a
 * correlation reads from the project's other detection rules names its own
 * lists, in its own YAML.
 */
export function getDetectionRuleWatchlistReferences(
  definition: DetectionRuleDefinition,
): Array<SigmaWatchlistReference> {
  const references: Array<SigmaWatchlistReference> = [];
  const seen: Set<string> = new Set();

  for (const rule of sigmaRulesOf(definition)) {
    for (const reference of getSigmaRuleWatchlistReferences(rule)) {
      if (!seen.has(reference.key)) {
        seen.add(reference.key);
        references.push(reference);
      }
    }
  }

  return references;
}

/*
 * The watchlists a rule's YAML names, or none when it does not parse (a rule
 * being typed, or a stored rule an older version saved).
 */
export function readDetectionRuleWatchlistReferences(
  yaml: unknown,
): Array<SigmaWatchlistReference> {
  if (typeof yaml !== "string" || !yaml.trim()) {
    return [];
  }

  // Cheap first: a rule that never writes the modifier reads no list.
  if (!yaml.includes(`|${SECURITY_WATCHLIST_MODIFIER}`)) {
    return [];
  }

  try {
    return getDetectionRuleWatchlistReferences(SigmaRuleSetParser.parse(yaml));
  } catch {
    return [];
  }
}

// What the rules read: a rule by its id and name.
export interface WatchlistReadingRule {
  id: string;
  name: string;
  sigmaRuleYaml?: string | null | undefined;
}

/*
 * The rules that read each watchlist, by name key, in the order given:
 * what a watchlist's row says ("Read by"), and what keeps it from being
 * deleted or renamed while a rule still reads it.
 */
export function getRulesReadingWatchlists(
  rules: ReadonlyArray<WatchlistReadingRule>,
): Map<string, Array<{ id: string; name: string }>> {
  const byKey: Map<string, Array<{ id: string; name: string }>> = new Map();

  for (const rule of rules) {
    for (const reference of readDetectionRuleWatchlistReferences(
      rule.sigmaRuleYaml,
    )) {
      const readers: Array<{ id: string; name: string }> =
        byKey.get(reference.key) || [];
      readers.push({ id: rule.id, name: rule.name });
      byKey.set(reference.key, readers);
    }
  }

  return byKey;
}

/*
 * The names a definition reads that are not among the lists given: what a
 * save refuses, naming each.
 */
export function getMissingSigmaWatchlists(
  definition: DetectionRuleDefinition,
  watchlists: SigmaWatchlists,
): Array<string> {
  return getDetectionRuleWatchlistReferences(definition)
    .filter((reference: SigmaWatchlistReference): boolean => {
      return !Object.prototype.hasOwnProperty.call(watchlists, reference.key);
    })
    .map((reference: SigmaWatchlistReference): string => {
      return reference.name;
    });
}

// The lists one rule reads, out of those given: what is bound to it.
function watchlistsFor(
  rule: SigmaRule,
  watchlists: SigmaWatchlists,
): SigmaWatchlists | undefined {
  const references: Array<SigmaWatchlistReference> =
    getSigmaRuleWatchlistReferences(rule);

  if (references.length === 0) {
    return undefined;
  }

  const bound: SigmaWatchlists = {};

  for (const reference of references) {
    if (Object.prototype.hasOwnProperty.call(watchlists, reference.key)) {
      bound[reference.key] = watchlists[reference.key] as SigmaWatchlist;
    }
  }

  return bound;
}

function bindRule(rule: SigmaRule, watchlists: SigmaWatchlists): SigmaRule {
  const bound: SigmaWatchlists | undefined = watchlistsFor(rule, watchlists);

  return bound ? { ...rule, watchlists: bound } : rule;
}

/*
 * The definition with each of its Sigma rules carrying the lists it names
 * (SigmaRule.watchlists), for the compiler. A copy: the rules given are
 * left as they were. A name missing from the lists given stays unbound, and
 * compiling it fails - check getMissingSigmaWatchlists first to say which.
 */
export function bindSigmaWatchlists(
  definition: DetectionRuleDefinition,
  watchlists: SigmaWatchlists,
): DetectionRuleDefinition {
  if (definition.kind === "single") {
    return { ...definition, rule: bindRule(definition.rule, watchlists) };
  }

  return {
    ...definition,
    steps: definition.steps.map(
      (step: SigmaCorrelationStep): SigmaCorrelationStep => {
        return {
          ...step,
          rule: step.rule ? bindRule(step.rule, watchlists) : step.rule,
          count: step.count
            ? {
                ...step.count,
                rules: step.count.rules.map((rule: SigmaRule): SigmaRule => {
                  return bindRule(rule, watchlists);
                }),
              }
            : step.count,
        };
      },
    ),
  };
}

// Whether a requirement reads watchlists: `field|expand`.
export function isSigmaWatchlistRequirement(
  requirement: SigmaFieldRequirement,
): boolean {
  return requirement.modifiers.includes(SECURITY_WATCHLIST_MODIFIER);
}

// The name key a requirement's value names, or null for a value that names no list.
export function getSigmaWatchlistKey(value: JSONValue): string | null {
  const name: string | null = readSecurityWatchlistPlaceholder(value);
  return name ? getSecurityWatchlistNameKey(name) : null;
}
