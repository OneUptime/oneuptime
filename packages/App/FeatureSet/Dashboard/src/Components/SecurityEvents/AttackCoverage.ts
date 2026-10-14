import {
  MITRE_TACTICS,
  MITRE_TACTIC_TECHNIQUES,
  MitreTactic,
  getMitreTechnique,
  resolveMitreTacticId,
  resolveMitreTechniqueId,
} from "Common/Types/SecurityEvent/MitreAttack";
import SigmaRule from "Common/Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleParser";

/*
 * Which parts of the ATT&CK matrix the project's detection rules cover, and
 * which the rule library would cover if added. A rule covers the techniques
 * its Sigma tags name (a sub-technique counts for its parent's cell, a
 * revoked technique for the one that replaced it) and the tactics it names
 * or its techniques serve.
 *
 * React-free so the counting is pinned in a plain test.
 */

export interface CoverageRuleInput {
  id: string;
  name: string;
  isEnabled: boolean;
  sigmaRuleYaml: string;
}

export interface CoveringRule {
  id: string;
  name: string;
  isEnabled: boolean;
}

export interface AttackCoverage {
  // Parent technique id -> the rules that cover it.
  rulesByTechnique: Map<string, Array<CoveringRule>>;
  // Tactic id -> the rules that cover it.
  rulesByTactic: Map<string, Array<CoveringRule>>;
  // Rules whose YAML could not be read, so cover nothing.
  unreadableRuleIds: Array<string>;
}

export interface RuleAttackTags {
  tactics: Array<string>;
  techniques: Array<string>;
}

// A rule's ATT&CK tags as matrix cells: parent techniques and tactic ids.
export function readRuleAttackTags(
  sigmaRuleYaml: string,
): RuleAttackTags | null {
  let rule: SigmaRule;

  try {
    rule = SigmaRuleParser.parse(sigmaRuleYaml);
  } catch {
    return null;
  }

  const techniques: Array<string> = [];
  const tactics: Array<string> = [];

  for (const tag of rule.mitreTechniques || []) {
    const resolved: string | undefined = resolveMitreTechniqueId(tag);
    const parent: string = (resolved || tag).toUpperCase().split(".")[0] || "";

    if (getMitreTechnique(parent) && !techniques.includes(parent)) {
      techniques.push(parent);
    }
  }

  for (const tag of rule.mitreTactics || []) {
    const tacticId: string | undefined = resolveMitreTacticId(tag);

    if (tacticId && !tactics.includes(tacticId)) {
      tactics.push(tacticId);
    }
  }

  // A technique covers the tactics it serves, named on the rule or not.
  for (const techniqueId of techniques) {
    for (const tacticId of getMitreTechnique(techniqueId)?.tacticIds || []) {
      if (!tactics.includes(tacticId)) {
        tactics.push(tacticId);
      }
    }
  }

  return { tactics, techniques };
}

function add(
  map: Map<string, Array<CoveringRule>>,
  key: string,
  rule: CoveringRule,
): void {
  const list: Array<CoveringRule> = map.get(key) || [];

  if (
    !list.some((existing: CoveringRule): boolean => {
      return existing.id === rule.id;
    })
  ) {
    list.push(rule);
  }

  map.set(key, list);
}

export function buildAttackCoverage(
  rules: Array<CoverageRuleInput>,
): AttackCoverage {
  const coverage: AttackCoverage = {
    rulesByTechnique: new Map(),
    rulesByTactic: new Map(),
    unreadableRuleIds: [],
  };

  for (const rule of rules) {
    const tags: RuleAttackTags | null = readRuleAttackTags(rule.sigmaRuleYaml);

    if (!tags) {
      coverage.unreadableRuleIds.push(rule.id);
      continue;
    }

    const covering: CoveringRule = {
      id: rule.id,
      name: rule.name,
      isEnabled: rule.isEnabled,
    };

    for (const techniqueId of tags.techniques) {
      add(coverage.rulesByTechnique, techniqueId, covering);
    }

    for (const tacticId of tags.tactics) {
      add(coverage.rulesByTactic, tacticId, covering);
    }
  }

  return coverage;
}

export interface TacticCoverageSummary {
  tactic: MitreTactic;
  techniqueCount: number;
  coveredTechniqueCount: number;
}

// Per tactic: how many of its techniques at least one enabled rule covers.
export function summarizeTacticCoverage(
  coverage: AttackCoverage,
): Array<TacticCoverageSummary> {
  return MITRE_TACTICS.map((tactic: MitreTactic): TacticCoverageSummary => {
    const techniques: ReadonlyArray<readonly [string, string]> =
      MITRE_TACTIC_TECHNIQUES[tactic.id] || [];

    return {
      tactic,
      techniqueCount: techniques.length,
      coveredTechniqueCount: techniques.filter(
        ([id]: readonly [string, string]): boolean => {
          return (coverage.rulesByTechnique.get(id) || []).some(
            (rule: CoveringRule): boolean => {
              return rule.isEnabled;
            },
          );
        },
      ).length,
    };
  });
}

// Every parent technique an enabled rule covers, once.
export function countCoveredTechniques(coverage: AttackCoverage): number {
  let count: number = 0;

  for (const rules of coverage.rulesByTechnique.values()) {
    if (
      rules.some((rule: CoveringRule): boolean => {
        return rule.isEnabled;
      })
    ) {
      count++;
    }
  }

  return count;
}
