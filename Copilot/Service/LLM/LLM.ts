import BadDataException from "Common/Types/Exception/BadDataException";
import { GetLlmType } from "../../Config";
import LlmType from "../../Types/LlmType";
import LlmBase, { CopilotPromptResult } from "./LLMBase";
import LLMServer from "./LLMServer";

import OpenAI from "./OpenAI";
import { CopilotActionPrompt } from "../CopilotActions/Types";

export default class LLM extends LlmBase {
  public static override async getResponse(
    data: CopilotActionPrompt,
  ): Promise<CopilotPromptResult> {
    if (GetLlmType() === LlmType.ONEUPTIME_LLM) {
      return await LLMServer.getResponse(data);
    }

    if (GetLlmType() === LlmType.OpenAI) {
      return await OpenAI.getResponse(data);
    }

    throw new BadDataException("Invalid LLM type");
  }
}
