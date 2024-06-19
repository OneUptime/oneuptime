import CopilotEventType from "Common/Types/Copilot/CopilotEventType";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import PromptsUtil from "../../Utils/Prompts";

export default class LlmBase {
  public static async getResponse(_data: { prompt: string }): Promise<string> {
    throw new NotImplementedException();
  }

  public static async getResponseByEventType(data: {
    copilotEventType: CopilotEventType;
    code: string;
  }): Promise<string> {
    const prompt = await PromptsUtil.getPrompt({
      copilotEventType: data.copilotEventType,
      vars: {
        code: data.code,
      },
    });

    return await this.getResponse({ prompt });
  }
}
