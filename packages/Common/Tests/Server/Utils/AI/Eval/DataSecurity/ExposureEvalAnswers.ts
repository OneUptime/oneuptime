import { ComplianceFact } from "../../../../../../Types/DataSecurity/ComplianceFacts";
import { ExposureDraftPart } from "../../../../../../Types/DataSecurity/ExposureAssessment";
import { ExposureAssessmentEvalCase } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCase";
import { getExposureEvalFacts } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityExposureEvalSet";

/*
 * What a right write-up of an exposure case is, for the eval's tests: each
 * part the case names says one word of each of its groups - words the
 * facts hold, as a right answer's do - and cites every fact it was given.
 * The sentence around them holds no number and names no law.
 */

const WRITTEN: string =
  "This draft rests on the assessment's facts, for a person to review and edit before anything is sent.";

export function getGoodExposureAnswer(
  testCase: ExposureAssessmentEvalCase,
): string {
  const ids: Array<string> = getExposureEvalFacts(testCase.exposure).facts.map(
    (fact: ComplianceFact): string => {
      return fact.id;
    },
  );
  const answer: Record<string, { markdown: string; facts: Array<string> }> = {};

  for (const [part, groups] of Object.entries(testCase.expect.parts) as Array<
    [ExposureDraftPart, Array<Array<string>>]
  >) {
    answer[part] = {
      markdown: `${groups
        .map((group: Array<string>): string => {
          return group[0]!;
        })
        .join(", ")}. ${WRITTEN}`,
      facts: ids,
    };
  }

  return JSON.stringify(answer);
}

// The ids of a case's facts with the keys a test names, for an answer that cites only those.
export function getExposureFactIds(
  testCase: ExposureAssessmentEvalCase,
  keys: ReadonlyArray<string>,
): Array<string> {
  return getExposureEvalFacts(testCase.exposure)
    .facts.filter((fact: ComplianceFact): boolean => {
      return keys.includes(fact.key);
    })
    .map((fact: ComplianceFact): string => {
      return fact.id;
    });
}
