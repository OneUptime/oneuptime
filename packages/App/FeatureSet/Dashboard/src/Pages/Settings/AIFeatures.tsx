import PageComponentProps from "../PageComponentProps";
import { getEnableAiConfirmation } from "../../Components/AISettings/EnableAiConfirmation";
import ProjectAiNotice from "../../Components/AISettings/ProjectAiNotice";
import {
  ENABLE_AI_COLUMN,
  ENABLE_AI_SWITCH_TEST_ID,
  EnableAiCopy,
  ProjectAiNoticeContext,
} from "../../Components/AISettings/ProjectAiSettingsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The project's AI switch, Enable AI, on a page every install shows. It used
 * to sit on AI Credits, which the settings menu lists only when billing is
 * on — so on a self-hosted install it could be reached only by typing its
 * URL. It is the master switch: auto-remediation and AI commands on Runners
 * had switches of their own once, and both now follow it. Every message
 * that sends people to turn AI on names this page: "Project Settings → AI
 * Features".
 *
 * It is the switch itself, saving the moment it is flipped (the shared
 * ModelSwitchCard). It used to sit behind "Edit AI Features" and a dialog.
 * Turning it off stops every AI feature in the project at once, so that
 * asks first; turning it on saves at once. Its column takes Project Owner
 * or Manage Billing - narrower than the Project table, which also lets
 * Project Admin and Edit Project in - so for everyone else the switch is
 * locked and says which permission it needs.
 *
 * Under it, only when it is so: the project has no LLM provider for AI to
 * use (ProjectAiNotice).
 */
const AIFeatures: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <>
      <ModelSwitchCard<Project>
        modelType={Project}
        modelId={projectId}
        column={ENABLE_AI_COLUMN}
        cardTitle={EnableAiCopy.cardTitle}
        cardDescription={EnableAiCopy.cardDescription}
        title={EnableAiCopy.switchTitle}
        getDescription={(): string => {
          return EnableAiCopy.switchDescription;
        }}
        getConfirmation={getEnableAiConfirmation}
        dataTestId={ENABLE_AI_SWITCH_TEST_ID}
      />

      {/*
       * Under the switch rather than above it: turning AI on can bring the
       * provider notice up, and it must not push the switch away from the
       * pointer that just pressed it.
       */}
      <ProjectAiNotice context={ProjectAiNoticeContext.AiFeatures} />
    </>
  );
};

export default AIFeatures;
