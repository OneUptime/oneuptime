import yaml from "js-yaml";
import BadDataException from "../../../Types/Exception/BadDataException";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import SigmaRule, {
  SIGMA_DEFAULT_LEVEL,
  SigmaLevel,
} from "../../../Types/SecurityEvent/SigmaRule";
import {
  DetectionRuleDefinition,
  SIGMA_COMPARISON_OPERATORS,
  SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS,
  SIGMA_CORRELATION_MAX_RULES,
  SIGMA_CORRELATION_MAX_TEMPORAL_RULES,
  SIGMA_CORRELATION_MAX_TIMESPAN_IN_SECONDS,
  SIGMA_CORRELATION_MIN_TEMPORAL_RULES,
  SIGMA_CORRELATION_MIN_TIMESPAN_IN_SECONDS,
  SIGMA_CORRELATION_TYPES,
  SIGMA_NEW_VALUE_MAX_TIMESPAN_IN_SECONDS,
  SIGMA_NEW_VALUE_MIN_TIMESPAN_IN_SECONDS,
  SIGMA_UNSUPPORTED_CORRELATION_TYPES,
  SigmaComparison,
  SigmaComparisonOperator,
  SigmaCorrelation,
  SigmaCorrelationCondition,
  SigmaCorrelationStep,
  SigmaCorrelationType,
  SigmaRuleReferenceResolver,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleParser, { extractMitre } from "./SigmaRuleParser";

/*
 * A detection rule's YAML -> DetectionRuleDefinition: one Sigma rule, or a
 * Sigma correlation with the rules it reads (SigmaCorrelation.ts).
 *
 * One document without `correlation` is a single Sigma rule, parsed exactly
 * as SigmaRuleParser always has. Anything else is a correlation's file: its
 * documents are Sigma rules (each named, so the correlation can say which
 * it reads) and correlations, and exactly one correlation - the one no other
 * correlation reads - is the rule's. Every check is made here, when the rule
 * is saved, so a rule that stores is one the engine can run: a type the
 * engine does not implement, a reference to nothing, a step it cannot time
 * or a timespan out of bounds is refused with what to change.
 */

// Documents in one rule's file: a correlation, its steps' correlations and their rules.
export const SIGMA_RULE_SET_MAX_DOCUMENTS: number = 25;

// A timespan's units, as the Sigma specification writes them, in seconds.
const TIMESPAN_UNITS: Dictionary<number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

const DIGITS: string = "0123456789";

interface RuleDocument {
  kind: "rule";
  index: number;
  name: string;
  rule: SigmaRule;
}

interface CorrelationDocument {
  kind: "correlation";
  index: number;
  correlation: SigmaCorrelation;
}

type SetDocument = RuleDocument | CorrelationDocument;

function isMapping(value: unknown): value is JSONObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: JSONValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function describeDocument(index: number): string {
  return `document ${index + 1}`;
}

/*
 * "10m" -> 600. A whole number and one unit letter (s, m, h, d or w); read
 * without a regular expression, so a long value is read in one pass.
 */
export function parseSigmaTimespan(value: JSONValue | undefined): number {
  const text: string = readText(value);

  if (text.length < 2 || text.length > 12) {
    throw new BadDataException(
      `Sigma correlation: timespan "${text}" must be a whole number and a unit, such as 30s, 10m, 2h or 7d.`,
    );
  }

  const unit: string = text.charAt(text.length - 1);
  const multiplier: number | undefined = Object.prototype.hasOwnProperty.call(
    TIMESPAN_UNITS,
    unit,
  )
    ? TIMESPAN_UNITS[unit]
    : undefined;
  const digits: string = text.slice(0, -1);

  let allDigits: boolean = digits.length > 0;

  for (const char of digits) {
    if (!DIGITS.includes(char)) {
      allDigits = false;
      break;
    }
  }

  if (!multiplier || !allDigits) {
    throw new BadDataException(
      `Sigma correlation: timespan "${text}" must be a whole number and a unit, such as 30s, 10m, 2h or 7d.`,
    );
  }

  const seconds: number = Number(digits) * multiplier;

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new BadDataException(
      `Sigma correlation: timespan "${text}" must be longer than nothing.`,
    );
  }

  return seconds;
}

