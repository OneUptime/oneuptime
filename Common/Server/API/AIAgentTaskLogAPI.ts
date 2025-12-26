import AIAgentTaskLogService, {
  Service as AIAgentTaskLogServiceType,
} from "../Services/AIAgentTaskLogService";
import BaseAPI from "./BaseAPI";
import AIAgentTaskLog from "../../Models/DatabaseModels/AIAgentTaskLog";

export default class AIAgentTaskLogAPI extends BaseAPI<
  AIAgentTaskLog,
  AIAgentTaskLogServiceType
> {
  public constructor() {
    super(AIAgentTaskLog, AIAgentTaskLogService);
  }
}
