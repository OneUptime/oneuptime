import ProjectSCIMService from "../Services/ProjectSCIMService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import ObjectID from "../../Types/ObjectID";
import ProjectSCIM from "../../Models/DatabaseModels/ProjectSCIM";
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

      // Extract project SCIM ID from URL path
      const projectScimId: string | undefined = req.params["projectScimId"];
      if (!projectScimId) {
        throw new BadRequestException("Project SCIM ID is required");
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
        `SCIM Authorization: projectScimId=${projectScimId}, bearerToken=${
          bearerToken
        }`,
      );

      if (!bearerToken) {
        throw new NotAuthorizedException(
          "Bearer token is required for SCIM authentication",
        );
      }

      // Find SCIM configuration by SCIM ID and bearer token
      const scimConfig: ProjectSCIM | null = await ProjectSCIMService.findOneBy(
        {
          query: {
            _id: new ObjectID(projectScimId),
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
        },
      );

      if (!scimConfig) {
        throw new NotAuthorizedException(
          "Invalid bearer token or SCIM configuration not found",
        );
      }

      // Store SCIM configuration and project ID in bearerTokenData for use in handlers
      oneuptimeRequest.bearerTokenData = {
        scimConfig: scimConfig,
        projectId: scimConfig.projectId,
        projectScimId: new ObjectID(projectScimId),
        type: "scim",
      };

      return next();
    } catch (err) {
      return next(err);
    }
  }
}
