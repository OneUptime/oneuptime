import {
  EXPOSURE_DRAFT_PARTS,
  ExposureAssessmentView,
  ExposureDraftAnswer,
  ExposureDraftPart,
  ExposureDraftSection,
  HeldExposureDrafts,
  holdExposureDraftsToFacts,
} from "../../../../../Types/DataSecurity/ExposureAssessment";
import { AiComplianceFacts } from "../../DataSecurity/DataSecurityAiInput";
import {
  buildCaseExposurePrompt,
  EXPOSURE_ASSESSMENT_MAX_TOKENS,
  EXPOSURE_ASSESSMENT_TEMPERATURE,
  readExposureAssessmentAnswer,
} from "../../DataSecurity/ExposureAssessmentPrompt";
import { ExposureAssessmentEvalCase } from "./DataSecurityEvalCase";
import {
  getExposureEvalFacts,
  getExposureEvalView,
} from "./DataSecurityExposureEvalSet";
import {
  PaperworkEvalCall,
  PaperworkEvalScore,
} from "./DataSecurityPaperworkEval";

/*
 * AN EXPOSURE'S WRITE-UP, ASKED AND SCORED AS THE PRODUCT ASKS AND HOLDS IT
 * (#10377).
 *
 * The input is the product's: the exposure worked out by its plain code,
 * its facts built by DataSecurityAiInput, its words ExposureAssessmentPrompt's.
 * The answer is read and held to its facts exactly as the product holds it
 * (holdExposureDraftsToFacts) - a part the product would drop counts as no
 * part - and then each part the case names must be kept and say its
 * words, and no part may say what the case says a right write-up never
 * does.
 */

function lower(text: string): string {
  return text.toLowerCase();
}

export function exposureAssessmentCall(
  testCase: ExposureAssessmentEvalCase,
): PaperworkEvalCall {
  const view: ExposureAssessmentView = getExposureEvalView(testCase.exposure);
  const built: AiComplianceFacts = getExposureEvalFacts(testCase.exposure);

  return {
    messages: buildCaseExposurePrompt({
      feature: testCase.feature,
      built,
      parts: [...EXPOSURE_DRAFT_PARTS],
      dueFirst: view.mostUrgent?.ruleId,
      language: testCase.language || "en",
    }).messages,
    maxTokens: EXPOSURE_ASSESSMENT_MAX_TOKENS,
    temperature: EXPOSURE_ASSESSMENT_TEMPERATURE,
  };
}

export function scoreExposureAssessment(
  testCase: ExposureAssessmentEvalCase,
  answer: string,
): PaperworkEvalScore {
  const read: ExposureDraftAnswer | null = readExposureAssessmentAnswer(answer);

  if (!read) {
    return { passed: false, notes: ["not the answer asked for"] };
  }

  const held: HeldExposureDrafts = holdExposureDraftsToFacts({
    answer: read,
    facts: getExposureEvalFacts(testCase.exposure).facts,
    now: new Date(testCase.exposure.now),
  });
  const notes: Array<string> = [];

  for (const [part, groups] of Object.entries(testCase.expect.parts) as Array<
    [ExposureDraftPart, Array<Array<string>>]
  >) {
    const section: ExposureDraftSection | undefined = held.sections[part];

    if (!section) {
      notes.push(
        held.dropped[part]
          ? `${part} was dropped: ${held.dropped[part]}`
          : `${part} was not written`,
      );
      continue;
    }

    const said: string = lower(section.markdown);

    for (const group of groups) {
      if (
        !group.some((word: string): boolean => {
          return said.includes(lower(word));
        })
      ) {
        notes.push(`${part} does not say ${group.join(" or ")}`);
      }
    }
  }

  const everything: string = lower(
    Object.values(held.sections)
      .map((section: ExposureDraftSection | undefined): string => {
        return section?.markdown || "";
      })
      .join("\n"),
  );

  for (const word of testCase.expect.never) {
    if (everything.includes(lower(word))) {
      notes.push(`says "${word}"`);
    }
  }

  return { passed: notes.length === 0, notes };
}
