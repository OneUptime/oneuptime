import PageComponentProps from "../../PageComponentProps";
import AIInsightViewPage from "../../AIInsights/View/Index";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Metrics → AI → Insights → one finding: AI Insights' view of it, drawn
 * under Metrics' AI menu - its evidence, OneUptime AI's look into it, "Open
 * in Metrics" (or, for a service with no metrics, "Open in Traces"), and
 * "Fix with AI" while it has no fix.
 */
const MetricsAIInsightView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <AIInsightViewPage {...props} />;
};

export default MetricsAIInsightView;
