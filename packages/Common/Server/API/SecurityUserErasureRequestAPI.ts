import SecurityUserErasureRequest from "../../Models/DatabaseModels/SecurityUserErasureRequest";
import Includes from "../../Types/BaseDatabase/Includes";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import { SecurityUserErasureRequestStatus } from "../../Types/SecurityEvent/SecurityUserErasure";
import {
  SECURITY_USER_ERASURE_PROGRESS_LIMIT,
  SECURITY_USER_ERASURE_PROGRESS_PATH,
  SecurityUserErasureProgressLine,
  progressLinesToJSON,
} from "../../Types/SecurityEvent/SecurityUserErasureProgressLine";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityUserErasureRequestService, {
  Service as SecurityUserErasureRequestServiceType,
} from "../Services/SecurityUserErasureRequestService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import { getErasureProgressLine } from "../Utils/SecurityEvent/UserVault/SecurityUserErasureProgressLine";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Erasure Requests (#10908): their CRUD, and
 *
 *   POST /security-user-erasure-request/progress  how far each of the
 *                                                 project's open requests
 *                                                 has got (#11232)
 *
 * The worker keeps where a request got to in its `progress`, which no role
 * may read: its cursor holds a finding's _id. This route reads it as the
 * server and answers with the line the page shows under Erasing
 * (Utils/SecurityEvent/UserVault/SecurityUserErasureProgressLine) - a
 * step, a pass, times, and why a run failed, which the requests' readers
 * read already - never the cursor. It takes the permission to read the
 * requests, reads no body and writes nothing.
 */

export const ERASURE_PROGRESS_REFUSED_MESSAGE: string =
  "Reading how far an erasure has got takes a role that can read Erasure Requests.";

export default class SecurityUserErasureRequestAPI extends BaseAPI<
  SecurityUserErasureRequest,
  SecurityUserErasureRequestServiceType
> {
  public constructor() {
    super(SecurityUserErasureRequest, SecurityUserErasureRequestService);

    this.router.post(
      SECURITY_USER_ERASURE_PROGRESS_PATH,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          CommonAPI.assertCanReadTable({
            modelType: SecurityUserErasureRequest,
            props,
            errorMessage: ERASURE_PROGRESS_REFUSED_MESSAGE,
          });

          const lines: Array<SecurityUserErasureProgressLine> =
            await SecurityUserErasureRequestAPI.readProgressLines({
              projectId,
              now: OneUptimeDate.getCurrentDate(),
            });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            progressLinesToJSON(lines),
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  /*
   * The line of each of the project's open requests, the newest first, as
   * the page lists them. Read as the server: `progress` is no role's.
   */
  public static async readProgressLines(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<Array<SecurityUserErasureProgressLine>> {
    const requests: Array<SecurityUserErasureRequest> =
      await SecurityUserErasureRequestService.findBy({
        query: {
          projectId: data.projectId,
          status: new Includes([
            SecurityUserErasureRequestStatus.Pending,
            SecurityUserErasureRequestStatus.InProgress,
          ]),
        },
        select: {
          _id: true,
          status: true,
          progress: true,
          attempts: true,
          failureReason: true,
          updatedAt: true,
        },
        sort: { requestedAt: SortOrder.Descending },
        skip: 0,
        limit: SECURITY_USER_ERASURE_PROGRESS_LIMIT,
        props: { isRoot: true },
      });

    const lines: Array<SecurityUserErasureProgressLine> = [];

    for (const request of requests) {
      const line: SecurityUserErasureProgressLine | null =
        getErasureProgressLine(request, data.now);

      if (line) {
        lines.push(line);
      }
    }

    return lines;
  }
}
