import PageComponentProps from "../PageComponentProps";
import {
  ProjectColumnsEditGate,
  canUpdateProjectColumns,
  getProjectColumnsEditGate,
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "./ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import Permission from "Common/Types/Permission";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The project's three AI switches, in one card, on a page every install
 * shows. They used to sit on AI Credits, which the settings menu lists only
 * when billing is on — so on a self-hosted install the master switch could
 * be reached only by typing its URL, and "Enable auto-remediation" had no
 * screen at all. Every message that sends people to turn AI (or AI command
 * execution) on names this page: "Project Settings → AI Features".
 */

export const AI_FEATURES_CARD_TITLE: string = "AI Features";

/*
 * The columns the card edits. The form writes all of them on save, so
 * editing needs update permission on every one of them.
 */
export const AI_FEATURE_FIELDS: Array<
  "enableAi" | "enableAutoRemediation" | "enableAiCommandExecution"
> = ["enableAi", "enableAutoRemediation", "enableAiCommandExecution"];

/*
 * Who may change the switches, read from the columns' own update access
 * control rather than written out here, so the page follows the model. The
 * Project table's update list is wider (Project Admin, Edit Project) than
 * these columns', which is why the card cannot rely on CardModelDetail's
 * table-level gate: a Project Admin would get a working Edit button and a
 * save the server refuses.
 */
export function getAiFeaturesUpdatePermissions(): Array<Permission> {
  return getProjectColumnsUpdatePermissions(AI_FEATURE_FIELDS);
}

export function canEditAiFeatures(): boolean {
  return canUpdateProjectColumns(AI_FEATURE_FIELDS);
}

export function getAiFeaturesPermissionMessage(): string {
  return getProjectColumnsPermissionMessage(AI_FEATURE_FIELDS);
}

const AIFeatures: FunctionComponent<PageComponentProps> = (): ReactElement => {
  /*
   * The permission snapshot arrives on an API response header, so it can be
   * empty on the first paint. Loading the card re-renders the page, which
   * reads the permissions again.
   */
  const [, setIsLoaded] = useState<boolean>(false);

  const editGate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: AI_FEATURE_FIELDS,
    buttonTitle: "Edit AI Features",
  });

  return (
    <CardModelDetail<Project>
      name={AI_FEATURES_CARD_TITLE}
      cardProps={{
        title: AI_FEATURES_CARD_TITLE,
        description: "Turn OneUptime AI on or off for this project.",
        buttons: editGate.lockedButtons,
      }}
      isEditable={editGate.isEditable}
      editButtonText="Edit AI Features"
      formFields={[
        {
          field: {
            enableAi: true,
          },
          title: "Enable AI",
          description:
            "The master switch. When off, every AI feature in this project stops: Ask AI, investigations, postmortem drafts and fixes.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: {
            enableAutoRemediation: true,
          },
          title: "Enable Auto-Remediation",
          description:
            "When off, AI never proposes or applies a fix — no auto-remediation rule runs and no fix runs on a Kubernetes cluster.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: {
            enableAiCommandExecution: true,
          },
          title: "Enable AI Command Execution (for Runners)",
          description:
            "Lets AI run commands through your Runners: Bash or SSH commands from auto-remediation rules on the Runners you opt in, and fixes on Kubernetes clusters reached through a Runner with a Kubernetes credential. Off by default. Every command is policy-checked and runs only if it matches an allowlist or someone approves it. Kubernetes clusters connected through the Kubernetes AI agent do not need this.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ]}
      modelDetailProps={{
        modelType: Project,
        id: "ai-features",
        onItemLoaded: () => {
          setIsLoaded(true);
        },
        fields: [
          {
            field: {
              enableAi: true,
            },
            fieldType: FieldType.Boolean,
            title: "Enable AI",
            description: "Every AI feature in this project.",
          },
          {
            field: {
              enableAutoRemediation: true,
            },
            fieldType: FieldType.Boolean,
            title: "Enable Auto-Remediation",
            description: "AI may propose and apply fixes.",
          },
          {
            field: {
              enableAiCommandExecution: true,
            },
            fieldType: FieldType.Boolean,
            title: "Enable AI Command Execution (for Runners)",
            description:
              "AI may run commands on opted-in Runners and on clusters reached through a Runner.",
          },
        ],
        modelId: ProjectUtil.getCurrentProjectId()!,
      }}
    />
  );
};

export default AIFeatures;
