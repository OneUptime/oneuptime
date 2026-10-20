import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { isAiOffered } from "Common/Utils/Suggestions/AiSuggestion";
import { useEffect, useState } from "react";
import { ENABLE_AI_COLUMN } from "../Components/AISettings/EnableAiColumn";

/*
 * Whether this page may draw an AI action ("Draft with AI", "Generate with
 * AI", "Explain with AI", ...): the rule is Common/Utils/Suggestions/
 * AiSuggestion.isAiOffered, read off the project the dashboard has selected
 * (the project list selects Enable AI with it), so asking costs no request.
 *
 * Enable AI saves without a reload (Project Settings > AI > AI Features, or
 * the AI pages' own notice), and every save is announced: the answer
 * follows it at once, on every page that asks.
 *
 * Fails open: a project that is not loaded yet, or a value the project list
 * did not carry, reads as AI on - the server refuses an AI action either
 * way, and an unknown value must never hide a working feature.
 */
const useAiOffered: () => boolean = (): boolean => {
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  const [isOffered, setIsOffered] = useState<boolean>(() => {
    return isAiOffered(ProjectUtil.getCurrentProject());
  });

  useEffect(() => {
    setIsOffered(isAiOffered(ProjectUtil.getCurrentProject()));

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    return subscribeToModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(projectId),
      column: ENABLE_AI_COLUMN,
      onSaved: (stored: boolean): void => {
        setIsOffered(isAiOffered({ enableAi: stored }));
      },
    });
  }, [projectId]);

  return isOffered;
};

export default useAiOffered;
