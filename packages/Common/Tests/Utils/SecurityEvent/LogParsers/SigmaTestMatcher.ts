import { JSONValue } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SigmaRule, {
  SigmaConditionNode,
  SigmaFieldRequirement,
  SigmaSelection,
} from "../../../../Types/SecurityEvent/SigmaRule";
import { resolveSigmaField } from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import CidrMatchUtil from "../../../../Utils/NetworkSite/CidrMatchUtil";

/*
 * Whether one security event matches a Sigma rule's detection, read the way
 * the engine's ClickHouse query reads it (resolveSigmaField, case-insensitive
 * values) - for the modifiers the rule library uses: none (equals), cidr,
 * contains, startswith, endswith. It lets a suite show that a rule fires on
 * the events a log parser makes, without a database.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

function fieldValue(event: NormalizedSecurityEvent, field: string): string {
  const resolved: ReturnType<typeof resolveSigmaField> =
    resolveSigmaField(field);

  if (resolved.kind === "attribute") {
    const value: JSONValue | undefined =
      event.attributes[resolved.attributeKey];

    return value === undefined || value === null ? "" : String(value);
  }

  const value: unknown = (event as unknown as Record<string, unknown>)[
    resolved.column
  ];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return value === undefined || value === null ? "" : String(value);
}

function matchesValue(
  actual: string,
  modifiers: Array<string>,
  expected: JSONValue,
): boolean {
  const want: string = String(expected).toLowerCase();
  const have: string = actual.toLowerCase();

  // An address in a range, as the engine's isIPAddressInRange reads it.
  if (modifiers.includes("cidr")) {
    return Boolean(have) && CidrMatchUtil.ipInCidr(have, want);
  }

  if (modifiers.includes("contains")) {
    return have.includes(want);
  }

  if (modifiers.includes("startswith")) {
    return have.startsWith(want);
  }

  if (modifiers.includes("endswith")) {
    return have.endsWith(want);
  }

  return have === want;
}

function matchesRequirement(
  event: NormalizedSecurityEvent,
  requirement: SigmaFieldRequirement,
): boolean {
  const actual: string = fieldValue(event, requirement.field);
  const matches: Array<boolean> = requirement.values.map(
    (value: JSONValue): boolean => {
      return matchesValue(actual, requirement.modifiers, value);
    },
  );

  return requirement.modifiers.includes("all")
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

function matchesSelection(
  event: NormalizedSecurityEvent,
  selection: SigmaSelection,
): boolean {
  const fieldMapMatches: boolean =
    selection.fieldMaps.length === 0 ||
    selection.fieldMaps.some(
      (requirements: Array<SigmaFieldRequirement>): boolean => {
        return requirements.every((requirement: SigmaFieldRequirement) => {
          return matchesRequirement(event, requirement);
        });
      },
    );

  const keywordMatches: boolean =
    selection.keywords.length === 0 ||
    selection.keywords.some((keyword: string): boolean => {
      return event.message.toLowerCase().includes(keyword.toLowerCase());
    });

  return fieldMapMatches && keywordMatches;
}

function selectionsNamed(
  rule: SigmaRule,
  pattern: string,
): Array<SigmaSelection> {
  if (pattern === "them") {
    return rule.selections;
  }

  if (pattern.endsWith("*")) {
    const prefix: string = pattern.slice(0, -1);

    return rule.selections.filter((selection: SigmaSelection): boolean => {
      return selection.name.startsWith(prefix);
    });
  }

  return rule.selections.filter((selection: SigmaSelection): boolean => {
    return selection.name === pattern;
  });
}

function evaluate(
  event: NormalizedSecurityEvent,
  rule: SigmaRule,
  node: SigmaConditionNode,
): boolean {
  switch (node.kind) {
    case "selection":
      return selectionsNamed(rule, node.name).some(
        (selection: SigmaSelection): boolean => {
          return matchesSelection(event, selection);
        },
      );
    case "and":
      return node.children.every((child: SigmaConditionNode): boolean => {
        return evaluate(event, rule, child);
      });
    case "or":
      return node.children.some((child: SigmaConditionNode): boolean => {
        return evaluate(event, rule, child);
      });
    case "not":
      return !evaluate(event, rule, node.child);
    case "of": {
      const matched: Array<boolean> = selectionsNamed(rule, node.pattern).map(
        (selection: SigmaSelection): boolean => {
          return matchesSelection(event, selection);
        },
      );

      if (node.quantifier === "all") {
        return matched.length > 0 && matched.every(Boolean);
      }

      const needed: number =
        node.quantifier === "any" ? 1 : Math.max(1, node.quantifier);

      return matched.filter(Boolean).length >= needed;
    }
    default:
      return false;
  }
}

export function sigmaRuleMatchesEvent(
  rule: SigmaRule,
  event: NormalizedSecurityEvent,
): boolean {
  return evaluate(event, rule, rule.condition);
}
