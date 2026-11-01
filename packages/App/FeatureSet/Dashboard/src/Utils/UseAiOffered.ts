import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  AiSwitchHolder,
  isAiOffered,
} from "Common/Utils/Suggestions/AiSuggestion";
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

/*
 * The selected project's Enable AI, or null when it cannot be read: the
 * stored copy is read from the browser's storage, and a value that will
 * not read is an unknown one - which never hides a working feature.
 */
const readSelectedProject: () => AiSwitchHolder | null =
  (): AiSwitchHolder | null => {
    try {
      return ProjectUtil.getCurrentProject();
    } catch {
      return null;
    }
  };

const readSelectedProjectId: () => string = (): string => {
  try {
    return ProjectUtil.getCurrentProjectId()?.toString() || "";
  } catch {
    return "";
  }
};

/*
 * The same answer outside a render - for a callback that decides whether to
 * ask the server for an AI suggestion at all.
 */
export const isAiOfferedForSelectedProject: () => boolean = (): boolean => {
  return isAiOffered(readSelectedProject());
};

// The selected project's Enable AI as it was read, or undefined if it was not.
const readSelectedEnableAi: () => boolean | undefined = ():
  | boolean
  | undefined => {
  const enableAi: unknown = readSelectedProject()?.enableAi;

  return typeof enableAi === "boolean" ? enableAi : undefined;
};

/*
 * The selected project's Enable AI itself, following every save of it:
 * undefined while it is not known - a project not loaded yet, or loaded
 * without the switch. For a sentence about the switch ("Enable AI was off
 * ... It is on now"), which must never say it of a switch nobody read: an
 * AI action asks useAiOffered, which reads an unknown value as on.
 */
export const useAiSwitchState: () => boolean | undefined = ():
  | boolean
  | undefined => {
  const projectId: string = readSelectedProjectId();

  const [state, setState] = useState<boolean | undefined>(() => {
    return readSelectedEnableAi();
  });

  useEffect(() => {
    setState(readSelectedEnableAi());

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    return subscribeToModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(projectId),
      column: ENABLE_AI_COLUMN,
      onSaved: (stored: boolean): void => {
        setState(stored);
      },
    });
  }, [projectId]);

  return state;
};

const useAiOffered: () => boolean = (): boolean => {
  return isAiOffered({ enableAi: useAiSwitchState() });
};

export default useAiOffered;