// A timespan, as a person says it: "10 minutes", "1 hour", "14 days".
export function describeSigmaTimespan(seconds: number): string {
  const units: Array<[number, string]> = [
    [7 * 24 * 60 * 60, "week"],
    [24 * 60 * 60, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
    [1, "second"],
  ];

  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count: number = seconds / size;
      return `${count} ${name}${count === 1 ? "" : "s"}`;
    }
  }

  return `${seconds} seconds`;
}

function readStringList(
  value: JSONValue | undefined,
  what: string,
  options: { rejectDuplicates?: boolean } = {},
): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  const items: Array<JSONValue> = Array.isArray(value) ? value : [value];
  const list: Array<string> = [];

  for (const item of items) {
    if (item === null || typeof item === "object") {
      throw new BadDataException(
        `Sigma correlation: every entry of ${what} must be a name, not a list or a mapping.`,
      );
    }

    const text: string = String(item).trim();

    if (!text) {
      throw new BadDataException(
        `Sigma correlation: ${what} has an empty entry.`,
      );
    }

    if (list.includes(text)) {
      if (options.rejectDuplicates) {
        throw new BadDataException(
          `Sigma correlation: ${what} names "${text}" twice.`,
        );
      }

      continue;
    }

    list.push(text);
  }

  return list;
}

function parseCondition(
  value: JSONValue | undefined,
): SigmaCorrelationCondition {
  const condition: SigmaCorrelationCondition = {
    comparisons: [],
    fields: [],
  };

  if (value === undefined || value === null) {
    return condition;
  }

  if (!isMapping(value)) {
    throw new BadDataException(
      "Sigma correlation: `condition` must be a mapping, such as `gte: 10`.",
    );
  }

  for (const key of Object.keys(value)) {
    const raw: JSONValue = value[key] as JSONValue;

    if (key === "field") {
      condition.fields = readStringList(raw, "`condition.field`");
      continue;
    }

    if (!(SIGMA_COMPARISON_OPERATORS as ReadonlyArray<string>).includes(key)) {
      throw new BadDataException(
        `Sigma correlation: "${key}" is not a condition. Use gt, gte, lt, lte, eq or neq, and field for value_count and new_value.`,
      );
    }

    const number: number =
      typeof raw === "number" ? raw : Number(readText(raw));

    if (!Number.isSafeInteger(number) || number < 0) {
      throw new BadDataException(
        `Sigma correlation: condition "${key}" must be a whole number, not "${readText(raw)}".`,
      );
    }

    condition.comparisons.push({
      operator: key as SigmaComparisonOperator,
      value: number,
    });
  }

  return condition;
}

function parseAliases(
  value: JSONValue | undefined,
): Dictionary<Dictionary<string>> {
  const aliases: Dictionary<Dictionary<string>> = {};

  if (value === undefined || value === null) {
    return aliases;
  }

  if (!isMapping(value)) {
    throw new BadDataException(
      "Sigma correlation: `aliases` must map each alias to the field every rule keeps it in.",
    );
  }

  for (const alias of Object.keys(value)) {
    const fields: JSONValue = value[alias] as JSONValue;

    if (!isMapping(fields)) {
      throw new BadDataException(
        `Sigma correlation: alias "${alias}" must map each rule to a field, such as \`failed_sign_in: principalIp\`.`,
      );
    }

    const byRule: Dictionary<string> = {};

    for (const ruleReference of Object.keys(fields)) {
      const field: string = readText(fields[ruleReference] as JSONValue);

      if (!field) {
        throw new BadDataException(
          `Sigma correlation: alias "${alias}" names no field for "${ruleReference}".`,
        );
      }

      byRule[ruleReference] = field;
    }

    aliases[alias] = byRule;
  }

  return aliases;
}

