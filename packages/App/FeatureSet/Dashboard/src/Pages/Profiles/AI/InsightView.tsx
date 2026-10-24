import PageComponentProps from "../../PageComponentProps";
import AIInsightViewPage from "../../AIInsights/View/Index";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Profiler → AI → Insights → one finding: AI Insights' view of it, drawn
 * under the Profiler's menu - its evidence, OneUptime AI's look into it,
 * "Open in Profiler", and "Fix with AI" while it has no fix.
 */
const ProfilesAIInsightView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <AIInsightViewPage {...props} />;
};

export default ProfilesAIInsightView;
