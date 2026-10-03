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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

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
  const translator: Translator = useTranslator();
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

  const getSummaryTitle: string =
    translator.translateText(props.title || "Evaluation Logs") ||
    "Evaluation Logs";

  const renderCriteriaResult: (
    criteria: MonitorEvaluationCriteriaResult,
    index: number,
  ) => ReactElement = (
    criteria: MonitorEvaluationCriteriaResult,
    index: number,
  ): ReactElement => {
    const isSkipped: boolean = Boolean(criteria.skipped);
    const criteriaName: string =
      criteria.criteriaName ||
      translator.translateTemplate("Criteria {{number}}", {
        number: index + 1,
      });

    if (isSkipped) {
      const skipReason: string =
        criteria.skipReason ||
        criteria.message ||
        translationKey("This criterion was not evaluated.");
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
              previousCriteria.criteriaName ||
              translator.translateTemplate("Criteria {{number}}", {
                number: previousIndex + 1,
              });
            break;
          }
        }
      }

      const skippedStatus: string = isDisabled
        ? translationKey("Disabled")
        : translationKey("Not evaluated");

      return (
        <div
          key={`criteria-${criteria.criteriaId || index}`}
          role="group"
          aria-label={translator.translateTemplate("{{name}}: {{status}}", {
            name: criteriaName,
            status: translatableTerm(skippedStatus),
          })}
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
                {translator.translateTemplate("Condition: {{condition}}", {
                  condition: translatableTerm(criteria.filterCondition || ""),
                })}
              </div>
              <div className="mt-3 border-t border-gray-200 pt-3">
                <div className="text-sm text-gray-600">
                  {previousMatchingCriteriaName ? (
                    <TranslatedSentence
                      template="Not evaluated because {{criteria}} matched first."
                      slots={{
                        criteria: (
                          <span className="font-medium text-gray-800">
                            “{previousMatchingCriteriaName}”
                          </span>
                        ),
                      }}
                    />
                  ) : (
                    translator.translateText(skipReason)
                  )}
                </div>
                {previousMatchingCriteriaName && (
                  <div className="mt-1 text-xs text-gray-500">
                    {translator.translateText(
                      "Criteria are evaluated in order; this monitor stops after the first match.",
                    )}
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
        aria-label={translator.translateTemplate(
          criteria.met ? "{{name}}: Met" : "{{name}}: Not Met",
          { name: criteriaName },
        )}
        className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {criteriaName}
            </div>
            <div className="text-xs text-gray-500">
              {translator.translateTemplate("Condition: {{condition}}", {
                condition: translatableTerm(criteria.filterCondition || ""),
              })}
            </div>
          </div>
          <span
            className={`text-xs font-semibold ${
              criteria.met ? "text-green-600" : "text-gray-500"
            }`}
          >
            {translator.translateText(criteria.met ? "Met" : "Not Met")}
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

                let statusText: string = translationKey("Partial");
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

                // Each value is a check or condition name the reader's language may word.
                const listTerms: (values: Array<string>) => string = (
                  values: Array<string>,
                ): string => {
                  return values
                    .map((value: string): string => {
                      return translator.translateTerm(value);
                    })
                    .join(", ");
                };

                if (uniqueCheckOnLabels.length > 0) {
                  metadataParts.push(
                    translator.translatePlural(
                      { one: "Check: {{checks}}", other: "Checks: {{checks}}" },
                      uniqueCheckOnLabels.length,
                      { checks: listTerms(uniqueCheckOnLabels) },
                    ),
                  );
                }

                if (uniqueFilterTypes.length > 0) {
                  metadataParts.push(
                    translator.translatePlural(
                      {
                        one: "Condition: {{conditions}}",
                        other: "Conditions: {{conditions}}",
                      },
                      uniqueFilterTypes.length,
                      { conditions: listTerms(uniqueFilterTypes) },
                    ),
                  );
                }

                if (thresholdValues.length > 0) {
                  metadataParts.push(
                    translator.translatePlural(
                      {
                        one: "Threshold: {{thresholds}}",
                        other: "Thresholds: {{thresholds}}",
                      },
                      thresholdValues.length,
                      { thresholds: thresholdValues.join(", ") },
                    ),
                  );
                }

                if (filterGroup.occurrences.length > 1) {
                  metadataParts.push(
                    translator.translatePlural(
                      {
                        one: "{{count}} matching check",
                        other: "{{count}} matching checks",
                      },
                      filterGroup.occurrences.length,
                    ),
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
                      {translator.translateText(statusText)}
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

    // A whole sentence per kind of event, with the time as {{time}}.
    let eventTimeLabel: string = translationKey("Action at {{time}}");

    switch (event.type) {
      case "alert-created":
      case "incident-created":
        eventTimeLabel = translationKey("Created at {{time}}");
        break;
      case "alert-resolved":
      case "incident-resolved":
        eventTimeLabel = translationKey("Resolved at {{time}}");
        break;
      case "alert-skipped":
      case "incident-skipped":
        eventTimeLabel =
          isExistingAlert || isExistingIncident
            ? translationKey("Checked at {{time}}")
            : translationKey("Skipped at {{time}}");
        break;
    }

    /*
     * The incident or alert this event is about. `englishLabel` is how the
     * server's (English) event text names it, used only to avoid naming it
     * twice; the reader sees `template`, a whole sentence in their language.
     */
    const eventNumber: {
      englishLabel: string;
      number: string;
      template: string;
    } | null = (() => {
      if (
        event.relatedIncidentNumber !== undefined &&
        event.relatedIncidentNumber !== null
      ) {
        const number: string =
          event.relatedIncidentNumberWithPrefix ||
          "#" + event.relatedIncidentNumber;

        return {
          englishLabel: "Incident " + number,
          number: number,
          template: translationKey("{{text}} (Incident {{number}})"),
        };
      }

      if (
        event.relatedAlertNumber !== undefined &&
        event.relatedAlertNumber !== null
      ) {
        const number: string =
          event.relatedAlertNumberWithPrefix || "#" + event.relatedAlertNumber;

        return {
          englishLabel: "Alert " + number,
          number: number,
          template: translationKey("{{text}} (Alert {{number}})"),
        };
      }

      return null;
    })();

    const decorate: (text: string) => string = (text: string): string => {
      if (!eventNumber || text.includes(eventNumber.englishLabel)) {
        return text;
      }

      return translator.translateTemplate(eventNumber.template, {
        text: text,
        number: eventNumber.number,
      });
    };

    const decoratedTitle: string = decorate(event.title);

    const decoratedMessage: string | undefined = event.message
      ? decorate(event.message)
      : event.message;

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
              {translator.translateTemplate(
                isExistingAlert
                  ? "Alert created at {{time}}"
                  : "Incident created at {{time}}",
                {
                  time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    relatedCreatedAt,
                  ),
                },
              )}
            </div>
          )}
          {event.at && (
            <div className="text-xs text-gray-400">
              {translator.translateTemplate(eventTimeLabel, {
                time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  event.at,
                ),
              })}
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
          {translator.translateTemplate("Evaluated at {{time}}", {
            time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              evaluationSummary.evaluatedAt,
            ),
          })}
        </div>
      )}

      {hasCriteriaResults && (
        <div className="space-y-3">
          {evaluationSummary.criteriaResults.map(renderCriteriaResult)}
        </div>
      )}

      {actionEvents.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-900">
            {translator.translateText("Actions")}
          </div>
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