function parseLevel(value: JSONValue | undefined): SigmaLevel {
  const text: string = readText(value).toLowerCase();

  return (Object.values(SigmaLevel) as Array<string>).includes(text)
    ? (text as SigmaLevel)
    : SIGMA_DEFAULT_LEVEL;
}

function parseTags(value: JSONValue | undefined): Array<string> {
  return Array.isArray(value)
    ? value.map((tag: JSONValue): string => {
        return String(tag);
      })
    : [];
}

function parseCorrelationDocument(
  doc: JSONObject,
  index: number,
): SigmaCorrelation {
  const section: JSONValue | undefined = doc["correlation"];

  if (!isMapping(section)) {
    throw new BadDataException(
      `Sigma correlation (${describeDocument(index)}): \`correlation\` must be a mapping with type, rules, group-by and timespan.`,
    );
  }

  if (doc["detection"] !== undefined) {
    throw new BadDataException(
      `Sigma correlation (${describeDocument(index)}): a document is a rule (detection) or a correlation, not both.`,
    );
  }

  const typeText: string = readText(section["type"] as JSONValue);

  if (SIGMA_UNSUPPORTED_CORRELATION_TYPES.includes(typeText)) {
    throw new BadDataException(
      `Sigma correlation: type "${typeText}" is not supported. Supported: ${SIGMA_CORRELATION_TYPES.join(", ")}.`,
    );
  }

  if (!(SIGMA_CORRELATION_TYPES as ReadonlyArray<string>).includes(typeText)) {
    throw new BadDataException(
      `Sigma correlation (${describeDocument(index)}): \`type\` must be one of ${SIGMA_CORRELATION_TYPES.join(", ")}${typeText ? `, not "${typeText}"` : ""}.`,
    );
  }

  const rules: Array<string> = readStringList(
    section["rules"] as JSONValue,
    "`rules`",
    { rejectDuplicates: true },
  );

  if (rules.length === 0) {
    throw new BadDataException(
      `Sigma correlation (${describeDocument(index)}): \`rules\` must name at least one rule, by its name or id.`,
    );
  }

  /*
   * The Sigma specification writes `group-by`; `group_by` and `groupBy`
   * are read too, the way rules are pasted from other tools.
   */
  const groupByRaw: JSONValue | undefined =
    section["group-by"] !== undefined
      ? (section["group-by"] as JSONValue)
      : section["group_by"] !== undefined
        ? (section["group_by"] as JSONValue)
        : (section["groupBy"] as JSONValue | undefined);

  const groupBy: Array<string> = readStringList(groupByRaw, "`group-by`");

  if (groupBy.length > SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS) {
    throw new BadDataException(
      `Sigma correlation: \`group-by\` takes at most ${SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS} fields.`,
    );
  }

  if (section["timespan"] === undefined || section["timespan"] === null) {
    throw new BadDataException(
      `Sigma correlation (${describeDocument(index)}): \`timespan\` is required, such as 10m.`,
    );
  }

  const timespanInSeconds: number = parseSigmaTimespan(
    section["timespan"] as JSONValue,
  );

  const tags: Array<string> = parseTags(doc["tags"] as JSONValue);
  const mitre: { tactics: Array<string>; techniques: Array<string> } =
    extractMitre(tags);

  return {
    title: readText(doc["title"] as JSONValue) || "Untitled correlation",
    id: readText(doc["id"] as JSONValue),
    name: readText(doc["name"] as JSONValue),
    description: readText(doc["description"] as JSONValue),
    level: parseLevel(doc["level"] as JSONValue),
    tags,
    mitreTactics: mitre.tactics,
    mitreTechniques: mitre.techniques,
    type: typeText as SigmaCorrelationType,
    rules,
    groupBy,
    timespan: readText(section["timespan"] as JSONValue),
    timespanInSeconds,
    condition: parseCondition(section["condition"] as JSONValue),
    aliases: parseAliases(section["aliases"] as JSONValue),
  };
}

