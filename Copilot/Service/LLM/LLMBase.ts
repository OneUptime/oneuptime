import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import { JSONValue } from "Common/Types/JSON";
import { CopilotActionPrompt } from "../CopilotActions/Types";

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
