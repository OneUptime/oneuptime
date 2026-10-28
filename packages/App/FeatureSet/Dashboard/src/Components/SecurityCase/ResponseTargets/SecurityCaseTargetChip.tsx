import {
  RESPONSE_TARGETS_TEST_IDS,
  SECURITY_CASE_DUE_CELL_IN,
  SECURITY_CASE_DUE_CELL_OVERDUE,
  SECURITY_CASE_TARGET_DUE_AT,
  SECURITY_CASE_TARGET_NAMES,
} from "./ResponseTargetsCopy";
import {
  SecurityCaseDue,
  SecurityCaseTargetCase,
  getSecurityCaseDue,
  getSecurityCaseTargetToneClassName,
  getSecurityCaseTargetToneColor,
} from "./SecurityCaseTargetDisplay";
import { formatCompactDurationInMinutes } from "../../../Utils/CompactDuration";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// How often a due time on screen is read again: often enough for minutes.
export const SECURITY_CASE_TARGET_REFRESH_MS: number = 30 * 1000;

/*
 * The time now, read again every half minute while it is shown, so a due
 * time counts down - and turns amber, then red - without a reload.
 */
export function useTargetClock(): Date {
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, SECURITY_CASE_TARGET_REFRESH_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return now;
}

export interface ComponentProps {
  securityCase: SecurityCaseTargetCase;
  priorities: ReadonlyArray<SecurityCasePriority>;
}

/*
 * The case's header chip: the target the case is working against now and
 * how long is left - "Acknowledge in 12 min" - or how far past it is -
 * "Acknowledge overdue by 5 min": grey on track, amber in its last fifth,
 * red once missed; when it is due on hover. Nothing once every target is
 * met, or for a case without targets (SecurityCaseTargetDisplay).
 */
export const SecurityCaseTargetChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = useTargetClock();
  const due: SecurityCaseDue | null = getSecurityCaseDue({
    securityCase: props.securityCase,
    priorities: props.priorities,
    now,
  });

  if (!due) {
    return <></>;
  }

  const time: string = formatCompactDurationInMinutes(
    due.minutes,
    translator.language,
  );

  return (
    <span
      className="inline-flex"
      data-testid={RESPONSE_TARGETS_TEST_IDS.chip}
      data-state={due.state}
      data-target={due.target}
    >
      <Pill
        text={translator.translateTemplate(due.template, { time })}
        icon={IconProp.Clock}
        color={getSecurityCaseTargetToneColor(due.tone)}
        tooltip={translator.translateTemplate(SECURITY_CASE_TARGET_DUE_AT, {
          time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            due.dueAt,
          ),
        })}
      />
    </span>
  );
};

/*
 * A row's Due cell in the case lists: when the next target is due - "in
 * 12 min", "5 min overdue" - in its tone, with the target under it.
 */
export const SecurityCaseDueCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = useTargetClock();
  const due: SecurityCaseDue | null = getSecurityCaseDue({
    securityCase: props.securityCase,
    priorities: props.priorities,
    now,
  });

  if (!due) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const time: string = formatCompactDurationInMinutes(
    due.minutes,
    translator.language,
  );

  return (
    <span
      className="flex min-w-0 flex-col"
      data-testid={RESPONSE_TARGETS_TEST_IDS.dueCell}
      data-state={due.state}
      title={translator.translateTemplate(SECURITY_CASE_TARGET_DUE_AT, {
        time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          due.dueAt,
        ),
      })}
    >
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium ${getSecurityCaseTargetToneClassName(due.tone)}`}
      >
        <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 shrink-0" />
        {translator.translateTemplate(
          due.isOverdue ? SECURITY_CASE_DUE_CELL_OVERDUE : SECURITY_CASE_DUE_CELL_IN,
          { time },
        )}
      </span>
      <span className="text-xs text-gray-500">
        {translator.translateText(SECURITY_CASE_TARGET_NAMES[due.target])}
      </span>
    </span>
  );
};

/*
 * The line under a row's priority in the case lists: the next target and
 * when - "Acknowledge in 12 min", "Acknowledge overdue by 5 min" - small,
 * in its tone, so the queue says which cases are about to miss a target
 * beside how urgent each is. Nothing when no target is pending.
 */
export const SecurityCaseDueLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = useTargetClock();
  const due: SecurityCaseDue | null = getSecurityCaseDue({
    securityCase: props.securityCase,
    priorities: props.priorities,
    now,
  });

  if (!due) {
    return <></>;
  }

  const time: string = formatCompactDurationInMinutes(
    due.minutes,
    translator.language,
  );

  return (
    <span
      className={`mt-1 flex min-w-0 items-center gap-1 text-xs font-medium ${getSecurityCaseTargetToneClassName(due.tone)}`}
      data-testid={RESPONSE_TARGETS_TEST_IDS.dueLine}
      data-state={due.state}
      title={translator.translateTemplate(SECURITY_CASE_TARGET_DUE_AT, {
        time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          due.dueAt,
        ),
      })}
    >
      <Icon icon={IconProp.Clock} className="h-3 w-3 shrink-0" />
      <span className="min-w-0">
        {translator.translateTemplate(due.template, { time })}
      </span>
    </span>
  );
};

export default SecurityCaseTargetChip;