function comparisonsReach(comparisons: Array<SigmaComparison>): boolean {
  return comparisons.every((comparison: SigmaComparison): boolean => {
    return comparison.operator === "gte" || comparison.operator === "gt";
  });
}

/*
 * The smallest count a comparison set is met at, for the counts a step or
 * a query starts from: gte 10 -> 10, gt 10 -> 11, and 1 when nothing asks
 * for more.
 */
export function minimumCountFor(comparisons: Array<SigmaComparison>): number {
  let minimum: number = 1;

  for (const comparison of comparisons) {
    if (comparison.operator === "gte") {
      minimum = Math.max(minimum, comparison.value);
    } else if (comparison.operator === "gt") {
      minimum = Math.max(minimum, comparison.value + 1);
    } else if (comparison.operator === "eq") {
      minimum = Math.max(minimum, comparison.value);
    }
  }

  return minimum;
}

// Whether a count meets every comparison (they are ANDed).
export function countMeetsComparisons(
  count: number,
  comparisons: Array<SigmaComparison>,
): boolean {
  return comparisons.every((comparison: SigmaComparison): boolean => {
    switch (comparison.operator) {
      case "gt":
        return count > comparison.value;
      case "gte":
        return count >= comparison.value;
      case "lt":
        return count < comparison.value;
      case "lte":
        return count <= comparison.value;
      case "eq":
        return count === comparison.value;
      case "neq":
        return count !== comparison.value;
      default:
        return false;
    }
  });
}

export default class SigmaRuleSetParser {
  /*
   * Whether a YAML is a correlation's file: more than one document, or a
   * document with a top-level `correlation`. Cheap enough for a form to
   * ask on every keystroke; it never throws.
   */
  public static isCorrelationYaml(text: unknown): boolean {
    if (typeof text !== "string" || !text.trim()) {
      return false;
    }

    try {
      const definition: DetectionRuleDefinition = this.parse(text);
      return definition.kind === "correlation";
    } catch {
      return false;
    }
  }

