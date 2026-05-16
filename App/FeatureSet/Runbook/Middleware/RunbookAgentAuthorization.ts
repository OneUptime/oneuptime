import { RunbookAgentExpressRequest } from "../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunbookAgentService from "Common/Server/Services/RunbookAgentService";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";

export default class RunbookAgentAuthorization {
  public static async isAuthorizedAgent(
    req: RunbookAgentExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const data: JSONObject = (req.body as JSONObject) || {};

    const agentIdRaw: unknown = data["agentId"] ?? req.headers["x-agent-id"];
    const agentKeyRaw: unknown = data["agentKey"] ?? req.headers["x-agent-key"];

    if (
      typeof agentIdRaw !== "string" ||
      typeof agentKeyRaw !== "string" ||
      !agentIdRaw ||
      !agentKeyRaw
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("agentId or agentKey is missing"),
      );
    }

    let agentId: ObjectID;
    try {
      agentId = new ObjectID(agentIdRaw);
    } catch {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("agentId is not a valid identifier"),
      );
    }

    const agent: RunbookAgent | null = await RunbookAgentService.findByIdAndKey(
      {
        agentId,
        agentKey: agentKeyRaw,
      },
    );

    if (!agent) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid agentId or agentKey"),
      );
    }

    req.runbookAgent = agent;
    return next();
  }
}
