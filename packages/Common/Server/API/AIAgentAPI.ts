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
import WrongComponentKeyLimit, {
  ComponentKeyKind,
} from "../Utils/RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "../Utils/RateLimit/WrongKeyLimit";

/*
 * The agent key a global AI agent registers and authenticates with is the
 * in-cluster Runner's ONEUPTIME_RUNNER_KEY. A value this repository ships for
 * it (unset, "secret" or a config.example.env placeholder) proves nothing, so
 * it is refused at registration and on the heartbeat: only the installation's
 * own Runner, with a long random key, is the global agent every project
 * shares.
 */
const SHIPPED_AI_AGENT_KEY_MESSAGE: string =
  "aiAgentKey is a value the OneUptime repository ships, which is public, so it is refused. Set ONEUPTIME_RUNNER_KEY to a long random value on the in-cluster Runner.";

export default class AIAgentAPI extends BaseAPI<AIAgent, AIAgentServiceType> {
  public constructor() {
    super(AIAgent, AIAgentService);

    /*
     * Register Global AI Agent: the installation's shared Runner, which
     * proves it is that Runner with its own key, the one the app holds too
     * - or, a Runner of an earlier release, with the cluster key
     * (ClusterKeyAuthorization.isAuthorizedRunnerRegistrationMiddleware).
     * Custom AI Agent can be registered via dashboard.
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

          const registeredAIAgent: AIAgent | null =
            await AIAgentService.findOneBy({
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

          /*
           * No global agent holds this key. A Runner that ran on the key
           * config.example.env ships comes back under the random
           * ONEUPTIME_RUNNER_KEY npm start gave it, and the agent it ran as
           * is refused from then on: it takes that agent over, so it stays
           * the one global agent rather than a second one appearing beside
           * an agent that can never report in again. A global agent whose
           * key is the installation's own is never taken over
           * (ShippedKeyTakeover).
           */
          const aiAgentToTakeOver: AIAgent | null = registeredAIAgent
            ? null
            : await AIAgentService.findGlobalAIAgentToTakeOver({
                presentedKey: aiAgentKey,
              });

          const aiAgent: AIAgent | null =
            registeredAIAgent || aiAgentToTakeOver;

          const defaultDescription: string =
            "AI-powered agent that analyzes and resolves code issues, triages incidents and alerts, and helps automate operational workflows.";

          if (aiAgent) {
            await AIAgentService.updateOneById({
              id: aiAgent.id!,
              data: {
                ...(aiAgentToTakeOver ? { key: aiAgentKey } : {}),
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
