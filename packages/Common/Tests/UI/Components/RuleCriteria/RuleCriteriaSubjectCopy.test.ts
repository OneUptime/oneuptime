import { describe, expect, test } from "@jest/globals";
import RuleCriteriaSubject from "../../../../Types/Rules/RuleCriteriaSubject";
import {
  getRuleCriteriaSubjectCopy,
  RULE_CRITERIA_ANY_SUBJECT_COPY,
  RULE_CRITERIA_SUBJECT_COPY,
  RuleCriteriaSubjectCopy,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";

/*
 * The two answers to "Applies to", in the words of a rule's records:
 * "All incidents" and "Only incidents that match conditions". Each phrase is
 * whole, one per kind of record, so every language words it with its own
 * agreement ("Tous les incidents", "Toutes les alertes");
 * RuleCriteriaBuilderI18n holds each to all seventeen locale files.
 */

const ALL_PREFIX: string = "All ";
const MATCHING_PREFIX: string = "Only ";
const MATCHING_SUFFIX: string = " that match conditions";

const SUBJECTS: Array<RuleCriteriaSubject> = Object.values(
  RuleCriteriaSubject,
) as Array<RuleCriteriaSubject>;

describe("RULE_CRITERIA_SUBJECT_COPY", () => {
  test("words every kind of record", () => {
    expect(Object.keys(RULE_CRITERIA_SUBJECT_COPY).sort()).toEqual(
      [...SUBJECTS].sort(),
    );
    expect(SUBJECTS.length).toBe(32);
  });

  test.each(SUBJECTS)(
    "%s: 'All <records>' and 'Only <the same records> that match conditions'",
    (subject: RuleCriteriaSubject) => {
      const copy: RuleCriteriaSubjectCopy = RULE_CRITERIA_SUBJECT_COPY[subject];

      expect(copy.all.startsWith(ALL_PREFIX)).toBe(true);
      expect(copy.matching.startsWith(MATCHING_PREFIX)).toBe(true);
      expect(copy.matching.endsWith(MATCHING_SUFFIX)).toBe(true);

      const records: string = copy.all.slice(ALL_PREFIX.length);
      expect(records.trim()).toBe(records);
      expect(records.length).toBeGreaterThan(2);
      expect(copy.matching).toBe(
        `${MATCHING_PREFIX}${records}${MATCHING_SUFFIX}`,
      );
      // A label, not a sentence: no full stop.
      expect(copy.all.endsWith(".")).toBe(false);
      expect(copy.matching.endsWith(".")).toBe(false);
    },
  );

  test("no two kinds of record read the same", () => {
    const all: Array<string> = SUBJECTS.map(
      (subject: RuleCriteriaSubject): string => {
        return RULE_CRITERIA_SUBJECT_COPY[subject].all;
      },
    );

    expect(new Set(all).size).toBe(all.length);
  });

  test("the records are lower case, as in a sentence, except their proper names", () => {
    expect(RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.Incidents].all).toBe(
      "All incidents",
    );
    expect(
      RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.KubernetesClusters].all,
    ).toBe("All Kubernetes clusters");
    expect(
      RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.ServiceLevelObjectives]
        .matching,
    ).toBe("Only SLOs that match conditions");
  });
});

describe("getRuleCriteriaSubjectCopy", () => {
  test("answers a kind of record with its own words", () => {
    expect(getRuleCriteriaSubjectCopy(RuleCriteriaSubject.Alerts)).toBe(
      RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.Alerts],
    );
  });

  test.each([[null], [undefined]])(
    "answers %p with the words that name nothing",
    (subject: null | undefined) => {
      expect(getRuleCriteriaSubjectCopy(subject)).toBe(
        RULE_CRITERIA_ANY_SUBJECT_COPY,
      );
      expect(RULE_CRITERIA_ANY_SUBJECT_COPY).toEqual({
        all: "Everything",
        matching: "Only what matches conditions",
      });
    },
  );
});
