import PageComponentProps from "../PageComponentProps";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../Components/AISettings/ProjectAiSwitchesCard";
import {
  ProjectAiNoticeContext,
  SECURITY_AI_SWITCHES,
  SECURITY_AI_SWITCHES_TEST_ID,
  SecurityAiSettingsCopy,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Security Events → AI → Settings: whether OneUptime AI triages each new
 * security case on its own - one switch that saves the moment it is
 * flipped, as the Incidents' and Alerts' AI settings do. On for new
 * projects; a project that existed before keeps it off until it is turned
 * on here. Enable AI is still the project's one AI switch: with it off,
 * the notice above says so and nothing here runs.
 *
 * The triage itself is drawn where people read cases - each case's AI card
 * - not on this page.
 */
const SecurityEventsAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <ProjectAiNotice context={ProjectAiNoticeContext.SecurityEvents} />

      <ProjectAiSwitchesCard
        cardTitle={SecurityAiSettingsCopy.cardTitle}
        cardDescription={SecurityAiSettingsCopy.cardDescription}
        switches={SECURITY_AI_SWITCHES}
        dataTestId={SECURITY_AI_SWITCHES_TEST_ID}
      />
    </>
  );
};

export default SecurityEventsAISettings;
