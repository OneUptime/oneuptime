import Dictionary from "../Dictionary";

/*
 * Which Welcome checklist events a visit to Home should send (issue #6830):
 * home/checklist_step_completed for each step seen done that was last seen
 * not done, and home/checklist_finished when every step is seen done for
 * the first time. Pure, so the rule is tested on its own; ChecklistEvents
 * (Common/UI/Utils) keeps what was seen and sends them.
 *
 * Only a change this browser saw counts: a step it never saw undone - the
 * first visit, or a step whose check failed last time - is remembered, not
 * reported, so a reload or a second device never reports a step twice and
 * nothing is reported for steps done before anyone looked.
 */

export interface ChecklistProgressChange {
  // The steps seen done now that were seen not done before.
  completedSteps: Array<string>;
  // Every step is seen done now, and was not before.
  isFinished: boolean;
  // What to remember for the next visit.
  seen: Dictionary<boolean>;
}

export const getChecklistProgressChange: (data: {
  previouslySeen: Dictionary<boolean> | null;
  current: Dictionary<boolean>;
  stepKeys: ReadonlyArray<string>;
}) => ChecklistProgressChange = (data: {
  previouslySeen: Dictionary<boolean> | null;
  current: Dictionary<boolean>;
  stepKeys: ReadonlyArray<string>;
}): ChecklistProgressChange => {
  const seen: Dictionary<boolean> = {
    ...(data.previouslySeen || {}),
  };

  for (const key of data.stepKeys) {
    if (typeof data.current[key] === "boolean") {
      seen[key] = data.current[key] as boolean;
    }
  }

  if (!data.previouslySeen) {
    return { completedSteps: [], isFinished: false, seen: seen };
  }

  const previouslySeen: Dictionary<boolean> = data.previouslySeen;

  const completedSteps: Array<string> = data.stepKeys.filter(
    (key: string): boolean => {
      return data.current[key] === true && previouslySeen[key] === false;
    },
  );

  const isDoneIn: (progress: Dictionary<boolean>) => boolean = (
    progress: Dictionary<boolean>,
  ): boolean => {
    return (
      data.stepKeys.length > 0 &&
      data.stepKeys.every((key: string): boolean => {
        return progress[key] === true;
      })
    );
  };

  return {
    completedSteps: completedSteps,
    isFinished:
      isDoneIn(data.current) && !isDoneIn(previouslySeen) && completedSteps.length > 0,
    seen: seen,
  };
};
