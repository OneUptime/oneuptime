import StatusPageAnnouncement from "../../Models/DatabaseModels/StatusPageAnnouncement";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import StatusPageAnnouncementService, {
  Service as StatusPageAnnouncementServiceType,
} from "../Services/StatusPageAnnouncementService";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";

export default class StatusPageAnnouncementAPI extends BaseAPI<
  StatusPageAnnouncement,
  StatusPageAnnouncementServiceType
> {
  public constructor() {
    super(StatusPageAnnouncement, StatusPageAnnouncementService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/attachment/:announcementId/:fileId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAttachment(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async getAttachment(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const announcementIdParam: string | undefined =
      req.params["announcementId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (!announcementIdParam || !fileIdParam) {
      throw new NotFoundException("Attachment not found");
    }

    let announcementId: ObjectID;
    let fileId: ObjectID;

    try {
      announcementId = new ObjectID(announcementIdParam);
      fileId = new ObjectID(fileIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const announcement: StatusPageAnnouncement | null =
      await this.service.findOneBy({
        query: {
          _id: announcementId,
        },
        select: {
          attachments: {
            _id: true,
            file: true,
            fileType: true,
            name: true,
          },
        },
        props,
      });

    const attachment: File | undefined = announcement?.attachments?.find(
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
