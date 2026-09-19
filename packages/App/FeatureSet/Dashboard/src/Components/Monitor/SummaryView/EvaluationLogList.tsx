import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationEvent,
  MonitorEvaluationFilterResult,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import React, { FunctionComponent, ReactElement } from "react";

interface FilterGroup {
  message: string;
  firstIndex: number;
  occurrences: Array<MonitorEvaluationFilterResult>;
}

const disabledCriteriaReasonPattern: RegExp = /\bdisabled\b/i;
const earlierCriteriaMatchedReasonPattern: RegExp =
  /\b(?:earlier|previous)\b.*\bcriteri(?:a|on)\b.*\bmatched\b/i;
const stoppedAtFirstMatchReasonPattern: RegExp =
  /\bstopped at the first match\b/i;

// Group identical filter messages so we can surface helpful metadata once per row.
const groupFiltersByMessage: (
  filters: Array<MonitorEvaluationFilterResult>,
) => Array<FilterGroup> = (
  filters: Array<MonitorEvaluationFilterResult>,
): Array<FilterGroup> => {
  const groups: Array<FilterGroup> = [];
  const messageToIndex: Map<string, number> = new Map();

  filters.forEach(
    (filter: MonitorEvaluationFilterResult, position: number): void => {
      const existingGroupIndex: number | undefined = messageToIndex.get(
        filter.message,
      );

      if (existingGroupIndex !== undefined) {
        const existingGroup: FilterGroup | undefined =
          groups[existingGroupIndex];

        if (existingGroup) {
          existingGroup.occurrences.push(filter);
        }
        return;
      }

      messageToIndex.set(filter.message, groups.length);
      groups.push({
        message: filter.message,
        firstIndex: position,
        occurrences: [filter],
      });
    },
  );

  return groups;
};

export interface ComponentProps {
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  title?: string | undefined;
}

