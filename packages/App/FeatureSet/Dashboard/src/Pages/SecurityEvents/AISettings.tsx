import PageComponentProps from "../PageComponentProps";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../Components/AISettings/ProjectAiSwitchesCard";
import SecurityCaseAiLimitsCard from "../../Components/AISettings/SecurityCaseAiLimitsCard";
import SecurityCaseAiRespondFirstCard from "../../Components/AISettings/SecurityCaseAiRespondFirstCard";
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

// The switch that triages each new case, which OneUptime AI's work starts from.
const TRIAGE_SWITCH_COLUMN: string = "enableAutomaticSecurityCaseTriage";

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
 * which says so while working cases is off. Then whether it responds first
 * to new cases, alerting people only when it needs them (#10353,
 * SecurityCaseAiRespondFirstCard): offered while both switches are on, and
 * saying, while nothing contains on its own, that most cases reach people
 * as soon as OneUptime AI asks - which the rows above it change.
 *
 * The triage and OneUptime AI's log of each case it works are drawn where
 * people read cases - each case's AI card - not on this page.
 */
const SecurityEventsAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  // Where the two switches are, once the switches card has read them.
  const [isWorkingCases, setIsWorkingCases] = useState<boolean | null>(null);
  const [isTriaging, setIsTriaging] = useState<boolean | null>(null);
  // Moves on whenever a row of what OneUptime AI may do is saved.
  const [limitsRevision, setLimitsRevision] = useState<number>(0);

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

          if (column === TRIAGE_SWITCH_COLUMN) {
            setIsTriaging(isOn);
          }
        }}
        dataTestId={SECURITY_AI_SWITCHES_TEST_ID}
      />

      <SecurityCaseAiLimitsCard
        isWorkingCases={isWorkingCases}
        onSaved={() => {
          setLimitsRevision((revision: number): number => {
            return revision + 1;
          });
        }}
      />

      <SecurityCaseAiRespondFirstCard
        isTriaging={isTriaging}
        isWorkingCases={isWorkingCases}
        limitsRevision={limitsRevision}
      />
    </>
  );
};

export default SecurityEventsAISettings;
