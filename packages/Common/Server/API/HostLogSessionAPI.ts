import HostLogSessionService, {
  Service as HostLogSessionServiceType,
} from "../Services/HostLogSessionService";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import HostLogSessionLines from "../Utils/Host/HostLogSessionLines";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import HostLogSession from "../../Models/DatabaseModels/HostLogSession";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { HostLogSessionFile } from "../../Utils/Host/HostLogSessionFile";
import { HOST_LOG_SESSION_LINES_PATH } from "../../Types/Host/HostLogSession";

export const NOT_A_SESSION_ID_MESSAGE: string =
  "That is not a log session's ID. Open the session from a device's Logs page and download its lines there.";

/*
 * Log sessions (#9806): the CRUD API of BaseAPI, and one route of their
 * own (#9966):
 *
 *   GET /host-log-session/:id/lines - the session's lines as a
 *   `logcat -v threadtime` text file, for a vendor's support: its name,
 *   its text, how many lines it holds and whether the session has more
 *   (Utils/Host/HostLogSessionLines). Read with the reader's own
 *   permissions, as viewing the lines is: the session as its list reads
 *   it, its lines as Logs reads them.
 *
 * It only reads, so it stays open while a product is switched off, as the
 * CRUD API's reads do.
 */
export default class HostLogSessionAPI extends BaseAPI<
  HostLogSession,
  HostLogSessionServiceType
> {
  public constructor() {
    super(HostLogSession, HostLogSessionService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/${HOST_LOG_SESSION_LINES_PATH}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const id: string = (req.params["id"] || "").toString().trim();

          if (!ObjectID.isValidUUID(id)) {
            throw new BadDataException(NOT_A_SESSION_ID_MESSAGE);
          }

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const file: HostLogSessionFile = await HostLogSessionLines.getFile({
            sessionId: new ObjectID(id),
            props: props,
          });

          return Response.sendJsonObjectResponse(req, res, {
            fileName: file.fileName,
            content: file.content,
            lineCount: file.lineCount,
            isTruncated: file.isTruncated,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