  public static parse(
    text: string,
    options: { resolveReference?: SigmaRuleReferenceResolver | undefined } = {},
  ): DetectionRuleDefinition {
    if (!text || !text.trim()) {
      throw new BadDataException("Sigma rule: YAML is empty.");
    }

    let loaded: Array<unknown>;

    try {
      loaded = yaml.loadAll(text);
    } catch (error) {
      throw new BadDataException(
        `Sigma rule: invalid YAML — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // A leading or trailing `---` makes an empty document: not a rule.
    const docs: Array<unknown> = loaded.filter((doc: unknown): boolean => {
      return doc !== null && doc !== undefined;
    });

    if (docs.length === 0) {
      throw new BadDataException("Sigma rule: YAML is empty.");
    }

    if (docs.length > SIGMA_RULE_SET_MAX_DOCUMENTS) {
      throw new BadDataException(
        `Sigma rule: one detection rule holds at most ${SIGMA_RULE_SET_MAX_DOCUMENTS} YAML documents.`,
      );
    }

    for (let index: number = 0; index < docs.length; index++) {
      if (!isMapping(docs[index])) {
        throw new BadDataException(
          docs.length === 1
            ? "Sigma rule: YAML must be a mapping."
            : `Sigma rule: ${describeDocument(index)} must be a mapping.`,
        );
      }
    }

    const first: JSONObject = docs[0] as JSONObject;

    if (docs.length === 1 && first["correlation"] === undefined) {
      return {
        kind: "single",
        rule: SigmaRuleParser.parseDocument(first),
        name: readText(first["name"] as JSONValue),
      };
    }

    return this.parseCorrelationSet(docs as Array<JSONObject>, options);
  }

  private static parseCorrelationSet(
    docs: Array<JSONObject>,
    options: { resolveReference?: SigmaRuleReferenceResolver | undefined },
  ): DetectionRuleDefinition {
    const parsed: Array<SetDocument> = docs.map(
      (doc: JSONObject, index: number): SetDocument => {
        if (doc["correlation"] !== undefined) {
          return {
            kind: "correlation",
            index,
            correlation: parseCorrelationDocument(doc, index),
          };
        }

        if (doc["detection"] === undefined) {
          throw new BadDataException(
            `Sigma rule: ${describeDocument(index)} is neither a rule (it has no \`detection\`) nor a correlation (it has no \`correlation\`).`,
          );
        }

        let rule: SigmaRule;

        try {
          rule = SigmaRuleParser.parseDocument(doc);
        } catch (error) {
          throw new BadDataException(
            `${describeDocument(index)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        return {
          kind: "rule",
          index,
          name: readText(doc["name"] as JSONValue),
          rule,
        };
      },
    );

    const correlations: Array<CorrelationDocument> = parsed.filter(
      (doc: SetDocument): doc is CorrelationDocument => {
        return doc.kind === "correlation";
      },
    );

    if (correlations.length === 0) {
      throw new BadDataException(
        "Sigma rule: several rules in one detection rule need a correlation that says how they go together. Save each rule on its own, or add a correlation document that reads them.",
      );
    }

    // Every name and id names one document.
    const keyOwners: Map<string, SetDocument> = new Map();

    for (const doc of parsed) {
      const keys: Array<string> =
        doc.kind === "rule"
          ? [doc.name, doc.rule.id]
          : [doc.correlation.name, doc.correlation.id];

      for (const key of keys) {
        if (!key) {
          continue;
        }

        const owner: SetDocument | undefined = keyOwners.get(key);

        if (owner && owner !== doc) {
          throw new BadDataException(
            `Sigma rule: "${key}" names both ${describeDocument(owner.index)} and ${describeDocument(doc.index)}. Every name and id in the file must be its own.`,
          );
        }

        keyOwners.set(key, doc);
      }
    }

    // What each correlation reads, of the file's own documents.
    const readBy: Map<SetDocument, Array<CorrelationDocument>> = new Map();

    for (const correlation of correlations) {
      for (const reference of correlation.correlation.rules) {
        const target: SetDocument | undefined = keyOwners.get(reference);

        if (!target) {
          continue;
        }

        if (target === correlation) {
          throw new BadDataException(
            `Sigma correlation "${correlation.correlation.title}" reads itself.`,
          );
        }

        readBy.set(target, [...(readBy.get(target) || []), correlation]);
      }
    }

    const outermost: Array<CorrelationDocument> = correlations.filter(
      (correlation: CorrelationDocument): boolean => {
        return !readBy.has(correlation);
      },
    );

    if (outermost.length !== 1) {
      throw new BadDataException(
        outermost.length === 0
          ? "Sigma rule: the correlations read each other in a circle; one of them must be the rule's, read by no other."
          : `Sigma rule: one detection rule holds one correlation, and this file has ${outermost.length} that nothing else reads (${outermost
              .map((correlation: CorrelationDocument): string => {
                return `"${correlation.correlation.title}"`;
              })
              .join(", ")}). Save each as its own rule.`,
      );
    }

    for (const doc of parsed) {
      if (doc.kind === "rule" && !readBy.has(doc)) {
        throw new BadDataException(
          `Sigma rule: "${doc.name || doc.rule.title}" (${describeDocument(doc.index)}) is in the file, but no correlation reads it. Name it under a correlation's \`rules\`, or remove it.`,
        );
      }
    }

    const main: SigmaCorrelation = outermost[0]!.correlation;

    this.validateCorrelationShape(main);

    const unresolvedReferences: Array<string> = [];

    const steps: Array<SigmaCorrelationStep> = main.rules.map(
      (reference: string): SigmaCorrelationStep => {
        const target: SetDocument | undefined = keyOwners.get(reference);

        if (target && target.kind === "rule") {
          return {
            reference,
            title: target.rule.title,
            rule: target.rule,
            origin: "file",
          };
        }

        if (target && target.kind === "correlation") {
          return this.buildCountStep({
            main,
            reference,
            inner: target.correlation,
            keyOwners,
            options,
          });
        }

        const resolved: SigmaRule | undefined = options.resolveReference
          ? options.resolveReference(reference)
          : undefined;

        if (resolved) {
          return {
            reference,
            title: resolved.title,
            rule: resolved,
            origin: "project",
          };
        }

        unresolvedReferences.push(reference);

        return { reference, title: reference, origin: "project" };
      },
    );

    if (options.resolveReference && unresolvedReferences.length > 0) {
      throw new BadDataException(
        `Sigma correlation "${main.title}": ${unresolvedReferences
          .map((reference: string): string => {
            return `"${reference}"`;
          })
          .join(
            ", ",
          )} is not in this YAML, nor the name or id of one of your detection rules.`,
      );
    }

    this.validateAliases(main, steps);

    return {
      kind: "correlation",
      correlation: this.withStepTags(main, steps),
      steps,
      unresolvedReferences,
    };
  }

