import OneUptimeDate from "Common/Types/Date";
import {
  RunbookScheduleChoice,
  RunbookScheduleProblem,
  getNextRunbookRuns,
  getRunbookScheduleChoiceProblem,
  getRunbookScheduleCron,
  isValidRunbookScheduleTimezone,
} from "Common/Types/Runbook/RunbookSchedule";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  NEXT_RUNS_SHOWN,
  RunTimeText,
  RunbookTriggersCopy,
  RunbookTriggersTestIds,
  formatRunTime,
  getScheduleProblemText,
  getScheduleSentence,
} from "./RunbookTriggersCopy";

/*
 * The next runs of a schedule, worked out the way the Worker that starts
 * them works them out (Types/Runbook/RunbookSchedule), each on the
 * schedule's clock, in the reader's language, with how long until it:
 * "Mon, Oct 19, 09:00 BST  in 4 days".
 */
export interface NextRunsProps {
  cron: string;
  timezone: string;
  // From when; now when left out.
  after?: Date | undefined;
  count?: number | undefined;
}

export const NextRuns: FunctionComponent<NextRunsProps> = (
  props: NextRunsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = props.after || OneUptimeDate.getCurrentDate();

  let runs: Array<Date> = [];

  try {
    runs = getNextRunbookRuns({
      cron: props.cron,
      timezone: props.timezone,
      after: now,
      count: props.count || NEXT_RUNS_SHOWN,
    });
  } catch {
    runs = [];
  }

  if (runs.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {translator.translateText(RunbookTriggersCopy.noNextRun)}
      </p>
    );
  }

  return (
    <ol
      className="space-y-1 text-sm text-gray-700"
      data-testid={RunbookTriggersTestIds.nextRuns}
    >
      {runs.map((run: Date) => {
        const time: RunTimeText = formatRunTime({
          date: run,
          timezone: props.timezone,
          language: translator.language,
          now,
        });

        return (
          <li
            key={run.toISOString()}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <time
              className="font-medium tabular-nums text-gray-900"
              dateTime={run.toISOString()}
            >
              {time.when}
            </time>
            <span className="text-xs text-gray-500">{time.relative}</span>
          </li>
        );
      })}
    </ol>
  );
};

/*
 * The schedule dialog's live answer, as the form changes. While the choice
 * cannot run, why - in the words the server would refuse it with - right
 * under the field that is wrong ("problem"). Otherwise the schedule in a
 * sentence and its next runs, under the time zone they are read in
 * ("runs"): the times depend on both.
 */
export interface ComponentProps {
  choice: RunbookScheduleChoice;
  timezone: string | undefined;
  part: "problem" | "runs";
}

const RunbookSchedulePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const problem: RunbookScheduleProblem | null =
    getRunbookScheduleChoiceProblem(props.choice);
  const timezone: string | undefined = isValidRunbookScheduleTimezone(
    props.timezone,
  )
    ? props.timezone
    : undefined;

  if (props.part === "problem") {
    if (!problem) {
      return <></>;
    }

    return (
      <div
        className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3"
        data-testid={RunbookTriggersTestIds.schedulePreview}
        data-state="error"
      >
        <p className="text-sm text-red-700" role="alert">
          {getScheduleProblemText(translator, problem)}
        </p>
      </div>
    );
  }

  if (problem) {
    return <></>;
  }

  return (
    <div
      className="mt-3 space-y-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
      data-testid={RunbookTriggersTestIds.schedulePreview}
      data-state="ok"
    >
      <p className="text-sm font-medium text-gray-900">
        {getScheduleSentence(translator, props.choice)}
      </p>
      {timezone ? (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(RunbookTriggersCopy.previewNextRuns)}
          </p>
          <NextRuns
            cron={getRunbookScheduleCron(props.choice)}
            timezone={timezone}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RunbookSchedulePreview;
