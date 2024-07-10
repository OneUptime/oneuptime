import BadDataException from "Common/Types/Exception/BadDataException";
import { GetLlmType } from "../../Config";
import LlmType from "../../Types/LlmType";
import LlmBase, { CopilotPromptResult } from "./LLMBase";
import LLMServer from "./LLMServer";
import { CopilotActionPrompt } from "../CopilotActions/CopilotActionsBase";
import OpenAI from "./OpenAI";

export default class LLM extends LlmBase {
  public static override async getResponse(
    data: CopilotActionPrompt,
  ): Promise<CopilotPromptResult> {
    if (GetLlmType() === LlmType.LLM) {
      return await LLMServer.getResponse(data);
    }

    if(GetLlmType() === LlmType.OpenAI) {
      return await OpenAI.getResponse(data);
    }

    throw new BadDataException("Invalid LLM type");
  }
}
