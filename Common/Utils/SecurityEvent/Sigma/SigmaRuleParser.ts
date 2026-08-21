import yaml from "js-yaml";
import BadDataException from "../../../Types/Exception/BadDataException";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import SigmaRule, {
  SigmaConditionNode,
  SigmaFieldRequirement,
  SigmaLevel,
  SigmaSelection,
} from "../../../Types/SecurityEvent/SigmaRule";

/*
 * Sigma YAML -> typed SigmaRule.
 *
 * Supports the boolean core of the Sigma spec: named selections (field
 * maps with modifiers, keyword lists), and the condition grammar
 * (and/or/not, parentheses, `N of x*` / `all of x*` / `any of them`).
 * Aggregation expressions (`| count() ...`) are rejected with a clear
 * error rather than silently ignored — a rule that parses is a rule the
 * engine evaluates faithfully.
 */

const SUPPORTED_MODIFIERS: Set<string> = new Set<string>([
  "contains",
  "startswith",
  "endswith",
  "all",
  "re",
  "cased",
  "gt",
  "gte",
  "lt",
  "lte",
  "cidr",
  "exists",
  "windash",
]);

const WHITESPACE_REGEX: RegExp = /\s/;
const COUNT_REGEX: RegExp = /^\d+$/;
const TACTIC_TAG_REGEX: RegExp = /^ta\d{4}$/i;
const TECHNIQUE_TAG_REGEX: RegExp = /^t\d{4}(\.\d{3})?$/i;

type Token =
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "word"; value: string };

function tokenizeCondition(condition: string): Array<Token> {
  const tokens: Array<Token> = [];
  let current: string = "";

  const flush: () => void = (): void => {
    if (current) {
      tokens.push({ kind: "word", value: current });
      current = "";
    }
  };

  for (const char of condition) {
    if (char === "(") {
      flush();
      tokens.push({ kind: "lparen" });
    } else if (char === ")") {
      flush();
      tokens.push({ kind: "rparen" });
    } else if (WHITESPACE_REGEX.test(char)) {
      flush();
    } else {
      current += char;
    }
  }

  flush();

  return tokens;
}

class ConditionParser {
  private position: number = 0;

  public constructor(private tokens: Array<Token>) {}

  public parse(): SigmaConditionNode {
    const node: SigmaConditionNode = this.parseOr();

    if (this.position < this.tokens.length) {
      throw new BadDataException(
        `Sigma condition: unexpected token after end of expression (near "${this.describeCurrent()}").`,
      );
    }

    return node;
  }

  private parseOr(): SigmaConditionNode {
    const children: Array<SigmaConditionNode> = [this.parseAnd()];

    while (this.isWord("or")) {
      this.position++;
      children.push(this.parseAnd());
    }

    if (children.length === 1) {
      return children[0]!;
    }

    return { kind: "or", children };
  }

  private parseAnd(): SigmaConditionNode {
    const children: Array<SigmaConditionNode> = [this.parseNot()];

    while (this.isWord("and")) {
      this.position++;
      children.push(this.parseNot());
    }

    if (children.length === 1) {
      return children[0]!;
    }

    return { kind: "and", children };
  }

