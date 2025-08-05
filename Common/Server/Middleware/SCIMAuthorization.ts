import ProjectSCIMService from "../Services/ProjectSCIMService";
import StatusPageSCIMService from "../Services/StatusPageSCIMService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import ObjectID from "../../Types/ObjectID";
import ProjectSCIM from "../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../Models/DatabaseModels/StatusPageSCIM";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import BadRequestException from "../../Types/Exception/BadRequestException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export default class SCIMMiddleware {
  @CaptureSpan()
  public static async isAuthorizedSCIMRequest(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      // Extract SCIM ID from URL path (could be project or status page)
      const scimId: string | undefined =
        req.params["projectScimId"] || req.params["statusPageScimId"];
      if (!scimId) {
        throw new BadRequestException("SCIM ID is required");
      }

      // Extract bearer token from Authorization header
      let bearerToken: string | undefined;
      if (req.headers?.["authorization"]) {
        const authHeader: string = req.headers["authorization"] as string;
        if (authHeader.startsWith("Bearer ")) {
          bearerToken = authHeader.substring(7);
        }
      }

      logger.debug(
        `SCIM Authorization: scimId=${scimId}, bearerToken=${
          bearerToken ? "***" : "missing"
        }`,
      );

      if (!bearerToken) {
        throw new NotAuthorizedException(
          "Bearer token is required for SCIM authentication",
        );
      }

      // Try to find Project SCIM configuration first
      const projectScimConfig: ProjectSCIM | null =
        await ProjectSCIMService.findOneBy({
          query: {
            _id: new ObjectID(scimId),
            bearerToken: bearerToken,
          },
          select: {
            _id: true,
            projectId: true,
            autoProvisionUsers: true,
            autoDeprovisionUsers: true,
            teams: {
              _id: true,
              name: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (projectScimConfig) {
        // Store Project SCIM configuration
        oneuptimeRequest.bearerTokenData = {
          scimConfig: projectScimConfig,
          projectId: projectScimConfig.projectId,
          projectScimId: new ObjectID(scimId),
          type: "project-scim",
        };
        return next();
      }

      // If not found, try Status Page SCIM configuration
      const statusPageScimConfig: StatusPageSCIM | null =
        await StatusPageSCIMService.findOneBy({
          query: {
            _id: new ObjectID(scimId),
            bearerToken: bearerToken,
          },
          select: {
            _id: true,
            projectId: true,
            statusPageId: true,
            autoProvisionUsers: true,
            autoDeprovisionUsers: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (statusPageScimConfig) {
        // Store Status Page SCIM configuration
        oneuptimeRequest.bearerTokenData = {
          scimConfig: statusPageScimConfig,
          projectId: statusPageScimConfig.projectId,
          statusPageId: statusPageScimConfig.statusPageId,
          statusPageScimId: new ObjectID(scimId),
          type: "status-page-scim",
        };
        return next();
      }

      // If neither found, throw error
      throw new NotAuthorizedException(
        "Invalid bearer token or SCIM configuration not found",
      );
    } catch (err) {
      return next(err);
    }
  }
}
