import ProjectOidcService, {
  Service as ProjectOidcServiceType,
} from "../Services/ProjectOidcService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectOIDC from "../../Models/DatabaseModels/ProjectOidc";

export default class ProjectOidcAPI extends BaseAPI<
  ProjectOIDC,
  ProjectOidcServiceType
> {
  public constructor() {
    super(ProjectOIDC, ProjectOidcService);

    // OIDC Fetch API
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:projectId/oidc-list`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const projectId: ObjectID = new ObjectID(
            req.params["projectId"] as string,
          );

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid project id."),
            );
          }

          const oidc: Array<ProjectOIDC> = await this.service.findBy({
            query: {
              projectId: projectId,
              isEnabled: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              name: true,
              description: true,
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

          return Response.sendEntityArrayResponse(
            req,
            res,
            oidc,
            new PositiveNumber(oidc.length),
            ProjectOIDC,
          );
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
