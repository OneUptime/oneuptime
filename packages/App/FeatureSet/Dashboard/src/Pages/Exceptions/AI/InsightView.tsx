import PageComponentProps from "../../PageComponentProps";
import AIInsightViewPage from "../../AIInsights/View/Index";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Exceptions → AI → Insights → one finding: AI Insights' view of it, drawn
 * under Exceptions' AI menu - its evidence, OneUptime AI's look into it,
 * "Open exception", and "Fix with AI" while it has no fix.
 */
const ExceptionsAIInsightView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <AIInsightViewPage {...props} />;
};

export default ExceptionsAIInsightView;
