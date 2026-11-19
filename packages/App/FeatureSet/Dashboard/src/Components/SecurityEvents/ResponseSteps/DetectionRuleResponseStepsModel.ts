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
 * PUTTING A RULE'S STEPS IN ORDER (#9796).
 *
 * A case's Response Plan shows a rule's steps under their parts - Confirm
 * it is real, Contain it, Fix what let it happen - each part's in the order
 * the rule lists them. So the order that counts is the order within a
 * part, and the field lists the steps that way too: under their parts, as
 * the plan reads them (getResponseStepsInPlanOrder). A step moves among
 * the steps of its own part, one place at a time (Move Up, Move Down) or
 * dragged; it changes part by its picker, and lands at the end of its new
 * part nearest where it was.
 *
 * Every step keeps its id wherever it moves, so the key a case's plan keeps
 * it under (getDetectionRuleResponseStepKey: `rule:<id>`) never changes,
 * and a step ticked off on a case stays ticked. The list is the rule's one
 * column, written whole with the rule, so its order is simply the list's
 * order: there is no number of each step to keep, and a write of the whole
 * list lands exactly as written, however it is sent (the form, the API,
 * Terraform).
 */

// The steps as the plan reads them: by part, each part's in the order written.
export function getResponseStepsInPlanOrder(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
): Array<DetectionRuleResponseStep> {
  return getResponseStepsByPart(steps).flatMap(
    (part: ResponseStepsOfPart): Array<DetectionRuleResponseStep> => {
      return part.steps;
    },
  );
}

// Which way a step moves: one place up, or one place down.
export enum ResponseStepMove {
  Up = -1,
  Down = 1,
}

/*
 * The place in the plan's order a step at `index` (of the plan's order)
 * moves to: the next step of its own part that way, or -1 when it is the
 * first (or last) of its part already.
 */
function getMovePlace(data: {
  steps: ReadonlyArray<DetectionRuleResponseStep>;
  index: number;
  move: ResponseStepMove;
}): number {
  const step: DetectionRuleResponseStep | undefined = data.steps[data.index];
  const place: number = data.index + data.move;
  const neighbour: DetectionRuleResponseStep | undefined = data.steps[place];

  return step && neighbour && neighbour.phase === step.phase ? place : -1;
}

// Whether the step at `index` of the plan's order can move one place that way, within its part.
export function canMoveResponseStep(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
  index: number,
  move: ResponseStepMove,
): boolean {
  return (
    getMovePlace({
      steps: getResponseStepsInPlanOrder(steps),
      index,
      move,
    }) !== -1
  );
}

/*
 * The step at `index` of the plan's order moved one place up or down among
 * its part's steps, its id and every other step as they were: the list in
 * the plan's order. A step that cannot move that way leaves the list as it
 * was.
 */
export function moveResponseStep(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
  index: number,
  move: ResponseStepMove,
): Array<DetectionRuleResponseStep> {
  const ordered: Array<DetectionRuleResponseStep> =
    getResponseStepsInPlanOrder(steps);
  const place: number = getMovePlace({ steps: ordered, index, move });

  if (place === -1) {
    return ordered;
  }

  const moved: Array<DetectionRuleResponseStep> = [...ordered];
  const step: DetectionRuleResponseStep = moved[index]!;

  moved[index] = moved[place]!;
  moved[place] = step;

  return moved;
}

/*
 * One of a part's steps dragged from `from` to `to`, both places among that
 * part's steps (as a drag of its list reports them), the rest of the part
 * stepping aside: the list in the plan's order. A place outside the part
 * leaves the list as it was.
 */
export function moveResponseStepInPart(
  steps: ReadonlyArray<DetectionRuleResponseStep>,
  phase: DetectionRuleResponsePhase,
  from: number,
  to: number,
): Array<DetectionRuleResponseStep> {
  const parts: Array<ResponseStepsOfPart> = getResponseStepsByPart(steps);
  const part: ResponseStepsOfPart | undefined = parts.find(
    (candidate: ResponseStepsOfPart): boolean => {
      return candidate.phase === phase;
    },
  );

  if (
    !part ||
    from < 0 ||
    to < 0 ||
    from >= part.steps.length ||
    to >= part.steps.length
  ) {
    return getResponseStepsInPlanOrder(steps);
  }

  const partSteps: Array<DetectionRuleResponseStep> = [...part.steps];
  const [step] = partSteps.splice(from, 1);

  partSteps.splice(to, 0, step!);

  return parts.flatMap(
    (candidate: ResponseStepsOfPart): Array<DetectionRuleResponseStep> => {
      return candidate.phase === phase ? partSteps : candidate.steps;
    },
  );
}

/*
 * What More fields says of the field while it is folded: how many steps the
 * rule carries of its own - an empty list too, its author's "none" - or
 * nothing while it carries none written.
 */
export function getResponseStepsFoldedCount(value: unknown): number | null {
  return Array.isArray(value) ? readEditedResponseSteps(value).length : null;
}
