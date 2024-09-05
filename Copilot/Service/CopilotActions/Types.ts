import CodeRepositoryFile from "Common/Server/Utils/CodeRepository/CodeRepositoryFile";
import Dictionary from "Common/Types/Dictionary";
import { Prompt } from "../LLM/Prompt";
import CopilotActionProp from "Common/Types/Copilot/CopilotActionProps/Index";

export interface CopilotActionRunResult {
  files: Dictionary<CodeRepositoryFile>;
  statusMessage: string;
  logs: Array<string>;
}

export interface CopilotActionPrompt {
  messages: Array<Prompt>;
  timeoutInMinutes?: number | undefined;
}

export interface CopilotActionVars {
  currentFilePath: string;
  files: Dictionary<CodeRepositoryFile>;
}

export interface CopilotProcessStart {
  actionProp: CopilotActionProp;
}

export interface CopilotProcess extends CopilotProcessStart {
  result: CopilotActionRunResult;
}
