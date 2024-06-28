import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import { CopilotActionPrompt } from "../CopilotActions/CopilotActionsBase";
import { JSONValue } from "Common/Types/JSON";

export interface CopilotPromptResult {
  output: JSONValue;
}

export default class LlmBase {
  public static async getResponse(
    _data: CopilotActionPrompt,
  ): Promise<CopilotPromptResult> {
    throw new NotImplementedException();
  }
}
