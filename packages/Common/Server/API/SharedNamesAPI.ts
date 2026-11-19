import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import OnCallDutyPolicyScheduleService from "../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../Services/OnCallDutyPolicyService";
import TeamService from "../Services/TeamService";
import UniqueNameInProject from "../Utils/Database/UniqueNameInProject";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  SHARED_NAMES_ROUTE,
  SharedNameKind,
  isSharedNameKind,
  toSharedNamesAnswerJSON,
} from "../../Types/Database/SharedNames";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";

/*
 * GET /shared-names/:kind - the records of the request's project whose
 * names read as one name, for their list to mark (#9746,
 * Types/Database/SharedNames): teams, on-call policies and on-call
 * schedules, which a picker shows by their name alone.
 *
 * For a signed-in member of the project or a project API key. Only the
 * records the caller may read are answered, read with the caller's own
 * permissions; a caller who may not read the kind at all is refused as a
 * list of it would be. Nothing is written or cached.
 *
 * A bare router, as OnCallReadinessAPI is: it belongs to no one model, and
 * extending BaseAPI would register a model's routes a second time. A GET,
 * and so a read the server's switched-off products leave alone.
 */

const router: ExpressRouter = Express.getRouter();

// The service whose records each kind is.
const SERVICE_OF_KIND: Record<SharedNameKind, DatabaseService<BaseModel>> = {
  [SharedNameKind.Team]: TeamService as unknown as DatabaseService<BaseModel>,
  [SharedNameKind.OnCallPolicy]:
    OnCallDutyPolicyService as unknown as DatabaseService<BaseModel>,
  [SharedNameKind.OnCallSchedule]:
    OnCallDutyPolicyScheduleService as unknown as DatabaseService<BaseModel>,
};

router.get(
  `${SHARED_NAMES_ROUTE}/:kind`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const kind: unknown = req.params["kind"];

      if (!isSharedNameKind(kind)) {
        throw new NotFoundException(
          "There is no list of records with names of their own by that name. Ask for team, on-call-policy or on-call-schedule.",
        );
      }

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const groups: Array<Array<string>> =
        await UniqueNameInProject.findRecordsSharingName({
          service: SERVICE_OF_KIND[kind],
          projectId: projectId,
          props: props,
        });

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        toSharedNamesAnswerJSON({ groups: groups }),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
