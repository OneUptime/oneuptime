import BadDataException from "Common/Types/Exception/BadDataException";
import { GetLlmType } from "../../Config";
import LlmType from "../../Types/LLmType";
import LlmBase from "./LLMBase";
import Llama from "./Llama";
import CopilotEventType from "Common/Types/Copilot/CopilotEventType";

export default class LLM extends LlmBase {
  public static override async getResponse(data: {
    prompt: string;
  }): Promise<string> {
    if (GetLlmType() === LlmType.Llama) {
      return await Llama.getResponse(data);
    }

    throw new BadDataException("Invalid LLM type");
  }

  public static override async getResponseByEventType(data: {
    copilotEventType: CopilotEventType;
    code: string;
  }): Promise<string> {
    if (GetLlmType() === LlmType.Llama) {
      return await Llama.getResponseByEventType(data);
    }

    throw new BadDataException("Invalid LLM type");
  }
}
