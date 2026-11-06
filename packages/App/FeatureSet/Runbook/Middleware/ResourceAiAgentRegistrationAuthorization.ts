import { ResourceAiAgentRegistrationRequest } from "../Types/Request";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import CloudAiAgentKeyAuthenticator, {
  CloudAiAgentKeyAuthentication,
} from "Common/Server/Utils/CloudConnection/CloudAiAgentKeyAuthentication";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { isCloudAiAgentKey } from "Common/Types/CloudConnection/CloudAiAgentKey";
import OneUptimeDate from "Common/Types/Date";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

/*
 * Who may register a resource AI agent (POST
 * /resource-ai-agent-ingest/register), by the key in x-oneuptime-token:
 *
 *   - a Cloud AI agent's own key (Types/CloudConnection/CloudAiAgentKey):
 *     checked against its account's keys (CloudAiAgentKeyAuthenticator).
 *     The request then registers that account's agent and nothing else:
 *     the project and the account come from the key, and the registration
 *     refuses any other resource;
 *   - anything else: the project's telemetry ingestion key, through the
 *     resource AI agent surface's guard (TelemetryIngest), as every other
 *     resource AI agent and the Cloud AI agents set up before keys of their
 *     own register.
 *
 * A Cloud AI agent key is never an ingestion key: no other route reads it,
 * so it sends no telemetry and registers nothing else.
 */
export default class ResourceAiAgentRegistrationAuthorization {
  public static async authorize(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const token: unknown = ResourceAiAgentRegistrationAuthorization.readToken(
        req,
      );

      if (!isCloudAiAgentKey(token)) {
        return await TelemetryIngest.forSurface(
          TelemetryIngestSurface.ResourceAiAgent,
        )(req, res, next);
      }

      const result: CloudAiAgentKeyAuthentication =
        await CloudAiAgentKeyAuthenticator.authenticate({
          key: token,
          now: OneUptimeDate.getCurrentDate(),
        });

      if (!result.isAuthorized) {
        if (
          result.retryAfterSeconds !== undefined &&
          typeof res.setHeader === "function"
        ) {
          res.setHeader("Retry-After", String(result.retryAfterSeconds));
        }

        return Response.sendErrorResponse(
          req,
          res,
          result.status === 429
            ? new TooManyRequestsException(result.message)
            : new NotAuthenticatedException(result.message),
        );
      }

      const registration: ResourceAiAgentRegistrationRequest =
        req as ResourceAiAgentRegistrationRequest;

      registration.projectId = result.projectId;
      registration.cloudAiAgentKey = {
        cloudAccountId: result.cloudAccountId,
        keyHash: result.keyHash,
        match: result.match,
      };

      return next();
    } catch (err) {
      return next(err);
    }
  }

  // The key as TelemetryIngest reads it: the first of its three headers set.
  public static readToken(req: ExpressRequest): unknown {
    for (const header of [
      "x-oneuptime-token",
      "x-oneuptime-service-token",
      "x-oneuptime-ingestion-key",
    ]) {
      const value: unknown = req.headers[header];

      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }

    return undefined;
  }
}