const EvaluationLogList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const evaluationSummary: MonitorEvaluationSummary | undefined =
    props.evaluationSummary;

  if (!evaluationSummary) {
    return <></>;
  }

  const hasCriteriaResults: boolean =
    evaluationSummary.criteriaResults &&
    evaluationSummary.criteriaResults.length > 0;

  const actionEvents: Array<MonitorEvaluationEvent> = (
    evaluationSummary.events || []
  ).filter((event: MonitorEvaluationEvent) => {
    return event.type !== "criteria-met" && event.type !== "criteria-not-met";
  });

  if (!hasCriteriaResults && actionEvents.length === 0) {
    return <></>;
  }

  const getSummaryTitle: string = props.title || "Evaluation Logs";

  const renderCriteriaResult: (
    criteria: MonitorEvaluationCriteriaResult,
    index: number,
  ) => ReactElement = (
    criteria: MonitorEvaluationCriteriaResult,
    index: number,
  ): ReactElement => {
    const isSkipped: boolean = Boolean(criteria.skipped);
    const criteriaName: string =
      criteria.criteriaName || `Criteria ${index + 1}`;

    if (isSkipped) {
      const skipReason: string =
        criteria.skipReason ||
        criteria.message ||
        "This criterion was not evaluated.";
      const isDisabled: boolean =
        criteria.skipCause === "disabled" ||
        (!criteria.skipCause && disabledCriteriaReasonPattern.test(skipReason));
      const isEarlierCriterionMatch: boolean =
        criteria.skipCause === "earlier-criterion-matched" ||
        (!criteria.skipCause &&
          (earlierCriteriaMatchedReasonPattern.test(skipReason) ||
            stoppedAtFirstMatchReasonPattern.test(skipReason)));

      let previousMatchingCriteriaName: string | undefined = undefined;

      if (!isDisabled && isEarlierCriterionMatch) {
        for (
          let previousIndex: number = index - 1;
          previousIndex >= 0;
          previousIndex--
        ) {
          const previousCriteria: MonitorEvaluationCriteriaResult | undefined =
            evaluationSummary.criteriaResults[previousIndex];

          if (previousCriteria?.met && !previousCriteria.skipped) {
            previousMatchingCriteriaName =
              previousCriteria.criteriaName || `Criteria ${previousIndex + 1}`;
            break;
          }
        }
      }

      const skippedStatus: string = isDisabled ? "Disabled" : "Not evaluated";

      return (
        <div
          key={`criteria-${criteria.criteriaId || index}`}
          role="group"
          aria-label={`${criteriaName}: ${skippedStatus}`}
          className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-4 py-3"
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 ring-1 ring-inset ring-gray-200"
              aria-hidden="true"
            >
              <Icon
                icon={IconProp.PauseCircle}
                className="h-4 w-4 text-gray-500"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-gray-700">
                  {criteriaName}
                </div>
                <StatusBadge
                  text={skippedStatus}
                  type={StatusBadgeType.Neutral}
                  className="shrink-0"
                />
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                Condition: {criteria.filterCondition}
              </div>
              <div className="mt-3 border-t border-gray-200 pt-3">
                <div className="text-sm text-gray-600">
                  {previousMatchingCriteriaName ? (
                    <>
                      Not evaluated because{" "}
                      <span className="font-medium text-gray-800">
                        “{previousMatchingCriteriaName}”
                      </span>{" "}
                      matched first.
                    </>
                  ) : (
                    skipReason
                  )}
                </div>
                {previousMatchingCriteriaName && (
                  <div className="mt-1 text-xs text-gray-500">
                    Criteria are evaluated in order; this monitor stops after
                    the first match.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        key={`criteria-${criteria.criteriaId || index}`}
        role="group"
        aria-label={`${criteriaName}: ${criteria.met ? "Met" : "Not Met"}`}
        className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {criteriaName}
            </div>
            <div className="text-xs text-gray-500">
              Condition: {criteria.filterCondition}
            </div>
          </div>
          <span
            className={`text-xs font-semibold ${
              criteria.met ? "text-green-600" : "text-gray-500"
            }`}
          >
            {criteria.met ? "Met" : "Not Met"}
          </span>
        </div>

        {criteria.filters.length > 0 && (
          <ul className="mt-3 space-y-2">
            {groupFiltersByMessage(criteria.filters).map(
              (filterGroup: FilterGroup, filterGroupIndex: number) => {
                const allMet: boolean = filterGroup.occurrences.every(
                  (filter: MonitorEvaluationFilterResult) => {
                    return filter.met;
                  },
                );

                const noneMet: boolean = filterGroup.occurrences.every(
                  (filter: MonitorEvaluationFilterResult) => {
                    return !filter.met;
                  },
                );

                let statusText: string = "Partial";
                let statusClassName: string = "text-yellow-700 bg-yellow-100";

                if (allMet) {
                  statusText = "Met";
                  statusClassName = "text-green-700 bg-green-100";
                } else if (noneMet) {
                  statusText = "Not Met";
                  statusClassName = "text-gray-600 bg-gray-200";
                }

                const uniqueCheckOnLabels: Array<string> = Array.from(
                  new Set(
                    filterGroup.occurrences.map(
                      (filter: MonitorEvaluationFilterResult) => {
                        return filter.checkOn;
                      },
                    ),
                  ),
                );

                const uniqueFilterTypes: Array<string> = Array.from(
                  new Set(
                    filterGroup.occurrences
                      .map(
                        (
                          filter: MonitorEvaluationFilterResult,
                        ): FilterType | undefined => {
                          return filter.filterType;
                        },
                      )
                      .filter(
                        (
                          value: FilterType | undefined,
                        ): value is FilterType => {
                          return value !== undefined;
                        },
                      ),
                  ),
                ).map((value: FilterType): string => {
                  return value.toString();
                });

                const thresholdValues: Array<string> = Array.from(
                  new Set(
                    filterGroup.occurrences
                      .map(
                        (
                          filter: MonitorEvaluationFilterResult,
                        ): string | number | undefined => {
                          return filter.value;
                        },
                      )
                      .filter(
                        (
                          value: string | number | undefined,
                        ): value is number | string => {
                          return value !== undefined && value !== null;
                        },
                      ),
                  ),
                ).map((value: number | string): string => {
                  return value.toString();
                });

                const metadataParts: Array<string> = [];

                if (uniqueCheckOnLabels.length > 0) {
                  metadataParts.push(
                    uniqueCheckOnLabels.length === 1
                      ? `Check: ${uniqueCheckOnLabels[0]}`
                      : `Checks: ${uniqueCheckOnLabels.join(", ")}`,
                  );
                }

                if (uniqueFilterTypes.length > 0) {
                  metadataParts.push(
                    uniqueFilterTypes.length === 1
                      ? `Condition: ${uniqueFilterTypes[0]}`
                      : `Conditions: ${uniqueFilterTypes.join(", ")}`,
                  );
                }

                if (thresholdValues.length > 0) {
                  metadataParts.push(
                    thresholdValues.length === 1
                      ? `Threshold: ${thresholdValues[0]}`
                      : `Thresholds: ${thresholdValues.join(", ")}`,
                  );
                }

                if (filterGroup.occurrences.length > 1) {
                  metadataParts.push(
                    `${filterGroup.occurrences.length} matching checks`,
                  );
                }

                return (
                  <li
                    key={`criteria-${index}-filter-group-${filterGroup.firstIndex}-${filterGroupIndex}`}
                    className="flex items-center space-x-2 rounded-md border border-gray-100 bg-gray-50 p-3"
                  >
                    <span
                      className={`text-xs font-semibold flex-shrink-0 px-2 py-1 rounded ${statusClassName}`}
                    >
                      {statusText}
                    </span>
                    <div className="space-y-1">
                      <div className="text-sm text-gray-700">
                        {filterGroup.message}
                      </div>
                      {metadataParts.length > 0 && (
                        <div className="text-xs text-gray-500">
                          {metadataParts.join(" • ")}
                        </div>
                      )}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </div>
    );
  };

  const renderEvent: (
    event: MonitorEvaluationEvent,
    index: number,
  ) => ReactElement = (
    event: MonitorEvaluationEvent,
    index: number,
  ): ReactElement => {
    const renderEventAction: () => ReactElement | null = () => {
      if (
        event.relatedIncidentId &&
        (event.type === "incident-created" || event.type === "incident-skipped")
      ) {
        const incidentRoute: Route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENT_VIEW] as Route,
          {
            modelId: new ObjectID(event.relatedIncidentId),
          },
        );

        return (
          <Button
            title="View Incident"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            className="w-auto -ml-3"
            onClick={() => {
              Navigation.navigate(incidentRoute);
            }}
          />
        );
      }

      if (
        event.relatedAlertId &&
        (event.type === "alert-created" || event.type === "alert-skipped")
      ) {
        const alertRoute: Route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERT_VIEW] as Route,
          {
            modelId: new ObjectID(event.relatedAlertId),
          },
        );

        return (
          <Button
            title="View Alert"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            className="w-auto -ml-3"
            onClick={() => {
              Navigation.navigate(alertRoute);
            }}
          />
        );
      }

      return null;
    };

    const actionButton: ReactElement | null = renderEventAction();

    const isExistingAlert: boolean =
      event.type === "alert-skipped" && Boolean(event.relatedAlertId);
    const isExistingIncident: boolean =
      event.type === "incident-skipped" && Boolean(event.relatedIncidentId);
    const relatedCreatedAt: Date | undefined = isExistingAlert
      ? event.relatedAlertCreatedAt
      : isExistingIncident
        ? event.relatedIncidentCreatedAt
        : undefined;

    let eventTimeLabel: string = "Action at";

    switch (event.type) {
      case "alert-created":
      case "incident-created":
        eventTimeLabel = "Created at";
        break;
      case "alert-resolved":
      case "incident-resolved":
        eventTimeLabel = "Resolved at";
        break;
      case "alert-skipped":
      case "incident-skipped":
        eventTimeLabel =
          isExistingAlert || isExistingIncident ? "Checked at" : "Skipped at";
        break;
    }

    const eventNumberLabel: string | null = (() => {
      if (
        event.relatedIncidentNumber !== undefined &&
        event.relatedIncidentNumber !== null
      ) {
        return `Incident ${event.relatedIncidentNumberWithPrefix || "#" + event.relatedIncidentNumber}`;
      }

      if (
        event.relatedAlertNumber !== undefined &&
        event.relatedAlertNumber !== null
      ) {
        return `Alert ${event.relatedAlertNumberWithPrefix || "#" + event.relatedAlertNumber}`;
      }

      return null;
    })();

    let decoratedTitle: string = event.title;

    if (eventNumberLabel && !decoratedTitle.includes(eventNumberLabel)) {
      decoratedTitle = `${decoratedTitle} (${eventNumberLabel})`;
    }

    let decoratedMessage: string | undefined = event.message;

    if (
      decoratedMessage &&
      eventNumberLabel &&
      !decoratedMessage.includes(eventNumberLabel)
    ) {
      decoratedMessage = `${decoratedMessage} (${eventNumberLabel})`;
    }

    return (
      <div
        key={`event-${index}-${event.type}`}
        className="flex items-start space-x-3 rounded-md border border-gray-100 bg-gray-50 p-3"
      >
        <div className="mt-0.5">
          <Icon
            icon={IconProp.ArrowCircleRight}
            className="h-4 w-4 text-gray-500"
          />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-800">
            {decoratedTitle}
          </div>
          {decoratedMessage && (
            <div className="text-sm text-gray-600">{decoratedMessage}</div>
          )}
          {relatedCreatedAt && (
            <div className="text-xs text-gray-400">
              {isExistingAlert ? "Alert" : "Incident"} created at{" "}
              {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                relatedCreatedAt,
              )}
            </div>
          )}
          {event.at && (
            <div className="text-xs text-gray-400">
              {eventTimeLabel}{" "}
              {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                event.at,
              )}
            </div>
          )}
          {actionButton && <div className="mt-3 -ml-3">{actionButton}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="text-base font-semibold text-gray-900">
        {getSummaryTitle}
      </div>
      {evaluationSummary.evaluatedAt && (
        <div className="text-xs text-gray-500">
          Evaluated at{" "}
          {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            evaluationSummary.evaluatedAt,
          )}
        </div>
      )}

      {hasCriteriaResults && (
        <div className="space-y-3">
          {evaluationSummary.criteriaResults.map(renderCriteriaResult)}
        </div>
      )}

      {actionEvents.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-900">Actions</div>
          <div className="space-y-2">
            {actionEvents.map(
              (event: MonitorEvaluationEvent, index: number) => {
                return renderEvent(event, index);
              },
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EvaluationLogList;
