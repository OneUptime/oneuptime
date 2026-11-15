import OneUptimeDate from "Common/Types/Date";
import {
  OnCallPolicyRunWaitReason,
  readOnCallPolicyRunWaitReason,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A WAITING RUN WAITS FOR, IN THE READER'S WORDS (#7552).
 *
 * A run held before it pages - by an on-call rule that pages only during
 * working hours, or by OneUptime AI while it works - says why and when it
 * pages in its status message, in English for every reader
 * (OnCallDutyPolicyRunWait). The Execution Logs table drew that message as
 * it was: English on every page, and on an Arabic or Persian one laid out
 * right to left, so its full stop came first and "(Europe/London)" turned
 * round. The line is now worded here from the run itself: why it waits,
 * read back from its message (readOnCallPolicyRunWaitReason), and when
 * paging starts, its pagingStartsAt in the reader's own date and time,
 * set apart in a sentence read right to left. A run whose line cannot be
 * read that way - a message of another shape, a run with no moment - shows
 * its message as written, a line of its own that reads left to right on
 * an Arabic or Persian page (IsolatedLine).
 */

export const WAITING_RUN_SENTENCES: Readonly<
  Record<OnCallPolicyRunWaitReason, string>
> = {
  [OnCallPolicyRunWaitReason.WorkingHours]: translationKey(
    "Waiting for working hours. Paging starts {{time}}.",
  ),
  [OnCallPolicyRunWaitReason.OneUptimeAI]: translationKey(
    "Waiting for OneUptime AI. Paging starts {{time}} unless it resolves this.",
  ),
  [OnCallPolicyRunWaitReason.Other]: translationKey(
    "Waiting. Paging starts {{time}}.",
  ),
};

export interface WaitingRun {
  statusMessage?: string | undefined;
  pagingStartsAt?: Date | string | undefined;
}

/*
 * When paging starts, as the reader reads a date and a time: "Nov 18,
 * 09:00", "18. Nov., 09:00", "۱۸ نوامبر، ۰۹:۰۰" - with its year when it is
 * not this year's. Null for no moment, or one that is no date.
 */
function getPagingStartsText(
  pagingStartsAt: Date | string | undefined,
  now: Date | undefined,
): string | null {
  if (!pagingStartsAt) {
    return null;
  }

  const at: Date = OneUptimeDate.fromString(pagingStartsAt);

  if (isNaN(at.getTime())) {
    return null;
  }

  return OneUptimeDate.getDateAsLocalShortDateTimeString(at, {
    showYear: !OneUptimeDate.isWindowInTheCurrentYear({
      start: at,
      end: at,
      now: now,
    }),
  });
}

/*
 * A waiting run's line in the reader's words, or null when it cannot be
 * read from the run: its message is not a waiting run's, or the run has no
 * moment to page at.
 */
export function getWaitingRunSentence(
  translator: Translator,
  run: WaitingRun,
  // The moment "this year" is read from: now, unless a caller says.
  now?: Date | undefined,
): string | null {
  const reason: OnCallPolicyRunWaitReason | null =
    readOnCallPolicyRunWaitReason(run.statusMessage);
  const time: string | null = getPagingStartsText(run.pagingStartsAt, now);

  if (!reason || !time) {
    return null;
  }

  return translator.translateTemplate(
    WAITING_RUN_SENTENCES[reason],
    { time: time },
    { setsValuesApart: true },
  );
}

export interface ComponentProps {
  run: WaitingRun;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const WaitingRunLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const sentence: string | null = getWaitingRunSentence(translator, props.run);

  if (sentence !== null) {
    return (
      <p className={props.className} data-testid={props.dataTestId}>
        {sentence}
      </p>
    );
  }

  if (!props.run.statusMessage) {
    return <></>;
  }

  return (
    <IsolatedLine
      as="p"
      text={props.run.statusMessage}
      className={props.className}
      dataTestId={props.dataTestId}
    />
  );
};

export default WaitingRunLine;
