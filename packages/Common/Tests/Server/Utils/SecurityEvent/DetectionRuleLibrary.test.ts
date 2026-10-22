import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
} from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
} from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  DETECTION_RULE_LIBRARY,
  DETECTION_RULE_LIBRARY_CATEGORIES,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  getDetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  getMitreTactic,
  resolveMitreTechniqueId,
} from "../../../../Types/SecurityEvent/MitreAttack";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import {
  DetectionRuleDefinition,
  DetectionRuleType,
  SigmaCorrelationStep,
  detectionRuleTypeOf,
} from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser, {
  detectionRuleHeader,
  sigmaRulesOf,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { describe, expect, test } from "@jest/globals";

// The rule as the engine reads it: one Sigma rule, or a correlation, all in its own YAML.
function parseEntry(entry: DetectionRuleLibraryEntry): DetectionRuleDefinition {
  // No resolver: a library rule carries every rule it reads.
  return SigmaRuleSetParser.parse(entry.sigmaRuleYaml);
}

/*
 * The rule library is only worth offering if every rule in it is one the
 * engine runs as written: it parses, it compiles to a query, its metadata
 * agrees with its YAML, and every ATT&CK tag names something in the current
 * matrix (the coverage view counts nothing it cannot place).
 */

const entries: Array<[string, DetectionRuleLibraryEntry]> =
  DETECTION_RULE_LIBRARY.map(
    (entry: DetectionRuleLibraryEntry): [string, DetectionRuleLibraryEntry] => {
      return [entry.title, entry];
    },
  );

describe("DETECTION_RULE_LIBRARY", () => {
  test("ids and titles are unique", () => {
    const ids: Set<string> = new Set();
    const titles: Set<string> = new Set();

    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(ids.has(entry.id)).toBe(false);
      expect(titles.has(entry.title)).toBe(false);
      ids.add(entry.id);
      titles.add(entry.title);
    }
  });

  test("every category has rules, and every rule is in a listed category", () => {
    for (const category of DETECTION_RULE_LIBRARY_CATEGORIES) {
      expect(
        DETECTION_RULE_LIBRARY.some((entry: DetectionRuleLibraryEntry) => {
          return entry.category === category;
        }),
      ).toBe(true);
    }

    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(DETECTION_RULE_LIBRARY_CATEGORIES).toContain(entry.category);
    }
  });

  test("finds an entry by id", () => {
    const first: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY[0]!;

    expect(getDetectionRuleLibraryEntry(first.id)).toBe(first);
    expect(getDetectionRuleLibraryEntry("missing")).toBeUndefined();
  });

  test("offers sequences and first-seen rules beside single-event ones", () => {
    const types: Set<DetectionRuleType> = new Set(
      DETECTION_RULE_LIBRARY.map(
        (entry: DetectionRuleLibraryEntry): DetectionRuleType => {
          return detectionRuleTypeOf(parseEntry(entry));
        },
      ),
    );

    expect(types.has(DetectionRuleType.SingleEvent)).toBe(true);
    expect(types.has(DetectionRuleType.TemporalOrdered)).toBe(true);
    expect(types.has(DetectionRuleType.NewValue)).toBe(true);
  });

  test("covers identity, endpoint and cloud with more than a token rule each", () => {
    const countIn: (category: DetectionRuleLibraryCategory) => number = (
      category: DetectionRuleLibraryCategory,
    ): number => {
      return DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry) => {
          return entry.category === category;
        },
      ).length;
    };

    expect(
      countIn(DetectionRuleLibraryCategory.Identity),
    ).toBeGreaterThanOrEqual(8);
    expect(
      countIn(DetectionRuleLibraryCategory.Endpoint),
    ).toBeGreaterThanOrEqual(8);
    expect(countIn(DetectionRuleLibraryCategory.Cloud)).toBeGreaterThanOrEqual(
      4,
    );
  });

  describe.each(entries)(
    "%s",
    (_title: string, entry: DetectionRuleLibraryEntry) => {
      test("parses, with the entry's id and title", () => {
        const rule: SigmaRule = detectionRuleHeader(parseEntry(entry));

        expect(rule.id).toBe(entry.id);
        expect(rule.title).toBe(entry.title);
        expect(rule.description.length).toBeGreaterThan(10);
      });

      test("compiles to a parameterized ClickHouse condition", () => {
        for (const rule of sigmaRulesOf(parseEntry(entry))) {
          const statement: Statement = SigmaClickhouseCompiler.compile(rule);

          expect(statement.query.length).toBeGreaterThan(0);
          // Every value travels as a parameter, never as SQL text.
          expect(Object.keys(statement.query_params).length).toBeGreaterThan(0);
        }
      });

      test("a correlation holds every rule it reads, and groups by its own fields", () => {
        const definition: DetectionRuleDefinition = parseEntry(entry);

        if (definition.kind !== "correlation") {
          return;
        }

        expect(definition.unresolvedReferences).toEqual([]);
        expect(
          definition.steps.every((step: SigmaCorrelationStep): boolean => {
            return Boolean(step.rule || step.count);
          }),
        ).toBe(true);
        // Its YAML holds its grouping: the entry sets none of its own.
        expect(entry.groupByField).toBeUndefined();
        expect(entry.distinctCountField).toBeUndefined();
        expect(entry.matchCountThreshold).toBe(1);
      });

      test("its group and distinct-count fields build expressions", () => {
        if (entry.groupByField) {
          expect(
            buildSigmaFieldExpression(entry.groupByField).query.length,
          ).toBeGreaterThan(0);
        }

        if (entry.distinctCountField) {
          expect(
            buildSigmaDistinctCountExpression(entry.distinctCountField).query
              .length,
          ).toBeGreaterThan(0);
          // Counting distinct values only means something per group.
          expect(entry.groupByField).toBeTruthy();
        }
      });

      test("its interval and threshold are within what a rule may save", () => {
        expect(Number.isInteger(entry.evaluationIntervalInMinutes)).toBe(true);
        expect(entry.evaluationIntervalInMinutes).toBeGreaterThanOrEqual(
          DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
        );
        expect(entry.evaluationIntervalInMinutes).toBeLessThanOrEqual(
          DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
        );
        expect(Number.isInteger(entry.matchCountThreshold)).toBe(true);
        expect(entry.matchCountThreshold).toBeGreaterThanOrEqual(
          DETECTION_MATCH_COUNT_THRESHOLD_MIN,
        );
        expect(entry.matchCountThreshold).toBeLessThanOrEqual(
          DETECTION_MATCH_COUNT_THRESHOLD_MAX,
        );
      });

      test("names at least one ATT&CK tactic and technique of the current matrix", () => {
        const rule: SigmaRule = detectionRuleHeader(parseEntry(entry));

        expect(rule.mitreTactics.length).toBeGreaterThan(0);
        expect(rule.mitreTechniques.length).toBeGreaterThan(0);

        for (const tactic of rule.mitreTactics) {
          expect(getMitreTactic(tactic)?.id).toBe(tactic);
        }

        for (const technique of rule.mitreTechniques) {
          expect(resolveMitreTechniqueId(technique)).toBeTruthy();
        }
      });
    },
  );
});
