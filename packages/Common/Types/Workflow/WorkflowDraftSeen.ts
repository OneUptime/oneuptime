import { JSONObject } from "../JSON";
import {
  WorkflowDraftDigestFunction,
  WorkflowDraftProposedStep,
  fingerprintWorkflowStepContents,
  fingerprintWorkflowSteps,
  getWorkflowStepIds,
} from "./WorkflowDraftRebase";

/*
 * WHAT AN ASK AI CHANGE WOULD UNDO THAT ASK AI NEVER SAW (issue #6291).
 *
 * Ask AI writes a change to a workflow as a whole draft of its steps, from
 * what it last saw of them (Types/AI/AIChatRecordSeen): its read, or the
 * workflow as it created or changed it itself. Whatever was saved after
 * that - a step a teammate added, a setting the person changed in the
 * Builder beside the panel - the draft knows nothing of. Laid over the
 * workflow as it is, it takes their step out again, or puts the old
 * setting back. The approval card says what the change does to the
 * workflow as it is ("Removes Send Message to Slack"), which is true, but
 * nothing told the person that this removal was no part of what they
 * asked for.
 *
 * A step's change since Ask AI saw it is undone when the change touches
 * that step too: it was one thing when Ask AI saw it, it is another now,
 * and the change makes it something else again - most often what Ask AI
 * saw. A step is compared by its fingerprint (WorkflowDraftRebase): what
 * it is and what it connects to, never where its card sits. So a moved
 * card is no save to speak of, and nor is a setting changed on a step the
 * change leaves as it is: the change keeps both, and the card says nothing
 * more than it always did.
 *
 * Pure: no database, no clock. The digest is the caller's, keyed.
 */

/*
 * Ask AI's knowledge of the workflow: each step's fingerprint as it last
 * saw it, or null where it saw no such step. Null as a whole: it never saw
 * the workflow's steps, so every step it changes is one it has not seen.
 */
export type WorkflowStepsSeen = ReadonlyMap<string, string | null> | null;

export interface WorkflowStepsUndone {
  /*
   * The steps whose changes since Ask AI saw them the change undoes, by id,
   * in the order of the workflow as it is, then of the change.
   */
  stepIds: Array<string>;
  /*
   * Of those, the steps to name: the ones the change adds back, takes out,
   * or makes another component or other settings - what a step itself is.
   * When it undoes only what the steps connect to, all of them.
   */
  namedStepIds: Array<string>;
}

type FingerprintEveryStepFunction = (data: {
  graph: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}) => Array<WorkflowDraftProposedStep>;

// What Ask AI is shown of a graph: every step's fingerprint, in the graph's order.
export const fingerprintEveryWorkflowStep: FingerprintEveryStepFunction =
  (data: {
    graph: JSONObject | null | undefined;
    digest: WorkflowDraftDigestFunction;
  }): Array<WorkflowDraftProposedStep> => {
    return fingerprintWorkflowSteps({
      graph: data.graph,
      stepIds: getWorkflowStepIds(data.graph),
      digest: data.digest,
    });
  };

type ByIdFunction = (
  steps: Array<WorkflowDraftProposedStep>,
) => Map<string, string | null>;

const byId: ByIdFunction = (
  steps: Array<WorkflowDraftProposedStep>,
): Map<string, string | null> => {
  return new Map<string, string | null>(
    steps.map((step: WorkflowDraftProposedStep): [string, string | null] => {
      return [step.id, step.fingerprint];
    }),
  );
};

type FindStepsUndoneFunction = (data: {
  seen: WorkflowStepsSeen;
  // The workflow as it is now.
  graph: JSONObject | null | undefined;
  // The workflow as the change would leave it (the draft built over `graph`).
  changed: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}) => WorkflowStepsUndone;

/*
 * The steps the change would undo that were changed after Ask AI saw them
 * (see the comment at the top): none when nobody saved the workflow since,
 * when only cards moved, and when the change leaves alone each step that
 * was changed. With nothing seen, every step the workflow has that the
 * change touches.
 */
export const findWorkflowStepsUndoneUnseen: FindStepsUndoneFunction = (data: {
  seen: WorkflowStepsSeen;
  graph: JSONObject | null | undefined;
  changed: JSONObject | null | undefined;
  digest: WorkflowDraftDigestFunction;
}): WorkflowStepsUndone => {
  const stepIds: Array<string> = Array.from(
    new Set<string>([
      ...getWorkflowStepIds(data.graph),
      ...getWorkflowStepIds(data.changed),
      ...(data.seen ? Array.from(data.seen.keys()) : []),
    ]),
  );

  const now: Map<string, string | null> = byId(
    fingerprintWorkflowSteps({
      graph: data.graph,
      stepIds: stepIds,
      digest: data.digest,
    }),
  );
  const after: Map<string, string | null> = byId(
    fingerprintWorkflowSteps({
      graph: data.changed,
      stepIds: stepIds,
      digest: data.digest,
    }),
  );

  const undone: Array<string> = stepIds.filter((stepId: string): boolean => {
    const isNow: string | null = now.get(stepId) ?? null;

    if ((after.get(stepId) ?? null) === isNow) {
      // The change leaves the step as it is: whatever was saved to it stays.
      return false;
    }

    if (!data.seen) {
      return true;
    }

    // Changed since Ask AI saw it: it was another step then, or none.
    return (data.seen.get(stepId) ?? null) !== isNow;
  });

  const contentNow: Map<string, string | null> = byId(
    fingerprintWorkflowStepContents({
      graph: data.graph,
      stepIds: undone,
      digest: data.digest,
    }),
  );
  const contentAfter: Map<string, string | null> = byId(
    fingerprintWorkflowStepContents({
      graph: data.changed,
      stepIds: undone,
      digest: data.digest,
    }),
  );

  const named: Array<string> = undone.filter((stepId: string): boolean => {
    return (
      (contentNow.get(stepId) ?? null) !== (contentAfter.get(stepId) ?? null)
    );
  });

  return {
    stepIds: undone,
    namedStepIds: named.length > 0 ? named : undone,
  };
};
