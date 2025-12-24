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
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

export default class AIAgentAPI extends BaseAPI<AIAgent, AIAgentServiceType> {
  public constructor() {
    super(AIAgent, AIAgentService);

    // Alive endpoint for AI Agent heartbeat
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/alive`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          if (!data["aiAgentId"] || !data["aiAgentKey"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("aiAgentId or aiAgentKey is missing"),
            );
          }

          const aiAgentId: ObjectID = new ObjectID(data["aiAgentId"] as string);
          const aiAgentKey: string = data["aiAgentKey"] as string;

          const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
            query: {
              _id: aiAgentId.toString(),
              secretKey: aiAgentKey,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          // Update last alive
          await AIAgentService.updateLastAlive(aiAgentId);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

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
