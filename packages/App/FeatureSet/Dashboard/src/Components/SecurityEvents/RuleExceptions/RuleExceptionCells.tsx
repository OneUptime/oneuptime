import {
  ADDED_BY_NOBODY,
  ADDED_BY_PERSON,
  ADDED_THROUGH_API,
  RULE_EXCEPTIONS_TEST_IDS,
  TIME_WINDOW_RANGE,
} from "./RuleExceptionsCopy";
import {
  RuleExceptionLine,
  RuleExceptionSkipsView,
  getRuleExceptionSkipsView,
  getRuleExceptionStatusColor,
  getRuleExceptionStatusLine,
} from "./RuleExceptionsModel";
import OneUptimeDate from "Common/Types/Date";
import {
  DetectionRuleExceptionShape,
  DetectionRuleExceptionStatus,
  getDetectionRuleExceptionStatus,
} from "Common/Types/SecurityEvent/DetectionRuleException";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The cells of Security Events > Rule Exceptions: what a row skips, where
 * it stands, and who added it. What each says is worked out in
 * RuleExceptionsModel (React-free); here it is put into the reader's words.
 */

// A time as a list's line says it: "Oct 30, 14:00", the whole of it under the pointer.
function writeTime(time: Date | undefined): string {
  return time ? OneUptimeDate.getDateAsLocalShortDateTimeString(time) : "-";
}

// How far ahead or how long ago: "in 30 days", "2 days ago".
function writeRelativeTime(time: Date | undefined): string {
  return time ? OneUptimeDate.fromNow(time) : "-";
}

/*
 * A window's two times, each with its day: a bare clock reading for the
 * end of a one-day window was written in English ("PM") on a Persian page,
 * where the day and the time are written together in the reader's words.
 */
export function writeRuleExceptionWindowTimes(window: {
  from: Date | undefined;
  until: Date | undefined;
}): { from: string; until: string } {
  return { from: writeTime(window.from), until: writeTime(window.until) };
}

// One of the model's lines, as a sentence in the reader's language.
export function writeRuleExceptionLine(
  translator: Translator,
  line: RuleExceptionLine,
): string {
  const time: string = line.isTimeRelative
    ? writeRelativeTime(line.time)
    : writeTime(line.time);

  if (!line.key) {
    return time;
  }

  return translator.translateTemplate(line.key, {
    field: line.field || "",
    time,
    from: writeTime(line.from),
    until: writeTime(line.until),
  });
}

/*
 * What a row is called where the list names one: its Delete question, its
 * check box and its ⋯ for a screen reader. The value it skips, or a
 * window's times.
 */
export function writeRuleExceptionName(
  translator: Translator,
  exception: DetectionRuleExceptionShape,
): string {
  const view: RuleExceptionSkipsView = getRuleExceptionSkipsView(exception);

  if (view.window) {
    return translator.translateTemplate(
      TIME_WINDOW_RANGE,
      writeRuleExceptionWindowTimes(view.window),
    );
  }

  return view.value || "";
}

export interface WindowRangeProps {
  from: Date | undefined;
  until: Date | undefined;
}

/*
 * A window's times in a sentence of the reader's language, each time kept
 * whole on its line: a narrow column breaks the line between the two times,
 * never inside one ("Oct 15, 9:00 AM to" / "Oct 15, 1:00 PM").
 */
export const RuleExceptionWindowRange: FunctionComponent<WindowRangeProps> = (
  props: WindowRangeProps,
): ReactElement => {
  const times: { from: string; until: string } =
    writeRuleExceptionWindowTimes(props);

  return (
    <TranslatedSentence
      template={TIME_WINDOW_RANGE}
      slots={{
        from: <span className="whitespace-nowrap">{times.from}</span>,
        until: <span className="whitespace-nowrap">{times.until}</span>,
      }}
    />
  );
};

export interface SkipsCellProps {
  exception: DetectionRuleExceptionShape;
}

/*
 * What the row skips, over what kind of thing it is: "svc-backup" over
 * "User", "backup.exe" over "Value of processName", or a window's times
 * over "Time window". A value someone wrote reads the way it is written
 * (IsolatedText), in the mono type Protected Entities and a case's entities
 * write values in, and a long one breaks rather than widening the table.
 */
