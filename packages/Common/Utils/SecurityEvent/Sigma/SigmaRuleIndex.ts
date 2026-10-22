import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import {
  DetectionRuleDefinition,
  SigmaRuleReferenceResolver,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "./SigmaRuleSetParser";

/*
 * The detection rules a correlation can read by name: every single Sigma
 * rule of the project - on or off, since a step that should not fire on its
 * own is a rule turned off - by its Sigma `id` and its Sigma `name`.
 * Correlations are not offered: a correlation reads another correlation from
 * its own file.
 *
 * Pure, so the service that saves a rule and the engine that runs it build
 * the same index from the rules they read.
 */

export interface SigmaRuleSource {
  // The detection rule's own id, to leave the rule being saved out.
  id?: string | undefined;
  sigmaRuleYaml: string | undefined;
}

/*
 * A resolver over these rules. A rule that does not parse, or is a
 * correlation, is not offered; when two rules carry the same id or name, the
 * first one wins.
 */
export function indexSigmaRules(
  rules: Array<SigmaRuleSource>,
  options: { excludeRuleId?: string | undefined } = {},
): SigmaRuleReferenceResolver {
  const byId: Map<string, SigmaRule> = new Map();
  const byName: Map<string, SigmaRule> = new Map();

  for (const source of rules) {
    if (
      !source.sigmaRuleYaml ||
      (options.excludeRuleId && source.id === options.excludeRuleId)
    ) {
      continue;
    }

    let definition: DetectionRuleDefinition;

    try {
      definition = SigmaRuleSetParser.parse(source.sigmaRuleYaml);
    } catch {
      continue;
    }

    if (definition.kind !== "single") {
      continue;
    }

    if (definition.rule.id && !byId.has(definition.rule.id)) {
      byId.set(definition.rule.id, definition.rule);
    }

    if (definition.name && !byName.has(definition.name)) {
      byName.set(definition.name, definition.rule);
    }
  }

  return (reference: string): SigmaRule | undefined => {
    return byId.get(reference) || byName.get(reference);
  };
}
