import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  MITRE_TACTICS,
  MITRE_TACTIC_TECHNIQUES,
  MitreTactic,
} from "Common/Types/SecurityEvent/MitreAttack";
import {
  AttackCoverage,
  CoverageRuleInput,
  LibraryCoverageGap,
  TECHNIQUE_COVERAGE_ORDER,
  TacticCoverageView,
  TechniqueCoverage,
  TechniqueCoverageView,
  buildAttackCoverage,
  buildLibraryCoverage,
  countCoveredTechniques,
  getCoveredPercent,
  getLibraryCoverageGap,
  getLibraryRulesNotAdded,
  getTacticCoverageViews,
  getTechniqueCoverage,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/AttackCoverage";
import {
  ATTACK_COVERAGE_DESCRIPTIONS,
  ATTACK_COVERAGE_QUERY_KEYS,
  ATTACK_COVERAGE_VIEW_LABELS,
  AttackCoverageView,
  LIBRARY_GAP_ACTION,
  LIBRARY_GAP_SENTENCE,
  TACTIC_COVERED_COUNT,
  TACTIC_GOALS,
  TACTIC_LIBRARY_COUNT,
  TECHNIQUE_COVERAGE_LABELS,
  readAttackCoverageView,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/AttackCoverageCopy";
import { TRANSLATED_LOCALES } from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { isSaidInLocale, readDashboardLocale } from "./SecurityLocaleSentences";

/*
 * Security Events > ATT&CK Coverage opens on the tactics: a row per tactic
 * with how much of it the enabled rules cover and what the Rule Library
 * would add, each opening on its techniques, the covered first. These are
 * the React-free parts the page draws from: where each technique stands,
 * the rows, what the library would add (knowing a project's library rule
 * by its Sigma id, as the Rule Library does), and the page's words.
 */

function rule(
  id: string,
  tags: Array<string>,
  isEnabled: boolean = true,
  name: string = `Rule ${id}`,
): CoverageRuleInput {
  return {
    id,
    name,
    isEnabled,
    sigmaRuleYaml: `title: ${name}
id: ${id}
level: high
tags:
${tags
  .map((tag: string): string => {
    return `  - ${tag}`;
  })
  .join("\n")}
detection:
  selection:
    className: Authentication
  condition: selection
`,
  };
}

const NO_COVERAGE: AttackCoverage = buildAttackCoverage([]);

function tacticView(
  views: Array<TacticCoverageView>,
  tacticId: string,
): TacticCoverageView {
  return views.find((view: TacticCoverageView): boolean => {
    return view.tactic.id === tacticId;
  })!;
}

function techniqueIn(
  view: TacticCoverageView,
  techniqueId: string,
): TechniqueCoverageView {
  return view.techniques.find((technique: TechniqueCoverageView): boolean => {
    return technique.id === techniqueId;
  })!;
}

describe("where a technique stands", () => {
  const library: AttackCoverage = buildAttackCoverage([
    rule("lib-1", ["attack.t1556"]),
  ]);

  test("covered by an enabled rule, whatever else covers it", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1110"]),
      rule("r2", ["attack.t1110"], false),
    ]);

    expect(getTechniqueCoverage("T1110", coverage, library)).toBe(
      TechniqueCoverage.Covered,
    );
  });

  test("covered by rules that are off only", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1110"], false),
    ]);

    expect(getTechniqueCoverage("T1110", coverage, library)).toBe(
      TechniqueCoverage.DisabledOnly,
    );
  });

  test("in the Rule Library when no rule of the project names it", () => {
    expect(getTechniqueCoverage("T1556", NO_COVERAGE, library)).toBe(
      TechniqueCoverage.InLibrary,
    );
  });

  test("a rule that is off says so before the library does", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1556"], false),
    ]);

    expect(getTechniqueCoverage("T1556", coverage, library)).toBe(
      TechniqueCoverage.DisabledOnly,
    );
  });

  test("not covered when nothing names it", () => {
    expect(getTechniqueCoverage("T1595", NO_COVERAGE, library)).toBe(
      TechniqueCoverage.NotCovered,
    );
  });

  test("the states are listed most covered first", () => {
    expect([...TECHNIQUE_COVERAGE_ORDER]).toEqual([
      TechniqueCoverage.Covered,
      TechniqueCoverage.DisabledOnly,
      TechniqueCoverage.InLibrary,
      TechniqueCoverage.NotCovered,
    ]);
  });
});

