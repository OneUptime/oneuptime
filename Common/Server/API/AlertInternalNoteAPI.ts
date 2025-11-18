import AlertInternalNote from "../../Models/DatabaseModels/AlertInternalNote";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import AlertInternalNoteService, {
  Service as AlertInternalNoteServiceType,
} from "../Services/AlertInternalNoteService";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";

export default class AlertInternalNoteAPI extends BaseAPI<
  AlertInternalNote,
  AlertInternalNoteServiceType
> {
  public constructor() {
    super(AlertInternalNote, AlertInternalNoteService);

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
    } catch (error) {
      throw new NotFoundException("Attachment not found");
    }

    const props = await CommonAPI.getDatabaseCommonInteractionProps(req);

    const note: AlertInternalNote | null = await this.service.findOneBy({
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

    const attachment = note?.attachments?.find((file) => {
      const attachmentId: string | null = file._id
        ? file._id.toString()
        : file.id
          ? file.id.toString()
          : null;
      return attachmentId === fileId.toString();
    });

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
