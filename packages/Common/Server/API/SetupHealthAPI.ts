import UserMiddleware from "../Middleware/UserAuthorization";
import SetupHealthService from "../Services/SetupHealthService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import { isRefreshRequested } from "./WhoIsToldAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SETUP_HEALTH_RECORD_KINDS_WITH_A_PAGE,
  SetupHealthAnswer,
  SetupHealthRecord,
  SetupHealthRecordAnswer,
  SetupHealthSummary,
  isSetupHealthRecordKindWithAPage,
} from "../../Types/SetupHealth/SetupHealth";

/*
 * SETUP HEALTH (Types/SetupHealth/SetupHealth, #6812): what is misconfigured
 * in the project, each finding with its fix.
 *
 *   GET /setup-health[?refresh=true]   the findings, and the dismissed ones
 *   GET /setup-health/summary          the counts, for Home's line
 *   GET /setup-health/record?kind=&id=[&refresh=true]
 *                                      one record's open findings, for the
 *                                      line at the top of its page (#7297)
 *
 * A signed-in member of the project (or a key of it); each is handed the
 * findings about records they may read (SetupHealthService.getForCaller).
 * Reads only: a finding is dismissed and restored through the
 * RecommendationDismissal CRUD routes. `refresh` works the findings out
 * again instead of using the minute-old ones, as Readiness's Recheck does.
 *
 * A bare router, as OnCallReadinessAPI is: it reads no single model's CRUD
 * routes.
 */

export const SETUP_HEALTH_API_PATH: string = "/setup-health";

/*
 * The record a page asks about, from ?kind=&id=: one of the kinds that have
 * a page (SETUP_HEALTH_RECORD_KINDS_WITH_A_PAGE), and its id.
 */
export function readSetupHealthRecordQuery(
  req: ExpressRequest,
): Pick<SetupHealthRecord, "kind" | "id"> {
  const query: Record<string, unknown> =
    (req.query as Record<string, unknown>) || {};
  const kind: string = String(query["kind"] ?? "").trim();
  const id: string = String(query["id"] ?? "").trim();

  if (!isSetupHealthRecordKindWithAPage(kind)) {
    throw new BadDataException(
      `Setup Health can't check a record of that kind. Send kind as one of ${SETUP_HEALTH_RECORD_KINDS_WITH_A_PAGE.join(", ")}.`,
    );
  }

  if (!ObjectID.isValidUUID(id)) {
    throw new BadDataException(
      "Setup Health can't check that record, because its id is not valid. Send the id of the record whose page is open.",
    );
  }

  return { kind: kind, id: new ObjectID(id).toString() };
}

const router: ExpressRouter = Express.getRouter();

router.get(
  SETUP_HEALTH_API_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: projectId,
        props: props,
        refresh: isRefreshRequested(req),
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  `${SETUP_HEALTH_API_PATH}/summary`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const summary: SetupHealthSummary =
        await SetupHealthService.getSummaryForCaller({
          projectId: projectId,
          props: props,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        summary as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  `${SETUP_HEALTH_API_PATH}/record`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const record: Pick<SetupHealthRecord, "kind" | "id"> =
        readSetupHealthRecordQuery(req);

      const answer: SetupHealthRecordAnswer =
        await SetupHealthService.getForRecord({
          projectId: projectId,
          props: props,
          record: record,
          refresh: isRefreshRequested(req),
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