  /*
   * A correlation of the file read as a step of the main one: an
   * event_count over Sigma rules, only as a step of a temporal correlation
   * ("ten failed sign-ins, then a success").
   */
  private static buildCountStep(data: {
    main: SigmaCorrelation;
    reference: string;
    inner: SigmaCorrelation;
    keyOwners: Map<string, SetDocument>;
    options: { resolveReference?: SigmaRuleReferenceResolver | undefined };
  }): SigmaCorrelationStep {
    const { main, inner } = data;

    if (
      main.type !== SigmaCorrelationType.Temporal &&
      main.type !== SigmaCorrelationType.TemporalOrdered
    ) {
      throw new BadDataException(
        `Sigma correlation "${main.title}": a ${main.type} correlation reads Sigma rules; only temporal and temporal_ordered correlations can read another correlation.`,
      );
    }

    if (inner.type !== SigmaCorrelationType.EventCount) {
      throw new BadDataException(
        `Sigma correlation "${main.title}": its step "${data.reference}" is a ${inner.type} correlation. A step can be a Sigma rule or an event_count correlation.`,
      );
    }

    this.validateCorrelationShape(inner);

    if (!comparisonsReach(inner.condition.comparisons)) {
      throw new BadDataException(
        `Sigma correlation "${inner.title}": as a step, its condition says how many events it takes (gte or gt), not fewer.`,
      );
    }

    const rules: Array<SigmaRule> = inner.rules.map(
      (reference: string): SigmaRule => {
        const target: SetDocument | undefined = data.keyOwners.get(reference);

        if (target && target.kind === "rule") {
          return target.rule;
        }

        if (target && target.kind === "correlation") {
          throw new BadDataException(
            `Sigma correlation "${inner.title}": it reads "${reference}", another correlation. A correlation read as a step reads Sigma rules.`,
          );
        }

        const resolved: SigmaRule | undefined = data.options.resolveReference
          ? data.options.resolveReference(reference)
          : undefined;

        if (resolved) {
          return resolved;
        }

        if (data.options.resolveReference) {
          throw new BadDataException(
            `Sigma correlation "${inner.title}": "${reference}" is not in this YAML, nor the name or id of one of your detection rules.`,
          );
        }

        // Left for the project's rules: a form checks the shape only.
        return {
          title: reference,
          id: "",
          description: "",
          level: SIGMA_DEFAULT_LEVEL,
          status: "",
          tags: [],
          mitreTactics: [],
          mitreTechniques: [],
          logsource: {},
          selections: [],
          condition: { kind: "selection", name: reference },
        };
      },
    );

    return {
      reference: data.reference,
      title: inner.title,
      count: { correlation: inner, rules },
      origin: "file",
    };
  }

