import Incident from "../../Models/DatabaseModels/Incident";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import IncidentService, {
  Service as IncidentServiceType,
} from "../Services/IncidentService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default class IncidentAPI extends BaseAPI<Incident, IncidentServiceType> {
  public constructor() {
    super(Incident, IncidentService);

    this.router.get(
      `${new this
        .entityType()
        .getCrudApiPath()
        ?.toString()}/postmortem/attachment/:projectId/:incidentId/:fileId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getPostmortemAttachment(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async getPostmortemAttachment(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const projectIdParam: string | undefined = req.params["projectId"];
    const incidentIdParam: string | undefined = req.params["incidentId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (!projectIdParam || !incidentIdParam || !fileIdParam) {
      throw new NotFoundException("Attachment not found");
    }

    let incidentId: ObjectID;
    let fileId: ObjectID;
    let projectId: ObjectID;

    try {
      incidentId = new ObjectID(incidentIdParam);
      fileId = new ObjectID(fileIdParam);
      projectId = new ObjectID(projectIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const incident: Incident | null = await this.service.findOneBy({
      query: {
        _id: incidentId,
        projectId,
      },
      select: {
        postmortemAttachments: {
          _id: true,
          file: true,
          fileType: true,
          name: true,
        },
      },
      props,
    });

    if (!incident) {
      throw new NotFoundException("Attachment not found");
    }

    const attachment: File | undefined = incident.postmortemAttachments?.find(
      (file: File) => {
        const attachmentId: string | null = file._id
          ? file._id.toString()
          : file.id
            ? file.id.toString()
            : null;
        return attachmentId === fileId.toString();
      },
    );

    if (!attachment || !attachment.file) {
      throw new NotFoundException("Attachment not found");
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }
}
