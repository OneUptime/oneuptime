import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationEvent,
  MonitorEvaluationFilterResult,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import React, { FunctionComponent, ReactElement } from "react";

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
    return (
      <div
        key={`criteria-${criteria.criteriaId || index}`}
        className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {criteria.criteriaName || `Criteria ${index + 1}`}
            </div>
            <div className="text-xs text-gray-500">
              Condition: {criteria.filterCondition}
            </div>
          </div>
          <span
            className={`text-xs font-semibold ${criteria.met ? "text-green-600" : "text-red-500"}`}
          >
            {criteria.met ? "Met" : "Not Met"}
          </span>
        </div>

        {criteria.filters.length > 0 && (
          <ul className="mt-3 space-y-2">
            {criteria.filters.map(
              (filter: MonitorEvaluationFilterResult, filterIndex: number) => {
                return (
                  <li
                    key={`criteria-${index}-filter-${filterIndex}`}
                    className="flex items-start space-x-2 text-sm text-gray-700"
                  >
                    <Icon
                      icon={
                        filter.met ? IconProp.CheckCircle : IconProp.CircleClose
                      }
                      className={`h-4 w-4 flex-shrink-0 ${filter.met ? "text-green-600" : "text-red-500"}`}
                    />
                    <span>{filter.message}</span>
                  </li>
                );
              },
            )}
          </ul>
        )}

        {criteria.message && (
          <div className="mt-3 text-sm text-gray-700">{criteria.message}</div>
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
        (event.type === "incident-created" ||
          event.type === "incident-skipped")
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
            buttonStyle={ButtonStyleType.SECONDARY}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              Navigation.navigate(incidentRoute);
            }}
          />
        );
      }

      if (
        event.relatedAlertId &&
        (event.type === "alert-created" ||
          event.type === "alert-skipped")
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
            buttonStyle={ButtonStyleType.SECONDARY}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              Navigation.navigate(alertRoute);
            }}
          />
        );
      }

      return null;
    };

    const actionButton: ReactElement | null = renderEventAction();

    return (
      <div
        key={`event-${index}-${event.type}`}
        className="flex items-start space-x-3 rounded-md border border-gray-100 bg-gray-50 p-3"
      >
        <div className="mt-0.5">
          <Icon icon={IconProp.Activity} className="h-4 w-4 text-gray-500" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-800">{event.title}</div>
          {event.message && (
            <div className="text-sm text-gray-600">{event.message}</div>
          )}
          {event.at && (
            <div className="text-xs text-gray-400">
              {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                event.at,
              )}
            </div>
          )}
          {actionButton && <div className="mt-3">{actionButton}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
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
