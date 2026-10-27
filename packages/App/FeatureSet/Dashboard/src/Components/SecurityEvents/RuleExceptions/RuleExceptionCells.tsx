import {
  ADDED_AT,
  ADDED_BY_NOBODY,
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

// One of the model's lines, as a sentence in the reader's language.
export function writeRuleExceptionLine(
  translator: Translator,
  line: RuleExceptionLine,
): string {
  return translator.translateTemplate(line.key, {
    field: line.field || "",
    time: writeTime(line.time),
    from: writeTime(line.from),
    until: writeTime(line.until),
  });
}

export interface SkipsCellProps {
  exception: DetectionRuleExceptionShape;
}

/*
 * What the row skips, over what kind of thing it is: "svc-backup" over
 * "User", "backup.exe" over "Value of processName", or a window's times
 * over "Time window". A value someone wrote reads the way it is written
 * (IsolatedText), and a long one breaks rather than widening the table.
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
      className="flex min-w-[12rem] items-start gap-2"
      data-testid={RULE_EXCEPTIONS_TEST_IDS.skipsCell}
    >
      <Icon
        icon={view.icon}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0">
        {view.window ? (
          <span className="block text-sm text-gray-900">
            {translator.translateTemplate(TIME_WINDOW_RANGE, {
              from: writeTime(view.window.from),
              until: writeTime(view.window.until),
            })}
          </span>
        ) : (
          <span className="block break-all font-mono text-sm text-gray-900">
            <IsolatedText text={view.value || ""} />
          </span>
        )}
        <span className="block text-xs text-gray-500">
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
 * before a window starts, Expired or Ended once it skips nothing - with
 * until when, or since when, under it.
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
        className="whitespace-nowrap text-xs text-gray-500"
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

export interface AddedByCellProps {
  name?: string | undefined;
  createdAt?: Date | undefined;
}

/*
 * Who added it and when: the person's name over "Added 3 days ago", or
 * "Added through the API" when no person did (an API key, a workflow).
 */
export const RuleExceptionAddedByCell: FunctionComponent<AddedByCellProps> = (
  props: AddedByCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="min-w-[8rem]"
      data-testid={RULE_EXCEPTIONS_TEST_IDS.addedByCell}
    >
      <span className="block text-sm text-gray-900">
        {props.name ? (
          <IsolatedText text={props.name} />
        ) : (
          translator.translateText(ADDED_BY_NOBODY)
        )}
      </span>
      {props.createdAt ? (
        <span
          className="block text-xs text-gray-500"
          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            props.createdAt,
          )}
        >
          {translator.translateTemplate(ADDED_AT, {
            time: OneUptimeDate.fromNow(props.createdAt),
          })}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};
