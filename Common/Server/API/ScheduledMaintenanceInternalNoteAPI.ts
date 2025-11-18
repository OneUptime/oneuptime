import ScheduledMaintenanceInternalNote from "../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import ScheduledMaintenanceInternalNoteService, {
  Service as ScheduledMaintenanceInternalNoteServiceType,
} from "../Services/ScheduledMaintenanceInternalNoteService";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";

export default class ScheduledMaintenanceInternalNoteAPI extends BaseAPI<
  ScheduledMaintenanceInternalNote,
  ScheduledMaintenanceInternalNoteServiceType
> {
  public constructor() {
    super(
      ScheduledMaintenanceInternalNote,
      ScheduledMaintenanceInternalNoteService,
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/attachment/:noteId/:fileId`,
      UserMiddleware.getUserMiddleware,
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
    const noteIdParam: string | undefined = req.params["noteId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (!noteIdParam || !fileIdParam) {
      throw new NotFoundException("Attachment not found");
    }

    let noteId: ObjectID;
    let fileId: ObjectID;

    try {
      noteId = new ObjectID(noteIdParam);
      fileId = new ObjectID(fileIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const note: ScheduledMaintenanceInternalNote | null =
      await this.service.findOneBy({
        query: {
          _id: noteId,
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

    const attachment: File | undefined = note?.attachments?.find(
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

    this.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }

  private setNoCacheHeaders(res: ExpressResponse): void {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}
