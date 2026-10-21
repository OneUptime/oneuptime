import PageComponentProps from "../../Pages/PageComponentProps";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AiActivityInsightsPage from "../AI/ActivityInsights/AiActivityInsightsPage";
import {
  IncidentAlertAiDescriptor,
  getIncidentAlertAiDescriptor,
} from "./IncidentAlertAiDescriptors";
import { INCIDENT_ALERT_AI_INSIGHTS_PATHS } from "Common/Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "Common/Types/AI/IncidentAlertAiLogs";
import Route from "Common/Types/API/Route";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The AI Insights page of the Incidents and Alerts menus (AI → Insights):
 * what OneUptime AI found out about the project's incidents (or alerts) over
 * the last 30 days - the ones that keep coming back and why, with the step
 * their investigations suggest, the service or monitor behind several of
 * them, what AI fixed on its own or would fix if allowed, and the incidents
 * it could not look at and what would let it - and, as a footnote, how much
 * it investigated, how its fixes and fix pull requests turned out, and the
 * trend.
 *
 * It is every scope's AI Insights page (AiActivityInsightsPage, the one a
 * cluster and each resource have), over POST /ai-activity/{incident|alert}
 * /insights, which computes it on the server from what the system recorded
 * (IncidentAlertAiInsightsReader) - nothing here is invented or estimated.
 * The product says what it covers in sentences of its own, and its AI
 * Settings page is where a skip is fixed. The record behind the numbers is
 * the AI Logs page next to it.
 */

export const AI_INSIGHTS_PAGE_SUBTITLES: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "What OneUptime AI found out about your incidents in the last 30 days: what keeps going wrong and why, and what to do about it.",
  ),
  alert: translationKey(
    "What OneUptime AI found out about your alerts in the last 30 days: what keeps going wrong and why, and what to do about it.",
  ),
};

export const AI_INSIGHTS_EMPTY_DESCRIPTIONS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "When an incident is created, OneUptime AI investigates it. This page then tells you which incidents keep coming back and why, which services are behind most of them, what AI fixed on its own, and what it would fix if you let it.",
  ),
  alert: translationKey(
    "When an alert fires, OneUptime AI investigates it. This page then tells you which alerts keep coming back and why, which services are behind most of them, what AI fixed on its own, and what it would fix if you let it.",
  ),
};

export interface ComponentProps extends PageComponentProps {
  subjectKind: IncidentAlertAiSubjectKind;
}

const IncidentAlertAiInsightsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const descriptor: IncidentAlertAiDescriptor = getIncidentAlertAiDescriptor(
    props.subjectKind,
  );

  return (
    <AiActivityInsightsPage
      noun={props.subjectKind}
      insightsRoute={INCIDENT_ALERT_AI_INSIGHTS_PATHS[props.subjectKind]}
      requestBody={{}}
      requestKey={props.subjectKind}
      logsRoute={RouteUtil.populateRouteParams(
        RouteMap[descriptor.logsPage] as Route,
      )}
      settingsRoute={RouteUtil.populateRouteParams(
        RouteMap[descriptor.settingsPage] as Route,
      )}
      subtitle={AI_INSIGHTS_PAGE_SUBTITLES[props.subjectKind]}
      emptyDescription={AI_INSIGHTS_EMPTY_DESCRIPTIONS[props.subjectKind]}
      emptyStateId={`${descriptor.testIdPrefix}-insights-empty`}
    />
  );
};

export default IncidentAlertAiInsightsPage;