describe("the tactics' rows", () => {
  const coverage: AttackCoverage = buildAttackCoverage([
    // Brute Force and MFA request generation: Credential Access.
    rule("r1", ["attack.t1110.003", "attack.t1621"]),
    // Account Manipulation, off.
    rule("r2", ["attack.t1098"], false),
  ]);
  const library: AttackCoverage = buildAttackCoverage([
    // Modify Authentication Process (Credential Access and two more), and Brute Force again.
    rule("lib-1", ["attack.t1556", "attack.t1110"]),
  ]);
  const views: Array<TacticCoverageView> = getTacticCoverageViews(
    coverage,
    library,
  );

  test("are every tactic of the matrix, in its order: the order an attack moves through them", () => {
    expect(
      views.map((view: TacticCoverageView): string => {
        return view.tactic.id;
      }),
    ).toEqual(
      MITRE_TACTICS.map((tactic: MitreTactic): string => {
        return tactic.id;
      }),
    );
  });

  test("hold each tactic's every technique, once", () => {
    for (const view of views) {
      const expected: Array<string> = (
        MITRE_TACTIC_TECHNIQUES[view.tactic.id] || []
      ).map(([id]: readonly [string, string]): string => {
        return id;
      });

      expect(view.techniqueCount).toBe(expected.length);
      expect(
        view.techniques
          .map((technique: TechniqueCoverageView): string => {
            return technique.id;
          })
          .sort(),
      ).toEqual([...expected].sort());
    }
  });

  test("count what the enabled rules cover, and what the library would add", () => {
    const credentialAccess: TacticCoverageView = tacticView(views, "TA0006");

    expect(credentialAccess.coveredCount).toBe(2);
    // Modify Authentication Process; Brute Force is covered already.
    expect(credentialAccess.libraryCount).toBe(1);
    expect(techniqueIn(credentialAccess, "T1110").ruleCount).toBe(1);

    const persistence: TacticCoverageView = tacticView(views, "TA0003");

    // A rule that is off covers nothing in the counts, but is listed.
    expect(persistence.coveredCount).toBe(0);
    expect(techniqueIn(persistence, "T1098").coverage).toBe(
      TechniqueCoverage.DisabledOnly,
    );
    expect(techniqueIn(persistence, "T1098").ruleCount).toBe(1);
  });

  test("list a tactic's techniques covered first, then off, then in the library, each group in the matrix's order", () => {
    for (const view of views) {
      const ranks: Array<number> = view.techniques.map(
        (technique: TechniqueCoverageView): number => {
          return TECHNIQUE_COVERAGE_ORDER.indexOf(technique.coverage);
        },
      );

      expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));

      for (const state of TECHNIQUE_COVERAGE_ORDER) {
        const inGroup: Array<string> = view.techniques
          .filter((technique: TechniqueCoverageView): boolean => {
            return technique.coverage === state;
          })
          .map((technique: TechniqueCoverageView): string => {
            return technique.id;
          });
        const inMatrix: Array<string> = view.matrixTechniques
          .filter((technique: TechniqueCoverageView): boolean => {
            return technique.coverage === state;
          })
          .map((technique: TechniqueCoverageView): string => {
            return technique.id;
          });

        expect(inGroup).toEqual(inMatrix);
      }
    }

    const credentialAccess: TacticCoverageView = tacticView(views, "TA0006");

    expect(
      credentialAccess.techniques
        .slice(0, 3)
        .map((technique: TechniqueCoverageView): string => {
          return technique.id;
        }),
    ).toEqual(["T1110", "T1621", "T1556"]);
  });

  test("keep the matrix's own order for the matrix", () => {
    for (const view of views) {
      expect(
        view.matrixTechniques.map(
          (technique: TechniqueCoverageView): string => {
            return technique.id;
          },
        ),
      ).toEqual(
        (MITRE_TACTIC_TECHNIQUES[view.tactic.id] || []).map(
          ([id]: readonly [string, string]): string => {
            return id;
          },
        ),
      );
    }
  });

  test("a tactic's bar is the share covered, as a whole percent", () => {
    expect(getCoveredPercent({ coveredCount: 2, techniqueCount: 18 })).toBe(11);
    expect(getCoveredPercent({ coveredCount: 0, techniqueCount: 12 })).toBe(0);
    expect(getCoveredPercent({ coveredCount: 9, techniqueCount: 9 })).toBe(100);
    expect(getCoveredPercent({ coveredCount: 0, techniqueCount: 0 })).toBe(0);
  });
});