  // What each type asks for, checked on the correlation alone.
  private static validateCorrelationShape(correlation: SigmaCorrelation): void {
    const label: string = `Sigma correlation "${correlation.title}"`;
    const { comparisons, fields } = correlation.condition;

    const isTemporal: boolean =
      correlation.type === SigmaCorrelationType.Temporal ||
      correlation.type === SigmaCorrelationType.TemporalOrdered;

    if (isTemporal) {
      if (
        correlation.rules.length < SIGMA_CORRELATION_MIN_TEMPORAL_RULES ||
        correlation.rules.length > SIGMA_CORRELATION_MAX_TEMPORAL_RULES
      ) {
        throw new BadDataException(
          `${label}: a ${correlation.type} correlation reads ${SIGMA_CORRELATION_MIN_TEMPORAL_RULES} to ${SIGMA_CORRELATION_MAX_TEMPORAL_RULES} rules.`,
        );
      }
    } else if (correlation.rules.length > SIGMA_CORRELATION_MAX_RULES) {
      throw new BadDataException(
        `${label}: a correlation reads at most ${SIGMA_CORRELATION_MAX_RULES} rules.`,
      );
    }

    if (correlation.type === SigmaCorrelationType.NewValue) {
      if (
        correlation.timespanInSeconds <
          SIGMA_NEW_VALUE_MIN_TIMESPAN_IN_SECONDS ||
        correlation.timespanInSeconds > SIGMA_NEW_VALUE_MAX_TIMESPAN_IN_SECONDS
      ) {
        throw new BadDataException(
          `${label}: a new_value correlation's timespan is how far back "seen before" reaches, 1d to 30d.`,
        );
      }
    } else if (
      correlation.timespanInSeconds <
        SIGMA_CORRELATION_MIN_TIMESPAN_IN_SECONDS ||
      correlation.timespanInSeconds > SIGMA_CORRELATION_MAX_TIMESPAN_IN_SECONDS
    ) {
      throw new BadDataException(`${label}: its timespan is at most 24h.`);
    }

    switch (correlation.type) {
      case SigmaCorrelationType.EventCount: {
        if (comparisons.length === 0) {
          throw new BadDataException(
            `${label}: an event_count correlation needs a condition, such as \`gte: 10\`.`,
          );
        }

        if (fields.length > 0) {
          throw new BadDataException(
            `${label}: an event_count correlation counts events. To count the different values of a field, use value_count.`,
          );
        }
        return;
      }

      case SigmaCorrelationType.ValueCount: {
        if (fields.length === 0) {
          throw new BadDataException(
            `${label}: a value_count correlation needs \`condition.field\`, the field whose different values it counts.`,
          );
        }

        if (comparisons.length === 0) {
          throw new BadDataException(
            `${label}: a value_count correlation needs a condition, such as \`gte: 5\`.`,
          );
        }
        return;
      }

      case SigmaCorrelationType.Temporal: {
        if (fields.length > 0) {
          throw new BadDataException(
            `${label}: a temporal correlation's condition counts the rules that matched; it takes no field.`,
          );
        }

        for (const comparison of comparisons) {
          if (
            comparison.operator !== "gte" ||
            comparison.value < SIGMA_CORRELATION_MIN_TEMPORAL_RULES ||
            comparison.value > correlation.rules.length
          ) {
            throw new BadDataException(
              `${label}: its condition can only say how many of its ${correlation.rules.length} rules must match, as \`gte: N\` with N from ${SIGMA_CORRELATION_MIN_TEMPORAL_RULES} to ${correlation.rules.length}. Without one, every rule must.`,
            );
          }
        }
        return;
      }

      case SigmaCorrelationType.TemporalOrdered: {
        const allRules: boolean = comparisons.every(
          (comparison: SigmaComparison): boolean => {
            return (
              (comparison.operator === "gte" || comparison.operator === "eq") &&
              comparison.value === correlation.rules.length
            );
          },
        );

        if (fields.length > 0 || !allRules) {
          throw new BadDataException(
            `${label}: a temporal_ordered correlation matches when every rule matches, in order. Leave its condition out.`,
          );
        }
        return;
      }

      case SigmaCorrelationType.NewValue: {
        if (correlation.groupBy.length === 0) {
          throw new BadDataException(
            `${label}: a new_value correlation needs \`group-by\`: whose values are new, such as principalUser.`,
          );
        }

        if (fields.length === 0) {
          throw new BadDataException(
            `${label}: a new_value correlation needs \`condition.field\`: the value that is new for the group, such as principalIp.`,
          );
        }

        if (fields.length > SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS) {
          throw new BadDataException(
            `${label}: \`condition.field\` takes at most ${SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS} fields.`,
          );
        }

        if (comparisons.length > 0) {
          throw new BadDataException(
            `${label}: a new_value correlation fires on every new value; its condition takes only \`field\`.`,
          );
        }
        return;
      }

      default:
        return;
    }
  }

