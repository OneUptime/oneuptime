import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ExceptionIssueBadge,
  ExceptionIssueStateInput,
  getExceptionIssueBadges,
} from "Common/Utils/Exceptions/ExceptionIssueState";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Regressed, New and Unhandled, as a list row shows them: small pills a
 * person scanning the list picks out before they open anything. What each
 * one means is ExceptionIssueState's; the words and the colours are here,
 * and the exception's page draws the same ones in its header
 * (getExceptionIssueBadgePresentation).
 */

export interface ExceptionIssueBadgePresentation {
  badge: ExceptionIssueBadge;
  label: string;
  // Said on hover: why the exception carries the badge.
  title: string;
  className: string;
}

export function getExceptionIssueBadgePresentation(
  exception: ExceptionIssueStateInput,
  translator: Translator,
  now: Date = new Date(),
): Array<ExceptionIssueBadgePresentation> {
  return getExceptionIssueBadges(exception, now).map(
    (badge: ExceptionIssueBadge): ExceptionIssueBadgePresentation => {
      switch (badge) {
        case ExceptionIssueBadge.Regressed:
          return {
            badge,
            label: translator.translateText("Regressed") as string,
            title: exception.regressedAt
              ? translator.translateTemplate(
                  "It came back {{time}}, after it was resolved.",
                  {
                    time: OneUptimeDate.fromNow(
                      new Date(exception.regressedAt),
                    ),
                  },
                )
              : (translator.translateText(
                  "It came back after it was resolved.",
                ) as string),
            className: "border-orange-200 bg-orange-50 text-orange-700",
          };
        case ExceptionIssueBadge.New:
          return {
            badge,
            label: translator.translateText("New") as string,
            title: translator.translateText(
              "First seen in the last 24 hours.",
            ) as string,
            className: "border-sky-200 bg-sky-50 text-sky-700",
          };
        case ExceptionIssueBadge.Unhandled:
          return {
            badge,
            label: translator.translateText("Unhandled") as string,
            title: translator.translateText(
              "At least one occurrence escaped its span without being caught by application code.",
            ) as string,
            className: "border-amber-200 bg-amber-50 text-amber-700",
          };
      }
    },
  );
}

export interface ComponentProps {
  exception: ExceptionIssueStateInput;
  // For tests: the time "New" is measured from.
  now?: Date | undefined;
}

const ExceptionIssueBadges: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const badges: Array<ExceptionIssueBadgePresentation> =
    getExceptionIssueBadgePresentation(props.exception, translator, props.now);

  if (badges.length === 0) {
    return <></>;
  }

  return (
    <>
      {badges.map(
        (badge: ExceptionIssueBadgePresentation): ReactElement => {
          return (
            <span
              key={badge.badge}
              title={badge.title}
              data-testid={`exception-badge-${badge.badge}`}
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          );
        },
      )}
    </>
  );
};

export default ExceptionIssueBadges;
