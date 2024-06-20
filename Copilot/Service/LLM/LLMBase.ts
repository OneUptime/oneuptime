import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import PromptsUtil from "../../Utils/Prompts";

export default class LlmBase {
  public static async getResponse(_data: { prompt: string }): Promise<string> {
    throw new NotImplementedException();
  }

  public static async getResponseByEventType(data: {
    copilotActionType: CopilotActionType;
    code: string;
  }): Promise<string> {
    const prompt: string = await PromptsUtil.getPrompt({
      copilotActionType: data.copilotActionType,
      vars: {
        code: data.code,
      },
    });

    return await this.getResponse({ prompt });
  }
}
