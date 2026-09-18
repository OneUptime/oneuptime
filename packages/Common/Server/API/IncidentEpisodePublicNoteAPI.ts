import IncidentEpisodePublicNote from "../../Models/DatabaseModels/IncidentEpisodePublicNote";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import IncidentEpisodePublicNoteService, {
  Service as IncidentEpisodePublicNoteServiceType,
} from "../Services/IncidentEpisodePublicNoteService";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default class IncidentEpisodePublicNoteAPI extends BaseAPI<
  IncidentEpisodePublicNote,
  IncidentEpisodePublicNoteServiceType
> {
  public constructor() {
    super(IncidentEpisodePublicNote, IncidentEpisodePublicNoteService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/attachment/:projectId/:noteId/:fileId`,
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

    const note: IncidentEpisodePublicNote | null = await this.service.findOneBy(
      {
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
      },
    );

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

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }
}
