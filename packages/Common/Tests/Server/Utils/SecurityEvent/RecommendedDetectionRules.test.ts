import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SETUP_TEST_DETECTION_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser, {
  detectionRuleHeader,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";

/*
 * The recommended rules are what one click turns on for a new project, so
 * each must be a library rule, worth having on with no product connected,
 * and the setup test's rule must be one of them.
 */
describe("the recommended detection rules", () => {
  test("every recommended id is a rule in the library, once", () => {
    expect(new Set(RECOMMENDED_DETECTION_RULE_IDS).size).toBe(
      RECOMMENDED_DETECTION_RULE_IDS.length,
    );

    for (const id of RECOMMENDED_DETECTION_RULE_IDS) {
      expect([id, getDetectionRuleLibraryEntry(id)?.id]).toEqual([id, id]);
    }
  });

  test("come in the library's order", () => {
    const libraryOrder: Array<string> = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return RECOMMENDED_DETECTION_RULE_IDS.includes(entry.id);
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.id;
    });

    expect(
      getRecommendedDetectionRules().map(
        (entry: DetectionRuleLibraryEntry): string => {
          return entry.id;
        },
      ),
    ).toEqual(libraryOrder);
  });

  test("none of them needs one product's events: no Okta, no EDR, no firewall", () => {
    for (const entry of getRecommendedDetectionRules()) {
      expect([entry.title, entry.dataSource.includes("Okta")]).toEqual([
        entry.title,
        false,
      ]);
      expect([
        entry.title,
        entry.dataSource.includes("Sysmon or Windows"),
      ]).toEqual([entry.title, false]);
      expect([entry.title, entry.category]).not.toEqual([
        entry.title,
        DetectionRuleLibraryCategory.Network,
      ]);
    }
  });

  test("cover every kind of record 'Your logs' reads", () => {
    const sources: Set<string> = new Set(
      getRecommendedDetectionRules().map(
        (entry: DetectionRuleLibraryEntry): string => {
          return entry.dataSource;
        },
      ),
    );

    for (const source of [
      "Authentication events from any source",
      "AWS CloudTrail events",
      "Kubernetes audit logs",
      "HTTP or web server events",
    ]) {
      expect([source, sources.has(source)]).toEqual([source, true]);
    }
  });

  test("each carries its library id in its Sigma YAML, which is how a project's copy is recognized", () => {
    for (const entry of getRecommendedDetectionRules()) {
      const rule: SigmaRule = detectionRuleHeader(
        SigmaRuleSetParser.parse(entry.sigmaRuleYaml),
      );

      expect(rule.id).toBe(entry.id);
    }
  });

  test("isRecommendedDetectionRule agrees with the list", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(isRecommendedDetectionRule(entry)).toBe(
        RECOMMENDED_DETECTION_RULE_IDS.includes(entry.id),
      );
    }
  });

  test("the setup test fires the brute force rule, which is recommended", () => {
    const entry: DetectionRuleLibraryEntry | undefined =
      getDetectionRuleLibraryEntry(SETUP_TEST_DETECTION_RULE_ID);

    expect(entry?.title).toBe("Brute force from one IP address");
    expect(entry?.groupByField).toBe("principalIp");
    expect(entry?.matchCountThreshold).toBe(10);
    expect(isRecommendedDetectionRule(entry!)).toBe(true);
  });
});
