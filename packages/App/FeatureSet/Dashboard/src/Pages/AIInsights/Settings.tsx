import PageComponentProps from "../PageComponentProps";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../Components/AISettings/ProjectAiSwitchesCard";
import {
  AI_INSIGHTS_SWITCHES,
  AI_INSIGHTS_SWITCHES_TEST_ID,
  AiInsightsSettingsCopy,
  ProjectAiNoticeContext,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * AI → Insights → Settings: whether OneUptime watches this project's
 * telemetry for problems, and what OneUptime AI does with what it finds -
 * three switches that save the moment they are flipped. They used to sit
 * behind an Update button, under a card that spoke of "deterministic
 * statistical sensors" filing "quiet insights".
 *
 * All three start ON in a new project (ProjectService turns them on at
 * creation); a project that existed before keeps what it had. The server
 * enforces the gates; this page only edits the Project columns.
 */
const AIInsightsSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <ProjectAiNotice context={ProjectAiNoticeContext.Insights} />

      <ProjectAiSwitchesCard
        cardTitle={AiInsightsSettingsCopy.cardTitle}
        cardDescription={AiInsightsSettingsCopy.cardDescription}
        switches={AI_INSIGHTS_SWITCHES}
        dataTestId={AI_INSIGHTS_SWITCHES_TEST_ID}
      />
    </>
  );
};

export default AIInsightsSettings;
