import UserMiddleware from "../Middleware/UserAuthorization";
import ServiceKnowledge from "../Utils/AI/SRE/ServiceKnowledge";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import { ServiceKnowledgeSummary } from "../../Types/AI/ServiceKnowledgeSummary";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * WHAT ONEUPTIME AI LEARNED ABOUT A SERVICE (#7672;
 * Types/AI/ServiceKnowledgeSummary), for the card on the service's page:
 *
 *   GET /service-knowledge/:serviceId
 *     -> ServiceKnowledgeSummary: the failures the service keeps having,
 *        each with how often and when it was last seen, its newest
 *        records, its cause and the fix that worked
 *
 * A signed-in member of the project who may read the service. Everything
 * is read with their own permissions (ServiceKnowledge.readSummaryForPerson),
 * never as OneUptime: an incident or an alert they may not read - a private
 * one, one an owner or a label sets apart from them - is never named or
 * counted, nor are a fix or an analysis they may not read. It only reads.
 *
 * What the team wrote for OneUptime AI about the service is a record of its
 * own (ServiceAINote), read and written through its CRUD routes.
 *
 * A bare router, as UsedByAPI is: it reads no single model's CRUD routes.
 */

export const SERVICE_KNOWLEDGE_API_PATH: string = "/service-knowledge";

const router: ExpressRouter = Express.getRouter();

export function readServiceIdParam(req: ExpressRequest): ObjectID {
  const raw: string = ((req.params["serviceId"] as string) || "").trim();

  if (!raw || !ObjectID.isValidUUID(raw)) {
    throw new BadDataException(
      "The service's ID is missing or is not an ID. Open the service's page again and retry.",
    );
  }

  return new ObjectID(raw);
}

router.get(
  `${SERVICE_KNOWLEDGE_API_PATH}/:serviceId`,
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

      const summary: ServiceKnowledgeSummary =
        await ServiceKnowledge.readSummaryForPerson({
          projectId: projectId,
          serviceId: readServiceIdParam(req),
          props: props,
        });

      Response.setNoCacheHeaders(res);
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

export default router;