  private parseNot(): SigmaConditionNode {
    if (this.isWord("not")) {
      this.position++;
      return { kind: "not", child: this.parseNot() };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): SigmaConditionNode {
    const token: Token | undefined = this.tokens[this.position];

    if (!token) {
      throw new BadDataException(
        "Sigma condition: unexpected end of expression.",
      );
    }

    if (token.kind === "lparen") {
      this.position++;
      const inner: SigmaConditionNode = this.parseOr();

      if (this.tokens[this.position]?.kind !== "rparen") {
        throw new BadDataException(
          "Sigma condition: missing closing parenthesis.",
        );
      }

      this.position++;
      return inner;
    }

    if (token.kind === "rparen") {
      throw new BadDataException(
        "Sigma condition: unexpected closing parenthesis.",
      );
    }

    const word: string = token.value;

    // Quantifier: `1 of x*`, `all of them`, `any of selection*`.
    const lowered: string = word.toLowerCase();
    const isCount: boolean = COUNT_REGEX.test(word);

    if (isCount || lowered === "all" || lowered === "any") {
      const next: Token | undefined = this.tokens[this.position + 1];

      if (next && next.kind === "word" && next.value.toLowerCase() === "of") {
        const patternToken: Token | undefined = this.tokens[this.position + 2];

        if (!patternToken || patternToken.kind !== "word") {
          throw new BadDataException(
            `Sigma condition: "${word} of" must be followed by a selection pattern or "them".`,
          );
        }

        this.position += 3;

        const quantifier: "any" | "all" | number = isCount
          ? Number(word)
          : (lowered as "any" | "all");

        return {
          kind: "of",
          quantifier,
          pattern: patternToken.value,
        };
      }

      if (isCount) {
        throw new BadDataException(
          `Sigma condition: bare number "${word}" — expected "${word} of <pattern>".`,
        );
      }
    }

    this.position++;
    return { kind: "selection", name: word };
  }

  private isWord(value: string): boolean {
    const token: Token | undefined = this.tokens[this.position];
    return Boolean(
      token && token.kind === "word" && token.value.toLowerCase() === value,
    );
  }

  private describeCurrent(): string {
    const token: Token | undefined = this.tokens[this.position];

    if (!token) {
      return "end";
    }

    if (token.kind === "word") {
      return token.value;
    }

    return token.kind === "lparen" ? "(" : ")";
  }
}

function parseFieldRequirement(
  key: string,
  rawValue: JSONValue,
): SigmaFieldRequirement {
  const parts: Array<string> = key.split("|");
  const field: string = (parts[0] || "").trim();

  if (!field) {
    throw new BadDataException(
      `Sigma detection: empty field name in "${key}".`,
    );
  }

  const modifiers: Array<string> = parts.slice(1).map((part: string) => {
    return part.trim().toLowerCase();
  });

  for (const modifier of modifiers) {
    if (!SUPPORTED_MODIFIERS.has(modifier)) {
      throw new BadDataException(
        `Sigma detection: unsupported field modifier "${modifier}" on "${key}". Supported: ${Array.from(
          SUPPORTED_MODIFIERS,
        ).join(", ")}.`,
      );
    }
  }

  const values: Array<JSONValue> = Array.isArray(rawValue)
    ? (rawValue as Array<JSONValue>)
    : [rawValue];

  if (values.length === 0) {
    throw new BadDataException(
      `Sigma detection: field "${key}" has an empty value list.`,
    );
  }

  for (const value of values) {
    if (value !== null && typeof value === "object") {
      throw new BadDataException(
        `Sigma detection: field "${key}" has a nested object value — only scalars, lists of scalars, and null are supported.`,
      );
    }
  }

  return { field, modifiers, values };
}

function parseSelection(name: string, rawValue: JSONValue): SigmaSelection {
  // Map: fields AND together.
  if (
    rawValue !== null &&
    typeof rawValue === "object" &&
    !Array.isArray(rawValue)
  ) {
    const requirements: Array<SigmaFieldRequirement> = [];

    for (const key of Object.keys(rawValue as JSONObject)) {
      requirements.push(
        parseFieldRequirement(key, (rawValue as JSONObject)[key] as JSONValue),
      );
    }

    if (requirements.length === 0) {
      throw new BadDataException(
        `Sigma detection: selection "${name}" is empty.`,
      );
    }

    return { name, fieldMaps: [requirements], keywords: [] };
  }

  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) {
      throw new BadDataException(
        `Sigma detection: selection "${name}" is an empty list.`,
      );
    }

    const isMapList: boolean = rawValue.every((item: JSONValue): boolean => {
      return item !== null && typeof item === "object" && !Array.isArray(item);
    });

    if (isMapList) {
      // List of maps: maps OR together, fields inside a map AND.
      const fieldMaps: Array<Array<SigmaFieldRequirement>> = [];

      for (const item of rawValue) {
        const requirements: Array<SigmaFieldRequirement> = [];

        for (const key of Object.keys(item as JSONObject)) {
          requirements.push(
            parseFieldRequirement(key, (item as JSONObject)[key] as JSONValue),
          );
        }

        if (requirements.length > 0) {
          fieldMaps.push(requirements);
        }
      }

      return { name, fieldMaps, keywords: [] };
    }

    const isScalarList: boolean = rawValue.every((item: JSONValue): boolean => {
      return item === null || typeof item !== "object";
    });

    if (isScalarList) {
      // Keyword list: matched against the event message, OR semantics.
      return {
        name,
        fieldMaps: [],
        keywords: rawValue.map((item: JSONValue): string => {
          return String(item);
        }),
      };
    }

    throw new BadDataException(
      `Sigma detection: selection "${name}" mixes maps and scalars — use either a field map list or a keyword list.`,
    );
  }

  throw new BadDataException(
    `Sigma detection: selection "${name}" must be a map or a list.`,
  );
}

function extractMitre(tags: Array<string>): {
  tactics: Array<string>;
  techniques: Array<string>;
} {
  const tactics: Array<string> = [];
  const techniques: Array<string> = [];

  for (const tag of tags) {
    const normalized: string = tag.toLowerCase();

    if (!normalized.startsWith("attack.")) {
      continue;
    }

    const remainder: string = tag.slice("attack.".length);

    if (TACTIC_TAG_REGEX.test(remainder)) {
      const tactic: string = remainder.toUpperCase();
      if (!tactics.includes(tactic)) {
        tactics.push(tactic);
      }
    } else if (TECHNIQUE_TAG_REGEX.test(remainder)) {
      const technique: string = remainder.toUpperCase();
      if (!techniques.includes(technique)) {
        techniques.push(technique);
      }
    }
  }

  return { tactics, techniques };
}

