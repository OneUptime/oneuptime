import { RunnerExpressRequest } from "../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunnerService from "Common/Server/Services/RunnerService";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Runner from "Common/Models/DatabaseModels/Runner";

export default class RunnerAuthorization {
  public static async isAuthorizedAgent(
    req: RunnerExpressRequest,
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

    const agent: Runner | null = await RunnerService.findByIdAndKey({
      agentId,
      agentKey: agentKeyRaw,
    });

    if (!agent) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid agentId or agentKey"),
      );
    }

    req.runner = agent;
    return next();
  }
}
