import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import {
  CopilotActionPrompt,
  CopilotActionRunResult,
} from "../CopilotActions/CopilotActionsBase";

export default class LlmBase {
  public static async getResponse(
    _data: CopilotActionPrompt,
  ): Promise<CopilotActionRunResult> {
    throw new NotImplementedException();
  }
}
