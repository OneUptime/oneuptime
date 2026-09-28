import PageComponentProps from "../../PageComponentProps";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Settings/ProjectColumnEditGate";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";

export type ComponentProps = PageComponentProps;

export const POSTMORTEM_DRAFT_CARD_TITLE: string = "Automatic Postmortem Draft";

export const POSTMORTEM_DRAFT_FIELDS: Array<"enableAutomaticPostmortemDraft"> =
  ["enableAutomaticPostmortemDraft"];

const IncidentAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  /*
   * The permission snapshot arrives on an API response header, so it can be
   * empty on the first paint. Loading the postmortem card re-renders the
   * page, which reads the permissions again.
   */
  const [, setIsPostmortemCardLoaded] = useState<boolean>(false);

  /*
   * Project.enableAutomaticPostmortemDraft takes Project Owner or Project
   * Admin; the Project table's update list (which the card would otherwise
   * gate on) also lets Manage Billing and Edit Project in, and their save
   * would be refused.
   */
  const postmortemEditGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: POSTMORTEM_DRAFT_FIELDS,
    buttonTitle: "Update",
  });

  return (
    <>
      <CardModelDetail<Project>
        name="Automatic Incident Investigation"
        cardProps={{
          title: "Automatic Incident Investigation",
          description:
            "When enabled, OneUptime AI automatically investigates every new incident and posts a cited root cause analysis to the incident timeline. Requires an LLM provider to be configured in Settings > AI > LLM Providers.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formSteps={[
          {
            title: "Investigation",
            id: "investigation",
          },
          {
            title: "Limits",
            id: "limits",
          },
          {
            title: "Fix Tasks",
            id: "fix-tasks",
          },
        ]}
        formFields={[
          {
            field: {
              enableAutomaticIncidentInvestigation: true,
            },
            stepId: "investigation",
            title: "Automatically Investigate Incidents",
            description:
              "Investigate every new incident and post a cited root cause analysis to the incident timeline.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              incidentInvestigationMinimumSeverity: true,
            },
            stepId: "investigation",
            title: "Minimum Severity To Investigate",
            description:
              "Only incidents at or above this severity are investigated. Leave unset to investigate every incident — unlike alerts, incidents have no default floor, because an incident already cleared a threshold to be declared.",
            required: false,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
            },
            placeholder: "Every severity",
          },
          {
            field: {
              incidentInvestigationDedupeWindowMinutes: true,
            },
            stepId: "investigation",
            title: "Re-investigation Cooldown (Minutes)",
            description:
              "Incidents affecting a monitor that was investigated within this many minutes are not re-investigated — the first analysis stands. Leave empty for the default of 30 minutes; set 0 to investigate every qualifying incident.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "30",
          },
          {
            field: {
              incidentAiMaxConcurrentInvestigations: true,
            },
            stepId: "limits",
            title: "Max Concurrent Incident Investigations",
            description:
              "How many incident investigations may run at the same time for this project. Queued incident investigations wait for a free slot and expire after 30 minutes. Leave empty for the default of 3 (minimum 1, maximum 25).",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "3",
          },
          {
            field: {
              incidentAiDailyAutonomousTokenLimit: true,
            },
            stepId: "limits",
            title: "Daily Incident AI Token Limit",
            description:
              "Maximum tokens per day (UTC) for autonomous incident-linked AI work, including investigations, remediation, and follow-up fix tasks. When reached, new incident-linked AI work is skipped until the next day — interactive AI chat is never blocked. Leave empty for no limit; set 0 to pause autonomous incident AI work entirely.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "No limit",
          },
          {
            field: {
              enableIncidentInstrumentationFixTasks: true,
            },
            stepId: "fix-tasks",
            title: "Instrumentation PRs From Inconclusive Investigations",
            description:
              "Open instrumentation pull requests from inconclusive incident investigations (requires a connected GitHub repository). When an incident investigation cannot determine a root cause because telemetry was insufficient, OneUptime AI opens a pull request adding the missing logs, spans, and metrics to the implicated code paths — always human-reviewed, never auto-merged.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              enableAutomaticIncidentCodeFixes: true,
            },
            stepId: "fix-tasks",
            title: "Enable Automatic Incident Code Fixes",
            description:
              "Open a fix pull request automatically, ready for review, when an incident investigation ends with a confident, evidenced root cause analysis that recommends a repository code change — the automatic form of the 'Open Fix PR from this analysis' button. Operational, infrastructure, external, user-error and inconclusive findings do not open pull requests. Requires a repository connected through the GitHub App and a Runner with the code-fix capability. Pull requests are always human-reviewed — nothing merges automatically.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              incidentAiDailyFixTaskLimit: true,
            },
            stepId: "fix-tasks",
            title: "Daily Incident AI Fix Task Limit",
            description:
              "Maximum incident AI fix tasks (agent runs that open pull requests) that may be created per day (UTC) for this project, across manual and automatic incident fix recipes. Leave empty for the default of 25 per day; set 0 to pause incident AI fix tasks entirely.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "25",
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-incident-ai-settings",
          fields: [
            {
              field: {
                enableAutomaticIncidentInvestigation: true,
              },
              title: "Automatically Investigate Incidents",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
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
              placeholder: "Default (30 minutes)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                incidentAiMaxConcurrentInvestigations: true,
              },
              title: "Max Concurrent Incident Investigations",
              placeholder: "Default (3)",
              fieldType: FieldType.Number,
            },
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
                enableIncidentInstrumentationFixTasks: true,
              },
              title: "Instrumentation PRs From Inconclusive Investigations",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                enableAutomaticIncidentCodeFixes: true,
              },
              title: "Enable Automatic Incident Code Fixes",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                incidentAiDailyFixTaskLimit: true,
              },
              title: "Daily Incident AI Fix Task Limit",
              placeholder: "Default (25)",
              fieldType: FieldType.Number,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/*
       * Its own card and its own save: drafting a postmortem writes to the
       * incident, so it is a separate switch from investigating one (and
       * no longer turns on with it). A card writes every field it is given,
       * so keeping it apart also keeps either save from touching the other.
       */}
      <CardModelDetail<Project>
        name={POSTMORTEM_DRAFT_CARD_TITLE}
        cardProps={{
          title: POSTMORTEM_DRAFT_CARD_TITLE,
          description:
            "When an incident resolves, OneUptime AI drafts a postmortem from its timeline and telemetry for your team to review. This is separate from automatic investigation.",
          buttons: postmortemEditGate.lockedButtons,
        }}
        isEditable={postmortemEditGate.isEditable}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableAutomaticPostmortemDraft: true,
            },
            title: "Draft a postmortem automatically when an incident resolves",
            description:
              "The draft is saved on the incident for someone to review and edit. It never replaces a postmortem that already exists. Off by default.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-incident-postmortem-draft",
          onItemLoaded: () => {
            setIsPostmortemCardLoaded(true);
          },
          fields: [
            {
              field: {
                enableAutomaticPostmortemDraft: true,
              },
              title:
                "Draft a postmortem automatically when an incident resolves",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default IncidentAISettings;
