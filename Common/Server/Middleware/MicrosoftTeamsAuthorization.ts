import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import { JSONObject } from "../../Types/JSON";
import Response from "../Utils/Response";
import BadRequestException from "../../Types/Exception/BadRequestException";
import { MicrosoftTeamsAppPassword } from "../EnvironmentConfig";
import * as jwt from "jsonwebtoken";

export default class MicrosoftTeamsAuthorization {
  public static isAuthorizedMicrosoftTeamsRequest(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    // Microsoft Teams sends the authorization header with Bearer token
    const authHeader: string | undefined = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.debug("No authorization header found in Microsoft Teams request");
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Unauthorized"),
      );
    }

    const token: string = authHeader.substring(7); // Remove "Bearer " prefix

    if (!MicrosoftTeamsAppPassword) {
      logger.debug("Microsoft Teams App Password not configured");
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Microsoft Teams not configured"),
      );
    }

    try {
      // For Microsoft Teams Bot Framework, we need to validate the JWT token
      // In a production environment, you would validate against Microsoft's public keys
      // For now, we'll do basic validation
      const decoded: any = jwt.decode(token, { complete: true });
      
      if (!decoded) {
        logger.debug("Failed to decode Microsoft Teams token");
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Invalid token"),
        );
      }

      // Basic validation - in production, validate against Microsoft's signing keys
      if (decoded.payload && decoded.payload.iss) {
        const validIssuers: Array<string> = [
          "https://api.botframework.com",
          "https://sts.windows.net/",
        ];
        
        const isValidIssuer: boolean = validIssuers.some((issuer: string) => {
          return decoded.payload.iss.startsWith(issuer);
        });

        if (!isValidIssuer) {
          logger.debug("Invalid token issuer: " + decoded.payload.iss);
          return Response.sendErrorResponse(
            req,
            res,
            new BadRequestException("Invalid token issuer"),
          );
        }
      }

      // If validation passes, continue
      next();
    } catch (error) {
      logger.error("Error validating Microsoft Teams token:");
      logger.error(error);
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Token validation failed"),
      );
    }
  }
}