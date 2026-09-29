import { ResourceAiAgentExpressRequest } from "../Types/Request";
import ResourceAiAgent from "Common/Models/DatabaseModels/ResourceAiAgent";
import ResourceAiAgentService from "Common/Server/Services/ResourceAiAgentService";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import { JSONObject } from "Common/Types/JSON";

/*
 * Authenticates every /resource-ai-agent-ingest request after
 * registration: the agent id and key from the body (or the x-agent-id /
 * x-agent-key headers), checked against the agent row's key hash.
 *
 * Every failure is a 401 with a JSON { message }: a missing pair, an
 * unknown id, a wrong key, and a key that stopped working because an admin
 * reset the agent or a newer registration rotated it. The agent answers
 * repeated 401s by registering again, which is how a reset agent comes
 * back on its own.
 */
export default class ResourceAiAgentAuthorization {
  public static readonly MISSING_CREDENTIALS_MESSAGE: string =
    "agentId and agentKey are required.";

  public static readonly INVALID_CREDENTIALS_MESSAGE: string =
    "This resource AI agent's id or key is not valid (the agent may have been reset or registered again). Register again.";

  public static async isAuthorizedAgent(
    req: ResourceAiAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const body: JSONObject = (req.body as JSONObject) || {};

    const agentId: unknown = body["agentId"] ?? req.headers["x-agent-id"];
    const agentKey: unknown = body["agentKey"] ?? req.headers["x-agent-key"];

    if (
      typeof agentId !== "string" ||
      typeof agentKey !== "string" ||
      !agentId ||
      !agentKey
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          ResourceAiAgentAuthorization.MISSING_CREDENTIALS_MESSAGE,
        ),
      );
    }

    let agent: ResourceAiAgent | null;

    try {
      agent = await ResourceAiAgentService.authenticate({
        agentId,
        agentKey,
      });
    } catch (err) {
      return next(err);
    }

    if (!agent) {
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          ResourceAiAgentAuthorization.INVALID_CREDENTIALS_MESSAGE,
        ),
      );
    }

    req.resourceAiAgent = agent;

    return next();
  }
}
