import {
  CODE_TASK_ATTEMPT,
  CODE_TASK_RETRY_NOW,
  CODE_TASK_RETRYING_IN,
  CODE_TASK_RETRYING_NOW,
  getRetryReasonKey,
} from "./CodeTaskStatusCopy";
import {
  formatEventDurationParts,
  getEventDurationParts,
  LESS_THAN_A_MINUTE,
} from "../../Utils/EventDuration";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import { CodeTaskRetryJSON } from "Common/Types/AI/CodeTaskRetry";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useClockTick from "Common/UI/Utils/UseClockTick";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A note with a button in it (Retry now, Try again) measures itself, not
 * the screen: its button sits beside its words only from 28rem wide, and
 * under them in a narrower note - an insight's side column at a laptop's
 * width, a phone, a long language.
 */
export const RETRY_NOTE_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";

export const WIDE_NOTE_ROW_CLASS_NAME: string =
  "[@container(min-width:28rem)]:flex-row [@container(min-width:28rem)]:gap-3";

export interface ComponentProps {
  retry: CodeTaskRetryJSON;
  // Start the next attempt now, for those who may.
  onRetryNow?: (() => void) | undefined;
  isRetryingNow?: boolean | undefined;
  // One quiet line, for a list row or a header.
  isCompact?: boolean | undefined;
  // The compact line's size where it does not take its line's.
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * When the next attempt starts, in the reader's words: "Trying again in 4
 * minutes", then "Trying again now…" once its wait is over and a Runner is
 * about to take it. Counted down on its own clock.
 */
export const getRetryCountdownText: (data: {
  nextAttemptAt: string;
  now: Date;
  translator: Translator;
}) => string = (data: {
  nextAttemptAt: string;
  now: Date;
  translator: Translator;
}): string => {
  const at: Date = new Date(data.nextAttemptAt);

  if (Number.isNaN(at.getTime()) || at.getTime() <= data.now.getTime()) {
    return (
      data.translator.translateText(CODE_TASK_RETRYING_NOW) ||
      CODE_TASK_RETRYING_NOW
    );
  }

  const parts: ReturnType<typeof getEventDurationParts> = getEventDurationParts(
    data.now,
    at,
    { maxUnits: 2 },
  );

  const duration: string =
    parts.length === 0
      ? data.translator.translateText(LESS_THAN_A_MINUTE) || LESS_THAN_A_MINUTE
      : formatEventDurationParts(parts, data.translator.language);

  return data.translator.translateTemplate(CODE_TASK_RETRYING_IN, {
    duration,
  });
};

/*
 * A turn AI tries again by itself: which attempt it is on, why the one
 * before failed, and - while it waits - when the next starts, with Retry
 * now for those who may not want to wait.
 */
const CodeTaskRetryNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isWaiting: boolean = Boolean(props.retry.nextAttemptAt);
  const now: Date = useClockTick(false, { isEnabled: isWaiting });

  const attempt: string = translator.translateTemplate(CODE_TASK_ATTEMPT, {
    attempt: translator.formatNumber(props.retry.attempt),
    max: translator.formatNumber(props.retry.maxAttempts),
  });
  const reasonKey: string = getRetryReasonKey(props.retry);
  const reason: string = reasonKey
    ? translator.translateText(reasonKey) || reasonKey
    : "";
  const countdown: string = props.retry.nextAttemptAt
    ? getRetryCountdownText({
        nextAttemptAt: props.retry.nextAttemptAt,
        now,
        translator,
      })
    : "";

  if (props.isCompact) {
    return (
      <span
        data-testid={props.dataTestId || "code-task-retry-note"}
        title={reason || undefined}
        className={`font-medium text-amber-700 ${props.className || ""}`}
      >
        {countdown ? `${attempt} · ${countdown}` : attempt}
      </span>
    );
  }

  /*
   * Retry now beside the words where the note is wide (a task's page), and
   * under them where it is not (an insight's side column, a phone, a long
   * language): beside them there, it squeezed the words to a word a line.
   */
  return (
    <div
      role="status"
      data-testid={props.dataTestId || "code-task-retry-note"}
      className={RETRY_NOTE_CONTAINER_CLASS_NAME}
    >
      <div
        className={`flex flex-col items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ${WIDE_NOTE_ROW_CLASS_NAME}`}
      >
        <div className="min-w-0 max-w-full flex-1">
          <p className="font-medium">
            {countdown ? `${attempt} · ${countdown}` : attempt}
          </p>
          {reason ? (
            <p
              data-testid="code-task-retry-reason"
              className="mt-0.5 break-words text-amber-800"
            >
              {reason}
            </p>
          ) : (
            <></>
          )}
        </div>
        {isWaiting && props.onRetryNow ? (
          <button
            type="button"
            data-testid="code-task-retry-now"
            disabled={props.isRetryingNow}
            onClick={props.onRetryNow}
            className={`flex-shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-amber-800 shadow-sm ring-1 ring-inset ring-amber-200 ${getHandDrawnButtonStateClassName(
              {
                isBusy: props.isRetryingNow,
                hoverClassName: "hover:bg-amber-100",
              },
            )}`}
          >
            {translator.translateText(CODE_TASK_RETRY_NOW)}
          </button>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default CodeTaskRetryNote;