describe("what the Rule Library would add", () => {
  const entry: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY[0]!;

  test("a project with none of its rules can add every one", () => {
    expect(getLibraryRulesNotAdded([])).toHaveLength(
      DETECTION_RULE_LIBRARY.length,
    );
  });

  test("a library rule the project has is left out, by its name, whatever its case", () => {
    const left: Array<DetectionRuleLibraryEntry> = getLibraryRulesNotAdded([
      entry.title.toUpperCase(),
    ]);

    expect(left).toHaveLength(DETECTION_RULE_LIBRARY.length - 1);
    expect(left).not.toContain(entry);
  });

  test("a library rule the team renamed is left out too, known by the Sigma id it carries", () => {
    // ATT&CK Coverage matched by name only, so a renamed rule read as missing while the Rule Library said Added.
    const left: Array<DetectionRuleLibraryEntry> = getLibraryRulesNotAdded([
      {
        name: "Our own name for it",
        sigmaRuleYaml: entry.sigmaRuleYaml,
        isEnabled: true,
      },
    ]);

    expect(left).not.toContain(entry);
  });

  test("the gap counts techniques no enabled rule covers that the library would, and the rules that would", () => {
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1110"]),
      rule("r2", ["attack.t1098"], false),
    ]);
    const library: AttackCoverage = buildAttackCoverage([
      // T1110 is covered already; T1098 is covered by a rule that is off.
      rule("lib-1", ["attack.t1110", "attack.t1098"]),
      rule("lib-2", ["attack.t1556"]),
      rule("lib-3", ["attack.t1110"]),
    ]);

    const gap: LibraryCoverageGap = getLibraryCoverageGap(coverage, library);

    expect(gap).toEqual({ ruleCount: 2, techniqueCount: 2 });
  });

  test("no gap once the rules cover all the library does", () => {
    const library: AttackCoverage = buildAttackCoverage([
      rule("lib-1", ["attack.t1110"]),
    ]);
    const coverage: AttackCoverage = buildAttackCoverage([
      rule("r1", ["attack.t1110.001"]),
    ]);

    expect(getLibraryCoverageGap(coverage, library)).toEqual({
      ruleCount: 0,
      techniqueCount: 0,
    });
  });

  test("for a new project the gap is everything the library covers", () => {
    const library: AttackCoverage = buildLibraryCoverage([]);
    const gap: LibraryCoverageGap = getLibraryCoverageGap(NO_COVERAGE, library);

    expect(gap.techniqueCount).toBe(countCoveredTechniques(library));
    expect(gap.techniqueCount).toBeGreaterThan(20);
    expect(gap.ruleCount).toBe(DETECTION_RULE_LIBRARY.length);
  });

  test("a project with every library rule has nothing left to add", () => {
    const existing: Array<{
      name: string;
      sigmaRuleYaml: string;
      isEnabled: boolean;
    }> = DETECTION_RULE_LIBRARY.map(
      (
        libraryEntry: DetectionRuleLibraryEntry,
      ): { name: string; sigmaRuleYaml: string; isEnabled: boolean } => {
        return {
          name: libraryEntry.title,
          sigmaRuleYaml: libraryEntry.sigmaRuleYaml,
          isEnabled: true,
        };
      },
    );
    const library: AttackCoverage = buildLibraryCoverage(existing);

    expect(library.rulesByTechnique.size).toBe(0);
    expect(
      getLibraryCoverageGap(
        buildAttackCoverage(
          DETECTION_RULE_LIBRARY.map(
            (libraryEntry: DetectionRuleLibraryEntry): CoverageRuleInput => {
              return {
                id: libraryEntry.id,
                name: libraryEntry.title,
                isEnabled: true,
                sigmaRuleYaml: libraryEntry.sigmaRuleYaml,
              };
            },
          ),
        ),
        library,
      ),
    ).toEqual({ ruleCount: 0, techniqueCount: 0 });
  });
});

