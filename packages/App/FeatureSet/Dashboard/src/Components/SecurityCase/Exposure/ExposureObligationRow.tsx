import {
  DOES_NOT_APPLY,
  DUE_IN,
  EXPOSURE_TEST_IDS,
  HIDE_DETAILS,
  MAY_APPLY,
  NOT_YET_IN_FORCE,
  OVERDUE_BY,
  SHOW_DETAILS,
  SOURCE_CHECKED,
  WHAT_TO_CHECK,
  WHO_IS_TOLD,
  WHY_NOT,
} from "./ExposureAssessmentCopy";
import {
  DueReading,
  DueState,
  describeCheck,
  describeDeadline,
  describeDueDate,
  describeLaw,
  describeWhyNot,
  readDue,
  say,
} from "./ExposureAssessmentModel";
import { formatCompactDurationInMinutes } from "../../../Utils/CompactDuration";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import {
  BreachLawRule,
  getBreachLawRule,
} from "Common/Types/DataSecurity/BreachLaws";
import {
  BreachCheck,
  BreachObligation,
  BreachObligationStatus,
} from "Common/Types/DataSecurity/ExposureAssessment";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * ONE BREACH LAW OF THE TABLE, AS IT STANDS FOR THIS EXPOSURE (#10377): what
 * it asks and of whom, its deadline in its own units, when that is due and
 * how far off, and whether it may apply. Who is told, what a person still
 * checks - or why it does not apply - and the law's own text, checked on
 * the day the table says, are one click away.
 */

export interface ComponentProps {
  obligation: BreachObligation;
  now: Date;
}

const DOT: ReactElement = (
  <span aria-hidden="true" className="text-gray-400">
    ·
  </span>
);

// The chip that says how a law stands: how far off its deadline is, or why it does not count.
export const ObligationStatusPill: FunctionComponent<{
  obligation: BreachObligation;
  now: Date;
}> = (props: { obligation: BreachObligation; now: Date }): ReactElement => {
  const translator: Translator = useTranslator();
  const due: DueReading | null =
    props.obligation.status === BreachObligationStatus.MayApply &&
    props.obligation.isPlaceKnown
      ? readDue(props.obligation.dueAt, props.now)
      : null;

  if (due) {
    const time: string = formatCompactDurationInMinutes(
      due.minutes,
      translator.language,
    );

    return (
      <span data-testid={EXPOSURE_TEST_IDS.dueState} data-state={due.state}>
        <Pill
          text={translator.translateTemplate(
            due.state === DueState.Overdue ? OVERDUE_BY : DUE_IN,
            { time },
          )}
          isUserContent={true}
          tone={
            due.state === DueState.Overdue
              ? PillTone.Danger
              : due.state === DueState.DueSoon
                ? PillTone.Warning
                : PillTone.Neutral
          }
          size={PillSize.Small}
        />
      </span>
    );
  }

  switch (props.obligation.status) {
    case BreachObligationStatus.MayApply:
      return (
        <Pill text={MAY_APPLY} tone={PillTone.Warning} size={PillSize.Small} />
      );
    case BreachObligationStatus.NotYetInForce:
      return (
        <Pill
          text={NOT_YET_IN_FORCE}
          tone={PillTone.Neutral}
          size={PillSize.Small}
        />
      );
    default:
      return (
        <Pill
          text={DOES_NOT_APPLY}
          tone={PillTone.Success}
          size={PillSize.Small}
        />
      );
  }
};

// A calendar day the table names ("2026-11-24"), as the reader writes a date: never a day off.
export function describeCalendarDay(day: string): string {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: `${day}T12:00:00.000Z`,
    timezone: "UTC",
    onlyShowDate: true,
    hideZone: true,
  });
}

const ExposureObligationRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const rule: BreachLawRule | undefined = getBreachLawRule(
    props.obligation.ruleId,
  );

  if (!rule) {
    return <></>;
  }

  const mayApply: boolean =
    props.obligation.status === BreachObligationStatus.MayApply;
  const dueDate: string = mayApply
    ? describeDueDate(props.obligation, translator)
    : "";
  const checks: Array<string> = mayApply
    ? props.obligation.checks
        .map((check: BreachCheck): string => {
          return describeCheck(check, translator);
        })
        .filter(Boolean)
    : [];
  const whyNot: Array<string> = mayApply
    ? []
    : describeWhyNot(props.obligation, translator);
  const detailsId: string = `${EXPOSURE_TEST_IDS.law}-${props.obligation.ruleId}-details`;

  return (
    <li
      className="space-y-1.5 py-3"
      data-testid={`${EXPOSURE_TEST_IDS.law}-${props.obligation.ruleId}`}
      data-status={props.obligation.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-gray-900">
            {say(translator, rule.action)}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-600">
            <span className="font-medium text-gray-700">
              {describeLaw(rule, translator)}
            </span>
            {DOT}
            <span>{describeDeadline(rule, translator)}</span>
            {dueDate ? (
              <>
                {DOT}
                <span>{dueDate}</span>
              </>
            ) : (
              <></>
            )}
          </p>
        </div>
        <ObligationStatusPill obligation={props.obligation} now={props.now} />
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-expanded={isOpen}
        aria-controls={detailsId}
        data-testid={`${EXPOSURE_TEST_IDS.law}-${props.obligation.ruleId}-toggle`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon
          icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
          className="h-4 w-4"
        />
        <span>{say(translator, isOpen ? HIDE_DETAILS : SHOW_DETAILS)}</span>
      </button>
      {isOpen ? (
        <div
          id={detailsId}
          className="space-y-3 border-s-2 border-gray-100 ps-3 text-sm text-gray-700"
        >
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-gray-500">
              {say(translator, WHO_IS_TOLD)}
            </p>
            <p>{say(translator, rule.recipient)}</p>
            {rule.deadlineNote ? (
              <p className="text-gray-600">
                {say(translator, rule.deadlineNote)}
              </p>
            ) : (
              <></>
            )}
          </div>
          {checks.length > 0 ? (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-gray-500">
                {say(translator, WHAT_TO_CHECK)}
              </p>
              <div>
                <ul className="list-disc space-y-0.5 ps-5">
                  {checks.map((check: string): ReactElement => {
                    return <li key={check}>{check}</li>;
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <></>
          )}
          {whyNot.length > 0 ? (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-gray-500">
                {say(translator, WHY_NOT)}
              </p>
              <div>
                <ul className="list-disc space-y-0.5 ps-5">
                  {whyNot.map((line: string): ReactElement => {
                    return <li key={line}>{line}</li>;
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <></>
          )}
          {rule.note ? (
            <p className="text-gray-600">{say(translator, rule.note)}</p>
          ) : (
            <></>
          )}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
            <Link
              to={URL.fromString(rule.sourceUrl)}
              openInNewTab={true}
              className="font-medium text-indigo-600 hover:underline [overflow-wrap:anywhere]"
              title={rule.sourceTitle}
              isTitleTranslated={true}
            >
              {rule.sourceTitle}
            </Link>
            {DOT}
            <span>
              {translator.translateTemplate(SOURCE_CHECKED, {
                date: describeCalendarDay(rule.checkedOn),
              })}
            </span>
          </p>
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

export default ExposureObligationRow;
