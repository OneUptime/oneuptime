import FileService, {
  Service as FileServiceType,
} from "../Services/FileService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import File from "../../Models/DatabaseModels/File";
import FileViewerAccess from "../Utils/File/FileViewerAccess";

// What the image routes read of a file: its bytes, and who may see them.
const SERVED_FILE_SELECT: {
  file: true;
  fileType: true;
  isPublic: true;
  name: true;
  projectId: true;
  createdByUserId: true;
} = {
  file: true,
  fileType: true,
  isPublic: true,
  name: true,
  projectId: true,
  createdByUserId: true,
};

const FILE_NOT_FOUND_MESSAGE: string = "File not found";

export default class FileAPI extends BaseAPI<File, FileServiceType> {
  public constructor() {
    super(File, FileService);

    /*
     * Token-based image route. Used for inline images embedded in
     * markdown (post-mortems, internal notes, etc.) where we don't want
     * the file's ObjectID to be enumerable. A public image is served to
     * anyone; a private one only to the people who may see it - the members
     * of the project it was uploaded in (FileViewerAccess) - and anyone else
     * is answered as for an image that does not exist.
     *
     * Registered before the id-based route so the longer path matches
     * first.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/image/access-token/:token`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const token: string | undefined = req.params["token"];

          if (!token) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException(FILE_NOT_FOUND_MESSAGE),
            );
          }

          const file: File | null = await FileService.findOneBy({
            query: {
              imageAccessToken: token,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
            select: SERVED_FILE_SELECT,
          });

          const image: File | undefined =
            await FileViewerAccess.keepReadableFile({
              req: req,
              file: file,
            });

          if (!image || !image.file || !image.fileType) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException(FILE_NOT_FOUND_MESSAGE),
            );
          }

          FileViewerAccess.setCacheHeaders(res, image);

          return Response.sendFileResponse(req, res, image);
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Legacy id-based image route. Kept for assets that are intentionally
     * public (probe icons, AI agent icons), and serves only public files:
     * an id is no secret, so a private file - an inline image, an
     * attachment - is never served by it, however the request is signed in.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/image/:imageId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const imageId: string = (req.params["imageId"] || "").trim();

          // Not an id: no file has it, and the database is not asked.
          if (!ObjectID.isValidUUID(imageId)) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException(FILE_NOT_FOUND_MESSAGE),
            );
          }

          const file: File | null = await FileService.findOneById({
            id: new ObjectID(imageId),
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
            select: SERVED_FILE_SELECT,
          });

          const icon: File | undefined = FileViewerAccess.keepPublicFile(file);

          if (!icon || !icon.file || !icon.fileType) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException(FILE_NOT_FOUND_MESSAGE),
            );
          }

          FileViewerAccess.setCacheHeaders(res, icon);

          return Response.sendFileResponse(req, res, icon);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
