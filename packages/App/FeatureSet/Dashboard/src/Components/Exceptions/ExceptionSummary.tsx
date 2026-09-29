import Service from "Common/Models/DatabaseModels/Service";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
  useState,
} from "react";
import {
  formatOccurrenceCount,
  formatRelativeTime,
} from "../../Utils/ExceptionDetailPresentation";
import { getErrorClassBadgeLabel } from "../../Utils/ExceptionErrorClassLabels";
import ExceptionResource from "./ExceptionResource";

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
      iconClassName: "text-emerald-600",
      pillClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    };
  }

  if (exception.isArchived) {
    return {
      label: "Archived",
      icon: IconProp.Archive,
      containerClassName: "bg-amber-50",
      iconClassName: "text-amber-600",
      pillClassName: "bg-amber-50 text-amber-700 ring-amber-600/20",
    };
  }

  return {
    label: "Unresolved",
    icon: IconProp.Error,
    containerClassName: "bg-red-50",
    iconClassName: "text-red-600",
    pillClassName: "bg-red-50 text-red-700 ring-red-600/20",
  };
}

const NEUTRAL_PILL_CLASS_NAME: string =
  "bg-gray-50 text-gray-600 ring-gray-500/15";

interface SummaryPill {
  label: string;
  className: string;
  icon?: IconProp | undefined;
  title?: string | undefined;
  testId: string;
}

interface SummaryStat {
  label: string;
  value: ReactNode;
  detail?: string | undefined;
  title?: string | undefined;
}

export interface ComponentProps {
  exception: TelemetryException;
  // The group's Service, once loaded, for the Service cell.
  services?: Array<Service> | undefined;
  // Triage buttons rendered at the top right of the header.
  actions?: ReactElement | undefined;
}

const ExceptionSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const status: ExceptionSummaryStatus = getExceptionSummaryStatus(
    props.exception,
  );
  const messageId: string = useId();
  const [isMessageExpanded, setIsMessageExpanded] = useState<boolean>(false);
  const hasMessage: boolean = Boolean(props.exception.message);
  const message: string =
    props.exception.message || "No exception message was recorded.";
  const isMessageClampable: boolean =
    message.length > EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT;

  const pills: Array<SummaryPill> = [
    {
      label: status.label,
      className: status.pillClassName,
      testId: "exception-summary-status",
    },
  ];

  if (props.exception.isResolved && props.exception.isArchived) {
    pills.push({
      label: "Archived",
      className: "bg-amber-50 text-amber-700 ring-amber-600/20",
      testId: "exception-summary-archived",
    });
  }

  if (props.exception.unhandled) {
    pills.push({
      label: "Unhandled",
      icon: IconProp.Alert,
      className: "bg-orange-50 text-orange-700 ring-orange-600/20",
      title:
        "At least one occurrence escaped its span without being caught by application code.",
      testId: "exception-summary-unhandled",
    });
  }

  const errorClassLabel: string | null = getErrorClassBadgeLabel(
    props.exception.errorClass,
  );

  if (errorClassLabel) {
    pills.push({
      label: errorClassLabel,
      className: NEUTRAL_PILL_CLASS_NAME,
      title: "Fault domain from AI triage",
      testId: "exception-summary-error-class",
    });
  }

  if (props.exception.environment) {
    pills.push({
      label: props.exception.environment,
      icon: IconProp.Globe,
      className: NEUTRAL_PILL_CLASS_NAME,
      title: "Environment",
      testId: "exception-summary-environment",
    });
  }

  const getAbsoluteTime: (date: Date | undefined) => string | undefined = (
    date: Date | undefined,
  ): string | undefined => {
    return date
      ? OneUptimeDate.getDateAsLocalShortDateTimeString(date)
      : undefined;
  };

  const getReleaseDetail: (
    release: string | undefined,
  ) => string | undefined = (
    release: string | undefined,
  ): string | undefined => {
    return release ? `in ${release}` : undefined;
  };

  const statItems: Array<SummaryStat> = [
    {
      label: "Occurrences",
      value: formatOccurrenceCount(props.exception.occuranceCount),
      detail: "all time",
    },
    {
      label: "First seen",
      value: formatRelativeTime(props.exception.firstSeenAt) || "Not recorded",
      detail: getReleaseDetail(props.exception.firstSeenInRelease),
      title: getAbsoluteTime(props.exception.firstSeenAt),
    },
    {
      label: "Last seen",
      value: formatRelativeTime(props.exception.lastSeenAt) || "Not recorded",
      detail: getReleaseDetail(props.exception.lastSeenInRelease),
      title: getAbsoluteTime(props.exception.lastSeenAt),
    },
    {
      label: "Service",
      value: (
        <ExceptionResource
          primaryEntityId={props.exception.primaryEntityId}
          primaryEntityType={props.exception.primaryEntityType}
          services={props.services}
          className="min-w-0 truncate"
          fallback={<span className="text-gray-900">Not recorded</span>}
        />
      ),
    },
  ];

  return (
    <section
      aria-label="Exception summary"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="exception-summary"
    >
      <div className="px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div
              className={`max-sm:hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl sm:flex ${status.containerClassName}`}
              data-testid="exception-summary-status-icon"
            >
              <Icon
                icon={status.icon}
                className={`h-6 w-6 ${status.iconClassName}`}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {pills.map((pill: SummaryPill): ReactElement => {
                  return (
                    <span
                      key={pill.testId}
                      data-testid={pill.testId}
                      title={pill.title}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${pill.className}`}
                    >
                      {pill.icon && (
                        <Icon icon={pill.icon} className="h-3 w-3" />
                      )}
                      {pill.label}
                    </span>
                  );
                })}
              </div>

              <h2
                className="mt-2 break-words text-lg font-semibold leading-7 text-gray-900"
                data-testid="exception-summary-type"
              >
                {props.exception.exceptionType || "Application exception"}
              </h2>

              <div className="mt-1 flex items-start gap-2">
                <p
                  className={`min-w-0 flex-1 break-words font-mono text-sm leading-6 ${
                    hasMessage ? "text-gray-700" : "italic text-gray-500"
                  } ${isMessageClampable && !isMessageExpanded ? "line-clamp-3" : ""}`}
                  id={messageId}
                  data-testid="exception-summary-message"
                >
                  {message}
                </p>
                {hasMessage && (
                  <div className="mt-0.5 flex-shrink-0">
                    <CopyTextButton
                      textToBeCopied={message}
                      iconOnly={true}
                      size="sm"
                      title="Copy exception message"
                    />
                  </div>
                )}
              </div>

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

          {props.actions && (
            <div
              className="flex flex-shrink-0 flex-wrap items-center gap-2 lg:justify-end"
              data-testid="exception-summary-actions"
            >
              {props.actions}
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 border-t border-gray-200 bg-gray-50/60 sm:grid-cols-2 xl:grid-cols-4">
        {statItems.map((item: SummaryStat, index: number): ReactElement => {
          return (
            <div
              className={`min-w-0 px-5 py-3 sm:px-6 ${STAT_BORDER_CLASS_NAMES[index]}`}
              key={item.label}
              data-testid={`exception-summary-stat-${item.label
                .toLowerCase()
                .replace(/\s+/g, "-")}`}
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {item.label}
              </dt>
              <dd
                className="mt-1 truncate text-sm font-semibold text-gray-900"
                title={item.title}
              >
                {item.value}
              </dd>
              {item.detail && (
                <dd
                  className="mt-0.5 truncate text-xs text-gray-500"
                  title={item.detail}
                >
                  {item.detail}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
};

export default ExceptionSummary;
