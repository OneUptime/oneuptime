import PageComponentProps from "../../PageComponentProps";
import AIInsightViewPage from "../../AIInsights/View/Index";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Traces → AI → Insights → one finding: AI Insights' view of it, drawn
 * under Traces' AI menu - its evidence, OneUptime AI's look into it, "Open
 * in Traces", and "Fix with AI" while it has no fix.
 */
const TracesAIInsightView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <AIInsightViewPage {...props} />;
};

export default TracesAIInsightView;
