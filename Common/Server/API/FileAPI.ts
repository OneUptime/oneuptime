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
import UserMiddleware from "../Middleware/UserAuthorization";
import JSONWebToken from "../Utils/JsonWebToken";
import logger from "../Utils/Logger";

const isAuthenticatedRequest: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  const accessToken: string | undefined =
    UserMiddleware.getAccessTokenFromExpressRequest(req);
  if (!accessToken) {
    return false;
  }
  try {
    const decoded: { userId?: unknown } = JSONWebToken.decode(accessToken);
    return Boolean(decoded?.userId);
  } catch (err) {
    logger.error(err);
    return false;
  }
};

export default class FileAPI extends BaseAPI<File, FileServiceType> {
  public constructor() {
    super(File, FileService);

    /*
     * Token-based image route. Used for inline images embedded in
     * markdown (post-mortems, internal notes, etc.) where we don't want
     * the file's ObjectID to be enumerable. Anonymous requests are
     * served only when the file is explicitly marked public; otherwise
     * the request must carry a valid OneUptime session.
     *
     * Registered before the id-based route so the longer path matches
     * first.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/image/access-token/:token`,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        _next: NextFunction,
      ) => {
        const token: string | undefined = req.params["token"];
        if (!token) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("File not found"),
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
          select: {
            file: true,
            fileType: true,
            isPublic: true,
          },
        });

        if (!file || !file.file || !file.fileType) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("File not found"),
          );
        }

        if (!file.isPublic && !isAuthenticatedRequest(req)) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("File not found"),
          );
        }

        return Response.sendFileResponse(req, res, file);
      },
    );

    /*
     * Legacy id-based image route. Kept for assets that are intentionally
     * public (probe icons, AI agent icons). Now requires isPublic=true
     * so private inline-upload images cannot be fetched by guessing or
     * leaking an ObjectID.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/image/:imageId`,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        _next: NextFunction,
      ) => {
        const file: File | null = await FileService.findOneById({
          id: new ObjectID(req.params["imageId"]!),
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
          select: {
            file: true,
            fileType: true,
            isPublic: true,
          },
        });

        if (!file || !file.file || !file.fileType || !file.isPublic) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("File not found"),
          );
        }

        return Response.sendFileResponse(req, res, file);
      },
    );
  }
}
