import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_CASE_IMPACT_API_PATH,
  SECURITY_CASE_STORY_API_PATH,
  SecurityCaseImpactJson,
  SecurityCaseStoryJson,
} from "../../Types/SecurityCase/SecurityCaseContext";
import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityCaseImpact from "../Utils/SecurityCase/Context/SecurityCaseImpact";
import SecurityCaseStory from "../Utils/SecurityCase/Context/SecurityCaseStory";
import CommonAPI from "./CommonAPI";

/*
 * A security case as the rest of OneUptime tells it
 * (Server/Utils/SecurityCase/Context):
 *
 *   POST /security-case-context/story   { caseId }  what happened, in order
 *   POST /security-case-context/impact  { caseId }  what the case puts at risk
 *
 * Each takes the right to read security events - a case's detections and
 * events are what both are told from - and reads everything else with the
 * caller's own permissions: a kind of fact their role cannot read is said
 * to be, in the answer, never left out unsaid. A case the caller may not
 * read, or of another project, is no case to them.
 */

export function readCaseId(body: JSONObject): ObjectID {
  const caseId: JSONValue | undefined = body["caseId"];

  if (typeof caseId !== "string" || !ObjectID.isValidUUID(caseId)) {
    throw new BadDataException("A valid case ID is required.");
  }

  return new ObjectID(caseId);
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

export function assertCanReadSecurityEvents(
  props: DatabaseCommonInteractionProps,
): void {
  CommonAPI.assertPermittedInProject({
    databaseProps: props,
    allowedPermissions: new SecurityEvent().getReadPermissions(),
    errorMessage:
      "Reading security events takes a Security role, or Project Owner or Project Admin.",
  });
}

export default class SecurityCaseContextAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      SECURITY_CASE_STORY_API_PATH,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          assertCanReadSecurityEvents(props);

          const story: SecurityCaseStoryJson | null =
            await SecurityCaseStory.build({
              projectId,
              securityCaseId: readCaseId(readBody(req)),
              props,
            });

          if (!story) {
            throw new NotFoundException("This case could not be found.");
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            story as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    router.post(
      SECURITY_CASE_IMPACT_API_PATH,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          assertCanReadSecurityEvents(props);

          const impact: SecurityCaseImpactJson | null =
            await SecurityCaseImpact.build({
              projectId,
              securityCaseId: readCaseId(readBody(req)),
              props,
            });

          if (!impact) {
            throw new NotFoundException("This case could not be found.");
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            impact as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    return router;
  }
}
