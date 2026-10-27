import useLiveDuration, {
  LiveDuration,
  LiveDurationDate,
} from "Common/UI/Utils/UseLiveDuration";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW LONG A RUN HAS BEEN GOING, on its page's Elapsed tile.
 *
 * The tile used to say "Running..." for as long as the run had no end - a
 * run waiting for someone to approve a step or tick one off included, where
 * nothing runs and "Running..." is not even true. It now counts up from the
 * run's start, once a second, worded as every live duration in the product
 * is ("12 mins 4 secs", in the reader's language): a run that has waited an
 * hour for its approval says so.
 *
 * A run that ended without an end time (cancelled before it started, say)
 * has no duration to count: it shows a dash rather than a clock that never
 * stops. A run that has not started yet shows one too.
 */

export const RUNBOOK_RUN_ELAPSED_TEST_ID: string = "runbook-execution-elapsed";

export interface ComponentProps {
  // When the run started; none while it is still queued.
  startedAt: LiveDurationDate;
  // Whether the run is over. An ended run's duration does not count up.
  isFinished: boolean;
}

const RunbookRunElapsed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const duration: LiveDuration = useLiveDuration({
    startDate: props.isFinished ? null : props.startedAt,
  });

  if (props.isFinished || duration.durationInSeconds === null) {
    return <span data-testid={RUNBOOK_RUN_ELAPSED_TEST_ID}>—</span>;
  }

  return (
    <time
      data-testid={RUNBOOK_RUN_ELAPSED_TEST_ID}
      dateTime={`PT${duration.durationInSeconds}S`}
      /*
       * A count of elapsed time, read when the reader reaches it rather
       * than announced every second.
       */
      role="timer"
      aria-live="off"
      // Even-width digits, so the count does not shuffle as it ticks.
      className="tabular-nums"
    >
      {duration.formattedDuration}
    </time>
  );
};

export default RunbookRunElapsed;
