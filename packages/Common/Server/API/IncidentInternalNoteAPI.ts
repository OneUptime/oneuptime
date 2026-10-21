import IncidentInternalNote from "../../Models/DatabaseModels/IncidentInternalNote";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import IncidentInternalNoteService, {
  Service as IncidentInternalNoteServiceType,
} from "../Services/IncidentInternalNoteService";
import Response from "../Utils/Response";
import FileOwnership from "../Utils/File/FileOwnership";
import BaseAPI from "./BaseAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";

export default class IncidentInternalNoteAPI extends BaseAPI<
  IncidentInternalNote,
  IncidentInternalNoteServiceType
> {
  public constructor() {
    super(IncidentInternalNote, IncidentInternalNoteService);

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

    const note: IncidentInternalNote | null = await this.service.findOneBy({
      query: {
        _id: noteId,
      },
      select: {
        projectId: true,
        attachments: {
          _id: true,
          file: true,
          fileType: true,
          name: true,
        },
      },
      props,
    });

    // One of its files, uploaded in its own project.
    const attachment: File | undefined =
      await FileOwnership.findProjectAttachment({
        files: note?.attachments,
        fileId: fileId,
        projectId: note?.projectId,
      });

    if (!attachment) {
      throw new NotFoundException("Attachment not found");
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }
}
