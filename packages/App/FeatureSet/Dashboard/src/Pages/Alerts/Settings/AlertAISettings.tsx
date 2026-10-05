import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PageComponentProps from "../../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Settings/ProjectColumnEditGate";
import ProjectAiNotice from "../../../Components/AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../../../Components/AISettings/ProjectAiSwitchesCard";
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
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Alerts → Settings → AI: what OneUptime AI does on its own as alerts
 * happen, as switches that save the moment they are flipped, then - folded
 * under Advanced - which alerts it investigates and the limits on its work,
 * each card one question with its own Edit.
 *
 * It used to be one card of nine read-only rows whose Update opened a
 * three-step wizard. See ProjectAiSettingsCopy for the words, and
 * IncidentAISettings for the incidents' twin of this page (which also
 * drafts postmortems).
 *
 * Every card writes only its own columns (a card writes every field it is
 * given): no save here can touch an incident setting, or a setting of
 * another card. Every limit is empty by default, and empty means no limit.
 */
const AlertAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  const advanced: AiLaneAdvanced = useAiLaneAdvancedState(AiLane.Alert);

  /*
   * The limits take Project Owner or Project Admin; the Project table's
   * update list, which a card would otherwise gate its Edit on, also lets
   * Edit Project and Manage Billing in, and their save would be refused.
   */
  const getEditGate: (card: AiLaneAdvancedCard) => ProjectColumnsEditGate = (
    card: AiLaneAdvancedCard,
  ): ProjectColumnsEditGate => {
    return getProjectColumnsEditGate({
      fields: getAiLaneAdvancedCardColumns(AiLane.Alert, card),
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
      <ProjectAiNotice context={ProjectAiNoticeContext.Alerts} />

      <ProjectAiSwitchesCard
        cardTitle={AI_LANE_PAGE_COPY[AiLane.Alert].switchesCardTitle}
        cardDescription={
          AI_LANE_PAGE_COPY[AiLane.Alert].switchesCardDescription
        }
        switches={AI_LANE_SWITCHES[AiLane.Alert]}
        dataTestId={AI_LANE_SWITCHES_TEST_ID[AiLane.Alert]}
      />

      <AdvancedPageSection
        description={AI_LANE_PAGE_COPY[AiLane.Alert].advancedDescription}
        items={advanced.items}
        summary={advanced.summary}
        dataTestId={AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Alert]}
      >
        <CardModelDetail<Project>
          name="Which alerts are investigated"
          cardProps={{
            title: "Which alerts are investigated",
            description:
              "Every new alert is investigated unless you narrow it down here.",
            buttons: whichGate.lockedButtons,
          }}
          isEditable={whichGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Which alerts are investigated"
          formFields={[
            {
              field: {
                alertInvestigationMinimumSeverity: true,
              },
              title: "Minimum Severity To Investigate",
              description:
                "Only alerts at or above this severity are investigated. Leave unset to investigate every alert, whatever its severity.",
              required: false,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownModal: {
                type: AlertSeverity,
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
                alertInvestigationDedupeWindowMinutes: true,
              },
              title: "Re-investigation Cooldown (Minutes)",
              description:
                "Repeat alerts from the same monitor within this many minutes are not re-investigated — the first analysis stands. Leave empty for no cooldown, so every alert is investigated. At most 1440 minutes (a day).",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No cooldown",
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-alert-ai-which",
            onItemLoaded: advanced.onCardLoaded(
              AiLaneAdvancedCard.WhichAreInvestigated,
            ),
            fields: [
              {
                field: {
                  alertInvestigationMinimumSeverity: {
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
                  alertInvestigationDedupeWindowMinutes: true,
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
          name="Alert Investigation Limits"
          cardProps={{
            title: "Investigation limits",
            description:
              "Investigations start right away and run until they are done unless you set a limit here.",
            buttons: limitsGate.lockedButtons,
          }}
          isEditable={limitsGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Investigation limits"
          formFields={[
            {
              field: {
                alertAiMaxConcurrentInvestigations: true,
              },
              title: "Max Concurrent Alert Investigations",
              description:
                "How many alert investigations may run at the same time for this project. Leave empty for no limit — every alert investigation starts right away. With a limit set (minimum 1), queued alert investigations wait for a free slot and expire after 30 minutes.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No limit",
            },
            {
              field: {
                alertAiInvestigationTimeLimitInMinutes: true,
              },
              title: "Alert Investigation Time Limit (Minutes)",
              description:
                "Stop an alert investigation after this many minutes and report what it found. Leave empty for no time limit — OneUptime AI keeps investigating (running every query and command it needs) until it is done.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No time limit",
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-alert-ai-limits",
            onItemLoaded: advanced.onCardLoaded(
              AiLaneAdvancedCard.InvestigationLimits,
            ),
            fields: [
              {
                field: {
                  alertAiMaxConcurrentInvestigations: true,
                },
                title: "Max Concurrent Alert Investigations",
                placeholder: "No limit",
                fieldType: FieldType.Number,
              },
              {
                field: {
                  alertAiInvestigationTimeLimitInMinutes: true,
                },
                title: "Alert Investigation Time Limit (Minutes)",
                placeholder: "No time limit",
                fieldType: FieldType.Number,
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />

        <CardModelDetail<Project>
          name="Alert Daily Limits"
          cardProps={{
            title: "Daily limits",
            description:
              "How much alert AI work may run each day (UTC). Ask AI is never limited.",
            buttons: dailyGate.lockedButtons,
          }}
          isEditable={dailyGate.isEditable}
          editButtonText="Edit"
          editModalTitle="Daily limits"
          formFields={[
            {
              field: {
                alertAiDailyAutonomousTokenLimit: true,
              },
              title: "Daily Alert AI Token Limit",
              description:
                "The most tokens alert AI work may use each day: investigations, remediation and fix tasks. Leave empty for no limit, or set 0 to pause it.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No limit",
            },
            {
              field: {
                alertAiDailyFixTaskLimit: true,
              },
              title: "Daily Alert AI Fix Task Limit",
              description:
                "How many fix pull requests OneUptime AI may start on for alerts each day, whether someone asked for one or not. Leave empty for no limit, or set 0 to pause them.",
              required: false,
              fieldType: FormFieldSchemaType.Number,
              placeholder: "No limit",
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "model-detail-project-alert-ai-daily",
            onItemLoaded: advanced.onCardLoaded(AiLaneAdvancedCard.DailyLimits),
            fields: [
              {
                field: {
                  alertAiDailyAutonomousTokenLimit: true,
                },
                title: "Daily Alert AI Token Limit",
                placeholder: "No limit",
                fieldType: FieldType.Number,
              },
              {
                field: {
                  alertAiDailyFixTaskLimit: true,
                },
                title: "Daily Alert AI Fix Task Limit",
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

export default AlertAISettings;
