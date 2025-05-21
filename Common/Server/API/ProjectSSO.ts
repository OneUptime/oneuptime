import ProjectSsoService, {
  Service as ProjectSsoServiceType,
} from "../Services/ProjectSsoService";
import { ExpressRequest, ExpressResponse } from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectSSO from "../../Models/DatabaseModels/ProjectSso";

export default class ProjectSsoAPI extends BaseAPI<
  ProjectSSO,
  ProjectSsoServiceType
> {
  public constructor() {
    super(ProjectSSO, ProjectSsoService);

    // SSO Fetch API
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:projectId/sso-list`,
      async (req: ExpressRequest, res: ExpressResponse) => {
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

        const sso: Array<ProjectSSO> = await this.service.findBy({
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
          sso,
          new PositiveNumber(sso.length),
          ProjectSSO,
        );
      },
    );
  }
}