  // Every alias a group-by names says where each step keeps it.
  private static validateAliases(
    correlation: SigmaCorrelation,
    steps: Array<SigmaCorrelationStep>,
  ): void {
    for (const field of correlation.groupBy) {
      const byRule: Dictionary<string> | undefined =
        Object.prototype.hasOwnProperty.call(correlation.aliases, field)
          ? correlation.aliases[field]
          : undefined;

      if (!byRule) {
        continue;
      }

      for (const step of steps) {
        if (!Object.prototype.hasOwnProperty.call(byRule, step.reference)) {
          throw new BadDataException(
            `Sigma correlation "${correlation.title}": alias "${field}" does not say which field "${step.reference}" keeps it in.`,
          );
        }
      }
    }
  }

  /*
   * A correlation without ATT&CK tags of its own takes its steps': the
   * coverage view and the findings say what the rules it reads say.
   */
  private static withStepTags(
    correlation: SigmaCorrelation,
    steps: Array<SigmaCorrelationStep>,
  ): SigmaCorrelation {
    if (correlation.tags.length > 0) {
      return correlation;
    }

    const tags: Array<string> = [];

    const addTags: (rule: SigmaRule) => void = (rule: SigmaRule): void => {
      for (const tag of rule.tags) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    };

    for (const step of steps) {
      if (step.rule) {
        addTags(step.rule);
      }

      if (step.count) {
        for (const tag of step.count.correlation.tags) {
          if (!tags.includes(tag)) {
            tags.push(tag);
          }
        }

        step.count.rules.forEach(addTags);
      }
    }

    const mitre: { tactics: Array<string>; techniques: Array<string> } =
      extractMitre(tags);

    return {
      ...correlation,
      tags,
      mitreTactics: mitre.tactics,
      mitreTechniques: mitre.techniques,
    };
  }
}

/*
 * The rule a correlation's findings, alerts and cases are written as: its
 * title, level, description, id and ATT&CK tags, in a Sigma rule's shape,
 * so everything downstream of a match reads a correlation the way it reads
 * a single rule.
 */
export function correlationAsSigmaRule(
  correlation: SigmaCorrelation,
): SigmaRule {
  return {
    title: correlation.title,
    id: correlation.id,
    description: correlation.description,
    level: correlation.level,
    status: "",
    tags: correlation.tags,
    mitreTactics: correlation.mitreTactics,
    mitreTechniques: correlation.mitreTechniques,
    logsource: {},
    selections: [],
    condition: { kind: "selection", name: "correlation" },
  };
}

// The rule that names a detection rule: the single Sigma rule, or the correlation.
export function detectionRuleHeader(
  definition: DetectionRuleDefinition,
): SigmaRule {
  return definition.kind === "single"
    ? definition.rule
    : correlationAsSigmaRule(definition.correlation);
}
