import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import Services from "../Services/Index";
import LabelService from "../Services/LabelService";
import OnCallDutyPolicyScheduleService from "../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../Services/OnCallDutyPolicyService";
import TeamService from "../Services/TeamService";
import RequiredUniqueNames from "../Utils/Database/RequiredUniqueNames";
import UniqueNameInProject from "../Utils/Database/UniqueNameInProject";
import { getRequiredUniqueNameServices } from "./UniqueNamesAPI";
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
  SharedNamesAnswer,
  isSharedNameKind,
  toSharedNamesAnswerJSON,
} from "../../Types/Database/SharedNames";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";

/*
 * GET /shared-names/:kind - the records of the request's project whose
 * names read as one name, for their list to mark (#9746,
 * Types/Database/SharedNames): teams, labels (#9856), on-call policies and
 * on-call schedules, which a picker shows by their name - and, by its
 * table's name, every kind Require Unique Names holds (@UniqueNameWhenRequired:
 * GET /shared-names/Monitor, #11021), whose groups hold only records the
 * reader may read, two or more, with when each was made
 * (RequiredUniqueNames.findTwinsOfKind).
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

interface SharedNamesOfKind {
  service: DatabaseService<BaseModel>;
  /*
   * Records in service only: an archived on-call policy or label is offered
   * in no picker, so one named as it is drawn alike with nothing, and its
   * list (which leaves the archived ones out) marks it for nothing.
   */
  leaveOutArchived: boolean;
}

// The service whose records each kind is, and which of them count.
const OF_KIND: Record<SharedNameKind, SharedNamesOfKind> = {
  [SharedNameKind.Team]: {
    service: TeamService as unknown as DatabaseService<BaseModel>,
    leaveOutArchived: false,
  },
  [SharedNameKind.Label]: {
    service: LabelService as unknown as DatabaseService<BaseModel>,
    leaveOutArchived: true,
  },
  [SharedNameKind.OnCallPolicy]: {
    service: OnCallDutyPolicyService as unknown as DatabaseService<BaseModel>,
    leaveOutArchived: true,
  },
  [SharedNameKind.OnCallSchedule]: {
    service:
      OnCallDutyPolicyScheduleService as unknown as DatabaseService<BaseModel>,
    leaveOutArchived: false,
  },
};

/*
 * The service of the kind Require Unique Names holds with that table's
 * name, or null: exactly as the model names its table, as the duplicates'
 * answer and GET /unique-names/check name it.
 */
export const getHeldServiceOfTable: (
  tableName: unknown,
) => DatabaseService<BaseModel> | null = (
  tableName: unknown,
): DatabaseService<BaseModel> | null => {
  if (typeof tableName !== "string" || !tableName) {
    return null;
  }

  return (
    getRequiredUniqueNameServices(Services).find(
      (service: DatabaseService<BaseModel>): boolean => {
        return service.getModel().tableName === tableName;
      },
    ) || null
  );
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

      // A kind Require Unique Names holds, by its table's name: "Monitor".
      const heldService: DatabaseService<BaseModel> | null = isSharedNameKind(
        kind,
      )
        ? null
        : getHeldServiceOfTable(kind);

      if (!isSharedNameKind(kind) && !heldService) {
        throw new NotFoundException(
          "There is no list of records with names of their own by that name. Ask for team, label, on-call-policy or on-call-schedule, or for a kind a project can require unique names for by its table's name, such as Monitor.",
        );
      }

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const answer: SharedNamesAnswer = heldService
        ? await RequiredUniqueNames.findTwinsOfKind({
            service: heldService,
            projectId: projectId,
            props: props,
          })
        : {
            groups: await UniqueNameInProject.findRecordsSharingName({
              service: OF_KIND[kind as SharedNameKind].service,
              projectId: projectId,
              props: props,
              leaveOutArchived:
                OF_KIND[kind as SharedNameKind].leaveOutArchived,
            }),
          };

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        toSharedNamesAnswerJSON(answer),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
