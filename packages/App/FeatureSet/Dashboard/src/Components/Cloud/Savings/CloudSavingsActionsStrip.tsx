import { CloudSavingsSummary } from "Common/Types/Cloud/CloudSavingsApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { formatCloudMoney } from "../CloudCostWords";
import CloudStatStrip, { CloudStatTile } from "../CloudStatStrip";

/*
 * WHAT ACTING ON SAVINGS CAME TO (#11010): a strip of its own on the
 * Savings page, once the project has changed anything - so a project that
 * never applied a saving sees no zeros.
 *
 *   - Saved this month: what the bill showed the changes saved since the
 *     1st - realised, never estimated.
 *   - Checking the bill: the changes still being read against it, and
 *     what they promised a month.
 *   - Waiting for approval: changes asked for, and how many the reader
 *     may approve.
 *   - Off-hours this month: the hours schedules kept resources stopped.
 */

export const SAVED_THIS_MONTH: string = translationKey("Saved this month");
export const SAVED_THIS_MONTH_DESCRIPTION: string = translationKey(
  "What your clouds' bills show the changes OneUptime made saved since the 1st. Estimates are never counted.",
);
export const CHECKING_THE_BILL: string = translationKey("Checking the bill");
export const WAITING_FOR_APPROVAL: string = translationKey(
  "Waiting for approval",
);
export const OFF_HOURS_THIS_MONTH: string = translationKey(
  "Off-hours this month",
);
export const CHANGES_SEEN_IN_THE_BILL: PluralTemplate = {
  one: "{{count}} change seen in the bill",
  other: "{{count}} changes seen in the bill",
};
export const PROMISED_A_MONTH: string = translationKey(
  "{{amount}} a month promised",
);
export const WAITING_FOR_YOU: PluralTemplate = {
  one: "{{count}} for you",
  other: "{{count}} for you",
};
export const NONE_FOR_YOU: string = translationKey("None for you");
export const HOURS_STOPPED: PluralTemplate = {
  one: "{{count}} hour stopped",
  other: "{{count}} hours stopped",
};
export const NOTHING_SEEN_YET: string = translationKey(
  "Nothing seen in the bill yet",
);
export const NOTHING_TO_CHECK: string = translationKey("Nothing to check");
export const BY_SCHEDULES: string = translationKey("By off-hours schedules");

// Whether the project has done anything with savings: the strip shows then.
export function hasCloudSavingsActivity(
  summary: CloudSavingsSummary | null,
): boolean {
  return Boolean(
    summary &&
      (summary.realisedCount > 0 ||
        summary.measuringCount > 0 ||
        summary.changesCount > 0 ||
        summary.waitingCount > 0 ||
        summary.scheduledHoursThisMonth > 0),
  );
}

export function getCloudSavingsActionTiles(data: {
  summary: CloudSavingsSummary;
  translator: Translator;
}): Array<CloudStatTile> {
  const translator: Translator = data.translator;
  const summary: CloudSavingsSummary = data.summary;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: summary.currency,
      translator,
    });
  };

  return [
    {
      key: "saved-this-month",
      title: SAVED_THIS_MONTH,
      description: SAVED_THIS_MONTH_DESCRIPTION,
      value: money(summary.savedThisMonth),
      sublabel:
        summary.realisedCount > 0
          ? translator.translatePlural(
              CHANGES_SEEN_IN_THE_BILL,
              summary.realisedCount,
            )
          : translator.translateText(NOTHING_SEEN_YET) || NOTHING_SEEN_YET,
      sublabelIsTranslated: true,
      tone: summary.savedThisMonth > 0 ? "positive" : "neutral",
      icon: IconProp.CheckCircle,
      color: "emerald",
    },
    {
      key: "checking-the-bill",
      title: CHECKING_THE_BILL,
      value: translator.formatNumber(summary.measuringCount),
      sublabel:
        summary.measuringCount > 0
          ? translator.translateTemplate(PROMISED_A_MONTH, {
              amount: money(summary.promisedMonthly),
            })
          : translator.translateText(NOTHING_TO_CHECK) || NOTHING_TO_CHECK,
      sublabelIsTranslated: true,
      icon: IconProp.Clock,
      color: "sky",
    },
    {
      key: "waiting-for-approval",
      title: WAITING_FOR_APPROVAL,
      value: translator.formatNumber(summary.waitingCount),
      sublabel:
        summary.waitingForYouCount > 0
          ? translator.translatePlural(
              WAITING_FOR_YOU,
              summary.waitingForYouCount,
            )
          : translator.translateText(NONE_FOR_YOU) || NONE_FOR_YOU,
      sublabelIsTranslated: true,
      tone: summary.waitingForYouCount > 0 ? "warning" : "neutral",
      icon: IconProp.Check,
      color: "amber",
    },
    {
      key: "off-hours-this-month",
      title: OFF_HOURS_THIS_MONTH,
      value: translator.translatePlural(
        HOURS_STOPPED,
        Math.round(summary.scheduledHoursThisMonth),
      ),
      sublabel: translator.translateText(BY_SCHEDULES) || BY_SCHEDULES,
      sublabelIsTranslated: true,
      icon: IconProp.Moon,
      color: "indigo",
    },
  ];
}

export interface ComponentProps {
  summary: CloudSavingsSummary | null;
}

const CloudSavingsActionsStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.summary || !hasCloudSavingsActivity(props.summary)) {
    return <></>;
  }

  return (
    <CloudStatStrip
      testId="cloud-savings-actions-strip"
      tiles={getCloudSavingsActionTiles({ summary: props.summary, translator })}
    />
  );
};

export default CloudSavingsActionsStrip;
