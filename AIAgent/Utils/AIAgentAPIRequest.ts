import { AI_AGENT_KEY } from "../Config";
import AIAgentUtil from "./AIAgent";
import { JSONObject } from "Common/Types/JSON";

export default class AIAgentAPIRequest {
  public static getDefaultRequestBody(): JSONObject {
    return {
      aiAgentKey: AI_AGENT_KEY,
      aiAgentId: AIAgentUtil.getAIAgentId().toString(),
    };
  }
}
