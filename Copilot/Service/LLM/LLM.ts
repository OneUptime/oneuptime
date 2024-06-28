import BadDataException from "Common/Types/Exception/BadDataException";
import { GetLlmType } from "../../Config";
import LlmType from "../../Types/LlmType";
import LlmBase, { CopilotPromptResult } from "./LLMBase";
import Llama from "./Llama";
import { CopilotActionPrompt } from "../CopilotActions/CopilotActionsBase";

export default class LLM extends LlmBase {
  public static override async getResponse(
    data: CopilotActionPrompt,
  ): Promise<CopilotPromptResult> {
    if (GetLlmType() === LlmType.Llama) {
      return await Llama.getResponse(data);
    }

    throw new BadDataException("Invalid LLM type");
  }
}
