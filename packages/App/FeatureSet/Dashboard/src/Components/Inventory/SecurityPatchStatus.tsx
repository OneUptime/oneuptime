import AndroidSecurityPatch, {
  AndroidSecurityPatchStatus,
} from "Common/Types/Host/AndroidSecurityPatch";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * AN ANDROID DEVICE'S SECURITY PATCH, AS INVENTORY DRAWS IT (#9965, #10099).
 *
 * One rule (Common/Types/Host/AndroidSecurityPatch): a patch level more than
 * 90 days old is out of date. Inventory > All Items' Security Patch Level
 * column and a device's Asset Details card draw it the same way, in the same
 * words - the level as the device reports it, and a pill that says Out of
 * Date or Up to Date - so the list and the device's own page never disagree.
 * The card, which has room, also says how old the patch is, in days: the
 * unit the rule, the filter and the alert count in, so a patch 89 days old
 * and one 91 days old read apart where "3 months" would read the same.
 */

export const SECURITY_PATCH_STATUS_LABELS: Readonly<
  Record<AndroidSecurityPatchStatus, string>
> = {
  [AndroidSecurityPatchStatus.OutOfDate]: translationKey("Out of Date"),
  [AndroidSecurityPatchStatus.UpToDate]: translationKey("Up to Date"),
};

export const SECURITY_PATCH_STATUS_TONES: Readonly<
  Record<AndroidSecurityPatchStatus, PillTone>
> = {
  // Needs a look soon: a device to update, not one that broke.
  [AndroidSecurityPatchStatus.OutOfDate]: PillTone.Warning,
  [AndroidSecurityPatchStatus.UpToDate]: PillTone.Success,
};

// How old the patch is: the days since its level's date, in UTC.
export const SECURITY_PATCH_AGE: PluralTemplate = {
  one: "{{count}} day old",
  other: "{{count}} days old",
};

export interface SecurityPatchReading {
  // The level as the device reports it: "2024-06-05".
  level: string;
  status: AndroidSecurityPatchStatus;
  // Whole UTC days since the level's date; none for a date no calendar has.
  ageInDays: number | undefined;
}

/*
 * What a value says of a device's patch, at `now`: undefined when it holds
 * no patch level (a server, a value that is not a date). Pure.
 */
export function readSecurityPatch(
  value: unknown,
  now: Date,
): SecurityPatchReading | undefined {
  const level: string | undefined = AndroidSecurityPatch.readLevel(value);

  if (!level) {
    return undefined;
  }

  return {
    level,
    status:
      AndroidSecurityPatch.getStatus(level, now) ||
      AndroidSecurityPatchStatus.UpToDate,
    ageInDays: AndroidSecurityPatch.getAgeInDays(level, now),
  };
}

export interface SecurityPatchStatusPillProps {
  status: AndroidSecurityPatchStatus;
}

// Out of Date or Up to Date, in the column's words and tones.
export const SecurityPatchStatusPill: FunctionComponent<
  SecurityPatchStatusPillProps
> = (props: SecurityPatchStatusPillProps): ReactElement => {
  return (
    <Pill
      text={SECURITY_PATCH_STATUS_LABELS[props.status]}
      tone={SECURITY_PATCH_STATUS_TONES[props.status]}
    />
  );
};

export interface SecurityPatchStatusLineProps {
  reading: SecurityPatchReading;
  testId?: string | undefined;
}

/*
 * The pill, and how old the patch is beside it: "Out of Date · 167 days old"
 * as two items of one row, which wraps on a narrow card.
 */
export const SecurityPatchStatusLine: FunctionComponent<
  SecurityPatchStatusLineProps
> = (props: SecurityPatchStatusLineProps): ReactElement => {
  const translator: Translator = useTranslator();
  const ageInDays: number | undefined = props.reading.ageInDays;

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
      data-testid={props.testId}
    >
      <SecurityPatchStatusPill status={props.reading.status} />
      {ageInDays !== undefined ? (
        <span
          className="text-xs text-gray-500"
          data-testid={props.testId ? `${props.testId}-age` : undefined}
        >
          {translator.translatePlural(SECURITY_PATCH_AGE, ageInDays)}
        </span>
      ) : null}
    </div>
  );
};