describe("the page's words", () => {
  test("say what every tactic is after, as MITRE_TACTICS says it", () => {
    expect(Object.keys(TACTIC_GOALS).sort()).toEqual(
      MITRE_TACTICS.map((tactic: MitreTactic): string => {
        return tactic.id;
      }).sort(),
    );

    for (const tactic of MITRE_TACTICS) {
      expect([tactic.id, TACTIC_GOALS[tactic.id]]).toEqual([
        tactic.id,
        tactic.goal,
      ]);
    }
  });

  test("name every state of a technique, and every view", () => {
    for (const state of Object.values(TechniqueCoverage)) {
      expect(TECHNIQUE_COVERAGE_LABELS[state]).toBeTruthy();
    }

    for (const view of Object.values(AttackCoverageView)) {
      expect(ATTACK_COVERAGE_VIEW_LABELS[view]).toBeTruthy();
      expect(ATTACK_COVERAGE_DESCRIPTIONS[view]).toBeTruthy();
    }
  });

  test("the address keeps the matrix, and anything else opens on the tactics", () => {
    expect(ATTACK_COVERAGE_QUERY_KEYS).toEqual({
      view: "view",
      tactic: "tactic",
    });
    expect(readAttackCoverageView("matrix")).toBe(AttackCoverageView.Matrix);
    expect(readAttackCoverageView("tactics")).toBe(AttackCoverageView.Tactics);
    expect(readAttackCoverageView(null)).toBe(AttackCoverageView.Tactics);
    expect(readAttackCoverageView("MATRIX")).toBe(AttackCoverageView.Tactics);
    expect(readAttackCoverageView("")).toBe(AttackCoverageView.Tactics);
  });

  test("every one is in every Dashboard locale, translated", () => {
    const sentences: Array<string> = [
      ...Object.values(TACTIC_GOALS),
      ...Object.values(TECHNIQUE_COVERAGE_LABELS),
      ...Object.values(ATTACK_COVERAGE_VIEW_LABELS),
      ...Object.values(ATTACK_COVERAGE_DESCRIPTIONS),
      TACTIC_COVERED_COUNT,
      TACTIC_LIBRARY_COUNT,
      LIBRARY_GAP_SENTENCE.other,
      LIBRARY_GAP_ACTION,
    ];

    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      for (const sentence of sentences) {
        expect([
          locale,
          sentence,
          isSaidInLocale(locale, sentence, entries[sentence]),
        ]).toEqual([locale, sentence, true]);
      }

      expect(typeof entries[`${LIBRARY_GAP_SENTENCE.other}_one`]).toBe(
        "string",
      );
    }
  });
});
