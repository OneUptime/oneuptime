import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PageComponentProps from "../../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Settings/ProjectColumnEditGate";
import ProjectAiNotice from "../../../Components/AISettings/ProjectAiNotice";
import AiRulesTable from "../../../Components/AISettings/AiRulesTable";
import AIPostmortemRulesTable from "../../../Components/AISettings/AIPostmortemRulesTable";
import ProjectAiSwitchesCard from "../../../Components/AISettings/ProjectAiSwitchesCard";
import { useAiRulesFixNothingSwitchWarning } from "../../../Components/AISettings/AiRulesFixNothingWarning";
import { AiRulesFixNothingLaneKind } from "../../../Components/AISettings/AiRulesFixNothing";
import { AUTOMATIC_FIX_SWITCH_COLUMNS } from "Common/Types/AI/AutomaticFixPullRequests";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  AI_LANE_ADVANCED_SECTION_TEST_ID,
  AI_LANE_PAGE_COPY,
  AI_LANE_SWITCHES,
  AI_LANE_SWITCHES_TEST_ID,
  AiLane,
  AiLaneAdvancedCard,
  getAiLaneAdvancedCardColumns,
  ProjectAiNoticeContext,
} from "../../../Components/AISettings/ProjectAiSettingsCopy";
import useAiLaneAdvancedState, {
  AiLaneAdvanced,
} from "../../../Components/AISettings/useAiLaneAdvancedState";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Incidents → AI → Settings: what OneUptime AI does on its own as incidents
 * happen, as switches that save the moment they are flipped, then - folded
 * under Advanced - the AI rules first (which incidents OneUptime AI
 * investigates, and whether and how it fixes them), the limits on its work,
 * each card one question with its own Edit, and the rules that narrow which
 * incidents get a postmortem draft when they resolve (and in which
 * template).
 *
 * It used to be one card of nine read-only rows whose Update opened a
 * three-step wizard (Investigation / Limits / Fix Tasks), and a second card
 * holding one more switch behind one more dialog. See ProjectAiSettingsCopy
 * for the words, and AlertAISettings for the alerts' twin of this page.
 *
 * Every card writes only its own columns (a card writes every field it is
 * given): no save here can touch an alert setting, or a setting of another
 * card. Every limit is empty by default, and empty means no limit.
 */
const IncidentAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const advanced: AiLaneAdvanced = useAiLaneAdvancedState(AiLane.Incident);

  /*
   * With rules that all say Don't fix, nothing is fixed while "Fix new
   * incidents automatically" still says it fixes each one: the switch says
   * so, with the way to the rules (AiRulesFixNothing).
   */
  const fixNothing: {
    getWarning: (column: string, isOn: boolean) => ReactNode;
    refresh: () => void;
  } = useAiRulesFixNothingSwitchWarning({
    triggerEntityType: AutoRemediationTriggerEntity.Incident,
    switchColumn:
      AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Incident],
    kind: AiRulesFixNothingLaneKind.Signal,
    rulesAnchor: AiLaneAdvancedCard.AiRules,
  });
  const onAiRulesLoaded: (count: number) => void = advanced.onRulesLoaded(
    AiLaneAdvancedCard.AiRules,
  );

  /*
   * The limits take Project Owner or Project Admin; the Project table's
   * update list, which a card would otherwise gate its Edit on, also lets
   * Edit Project and Manage Billing in, and their save would be refused.
   */
  const getEditGate: (card: AiLaneAdvancedCard) => ProjectColumnsEditGate = (
    card: AiLaneAdvancedCard,
  ): ProjectColumnsEditGate => {
    return getProjectColumnsEditGate({
      fields: getAiLaneAdvancedCardColumns(AiLane.Incident, card),
      buttonTitle: "Edit",
    });
  };

  const whichGate: ProjectColumnsEditGate = getEditGate(
    AiLaneAdvancedCard.WhichAreInvestigated,
  );
  const limitsGate: ProjectColumnsEditGate = getEditGate(
    AiLaneAdvancedCard.InvestigationLimits,
  );
  const dailyGate: ProjectColumnsEditGate = getEditGate(
    AiLaneAdvancedCard.DailyLimits,
  );

  return (
    <>
      <ProjectAiNotice context={ProjectAiNoticeContext.Incidents} />

      <ProjectAiSwitchesCard
        cardTitle={AI_LANE_PAGE_COPY[AiLane.Incident].switchesCardTitle}
        cardDescription={
          AI_LANE_PAGE_COPY[AiLane.Incident].switchesCardDescription
        }
        switches={AI_LANE_SWITCHES[AiLane.Incident]}
        getWarning={fixNothing.getWarning}
        dataTestId={AI_LANE_SWITCHES_TEST_ID[AiLane.Incident]}
      />

      <AdvancedPageSection
        description={AI_LANE_PAGE_COPY[AiLane.Incident].advancedDescription}
        items={advanced.items}
        summary={advanced.summary}
        dataTestId={AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Incident]}
      >
        <AiRulesTable
          lane={AiLane.Incident}
          onRulesLoaded={(count: number): void => {
            onAiRulesLoaded(count);
            // A rule added, changed or turned off: read what they fix again.
            fixNothing.refresh();
          }}
        />

        <CardModelDetail<Project>
          name="Which incidents are investigated"
          cardProps={{
            title: "Which incidents are investigated",
            description:
              "Every new incident is investigated unless you narrow it down here.",
            buttons: whichGate.lockedButtons,
            /*
             * Its place on the page: a link to ".../ai/settings#
             * WhichAreInvestigated" (an incident's AI card, when its
             * severity was below the minimum) opens More settings here.
             */
            id: AiLaneAdvancedCard.WhichAreInvestigated,
          }}
          isEditable={whichGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Which incidents are investigated"
          formFields={[
            {
              field: {
                incidentInvestigationMinimumSeverity: true,
              },
              title: "Minimum Severity To Investigate",
              description:
                "Only incidents at or above this severity are investigated. Leave unset to investigate every incident, whatever its severity.",
              required: false,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownModal: {
                type: IncidentSeverity,
                labelField: "name",
                valueField: "_id",
                sort: {
                  order: SortOrder.Ascending,
                },
              },
              placeholder: "Every severity",
            },
            {
              field: {
                incidentInvestigationDedupeWindowMinutes: true,
              },
              title: "Re-investigation Cooldown (Minutes)",
              description:
                "Incidents on a monitor investigated within this many minutes reuse that investigation. Leave empty to investigate every incident. At most 1440.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No cooldown",
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-incident-ai-which",
            onItemLoaded: advanced.onCardLoaded(
              AiLaneAdvancedCard.WhichAreInvestigated,
            ),
            fields: [
              {
                field: {
                  incidentInvestigationMinimumSeverity: {
                    name: true,
                    color: true,
                  },
                },
                title: "Minimum Severity To Investigate",
                placeholder: "Every severity",
                fieldType: FieldType.Entity,
              },
              {
                field: {
                  incidentInvestigationDedupeWindowMinutes: true,
                },
                title: "Re-investigation Cooldown (Minutes)",
                placeholder: "No cooldown",
                fieldType: FieldType.Number,
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />

        <CardModelDetail<Project>
          name="Incident Investigation Limits"
          cardProps={{
            title: "Investigation limits",
            description:
              "Investigations start right away and run until they are done unless you set a limit here.",
            buttons: limitsGate.lockedButtons,
            /*
             * Its place in More settings: the name the folded header lists
             * it by, so a link to it lands here.
             */
            id: AiLaneAdvancedCard.InvestigationLimits,
          }}
          isEditable={limitsGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Investigation limits"
          formFields={[
            {
              field: {
                incidentAiMaxConcurrentInvestigations: true,
              },
              title: "Max Concurrent Incident Investigations",
              description:
                "How many incident investigations may run at once. Leave empty for no limit. Queued ones wait for a free slot for up to 30 minutes.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No limit",
            },
            {
              field: {
                incidentAiInvestigationTimeLimitInMinutes: true,
              },
              title: "Incident Investigation Time Limit (Minutes)",
              description:
                "Stop an incident investigation after this many minutes and report what it found. Leave empty for no limit.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No time limit",
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-incident-ai-limits",
            onItemLoaded: advanced.onCardLoaded(
              AiLaneAdvancedCard.InvestigationLimits,
            ),
            fields: [
              {
                field: {
                  incidentAiMaxConcurrentInvestigations: true,
                },
                title: "Max Concurrent Incident Investigations",
                placeholder: "No limit",
                fieldType: FieldType.Number,
              },
              {
                field: {
                  incidentAiInvestigationTimeLimitInMinutes: true,
                },
                title: "Incident Investigation Time Limit (Minutes)",
                placeholder: "No time limit",
                fieldType: FieldType.Number,
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />

        <AIPostmortemRulesTable
          onRulesLoaded={advanced.onRulesLoaded(
            AiLaneAdvancedCard.PostmortemRules,
          )}
        />

        <CardModelDetail<Project>
          name="Incident Daily Limits"
          cardProps={{
            title: "Daily limits",
            description:
              "How much incident AI work may run each day (UTC). Ask AI is never limited.",
            buttons: dailyGate.lockedButtons,
            /*
             * Its place in More settings: the name the folded header lists
             * it by, so a link to it lands here.
             */
            id: AiLaneAdvancedCard.DailyLimits,
          }}
          isEditable={dailyGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Daily limits"
          formFields={[
            {
              field: {
                incidentAiDailyAutonomousTokenLimit: true,
              },
              title: "Daily Incident AI Token Limit",
              description:
                "The most tokens incident AI work may use each day: investigations, remediation and fix tasks. Leave empty for no limit, or set 0 to pause it.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No limit",
            },
            {
              field: {
                incidentAiDailyFixTaskLimit: true,
              },
              title: "Daily Incident AI Fix Task Limit",
              description:
                "How many fix pull requests OneUptime AI may start for incidents each day. Leave empty for no limit, or 0 to pause them.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No limit",
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-incident-ai-daily",
            onItemLoaded: advanced.onCardLoaded(AiLaneAdvancedCard.DailyLimits),
            fields: [
              {
                field: {
                  incidentAiDailyAutonomousTokenLimit: true,
                },
                title: "Daily Incident AI Token Limit",
                placeholder: "No limit",
                fieldType: FieldType.Number,
              },
              {
                field: {
                  incidentAiDailyFixTaskLimit: true,
                },
                title: "Daily Incident AI Fix Task Limit",
                placeholder: "No limit",
                fieldType: FieldType.Number,
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />
      </AdvancedPageSection>
    </>
  );
};

export default IncidentAISettings;
