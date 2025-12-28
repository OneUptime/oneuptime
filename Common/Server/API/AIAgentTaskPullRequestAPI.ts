import AIAgentTaskPullRequestService, {
  Service as AIAgentTaskPullRequestServiceType,
} from "../Services/AIAgentTaskPullRequestService";
import BaseAPI from "./BaseAPI";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";

export default class AIAgentTaskPullRequestAPI extends BaseAPI<
  AIAgentTaskPullRequest,
  AIAgentTaskPullRequestServiceType
> {
  public constructor() {
    super(AIAgentTaskPullRequest, AIAgentTaskPullRequestService);
  }
}
