import PageComponentProps from "../../PageComponentProps";
import IncidentAlertAiInsightsPage from "../../../Components/IncidentAlertAi/IncidentAlertAiInsightsPage";
import React, { FunctionComponent, ReactElement } from "react";

// Incidents → AI → Insights: what OneUptime AI learned from incidents.
const IncidentAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <IncidentAlertAiInsightsPage {...props} subjectKind="incident" />;
};

export default IncidentAIInsights;
