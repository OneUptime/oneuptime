import PageComponentProps from "../../PageComponentProps";
import AIInsightViewPage from "../../AIInsights/View/Index";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Logs → AI → Insights → one finding: AI Insights' view of it, drawn under
 * Logs' AI menu - its evidence, OneUptime AI's look into it, "Open in Logs",
 * and "Fix with AI" while it has no fix.
 */
const LogsAIInsightView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <AIInsightViewPage {...props} />;
};

export default LogsAIInsightView;
