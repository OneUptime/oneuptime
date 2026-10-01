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
 * The project's AI switch, Enable AI, on a page every install shows. It used
 * to sit on AI Credits, which the settings menu lists only when billing is
 * on — so on a self-hosted install it could be reached only by typing its
 * URL. It is the master switch: auto-remediation and AI commands on Runners
 * had switches of their own once, and both now follow it. Every message
 * that sends people to turn AI on names this page: "Project Settings → AI
 * Features".
 */

export const AI_FEATURES_CARD_TITLE: string = "AI Features";

/*
 * The columns the card edits: Enable AI and nothing else. The form writes
 * all of them on save, so editing needs update permission on every one.
 */
export const AI_FEATURE_FIELDS: Array<"enableAi"> = ["enableAi"];

/*
 * Who may change the switch, read from the column's own update access
 * control rather than written out here, so the page follows the model. The
 * Project table's update list is wider (Project Admin, Edit Project) than
 * this column's, which is why the card cannot rely on CardModelDetail's
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
            "The master switch. When off, every AI feature in this project stops: Ask AI, investigations, postmortem drafts, auto-remediation and AI commands on Runners. Auto-remediation and AI commands on Runners need no other project switch.",
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
            description:
              "The master switch for every AI feature in this project, auto-remediation and AI commands on Runners included.",
          },
        ],
        modelId: ProjectUtil.getCurrentProjectId()!,
      }}
    />
  );
};

export default AIFeatures;
