import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import {
  ENABLE_AI_COLUMN,
  getProjectAiProviderState,
  getProjectAiState,
  ProjectAiProviderState,
  ProjectAiState,
} from "./ProjectAiSettingsCopy";

/*
 * What an AI settings page needs to know before it can say something is
 * out of the ordinary: whether the project has AI on (Project.enableAi),
 * and whether there is an LLM provider OneUptime AI can use for it.
 *
 * Both are read when the page opens, each on its own, and each fails to
 * Unknown - which says nothing - when it cannot be read: someone who may
 * not read the providers, a request that fails. The server decides either
 * way; this only decides what the page tells the reader, and it must not
 * claim what it does not know.
 *
 * Enable AI can be flipped on the page itself (the notice's switch) or
 * anywhere else on the screen; every save of it is announced
 * (ModelSwitchEvents) and followed here at once.
 */

export interface ProjectAiReadiness {
  aiState: ProjectAiState;
  providerState: ProjectAiProviderState;
}

export const PROJECT_AI_PROVIDERS_PATH: string = "/ai-chat/providers";

const useProjectAiReadiness: () => ProjectAiReadiness =
  (): ProjectAiReadiness => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const projectIdString: string = projectId?.toString() || "";

    const [aiState, setAiState] = useState<ProjectAiState>(
      ProjectAiState.Unknown,
    );
    const [providerState, setProviderState] = useState<ProjectAiProviderState>(
      ProjectAiProviderState.Unknown,
    );

    /*
     * Set when Enable AI is saved anywhere on the screen: a read that was
     * already on its way must not put back the value from before the save.
     */
    const hasHeardSaveRef: MutableRefObject<boolean> = useRef<boolean>(false);

    useEffect(() => {
      hasHeardSaveRef.current = false;
      setAiState(ProjectAiState.Unknown);
      setProviderState(ProjectAiProviderState.Unknown);

      if (!projectIdString) {
        return;
      }

      let isCurrent: boolean = true;
      const id: ObjectID = new ObjectID(projectIdString);

      const readAi: () => Promise<void> = async (): Promise<void> => {
        try {
          const project: Project | null = await ModelAPI.getItem<Project>({
            modelType: Project,
            id: id,
            select: {
              enableAi: true,
            },
          });

          if (isCurrent && !hasHeardSaveRef.current) {
            setAiState(getProjectAiState(project));
          }
        } catch {
          // Unknown: say nothing.
        }
      };

      const readProvider: () => Promise<void> = async (): Promise<void> => {
        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(
                APP_API_URL.toString() + PROJECT_AI_PROVIDERS_PATH,
              ),
              data: {},
              headers: ModelAPI.getCommonHeaders(),
            });

          if (response instanceof HTTPErrorResponse) {
            return;
          }

          if (isCurrent) {
            setProviderState(getProjectAiProviderState(response.data));
          }
        } catch {
          // Unknown: say nothing.
        }
      };

      void readAi();
      void readProvider();

      const unsubscribe: () => void = subscribeToModelSwitchSaved({
        modelType: Project,
        modelId: id,
        column: ENABLE_AI_COLUMN,
        onSaved: (stored: boolean): void => {
          hasHeardSaveRef.current = true;
          setAiState(stored ? ProjectAiState.On : ProjectAiState.Off);
        },
      });

      return () => {
        isCurrent = false;
        unsubscribe();
      };
    }, [projectIdString]);

    return { aiState, providerState };
  };

export default useProjectAiReadiness;
