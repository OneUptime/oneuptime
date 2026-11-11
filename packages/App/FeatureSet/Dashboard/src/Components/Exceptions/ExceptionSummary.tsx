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
  ExceptionTriageAction,
  formatOccurrenceCount,
  formatRelativeTime,
  getExceptionTriageActions,
} from "../../Utils/ExceptionDetailPresentation";
import { getErrorClassBadgeLabel } from "../../Utils/ExceptionErrorClassLabels";
import ExceptionResource from "./ExceptionResource";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ExceptionIssueBadge } from "Common/Utils/Exceptions/ExceptionIssueState";
import { getExceptionIssueBadgePresentation } from "./ExceptionIssueBadges";
import {
  EVENT_HEADER_BUTTONS_CLASS_NAME,
  EVENT_HEADER_CLASS_NAME,
  EVENT_HEADER_FACT_CLASS_NAME,
  EVENT_HEADER_FACT_LABEL_CLASS_NAME,
  EVENT_HEADER_FACT_VALUE_CLASS_NAME,
  EVENT_HEADER_TOP_SECTION_CLASS_NAME,
  EventHeaderTopRowClassNames,
  getEventHeaderActionsBesideWidth,
  getEventHeaderFactsClassName,
  getEventHeaderTopRowClassNames,
} from "../EventView/EventHeaderLayout";

/*
 * The top of every page of an exception: what it is, where it stands, the
 * moves it takes next, and what a reader needs at a glance.
 *
 * Laid out as the header of an incident, an alert and a security case is
 * (EventHeaderLayout), so the record pages of the product read alike: the
 * pills first - its status, whether it came back, whether it was caught -
 * then its type as the title, on a line of its own; the message under it;
 * the buttons at the top right, beside the pills wherever the header is wide
 * enough for both (worked out from their words in the reader's language),
 * under the title where it is not, with the ⋯ in the header's corner; and
 * the facts - how often, since when, where, who owns it - on a grid of two
 * to five columns that follows the header's own width, never the window's.
 *
 * Two buttons and a ⋯: Resolve (or Reopen) and Archive (or Unarchive) are
 * the moves made on nearly every exception; Resolve in next release and
 * Create monitor wait in the ⋯ (ExceptionMoreActions). Who owns it is a
 * fact, changed right there (ExceptionAssignee), not a pill and a dashed
 * button among the buttons.
 */

export const EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT: number = 240;

export const EXCEPTION_SUMMARY_TEST_IDS: {
  header: string;
  top: string;
  pills: string;
  title: string;
  message: string;
  actions: string;
  buttons: string;
  morePlace: string;
  facts: string;
} = {
  header: "exception-summary",
  top: "exception-summary-top",
  pills: "exception-summary-pills",
  title: "exception-summary-type",
  message: "exception-summary-message",
  actions: "exception-summary-actions",
  buttons: "exception-summary-buttons",
  morePlace: "exception-summary-more-place",
  facts: "exception-summary-facts",
};

export interface ExceptionSummaryStatus {
  label: string;
  icon: IconProp;
  pillClassName: string;
}

export function getExceptionSummaryStatus(
  exception: Pick<TelemetryException, "isArchived" | "isResolved">,
): ExceptionSummaryStatus {
  if (exception.isResolved) {
    return {
      label: "Resolved",
      icon: IconProp.CheckCircle,
      pillClassName: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    };
  }

  if (exception.isArchived) {
    return {
      label: "Archived",
      icon: IconProp.Archive,
      pillClassName: "bg-amber-50 text-amber-700 ring-amber-600/20",
    };
  }

  return {
    label: "Unresolved",
    icon: IconProp.Error,
    pillClassName: "bg-red-50 text-red-700 ring-red-600/20",
  };
}

const NEUTRAL_PILL_CLASS_NAME: string =
  "bg-gray-50 text-gray-600 ring-gray-500/15";

const PILL_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

interface SummaryPill {
  label: string;
  className: string;
  icon?: IconProp | undefined;
  title?: string | undefined;
  testId: string;
}

interface SummaryFact {
  label: string;
  // The fact's test id: exception-summary-stat-<key>.
  key: string;
  value: ReactNode;
  // A second, quieter line under the value: "all time", "in v1.4.0".
  detail?: string | undefined;
  // The value's whole, on hover: a time's date and hour.
  title?: string | undefined;
  /*
   * A value that is a control (the Assignee's): drawn as it is, never in
   * the box that cuts a long value short, which would cut its focus ring.
   */
  isControl?: boolean | undefined;
}

/*
 * The buttons and the ⋯ the page offers in the header. The buttons are the
 * exception's triage moves (ExceptionTriageActions), whose words follow its
 * state, so the header works out where they fit from the exception itself.
 */
export interface ExceptionSummaryActions {
  buttons: ReactElement;
  more?: ReactElement | null | undefined;
}

