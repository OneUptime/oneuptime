import { getDetectionRuleLibraryResponseStepsForYaml } from "Common/Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import {
  DETECTION_RULE_RESPONSE_PHASES,
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  isDetectionRuleResponsePhase,
  isDetectionRuleResponseStepId,
  makeDetectionRuleResponseStepId,
} from "Common/Types/SecurityEvent/DetectionRuleResponseSteps";

/*
 * A DETECTION RULE'S RESPONSE STEPS, AS ITS FORM EDITS THEM (#9621).
 *
 * The rule's form holds the steps as the column does: a list of steps, each
 * under a part of the case's Response Plan, with an id of its own. A rule
 * with none written (null) and added from the rule library reads its
 * library rule's steps, so the form shows those - and only once the author
 * changes one do they become the rule's own, written to the form. A step
 * being written may have no words yet: the server leaves such a step out
 * when the rule is saved (DetectionRuleService).
 *
 * React-free, so it is tested on its own.
 */

// A new step goes under Contain it: what a rule's author most often adds.
export const NEW_RESPONSE_STEP_PHASE: DetectionRuleResponsePhase =
  DetectionRuleResponsePhase.Contain;

export interface ResponseStepsShown {
  steps: Array<DetectionRuleResponseStep>;
  // The library rule's, shown while the rule has none of its own.
  isFromLibrary: boolean;
}

/*
 * The steps as the form holds them: each with an id and a part of the plan,
 * its words as typed (none yet, too), in order, at most the most a rule
 * carries.
 */
export function readEditedResponseSteps(
  value: unknown,
): Array<DetectionRuleResponseStep> {
  const steps: Array<DetectionRuleResponseStep> = [];

  if (!Array.isArray(value)) {
    return steps;
  }

  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    if (steps.length >= DETECTION_RULE_RESPONSE_STEPS_MAX) {
      break;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const id: unknown = record["id"];
    const phase: unknown = record["phase"];

    if (
      !isDetectionRuleResponseStepId(id) ||
      !isDetectionRuleResponsePhase(phase) ||
      seen.has(id as string)
    ) {
      continue;
    }

    seen.add(id as string);
    steps.push({
      id: id as string,
      phase,
      text:
        typeof record["text"] === "string"
          ? record["text"].substring(
              0,
              DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
            )
          : "",
    });
  }

  return steps;
}

/*
 * What the field shows: the rule's own steps - an empty list is its
 * author's "none" - or, with none written, its library rule's.
 */
export function getResponseStepsShown(data: {
  value: unknown;
  sigmaRuleYaml: unknown;
}): ResponseStepsShown {
  if (Array.isArray(data.value)) {
    return { steps: readEditedResponseSteps(data.value), isFromLibrary: false };
  }

  const library: Array<DetectionRuleResponseStep> =
    getDetectionRuleLibraryResponseStepsForYaml(
      typeof data.sigmaRuleYaml === "string" ? data.sigmaRuleYaml : "",
    );

  return { steps: library, isFromLibrary: library.length > 0 };
}

export function canAddResponseStep(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
): boolean {
  return steps.length < DETECTION_RULE_RESPONSE_STEPS_MAX;
}

// One more step, under Contain it, with an id none of the others has.
export function addResponseStep(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
): Array<DetectionRuleResponseStep> {
  if (!canAddResponseStep(steps)) {
    return [...steps];
  }

  return [
    ...steps,
    {
      id: makeDetectionRuleResponseStepId(
        steps.map((step: DetectionRuleResponseStep): string => {
          return step.id;
        }),
      ),
      phase: NEW_RESPONSE_STEP_PHASE,
      text: "",
    },
  ];
}

// One step changed - its part of the plan or its words - its id kept.
export function changeResponseStep(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
  index: number,
  change: Partial<Pick<DetectionRuleResponseStep, "phase" | "text">>,
): Array<DetectionRuleResponseStep> {
  return steps.map(
    (
      step: DetectionRuleResponseStep,
      stepIndex: number,
    ): DetectionRuleResponseStep => {
      return stepIndex === index ? { ...step, ...change } : step;
    },
  );
}

export function removeResponseStep(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
  index: number,
): Array<DetectionRuleResponseStep> {
  return steps.filter(
    (_step: DetectionRuleResponseStep, stepIndex: number): boolean => {
      return stepIndex !== index;
    },
  );
}

export interface ResponseStepsOfPart {
  phase: DetectionRuleResponsePhase;
  steps: Array<DetectionRuleResponseStep>;
}

// The steps under each part of the plan, in the plan's order: parts with none left out.
export function getResponseStepsByPart(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
): Array<ResponseStepsOfPart> {
  return DETECTION_RULE_RESPONSE_PHASES.map(
    (phase: DetectionRuleResponsePhase): ResponseStepsOfPart => {
      return {
        phase,
        steps: steps.filter((step: DetectionRuleResponseStep): boolean => {
          return step.phase === phase;
        }),
      };
    },
  ).filter((part: ResponseStepsOfPart): boolean => {
    return part.steps.length > 0;
  });
}

/*
 * What More fields says of the field while it is folded: how many steps the
 * rule carries of its own - an empty list too, its author's "none" - or
 * nothing while it carries none written.
 */
export function getResponseStepsFoldedCount(value: unknown): number | null {
  return Array.isArray(value) ? readEditedResponseSteps(value).length : null;
}