export const RuleExceptionSkipsCell: FunctionComponent<SkipsCellProps> = (
  props: SkipsCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const view: RuleExceptionSkipsView = getRuleExceptionSkipsView(
    props.exception,
  );

  return (
    <div
      className="flex items-start gap-2"
      data-testid={RULE_EXCEPTIONS_TEST_IDS.skipsCell}
    >
      <Icon
        icon={view.icon}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0">
        {view.window ? (
          <span className="block text-sm text-gray-900">
            <RuleExceptionWindowRange
              from={view.window.from}
              until={view.window.until}
            />
          </span>
        ) : (
          <span className="block break-all text-sm text-gray-900">
            {/*
             * The mono type on the value's own isolate: every element
             * names its font (the page's * rule), so a parent's does not
             * reach it.
             */}
            <IsolatedText text={view.value || ""} className="font-mono" />
          </span>
        )}
        <span className="block text-xs font-normal text-gray-500">
          {writeRuleExceptionLine(translator, view.kind)}
        </span>
      </div>
    </div>
  );
};

export interface StatusCellProps {
  exception: DetectionRuleExceptionShape;
  now: Date;
}

/*
 * Where the exception stands: Active (green) while it skips, Upcoming
 * before a window starts, Expired or Ended once it skips nothing - with how
 * far off under it ("Expires in 30 days", "2 days ago"), the date itself
 * under the pointer.
 */
export const RuleExceptionStatusCell: FunctionComponent<StatusCellProps> = (
  props: StatusCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: DetectionRuleExceptionStatus = getDetectionRuleExceptionStatus(
    props.exception,
    props.now,
  );
  const line: RuleExceptionLine = getRuleExceptionStatusLine(
    props.exception,
    props.now,
  );
  const lineTime: Date | undefined = line.time;

  return (
    <div
      className="flex flex-col items-start gap-1"
      data-testid={RULE_EXCEPTIONS_TEST_IDS.statusCell}
    >
      <Pill
        text={status}
        color={getRuleExceptionStatusColor(status)}
        isMinimal={true}
      />
      <span
        className="text-xs text-gray-500"
        title={
          lineTime
            ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(lineTime)
            : undefined
        }
      >
        {writeRuleExceptionLine(translator, line)}
      </span>
    </div>
  );
};

export interface ReasonCellProps {
  reason: string;
  // The person who added it; none when an API key or a workflow did.
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}

/*
 * Who added it and when, as the line under the reason says it: the person's
 * name in an isolate of its own, so a Latin name keeps its place in a
 * Persian sentence, and how long ago kept whole on its line ("6 days ago",
 * never "6 days" over "ago").
 */
export const RuleExceptionAddedLine: FunctionComponent<{
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}> = (props: {
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.createdAt) {
    return props.addedBy ? (
      <IsolatedText text={props.addedBy} />
    ) : (
      <>{translator.translateText(ADDED_BY_NOBODY) || ADDED_BY_NOBODY}</>
    );
  }

  const time: ReactElement = (
    <span className="whitespace-nowrap">
      {OneUptimeDate.fromNow(props.createdAt)}
    </span>
  );

  if (!props.addedBy) {
    return <TranslatedSentence template={ADDED_THROUGH_API} slots={{ time }} />;
  }

  return (
    <TranslatedSentence
      template={ADDED_BY_PERSON}
      slots={{ name: <IsolatedText text={props.addedBy} />, time }}
    />
  );
};

/*
 * Why it is safe to skip, with who added it and when under it: "Added by
 * Maya Chen 3 days ago", or "Added through the API 40 days ago" when no
 * person did (an API key, a workflow). A reason someone wrote reads the way
 * it is written (IsolatedText).
 */
export const RuleExceptionReasonCell: FunctionComponent<ReasonCellProps> = (
  props: ReasonCellProps,
): ReactElement => {
  return (
    <div>
      <span className="block whitespace-pre-line break-words text-sm text-gray-900">
        <IsolatedText text={props.reason} />
      </span>
      <span
        className="mt-0.5 block text-xs text-gray-500"
        data-testid={RULE_EXCEPTIONS_TEST_IDS.addedByCell}
        title={
          props.createdAt
            ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                props.createdAt,
              )
            : undefined
        }
      >
        <RuleExceptionAddedLine
          addedBy={props.addedBy}
          createdAt={props.createdAt}
        />
      </span>
    </div>
  );
};
