import { RunnerExpressRequest } from "../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunnerService from "Common/Server/Services/RunnerService";
import UUIDColumnFilter from "Common/Server/Types/Database/UUIDColumnFilter";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
} from "Common/Server/Utils/RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "Common/Server/Utils/RateLimit/WrongKeyLimit";
import Runner from "Common/Models/DatabaseModels/Runner";

/*
 * Authenticates every runbook protocol request (/runner-ingest) by the
 * Runner's id and key, from the body or the x-agent-id / x-agent-key
 * headers. A client may present only so many different wrong keys for one
 * Runner: after that, its requests for that Runner are refused until its
 * window ends, whichever key they carry (WrongComponentKeyLimit). A Runner
 * that still holds the key it had before a reset sends that one key, so it
 * is never refused for it.
 *
 * Every request is answered. An id that is not one is refused before the
 * Runner table is read, and anything that fails on the way - a lookup, a
 * busy database - is handed to the app's error handler: Express 4 does not
 * wait on the promise an async middleware returns, so a rejection here would
 * otherwise leave the request open with no answer at all.
 */
export default class RunnerAuthorization {
  public static async isAuthorizedAgent(
    req: RunnerExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data: JSONObject = (req.body as JSONObject) || {};

      const agentIdRaw: unknown = data["agentId"] ?? req.headers["x-agent-id"];
      const agentKeyRaw: unknown =
        data["agentKey"] ?? req.headers["x-agent-key"];

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

      // Any spelling Postgres reads as an id, and nothing else.
      if (!UUIDColumnFilter.isUUIDText(agentIdRaw)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("agentId is not a valid identifier"),
        );
      }

      const agentId: ObjectID = new ObjectID(agentIdRaw);

      const agent: Runner | null = await RunnerService.findByIdAndKey({
        agentId,
        agentKey: agentKeyRaw,
      });

      const refusal: WrongKeyRefusal | null =
        await WrongComponentKeyLimit.checkComponentKey({
          req: req,
          kind: ComponentKeyKind.Agent,
          componentId: agentId.toString(),
          presentedKey: agentKeyRaw,
          isKeyRight: Boolean(agent),
          componentExists: async (): Promise<boolean> => {
            return await RunnerService.hasRunnerWithId(agentId);
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

      if (!agent) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid agentId or agentKey"),
        );
      }

      req.runner = agent;
      return next();
    } catch (err) {
      return next(err);
    }
  }
}
