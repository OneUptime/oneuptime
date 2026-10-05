import PageComponentProps from "../../PageComponentProps";
import IncidentAlertAiInsightsPage from "../../../Components/IncidentAlertAi/IncidentAlertAiInsightsPage";
import React, { FunctionComponent, ReactElement } from "react";

// Alerts → AI → Insights: what OneUptime AI learned from alerts.
const AlertAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <IncidentAlertAiInsightsPage {...props} subjectKind="alert" />;
};

export default AlertAIInsights;
