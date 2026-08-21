import Dictionary from "../Dictionary";
import { JSONValue } from "../JSON";

/*
 * Typed representation of a parsed Sigma rule — the subset OneUptime's
 * detection engine evaluates. Produced by SigmaRuleParser, consumed by
 * the ClickHouse compiler.
 *
 * https://sigmahq.io/docs/basics/rules.html
 */

export enum SigmaLevel {
  Informational = "informational",
  Low = "low",
  Medium = "medium",
  High = "high",
  Critical = "critical",
}

/*
 * One `field|modifier: value` requirement inside a selection map. `values`
 * always has at least one entry; multiple entries are OR-ed (AND-ed when
 * the `all` modifier is present).
 */
export interface SigmaFieldRequirement {
  field: string;
  modifiers: Array<string>;
  values: Array<JSONValue>;
}

/*
 * A named entry under `detection:`. Exactly one of the shapes is set:
 * - fieldMaps: list of {field: requirement} maps; maps OR, fields AND.
 * - keywords: bare string list matched against the event message.
 */
export interface SigmaSelection {
  name: string;
  fieldMaps: Array<Array<SigmaFieldRequirement>>;
  keywords: Array<string>;
}

/*
 * Condition AST. Parsed from the `condition:` expression grammar:
 * identifiers, and/or/not, parentheses, and the `1 of x*` / `all of x*` /
 * `any of them` quantifiers.
 */
export type SigmaConditionNode =
  | { kind: "selection"; name: string }
  | { kind: "and"; children: Array<SigmaConditionNode> }
  | { kind: "or"; children: Array<SigmaConditionNode> }
  | { kind: "not"; child: SigmaConditionNode }
  | {
      kind: "of";
      quantifier: "any" | "all" | number;
      pattern: string; // 'them' or a name pattern possibly ending in '*'
    };

export default interface SigmaRule {
  title: string;
  id: string;
  description: string;
  level: SigmaLevel;
  status: string;
  tags: Array<string>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  logsource: Dictionary<string>;
  selections: Array<SigmaSelection>;
  condition: SigmaConditionNode;
}
