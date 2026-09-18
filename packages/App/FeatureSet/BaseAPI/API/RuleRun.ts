import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  RuleRunPassResult,
  RuleRunType,
  RuleRunTypeUtil,
} from "Common/Types/Rules/RuleRun";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import RuleRunner from "Common/Server/Utils/Rules/RuleRun/RuleRunner";
import RuleRunPermission from "Common/Server/Utils/Rules/RuleRun/RuleRunPermission";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * ------------------------------------------------------------------
 * RuleRunAPI
 *
 *   POST /rule-run/:ruleType/:ruleId/run
 *
 * "Run now" for label, owner and privacy rules, and re-sync for status
 * page monitor rules. Those rules fire when a resource is created, so a
 * rule written after its resources exist never reaches them; this runs
 * one rule against the resources that already exist.
 *
 * One request is one bounded pass (see RuleRunner). The body carries:
 *
 *   cursor         the previous pass's nextCursor, absent on the first
 *   notifyOwners   owner rules only: notify the owners the run adds
 *
 * and the answer is a RuleRunPassResult whose nextCursor, when set, is
 * what the next request sends.
 * ------------------------------------------------------------------
 */

function readRuleType(req: ExpressRequest): RuleRunType {
  const ruleType: string | undefined = req.params["ruleType"];

  if (!RuleRunTypeUtil.isRuleRunType(ruleType)) {
    throw new BadDataException("This rule type cannot be run.");
  }

  return ruleType;
}

/*
 * The format check is explicit: ObjectID's constructor takes any string, so
 * an id that is not a UUID would otherwise reach the query layer and come back
 * as a Postgres syntax error instead of a bad request.
 */
function readRuleId(req: ExpressRequest): ObjectID {
  const ruleId: string | undefined = req.params["ruleId"];

  if (!ruleId) {
    throw new BadDataException("Rule ID is required.");
  }

  if (!ObjectID.isValidUUID(ruleId)) {
    throw new BadDataException("Invalid Rule ID.");
  }

  return new ObjectID(ruleId);
}

function readCursor(body: JSONObject): ObjectID | null {
  const cursor: unknown = body["cursor"];

  if (cursor === undefined || cursor === null) {
    return null;
  }

  if (typeof cursor !== "string" || !ObjectID.isValidUUID(cursor)) {
    throw new BadDataException("Invalid cursor.");
  }

  return new ObjectID(cursor);
}

/*
 * Absent means false, a literal boolean means itself, anything else is a 400.
 * A "true" string must not notify hundreds of owners the caller did not ask to
 * notify, so nothing is coerced.
 */
function readBooleanFlag(body: JSONObject, key: string): boolean {
  const value: unknown = body[key];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new BadDataException(`${key} must be a boolean (true or false).`);
  }

  return value;
}

export default class RuleRunAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/rule-run/:ruleType/:ruleId/run",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

          const ruleType: RuleRunType = readRuleType(req);

          RuleRunPermission.assertCanRun({
            props: props,
            ruleType: ruleType,
          });

          const body: JSONObject = (req.body || {}) as JSONObject;

          const result: RuleRunPassResult = await RuleRunner.runPass({
            ruleType: ruleType,
            ruleId: readRuleId(req),
            projectId: projectId,
            cursor: readCursor(body),
            allowOwnerNotification: readBooleanFlag(body, "notifyOwners"),
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
