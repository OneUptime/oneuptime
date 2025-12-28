import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import LocalCache from "Common/Server/Infrastructure/LocalCache";

export default class AIAgentUtil {
  public static getAIAgentId(): ObjectID {
    const id: string | undefined =
      LocalCache.getString("AI_AGENT", "AI_AGENT_ID") ||
      process.env["AI_AGENT_ID"];

    if (!id) {
      throw new BadDataException("AI Agent ID not found");
    }

    return new ObjectID(id);
  }
}