export interface ComponentProps {
  exception: TelemetryException;
  // The group's Service, once loaded, for the Service fact.
  services?: Array<Service> | undefined;
  // The header's buttons and ⋯; left out, the header offers none (Settings).
  actions?: ExceptionSummaryActions | undefined;
  /*
   * Who owns it, as the Assignee fact's value (ExceptionAssignee); left
   * out, the header has no Assignee fact.
   */
  assignee?: ReactElement | undefined;
}

const ExceptionSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: ExceptionSummaryStatus = getExceptionSummaryStatus(
    props.exception,
  );
  const messageId: string = useId();
  const [isMessageExpanded, setIsMessageExpanded] = useState<boolean>(false);
  const hasMessage: boolean = Boolean(props.exception.message);
  const message: string =
    props.exception.message ||
    (translator.translateText("No exception message was recorded.") as string);
  const isMessageClampable: boolean =
    message.length > EXCEPTION_MESSAGE_CLAMP_CHARACTER_COUNT;

  // Each pill's label and title are given in the reader's language.
  const pills: Array<SummaryPill> = [
    {
      label: translator.translateText(status.label) as string,
      icon: status.icon,
      className: status.pillClassName,
      testId: "exception-summary-status",
    },
  ];

  if (props.exception.isResolved && props.exception.isArchived) {
    pills.push({
      label: translator.translateText("Archived") as string,
      icon: IconProp.Archive,
      className: "bg-amber-50 text-amber-700 ring-amber-600/20",
      testId: "exception-summary-archived",
    });
  }

  /*
   * Regressed or New, beside the status, as the list row shows them
   * (ExceptionIssueBadges). Unhandled has its own pill below.
   */
  for (const badge of getExceptionIssueBadgePresentation(
    props.exception,
    translator,
  )) {
    if (badge.badge === ExceptionIssueBadge.Unhandled) {
      continue;
    }

    pills.push({
      label: badge.label,
      className:
        badge.badge === ExceptionIssueBadge.Regressed
          ? "bg-orange-50 text-orange-700 ring-orange-600/20"
          : "bg-sky-50 text-sky-700 ring-sky-600/20",
      title: badge.title,
      testId: `exception-summary-${badge.badge}`,
    });
  }

  if (props.exception.unhandled) {
    pills.push({
      label: translator.translateText("Unhandled") as string,
      icon: IconProp.Alert,
      className: "bg-orange-50 text-orange-700 ring-orange-600/20",
      title: translator.translateText(
        "At least one occurrence escaped its span without being caught by application code.",
      ),
      testId: "exception-summary-unhandled",
    });
  }

  const errorClassLabel: string | null = getErrorClassBadgeLabel(
    props.exception.errorClass,
  );

  if (errorClassLabel) {
    pills.push({
      label: translator.translateText(errorClassLabel) as string,
      className: NEUTRAL_PILL_CLASS_NAME,
      title: translator.translateText("Fault domain from AI triage"),
      testId: "exception-summary-error-class",
    });
  }

  if (props.exception.environment) {
    pills.push({
      label: props.exception.environment,
      icon: IconProp.Globe,
      className: NEUTRAL_PILL_CLASS_NAME,
      title: translator.translateText("Environment"),
      testId: "exception-summary-environment",
    });
  }

  /*
   * Where the actions go: beside the pills from the header width that holds
   * the pills, the two buttons and the ⋯ in one row - their words as the
   * reader's language spells them - and under the title below it.
   */
  const hasMore: boolean = Boolean(props.actions?.more);
  const besideWidthRem: number | null = props.actions
    ? getEventHeaderActionsBesideWidth({
        pills: pills.map((pill: SummaryPill): string => {
          return pill.label;
        }),
        hasPillIcon: pills.some((pill: SummaryPill): boolean => {
          return Boolean(pill.icon);
        }),
        actions: getExceptionTriageActions({
          isResolved: Boolean(props.exception.isResolved),
          isArchived: Boolean(props.exception.isArchived),
        }).map((action: ExceptionTriageAction) => {
          return {
            label: translator.translateText(action.label) || action.label,
            hasIcon: true,
          };
        }),
        hasMore: hasMore,
      })
    : null;

  const topRow: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames({
    besideWidthRem: besideWidthRem,
    hasMore: hasMore,
  });

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
    return release
      ? translator.translateTemplate("in {{release}}", { release })
      : undefined;
  };

  const facts: Array<SummaryFact> = [
    {
      label: "Occurrences",
      key: "occurrences",
      value: formatOccurrenceCount(props.exception.occuranceCount),
      detail: translator.translateText("all time"),
    },
    {
      label: "First seen",
      key: "first-seen",
      value:
        formatRelativeTime(
          props.exception.firstSeenAt,
          new Date(),
          translator.language,
        ) || translator.translateText("Not recorded"),
      detail: getReleaseDetail(props.exception.firstSeenInRelease),
      title: getAbsoluteTime(props.exception.firstSeenAt),
    },
    {
      label: "Last seen",
      key: "last-seen",
      value:
        formatRelativeTime(
          props.exception.lastSeenAt,
          new Date(),
          translator.language,
        ) || translator.translateText("Not recorded"),
      detail: getReleaseDetail(props.exception.lastSeenInRelease),
      title: getAbsoluteTime(props.exception.lastSeenAt),
    },
    {
      label: "Service",
      key: "service",
      value: (
        <ExceptionResource
          primaryEntityId={props.exception.primaryEntityId}
          primaryEntityType={props.exception.primaryEntityType}
          services={props.services}
          className="min-w-0 max-w-full truncate"
          fallback={
            <span className="text-gray-900">
              {translator.translateText("Not recorded")}
            </span>
          }
        />
      ),
    },
  ];

  if (props.assignee) {
    facts.push({
      label: "Assignee",
      key: "assignee",
      value: props.assignee,
      isControl: true,
    });
  }

  return (
    <section
      aria-label={translator.translateText("Exception summary")}
      className={EVENT_HEADER_CLASS_NAME}
      data-testid={EXCEPTION_SUMMARY_TEST_IDS.header}
      data-actions-beside-from={
        besideWidthRem === null ? "never" : `${besideWidthRem}rem`
      }
    >
      <div className={EVENT_HEADER_TOP_SECTION_CLASS_NAME}>
        <div className={topRow.row} data-testid={EXCEPTION_SUMMARY_TEST_IDS.top}>
          <div
            className={topRow.chips}
            data-testid={EXCEPTION_SUMMARY_TEST_IDS.pills}
          >
            {pills.map((pill: SummaryPill): ReactElement => {
              return (
                <span
                  key={pill.testId}
                  data-testid={pill.testId}
                  title={pill.title}
                  className={`${PILL_CLASS_NAME} ${pill.className}`}
                >
                  {pill.icon && (
                    <Icon icon={pill.icon} className="h-3 w-3 flex-shrink-0" />
                  )}
                  {pill.label}
                </span>
              );
            })}
          </div>

          {/*
           * Before the actions in the page, as it is read and as a screen
           * reader reads it; on a wide header drawn under the pills and the
           * actions both.
           */}
          <h2
            className={topRow.title}
            data-testid={EXCEPTION_SUMMARY_TEST_IDS.title}
          >
            {props.exception.exceptionType ||
              translator.translateText("Application exception")}
          </h2>

          {props.actions && (
            <div
              className={topRow.actions}
              role="group"
              aria-label={translator.translateText("Exception actions")}
              data-testid={EXCEPTION_SUMMARY_TEST_IDS.actions}
            >
              <div
                className={EVENT_HEADER_BUTTONS_CLASS_NAME}
                data-testid={EXCEPTION_SUMMARY_TEST_IDS.buttons}
              >
                {props.actions.buttons}
              </div>
              {props.actions.more ? (
                <div
                  className={topRow.morePlace}
                  data-testid={EXCEPTION_SUMMARY_TEST_IDS.morePlace}
                >
                  {props.actions.more}
                </div>
              ) : (
                <></>
              )}
            </div>
          )}
        </div>

        {/*
         * What it said, under what it is: in the reading font, three lines
         * at most until it is asked for whole, with a copy button beside
         * it.
         */}
        <div className="mt-2 flex items-start gap-2">
          <p
            className={`min-w-0 flex-1 break-words text-sm leading-6 [overflow-wrap:anywhere] ${
              hasMessage ? "text-gray-700" : "italic text-gray-500"
            } ${isMessageClampable && !isMessageExpanded ? "line-clamp-3" : ""}`}
            id={messageId}
            data-testid={EXCEPTION_SUMMARY_TEST_IDS.message}
          >
            {message}
          </p>
          {hasMessage && (
            <div className="flex-shrink-0">
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
            aria-label={translator.translateText(
              isMessageExpanded
                ? "Collapse exception message"
                : "Expand exception message",
            )}
            className="mt-1 rounded-sm text-xs font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => {
              setIsMessageExpanded(!isMessageExpanded);
            }}
          >
            {translator.translateText(
              isMessageExpanded ? "Show less" : "Show more",
            )}
          </button>
        )}
      </div>

      <dl
        className={getEventHeaderFactsClassName(facts.length)}
        data-testid={EXCEPTION_SUMMARY_TEST_IDS.facts}
      >
        {facts.map((fact: SummaryFact): ReactElement => {
          return (
            <div
              className={EVENT_HEADER_FACT_CLASS_NAME}
              key={fact.key}
              data-testid={`exception-summary-stat-${fact.key}`}
            >
              <dt className={EVENT_HEADER_FACT_LABEL_CLASS_NAME}>
                {translator.translateText(fact.label)}
              </dt>
              <dd className={EVENT_HEADER_FACT_VALUE_CLASS_NAME}>
                {fact.isControl ? (
                  <div className="flex min-w-0 max-w-full">{fact.value}</div>
                ) : (
                  <span
                    className="block max-w-full truncate"
                    title={fact.title}
                  >
                    {fact.value}
                  </span>
                )}
                {fact.detail && (
                  <span
                    className="mt-0.5 block truncate text-xs font-normal text-gray-500"
                    title={fact.detail}
                  >
                    {fact.detail}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
};

export default ExceptionSummary;
