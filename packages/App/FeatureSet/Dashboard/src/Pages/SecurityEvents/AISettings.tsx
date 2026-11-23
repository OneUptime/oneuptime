import PageComponentProps from "../PageComponentProps";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../Components/AISettings/ProjectAiSwitchesCard";
import SecurityCaseAiLimitsCard from "../../Components/AISettings/SecurityCaseAiLimitsCard";
import {
  ProjectAiNoticeContext,
  SECURITY_AI_SWITCHES,
  SECURITY_AI_SWITCHES_TEST_ID,
  SecurityAiSettingsCopy,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import { ModelSwitchColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import { SECURITY_CASE_AI_SWITCH_COLUMN } from "Common/Types/SecurityCase/SecurityCaseAi";
import React, { FunctionComponent, ReactElement, useState } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Security Events → AI → Settings: what OneUptime AI does on its own for
 * security cases - two switches that save the moment they are flipped, as
 * the Incidents' and Alerts' AI settings do: triaging each new case, and
 * working a case its triage reads as Likely Malicious end to end (#10352).
 * On for new projects; a project that existed before keeps them off until
 * they are turned on here. Enable AI is still the project's one AI switch:
 * with it off, the notice above says so and nothing here runs.
 *
 * Under them, what OneUptime AI may do while it works a case: one row per
 * kind of action, each Off, Ask first or On its own (SecurityCaseAiLimitsCard),
 * which says so while working cases is off.
 *
 * The triage and OneUptime AI's log of each case it works are drawn where
 * people read cases - each case's AI card - not on this page.
 */
const SecurityEventsAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  // Where Work cases end to end is, once the switches card has read it.
  const [isWorkingCases, setIsWorkingCases] = useState<boolean | null>(null);

  return (
    <>
      <ProjectAiNotice context={ProjectAiNoticeContext.SecurityEvents} />

      <ProjectAiSwitchesCard
        cardTitle={SecurityAiSettingsCopy.cardTitle}
        cardDescription={SecurityAiSettingsCopy.cardDescription}
        switches={SECURITY_AI_SWITCHES}
        onChange={(column: ModelSwitchColumn<Project>, isOn: boolean) => {
          if (column === SECURITY_CASE_AI_SWITCH_COLUMN) {
            setIsWorkingCases(isOn);
          }
        }}
        dataTestId={SECURITY_AI_SWITCHES_TEST_ID}
      />

      <SecurityCaseAiLimitsCard isWorkingCases={isWorkingCases} />
    </>
  );
};

export default SecurityEventsAISettings;
