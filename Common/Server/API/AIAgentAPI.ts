import UserMiddleware from "../Middleware/UserAuthorization";
import AIAgentService, {
  Service as AIAgentServiceType,
} from "../Services/AIAgentService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PositiveNumber from "../../Types/PositiveNumber";
import AIAgent from "../../Models/DatabaseModels/AIAgent";

export default class AIAgentAPI extends BaseAPI<AIAgent, AIAgentServiceType> {
  public constructor() {
    super(AIAgent, AIAgentService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-ai-agents`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const aiAgents: Array<AIAgent> = await AIAgentService.findBy({
            query: {
              isGlobalAIAgent: true,
            },
            select: {
              name: true,
              description: true,
              lastAlive: true,
              iconFileId: true,
              connectionStatus: true,
            },
            props: {
              isRoot: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
          });

          return Response.sendEntityArrayResponse(
            req,
            res,
            aiAgents,
            new PositiveNumber(aiAgents.length),
            AIAgent,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
