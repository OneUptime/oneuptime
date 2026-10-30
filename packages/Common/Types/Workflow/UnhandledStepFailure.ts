/*
 * A step that fails, with nothing connected to its Error output, fails the
 * run.
 *
 * Every step that can go wrong has an Error output, and a run that leaves a
 * step by it goes on to whatever is connected there: a Log, a message to
 * Slack, another way round. Until now a run whose step failed with nothing
 * connected there simply ended, and was listed as a Success - so the
 * templates put a Log on almost every Error output, to say in the run's log
 * that something had gone wrong (the maintainer counted about twenty steps in
 * one template, "in a tree too wide to read at once"). The run says it now,
 * once, for every step: it is listed as failed in Runs, the step that failed
 * is marked in its Steps with why, and its log ends with the line below.
 *
 * A step whose Error output is connected has its failure handled: the run
 * goes on there, and ends as it ends, as it always did. So a workflow that
 * already puts a Log after a step's Error output runs exactly as before.
 */

/** The id every step's Error output has. */
export const STEP_ERROR_PORT_ID: string = "error";

export interface UnhandledStepFailure {
  // The step's id on the canvas ("api-get-1").
  componentId: string;
  // Its component's title ("API GET").
  title: string;
}

export type GetUnhandledStepFailureLogLineFunction = (
  failures: Array<UnhandledStepFailure>,
) => string;

/*
 * The last line of the log of a run that failed this way: which steps
 * failed, and that nothing handled them. One line, however many failed.
 */
export const getUnhandledStepFailureLogLine: GetUnhandledStepFailureLogLineFunction =
  (failures: Array<UnhandledStepFailure>): string => {
    const steps: string = failures
      .map((failure: UnhandledStepFailure): string => {
        return `${failure.componentId} (${failure.title})`;
      })
      .join(", ");

    return failures.length === 1
      ? `The run failed: step ${steps} failed, and nothing is connected to its Error output. Why is in its Steps entry above.`
      : `The run failed: steps ${steps} failed, and nothing is connected to their Error outputs. Why is in their Steps entries above.`;
  };

export type ReadUnhandledStepFailuresFunction = (
  value: unknown,
) => Array<UnhandledStepFailure>;

/*
 * The failures a run kept in its resume data when it slept on a Sleep step,
 * read back when it wakes. Anything that is not one is dropped: a run that
 * slept before this was recorded has none.
 */
export const readUnhandledStepFailures: ReadUnhandledStepFailuresFunction = (
  value: unknown,
): Array<UnhandledStepFailure> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item: unknown): boolean => {
      return (
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as UnhandledStepFailure).componentId === "string" &&
        typeof (item as UnhandledStepFailure).title === "string"
      );
    })
    .map((item: unknown): UnhandledStepFailure => {
      return {
        componentId: (item as UnhandledStepFailure).componentId,
        title: (item as UnhandledStepFailure).title,
      };
    });
};

export type IsUnhandledStepFailureFunction = (data: {
  // The output the step left by, or null when it left by none.
  portId: string | null | undefined;
  // The steps connected to that output in the run.
  connectedComponentIds: Array<string> | null | undefined;
}) => boolean;

// Whether a step left by its Error output with nothing connected to it.
export const isUnhandledStepFailure: IsUnhandledStepFailureFunction = (data: {
  portId: string | null | undefined;
  connectedComponentIds: Array<string> | null | undefined;
}): boolean => {
  return (
    data.portId === STEP_ERROR_PORT_ID &&
    (data.connectedComponentIds || []).length === 0
  );
};
