import UserMiddleware from "../Middleware/UserAuthorization";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
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
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../Models/DatabaseModels/AIAgent";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import Version from "../../Types/Version";
import { isShippedSecretValue } from "../EnvironmentConfig";

/*
 * The agent key a global AI agent registers and authenticates with is the
 * in-cluster Runner's ONEUPTIME_RUNNER_KEY. A value this repository ships for
 * it is public (unset, "secret" or a config.example.env placeholder), so it
 * proves nothing: it is refused at registration and on the heartbeat, which
 * is what stops anyone who knows the public value from acting as the shared
 * Runner for every project. A real key is a long random value.
 */
const SHIPPED_AI_AGENT_KEY_MESSAGE: string =
  "aiAgentKey is a value the OneUptime repository ships, which is public, so it is refused. Set ONEUPTIME_RUNNER_KEY to a long random value on the in-cluster Runner.";

export default class AIAgentAPI extends BaseAPI<AIAgent, AIAgentServiceType> {
  public constructor() {
    super(AIAgent, AIAgentService);

    /*
     * Register Global AI Agent: the in-cluster Runner, which proves it is
     * one of the installation's own services with the cluster key. Custom
     * AI Agent can be registered via dashboard.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/register`,
      ClusterKeyAuthorization.isAuthorizedRunnerRegistrationMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const data: JSONObject = req.body;

          if (!data["aiAgentKey"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("aiAgentKey is missing"),
            );
          }

          const aiAgentKey: string = data["aiAgentKey"] as string;

          if (isShippedSecretValue(aiAgentKey)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(SHIPPED_AI_AGENT_KEY_MESSAGE),
            );
          }

          const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
            query: {
              key: aiAgentKey,
              isGlobalAIAgent: true,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

          const defaultDescription: string =
            "AI-powered agent that analyzes and resolves code issues, triages incidents and alerts, and helps automate operational workflows.";

          if (aiAgent) {
            await AIAgentService.updateOneById({
              id: aiAgent.id!,
              data: {
                name: (data["aiAgentName"] as string) || "Global AI Agent",
                description:
                  (data["aiAgentDescription"] as string) || defaultDescription,
                lastAlive: OneUptimeDate.getCurrentDate(),
                connectionStatus: AIAgentConnectionStatus.Connected,
              },
              props: {
                isRoot: true,
              },
            });

            return Response.sendJsonObjectResponse(req, res, {
              _id: aiAgent._id?.toString(),
              message: "AI Agent already registered",
            });
          }

          let newAIAgent: AIAgent = new AIAgent();
          newAIAgent.isGlobalAIAgent = true;
          newAIAgent.key = aiAgentKey;
          newAIAgent.name =
            (data["aiAgentName"] as string) || "Global AI Agent";
          newAIAgent.description =
            (data["aiAgentDescription"] as string) || defaultDescription;
          newAIAgent.lastAlive = OneUptimeDate.getCurrentDate();
          newAIAgent.connectionStatus = AIAgentConnectionStatus.Connected;
          newAIAgent.aiAgentVersion = new Version("1.0.0");

          newAIAgent = await AIAgentService.create({
            data: newAIAgent,
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            _id: newAIAgent._id?.toString(),
            message: "AI Agent registered successfully",
          });
        } catch (err) {
          return next(err);
        }
      },
    );

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

          const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
            query: {
              _id: aiAgentId.toString(),
              key: aiAgentKey,
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

    /*
     * The shared global AI agents: their name, description and status, read
     * as OneUptime, for anyone signed in. The AI agent table itself is read
     * by a project's own members only.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-ai-agents`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
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
