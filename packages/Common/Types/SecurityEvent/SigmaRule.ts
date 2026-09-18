import Dictionary from "../Dictionary";
import { JSONValue } from "../JSON";
import OcsfSeverity from "./OcsfSeverity";

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
 * The level a rule gets when its YAML has no `level:` or one outside the
 * enum above. The parser applies it; the dashboard's rule guide states it.
 */
export const SIGMA_DEFAULT_LEVEL: SigmaLevel = SigmaLevel.Medium;

/*
 * Sigma level -> OCSF severity stamped on a rule's Detection Finding rows.
 * Lives here rather than in the evaluator so the dashboard's rule guide
 * renders its severity table from the same map the engine writes with.
 */
export const SIGMA_LEVEL_TO_OCSF_SEVERITY: Record<SigmaLevel, OcsfSeverity> = {
  [SigmaLevel.Informational]: OcsfSeverity.Informational,
  [SigmaLevel.Low]: OcsfSeverity.Low,
  [SigmaLevel.Medium]: OcsfSeverity.Medium,
  [SigmaLevel.High]: OcsfSeverity.High,
  [SigmaLevel.Critical]: OcsfSeverity.Critical,
};

/*
 * Levels that rank onto a project's MOST severe alert/incident severity
 * when no severity is set on the rule and none is named after the level;
 * every other level ranks onto the least severe.
 */
export function isSevereSigmaLevel(level: SigmaLevel): boolean {
  return level === SigmaLevel.Critical || level === SigmaLevel.High;
}

/*
 * Field modifiers (`field|modifier: value`) the parser accepts. Anything
 * else is rejected at save time — listed here so the dashboard's rule
 * guide cannot advertise a modifier the parser refuses, or miss one it
 * takes.
 */
export const SIGMA_SUPPORTED_MODIFIERS: ReadonlyArray<string> = [
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
];

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
