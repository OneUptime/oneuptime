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
import AIAgent from "../../Models/DatabaseModels/AIAgent";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isShippedSecretValue } from "../EnvironmentConfig";
import { GLOBAL_AI_AGENT_GONE_MESSAGE } from "../../Types/Runner/GlobalAIAgentsGone";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
} from "../Utils/RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "../Utils/RateLimit/WrongKeyLimit";

/*
 * A value this repository ships (unset, "secret" or a config.example.env
 * placeholder) proves nothing as an agent key, so the heartbeat refuses it
 * before any row is read. An agent's real key is a long random value the
 * server made.
 */
const SHIPPED_AI_AGENT_KEY_MESSAGE: string =
  "aiAgentKey is a value the OneUptime repository ships, which is public, so it is refused.";

/*
 * The AI agents a project created before Runners replaced the agent
 * container. A Runner started with such an agent's id and key checks in
 * here (RegisterRunner's fallback for credentials from before Runners) and
 * takes the project's code-fix work as it always did. Nothing registers an
 * agent any more: the shared Runner that registered as the installation's
 * global AI agent is gone, and global Runners take its work.
 */
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

          if (isShippedSecretValue(aiAgentKey)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(SHIPPED_AI_AGENT_KEY_MESSAGE),
            );
          }

          /*
           * A client that sent too many different wrong keys for this agent
           * is refused before its key is looked up (WrongComponentKeyLimit).
           */
          const refusedBeforeLookup: WrongKeyRefusal | null =
            await WrongComponentKeyLimit.checkBeforeLookup({
              req: req,
              kind: ComponentKeyKind.Agent,
              componentId: aiAgentId.toString(),
            });

          if (refusedBeforeLookup) {
            return WrongComponentKeyLimit.answerRefusal(
              req,
              res,
              ComponentKeyKind.Agent,
              refusedBeforeLookup,
            );
          }

          const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
            query: {
              _id: aiAgentId.toString(),
              key: aiAgentKey,
            },
            select: {
              _id: true,
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          /*
           * Too many different wrong keys for this agent from this client:
           * refused, whichever key this request carries
           * (WrongComponentKeyLimit).
           */
          const refusal: WrongKeyRefusal | null =
            await WrongComponentKeyLimit.checkComponentKey({
              req: req,
              kind: ComponentKeyKind.Agent,
              componentId: aiAgentId.toString(),
              presentedKey: aiAgentKey,
              isKeyRight: Boolean(aiAgent),
              componentExists: async (): Promise<boolean> => {
                return await AIAgentService.hasAIAgentWithId(aiAgentId);
              },
            });

          if (refusal) {
            return WrongComponentKeyLimit.answerRefusal(
              req,
              res,
              ComponentKeyKind.Agent,
              refusal,
            );
          }

          if (!aiAgent) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid AI Agent ID or AI Agent Key"),
            );
          }

          /*
           * An AI agent with no project is a global AI agent - the shared
           * Runner's registration, or one a master admin added on the
           * removed Global AI Agents page - which global Runners replaced:
           * it proves nothing on the code-fix routes (CodeFixAgentAuth).
           * Its key is right, so it is never counted as a wrong one, but a
           * Runner started with it is told what to start instead, rather
           * than coming up to fail every request (GlobalAIAgentsGone).
           */
          if (!aiAgent.projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(GLOBAL_AI_AGENT_GONE_MESSAGE),
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
  }
}
