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
 * what OneUptime AI learned from the project's incidents (or alerts) over
 * the last 30 days, and what deserves attention - what needs a look, the
 * problems that keep coming back and what the investigations found about
 * them, the monitors and services that keep failing, how the fixes and fix
 * pull requests turned out, how much it investigated and why it skipped the
 * rest, and the trend.
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
    "What OneUptime AI learned from your incidents over the last 30 days: what keeps happening, what its investigations found, which monitors and services keep failing, and how its fixes turned out.",
  ),
  alert: translationKey(
    "What OneUptime AI learned from your alerts over the last 30 days: what keeps happening, what its investigations found, which monitors and services keep failing, and how its fixes turned out.",
  ),
};

export const AI_INSIGHTS_EMPTY_DESCRIPTIONS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "OneUptime AI has not investigated or fixed an incident in the last 30 days. Once it does, what keeps happening, what it found and how its fixes turned out show here.",
  ),
  alert: translationKey(
    "OneUptime AI has not investigated or fixed an alert in the last 30 days. Once it does, what keeps happening, what it found and how its fixes turned out show here.",
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
