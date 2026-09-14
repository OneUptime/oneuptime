import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";

export const EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT: number = 240;

const STAT_BORDER_CLASS_NAMES: Array<string> = [
  "",
  "border-t border-gray-200 sm:border-l sm:border-t-0",
  "border-t border-gray-200 xl:border-l xl:border-t-0",
  "border-t border-gray-200 sm:border-l xl:border-t-0",
];

export interface ExceptionSummaryStatus {
  label: string;
  icon: IconProp;
  containerClassName: string;
  iconClassName: string;
  pillClassName: string;
}

export function getExceptionSummaryStatus(
  exception: Pick<TelemetryException, "isArchived" | "isResolved">,
): ExceptionSummaryStatus {
  if (exception.isResolved) {
    return {
      label: "Resolved",
      icon: IconProp.CheckCircle,
      containerClassName: "bg-emerald-50",
      iconClassName: "text-emerald-700",
      pillClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    };
  }

  if (exception.isArchived) {
    return {
      label: "Archived",
      icon: IconProp.Archive,
      containerClassName: "bg-amber-50",
      iconClassName: "text-amber-700",
      pillClassName: "bg-amber-50 text-amber-700 ring-amber-600/20",
    };
  }

  return {
    label: "Unresolved",
    icon: IconProp.Error,
    containerClassName: "bg-red-50",
    iconClassName: "text-red-700",
    pillClassName: "bg-red-50 text-red-700 ring-red-600/20",
  };
}

export interface ComponentProps {
  exception: TelemetryException;
}

const ExceptionSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const status: ExceptionSummaryStatus = getExceptionSummaryStatus(
    props.exception,
  );
  const messageId: string = useId();
  const [isMessageExpanded, setIsMessageExpanded] = useState<boolean>(false);
  const message: string =
    props.exception.message || "No exception message was recorded.";
  const isMessageClampable: boolean =
    message.length > EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT;

  const formatDate: (date: Date | undefined) => string = (
    date: Date | undefined,
  ): string => {
    if (!date) {
      return "Not recorded";
    }

    return OneUptimeDate.getDateAsLocalShortDateTimeString(date);
  };

  const statItems: Array<{ label: string; value: string }> = [
    {
      label: "Occurrences",
      value: new Intl.NumberFormat().format(
        props.exception.occuranceCount || 0,
      ),
    },
    {
      label: "First seen",
      value: formatDate(props.exception.firstSeenAt),
    },
    {
      label: "Last seen",
      value: formatDate(props.exception.lastSeenAt),
    },
    {
      label: "Latest release",
      value: props.exception.lastSeenInRelease || "Not recorded",
    },
  ];

  return (
    <section
      aria-label="Exception summary"
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
      data-testid="exception-summary"
    >
      <div className="px-5 py-5 sm:px-6">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${status.containerClassName}`}
          >
            <Icon
              icon={status.icon}
              className={`h-5 w-5 ${status.iconClassName}`}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${status.pillClassName}`}
              >
                {status.label}
              </span>
              {props.exception.isResolved && props.exception.isArchived && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                  Archived
                </span>
              )}
              {props.exception.environment && (
                <span className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                  {props.exception.environment}
                </span>
              )}
            </div>

            <h2 className="mt-2 break-words text-base font-semibold leading-6 text-gray-900">
              {props.exception.exceptionType || "Application exception"}
            </h2>
            <p
              className={`mt-1 break-words font-mono text-sm leading-6 text-gray-600 ${
                isMessageClampable && !isMessageExpanded ? "line-clamp-3" : ""
              }`}
              id={messageId}
              data-testid="exception-summary-message"
            >
              {message}
            </p>
            {isMessageClampable && (
              <button
                type="button"
                aria-controls={messageId}
                aria-expanded={isMessageExpanded}
                aria-label={
                  isMessageExpanded
                    ? "Collapse exception message"
                    : "Expand exception message"
                }
                className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={() => {
                  setIsMessageExpanded(!isMessageExpanded);
                }}
              >
                {isMessageExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 border-t border-gray-200 bg-gray-50/60 sm:grid-cols-2 xl:grid-cols-4">
        {statItems.map(
          (
            item: { label: string; value: string },
            index: number,
          ): ReactElement => {
            return (
              <div
                className={`px-5 py-3 ${STAT_BORDER_CLASS_NAMES[index]}`}
                key={item.label}
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {item.label}
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold text-gray-900">
                  {item.value}
                </dd>
              </div>
            );
          },
        )}
      </dl>
    </section>
  );
};

export default ExceptionSummary;