export default class SigmaRuleParser {
  public static parse(ruleYaml: string): SigmaRule {
    if (!ruleYaml || !ruleYaml.trim()) {
      throw new BadDataException("Sigma rule: YAML is empty.");
    }

    let loaded: unknown;

    try {
      loaded = yaml.load(ruleYaml);
    } catch (error) {
      throw new BadDataException(
        `Sigma rule: invalid YAML — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      throw new BadDataException("Sigma rule: YAML must be a mapping.");
    }

    const doc: JSONObject = loaded as JSONObject;

    const detection: JSONValue = doc["detection"] as JSONValue;

    if (
      !detection ||
      typeof detection !== "object" ||
      Array.isArray(detection)
    ) {
      throw new BadDataException(
        "Sigma rule: a `detection` mapping is required.",
      );
    }

    const detectionObject: JSONObject = detection as JSONObject;

    const conditionRaw: JSONValue = detectionObject["condition"] as JSONValue;

    if (typeof conditionRaw !== "string" || !conditionRaw.trim()) {
      throw new BadDataException(
        "Sigma rule: `detection.condition` must be a non-empty string.",
      );
    }

    if (conditionRaw.includes("|")) {
      throw new BadDataException(
        "Sigma rule: aggregation expressions (`| count() ...`) are not supported. Use a plain boolean condition.",
      );
    }

    const selections: Array<SigmaSelection> = [];

    for (const key of Object.keys(detectionObject)) {
      if (key === "condition" || key === "timeframe") {
        continue;
      }

      selections.push(parseSelection(key, detectionObject[key] as JSONValue));
    }

    if (selections.length === 0) {
      throw new BadDataException(
        "Sigma rule: `detection` must contain at least one selection.",
      );
    }

    const condition: SigmaConditionNode = new ConditionParser(
      tokenizeCondition(conditionRaw),
    ).parse();

    // Every referenced selection must exist.
    this.validateConditionReferences(condition, selections);

    const levelRaw: string = String(doc["level"] || "medium").toLowerCase();
    const level: SigmaLevel = (
      Object.values(SigmaLevel) as Array<string>
    ).includes(levelRaw)
      ? (levelRaw as SigmaLevel)
      : SigmaLevel.Medium;

    const tags: Array<string> = Array.isArray(doc["tags"])
      ? (doc["tags"] as Array<JSONValue>).map((tag: JSONValue): string => {
          return String(tag);
        })
      : [];

    const { tactics, techniques } = extractMitre(tags);

    const logsource: Dictionary<string> = {};
    const logsourceRaw: JSONValue = doc["logsource"] as JSONValue;

    if (
      logsourceRaw &&
      typeof logsourceRaw === "object" &&
      !Array.isArray(logsourceRaw)
    ) {
      for (const key of Object.keys(logsourceRaw as JSONObject)) {
        logsource[key] = String((logsourceRaw as JSONObject)[key]);
      }
    }

    return {
      title: String(doc["title"] || "Untitled Sigma Rule"),
      id: String(doc["id"] || ""),
      description: String(doc["description"] || ""),
      level,
      status: String(doc["status"] || ""),
      tags,
      mitreTactics: tactics,
      mitreTechniques: techniques,
      logsource,
      selections,
      condition,
    };
  }

  private static validateConditionReferences(
    node: SigmaConditionNode,
    selections: Array<SigmaSelection>,
  ): void {
    const names: Array<string> = selections.map(
      (selection: SigmaSelection): string => {
        return selection.name;
      },
    );

    const visit: (current: SigmaConditionNode) => void = (
      current: SigmaConditionNode,
    ): void => {
      if (current.kind === "selection") {
        if (!names.includes(current.name)) {
          throw new BadDataException(
            `Sigma condition: unknown selection "${current.name}". Known selections: ${names.join(", ")}.`,
          );
        }
        return;
      }

      if (current.kind === "of") {
        if (current.pattern.toLowerCase() === "them") {
          return;
        }

        const matches: Array<string> = SigmaRuleParser.matchSelectionNames(
          current.pattern,
          names,
        );

        if (matches.length === 0) {
          throw new BadDataException(
            `Sigma condition: pattern "${current.pattern}" matches no selection. Known selections: ${names.join(", ")}.`,
          );
        }
        return;
      }

      if (current.kind === "not") {
        visit(current.child);
        return;
      }

      for (const child of current.children) {
        visit(child);
      }
    };

    visit(node);
  }

  public static matchSelectionNames(
    pattern: string,
    names: Array<string>,
  ): Array<string> {
    if (pattern.toLowerCase() === "them") {
      return [...names];
    }

    if (pattern.endsWith("*")) {
      const prefix: string = pattern.slice(0, -1);
      return names.filter((name: string): boolean => {
        return name.startsWith(prefix);
      });
    }

    return names.filter((name: string): boolean => {
      return name === pattern;
    });
  }
}
