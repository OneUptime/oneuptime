import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  MITRE_TACTICS,
  MITRE_TACTIC_TECHNIQUES,
  MitreTactic,
  getMitreTechnique,
  resolveMitreTacticId,
  resolveMitreTechniqueId,
} from "Common/Types/SecurityEvent/MitreAttack";
import SigmaRule from "Common/Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser, {
  detectionRuleHeader,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { ExistingRule, isLibraryRuleAdded } from "./RuleLibraryUtil";

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

/*
 * A rule's ATT&CK tags as matrix cells: parent techniques and tactic ids.
 * A correlation covers what its own tags name, or - without any - what the
 * rules it reads do.
 */
export function readRuleAttackTags(
  sigmaRuleYaml: string,
): RuleAttackTags | null {
  let rule: SigmaRule;

  try {
    rule = detectionRuleHeader(SigmaRuleSetParser.parse(sigmaRuleYaml));
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

/*
 * WHAT THE PAGE DRAWS: EACH TACTIC AS A ROW, EACH TECHNIQUE AS A CHIP.
 *
 * The page used to open on the whole matrix: fifteen columns of tiny
 * cells, wider than any screen, so the one tactic a project covers sat off
 * to the right behind a scrollbar and the page read as a wall of grey.
 * Now it opens on the tactics, in the order an attack moves through them,
 * each with how much of it the project's rules cover; a tactic opens on
 * its techniques. The matrix stays one switch away.
 */

// Where a technique stands, most covered first.
export enum TechniqueCoverage {
  // An enabled rule of the project covers it.
  Covered = "covered",
  // Only rules that are turned off cover it.
  DisabledOnly = "disabled-only",
  // No rule of the project covers it; a Rule Library rule it has not added does.
  InLibrary = "in-library",
  NotCovered = "not-covered",
}

// The order a tactic's techniques are listed in: what the project has first.
export const TECHNIQUE_COVERAGE_ORDER: ReadonlyArray<TechniqueCoverage> = [
  TechniqueCoverage.Covered,
  TechniqueCoverage.DisabledOnly,
  TechniqueCoverage.InLibrary,
  TechniqueCoverage.NotCovered,
];

export interface TechniqueCoverageView {
  id: string;
  name: string;
  coverage: TechniqueCoverage;
  // How many of the project's rules name it, on or off.
  ruleCount: number;
}

export interface TacticCoverageView {
  tactic: MitreTactic;
  techniqueCount: number;
  // Its techniques an enabled rule covers.
  coveredCount: number;
  // Its techniques no enabled rule covers that a library rule not added yet would.
  libraryCount: number;
  // Every technique of the tactic, most covered first, each group in the matrix's order.
  techniques: Array<TechniqueCoverageView>;
  // The same techniques in the matrix's own order (its column, top to bottom).
  matrixTechniques: Array<TechniqueCoverageView>;
}

function hasEnabledRule(rules: ReadonlyArray<CoveringRule>): boolean {
  return rules.some((rule: CoveringRule): boolean => {
    return rule.isEnabled;
  });
}

export function getTechniqueCoverage(
  techniqueId: string,
  coverage: AttackCoverage,
  library: AttackCoverage,
): TechniqueCoverage {
  const rules: Array<CoveringRule> =
    coverage.rulesByTechnique.get(techniqueId) || [];

  if (hasEnabledRule(rules)) {
    return TechniqueCoverage.Covered;
  }

  if (rules.length > 0) {
    return TechniqueCoverage.DisabledOnly;
  }

  if ((library.rulesByTechnique.get(techniqueId) || []).length > 0) {
    return TechniqueCoverage.InLibrary;
  }

  return TechniqueCoverage.NotCovered;
}

// A technique no enabled rule covers, that a library rule not added yet would.
function isLibraryGap(
  techniqueId: string,
  coverage: AttackCoverage,
  library: AttackCoverage,
): boolean {
  return (
    !hasEnabledRule(coverage.rulesByTechnique.get(techniqueId) || []) &&
    (library.rulesByTechnique.get(techniqueId) || []).length > 0
  );
}

// Every tactic of the matrix, in its order, as the page's rows.
export function getTacticCoverageViews(
  coverage: AttackCoverage,
  library: AttackCoverage,
): Array<TacticCoverageView> {
  return MITRE_TACTICS.map((tactic: MitreTactic): TacticCoverageView => {
    const techniques: Array<TechniqueCoverageView> = (
      MITRE_TACTIC_TECHNIQUES[tactic.id] || []
    ).map(([id, name]: readonly [string, string]): TechniqueCoverageView => {
      return {
        id,
        name,
        coverage: getTechniqueCoverage(id, coverage, library),
        ruleCount: (coverage.rulesByTechnique.get(id) || []).length,
      };
    });

    const ordered: Array<TechniqueCoverageView> = TECHNIQUE_COVERAGE_ORDER.map(
      (state: TechniqueCoverage): Array<TechniqueCoverageView> => {
        return techniques.filter(
          (technique: TechniqueCoverageView): boolean => {
            return technique.coverage === state;
          },
        );
      },
    ).flat();

    return {
      tactic,
      techniqueCount: techniques.length,
      coveredCount: techniques.filter(
        (technique: TechniqueCoverageView): boolean => {
          return technique.coverage === TechniqueCoverage.Covered;
        },
      ).length,
      libraryCount: techniques.filter(
        (technique: TechniqueCoverageView): boolean => {
          return isLibraryGap(technique.id, coverage, library);
        },
      ).length,
      techniques: ordered,
      matrixTechniques: techniques,
    };
  });
}

/*
 * The Rule Library's rules the project has no rule of, known as the
 * library knows them: by the Sigma id a rule carries, however the team
 * renamed it, or by its name (isLibraryRuleAdded). A renamed library rule
 * counted as missing here while the library said Added.
 */
export function getLibraryRulesNotAdded(
  existingRules: ReadonlyArray<ExistingRule>,
): Array<DetectionRuleLibraryEntry> {
  return DETECTION_RULE_LIBRARY.filter(
    (entry: DetectionRuleLibraryEntry): boolean => {
      return !isLibraryRuleAdded(entry, existingRules);
    },
  );
}

// What those rules would cover, as the matrix counts a rule.
export function buildLibraryCoverage(
  existingRules: ReadonlyArray<ExistingRule>,
): AttackCoverage {
  return buildAttackCoverage(
    getLibraryRulesNotAdded(existingRules).map(
      (entry: DetectionRuleLibraryEntry): CoverageRuleInput => {
        return {
          id: entry.id,
          name: entry.title,
          isEnabled: true,
          sigmaRuleYaml: entry.sigmaRuleYaml,
        };
      },
    ),
  );
}

/*
 * The page's next step: how many techniques no enabled rule covers that
 * the Rule Library would, and how many of its rules (not added yet) cover
 * at least one of them.
 */
export interface LibraryCoverageGap {
  ruleCount: number;
  techniqueCount: number;
}

export function getLibraryCoverageGap(
  coverage: AttackCoverage,
  library: AttackCoverage,
): LibraryCoverageGap {
  const ruleIds: Set<string> = new Set();
  let techniqueCount: number = 0;

  for (const [techniqueId, rules] of library.rulesByTechnique.entries()) {
    if (!isLibraryGap(techniqueId, coverage, library)) {
      continue;
    }

    techniqueCount++;

    for (const rule of rules) {
      ruleIds.add(rule.id);
    }
  }

  return { ruleCount: ruleIds.size, techniqueCount };
}

// A tactic's share covered, as a whole percent for its bar.
export function getCoveredPercent(view: {
  coveredCount: number;
  techniqueCount: number;
}): number {
  return view.techniqueCount > 0
    ? Math.round((view.coveredCount / view.techniqueCount) * 100)
    : 0;
}

/*
 * An open tactic's techniques under a heading per state - covered, covered
 * only by rules that are off, in the Rule Library, not covered - in that
 * order, leaving out the states none of them is in. The headings say what
 * each tile's look means right above it: a legend at the card's foot sat a
 * screen below a tactic opened near the top.
 */
export interface TechniqueCoverageGroup {
  coverage: TechniqueCoverage;
  techniques: Array<TechniqueCoverageView>;
}

export function groupTechniquesByCoverage(
  techniques: ReadonlyArray<TechniqueCoverageView>,
): Array<TechniqueCoverageGroup> {
  return TECHNIQUE_COVERAGE_ORDER.map(
    (coverage: TechniqueCoverage): TechniqueCoverageGroup => {
      return {
        coverage,
        techniques: techniques.filter(
          (technique: TechniqueCoverageView): boolean => {
            return technique.coverage === coverage;
          },
        ),
      };
    },
  ).filter((group: TechniqueCoverageGroup): boolean => {
    return group.techniques.length > 0;
  });
}
