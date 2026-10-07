import {
  getScimBelowPlanResponse,
  getScimRefusedOperationType,
  getScimRequestBelowPlan,
  SCIM_BELOW_PLAN_STATUS,
  ScimBelowPlanRefusal,
  ScimRequestBelowPlan,
  sendScimBelowPlanRefusal,
  setScimMissingPlan,
} from "../Utils/SCIMBelowPlan";
import {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
} from "../Utils/SCIMLogger";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import PlanCutoffCredentialAccess from "Common/Server/Utils/Billing/PlanCutoffCredentialAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import { PlanCutoffCredential } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import SpanUtil from "Common/Server/Utils/Telemetry/SpanUtil";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";

/*
 * The HTTP status a SCIM request gets when it is refused because the project
 * is below the plan SCIM needs: 402, as the REST API answers a project below
 * a plan, with the reason in the SCIM error body (RFC 7644, section 3.12).
 * SCIM's own list of statuses has no 402, so an identity provider that does
 * not know it treats it as the 4xx it is (RFC 9110, section 15): a refusal
 * it does not retry at once, whose detail it shows its administrators - Okta
 * among its provisioning errors, Entra ID in its provisioning logs, where a
 * job that keeps failing is quarantined until it is restarted. Which
 * requests are refused below the plan, and which still go through, is
 * Utils/SCIMBelowPlan's to say.
 */
export { SCIM_BELOW_PLAN_STATUS, getScimBelowPlanResponse };

// What getMissingPlanOrRefuse returns once it has answered the request.
type Refused = "refused";
const REFUSED: Refused = "refused";

// A request refused at the door, for the connection's SCIM log.
interface RefusedAtTheDoor {
  refusal: ScimBelowPlanRefusal;
  // As the SCIM log names it: CreateUser, CreateGroup, BulkOperation.
  operationType: string;
  missingPlan: PlanType;
  steps: Array<string>;
}

// The request's body, as the SCIM log keeps it: a JSON object, or nothing.
const getLoggedRequestBody: (req: ExpressRequest) => JSONObject | undefined = (
  req: ExpressRequest,
): JSONObject | undefined => {
  const body: unknown = req.body;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : undefined;
};

export default class SCIMMiddleware {
  @CaptureSpan()
  public static async isAuthorizedSCIMRequest(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      // Extract SCIM ID from URL path (could be project or status page)
      const scimId: string | undefined =
        req.params["projectScimId"] || req.params["statusPageScimId"];
      if (!scimId) {
        throw new BadRequestException("SCIM ID is required");
      }

      // Extract bearer token from Authorization header
      let bearerToken: string | undefined;
      if (req.headers?.["authorization"]) {
        const authHeader: string = req.headers["authorization"] as string;
        if (authHeader.startsWith("Bearer ")) {
          bearerToken = authHeader.substring(7);
        }
      }

      logger.debug(
        `SCIM Authorization: scimId=${scimId}, bearerToken=${
          bearerToken ? "***" : "missing"
        }`,
        getLogAttributesFromRequest(req as OneUptimeRequest),
      );

      if (!bearerToken) {
        throw new NotAuthorizedException(
          "Bearer token is required for SCIM authentication",
        );
      }

      // Try to find Project SCIM configuration first
      const projectScimConfig: ProjectSCIM | null =
        await ProjectSCIMService.findOneBy({
          query: {
            _id: new ObjectID(scimId),
            bearerToken: bearerToken,
          },
          select: {
            _id: true,
            projectId: true,
            autoProvisionUsers: true,
            autoDeprovisionUsers: true,
            enablePushGroups: true,
            teams: {
              _id: true,
              name: true,
            },
          },
          props: {
            isRoot: true,
          },
        });

      if (projectScimConfig) {
        const projectMissingPlan: PlanType | null | Refused =
          await SCIMMiddleware.getMissingPlanOrRefuse({
            req: req,
            res: res,
            projectId: projectScimConfig.projectId,
            credential: PlanCutoffCredential.ProjectSCIM,
            logRefusal: (refused: RefusedAtTheDoor): void => {
              void createProjectSCIMLog({
                projectId: projectScimConfig.projectId!,
                projectScimId: new ObjectID(scimId),
                operationType: refused.operationType,
                status: SCIMLogStatus.Error,
                statusMessage: refused.refusal.message,
                httpMethod: req.method,
                requestPath: req.path,
                httpStatusCode: refused.refusal.statusCode,
                requestBody: getLoggedRequestBody(req),
                responseBody: refused.refusal.body,
                steps: refused.steps,
                additionalContext: {
                  refusedBelowPlan: refused.missingPlan,
                },
              });
            },
          });

        if (projectMissingPlan === REFUSED) {
          return;
        }

        // Store Project SCIM configuration
        oneuptimeRequest.bearerTokenData = {
          scimConfig: projectScimConfig,
          projectId: projectScimConfig.projectId,
          projectScimId: new ObjectID(scimId),
          type: "project-scim",
        };

        // Below the plan: its handler takes access away only.
        if (projectMissingPlan) {
          setScimMissingPlan(req, projectMissingPlan);
        }

        return next();
      }

      // If not found, try Status Page SCIM configuration
      const statusPageScimConfig: StatusPageSCIM | null =
        await StatusPageSCIMService.findOneBy({
          query: {
            _id: new ObjectID(scimId),
            bearerToken: bearerToken,
          },
          select: {
            _id: true,
            projectId: true,
            statusPageId: true,
            autoProvisionUsers: true,
            autoDeprovisionUsers: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (statusPageScimConfig) {
        const statusPageMissingPlan: PlanType | null | Refused =
          await SCIMMiddleware.getMissingPlanOrRefuse({
            req: req,
            res: res,
            projectId: statusPageScimConfig.projectId,
            credential: PlanCutoffCredential.StatusPageSCIM,
            logRefusal: (refused: RefusedAtTheDoor): void => {
              void createStatusPageSCIMLog({
                projectId: statusPageScimConfig.projectId!,
                statusPageId: statusPageScimConfig.statusPageId!,
                statusPageScimId: new ObjectID(scimId),
                operationType: refused.operationType,
                status: SCIMLogStatus.Error,
                statusMessage: refused.refusal.message,
                httpMethod: req.method,
                requestPath: req.path,
                httpStatusCode: refused.refusal.statusCode,
                requestBody: getLoggedRequestBody(req),
                responseBody: refused.refusal.body,
                steps: refused.steps,
                additionalContext: {
                  refusedBelowPlan: refused.missingPlan,
                },
              });
            },
          });

        if (statusPageMissingPlan === REFUSED) {
          return;
        }

        // Store Status Page SCIM configuration
        oneuptimeRequest.bearerTokenData = {
          scimConfig: statusPageScimConfig,
          projectId: statusPageScimConfig.projectId,
          statusPageId: statusPageScimConfig.statusPageId,
          statusPageScimId: new ObjectID(scimId),
          type: "status-page-scim",
        };

        // Below the plan: its handler takes access away only.
        if (statusPageMissingPlan) {
          setScimMissingPlan(req, statusPageMissingPlan);
        }

        return next();
      }

      // If neither found, throw error
      throw new NotAuthorizedException(
        "Invalid bearer token or SCIM configuration not found",
      );
    } catch (err) {
      /*
       * Record on THIS middleware's own @CaptureSpan span before handing the
       * error to Express. The decorator sees a normal return (we call
       * next(err) rather than rethrowing — Express 4 does not catch a
       * rejection from an async middleware), so its recorder never runs and
       * without this the error is invisible on the span it actually belongs
       * to. Goes through SpanUtil so the event is typed by class name rather
       * than by HTTP status, and so a rejected credential produces a `fault`
       * event instead of an Issue.
       */
      SpanUtil.recordExceptionOnCurrentSpan(err);
      return next(err);
    }
  }

  /*
   * SCIM works fully only while the project is on the plan that sells it
   * (Types/Billing/PlanCutoffCredentials): Scale, for a project's SCIM
   * connections and its status pages' alike. Below it - after a downgrade -
   * a connection still answers lookups and takes access away, but gives or
   * changes none (Utils/SCIMBelowPlan). The requests that can only give
   * access - creating a user or a group, and a Bulk request that is not all
   * DELETEs - are refused here, once the bearer token has checked out, so a
   * caller without the token learns nothing about the project's plan. The
   * rest go on, marked as below the plan, to handlers that check what they
   * would change before they change anything. Nothing is deleted, and the
   * connection works fully again, with the same token and the same identity
   * provider setup, as soon as the project is back on the plan. Billing off:
   * no plans, nothing refused.
   *
   * A refusal is answered here, in the SCIM error format, so the identity
   * provider shows the reason - not through next(err), whose generic JSON
   * error an identity provider cannot read. Nor is it logged as an error: a
   * project below the plan is an expected state, and identity providers keep
   * calling on their sync schedule. It is written to the connection's SCIM
   * log (logRefusal), as the requests the handlers answer are, so the
   * project's admins see there what their identity provider was refused.
   *
   * Returns the plan the project is missing - null when it is on the plan,
   * or billing is off - or REFUSED once it has answered the request.
   */
  private static async getMissingPlanOrRefuse(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    projectId: ObjectID | undefined;
    credential: PlanCutoffCredential;
    logRefusal: (refused: RefusedAtTheDoor) => void;
  }): Promise<PlanType | null | Refused> {
    // Every SCIM connection belongs to a project; one without is no connection.
    if (!data.projectId) {
      throw new NotAuthorizedException(
        "Invalid bearer token or SCIM configuration not found",
      );
    }

    const missingPlan: PlanType | null =
      await PlanCutoffCredentialAccess.getMissingPlan({
        projectId: data.projectId,
        credential: data.credential,
      });

    if (!missingPlan) {
      return null;
    }

    const routePath: unknown = (
      data.req.route as { path?: unknown } | undefined
    )?.path;

    if (
      getScimRequestBelowPlan({
        method: data.req.method,
        routePath: typeof routePath === "string" ? routePath : undefined,
        body: data.req.body,
      }) === ScimRequestBelowPlan.Answered
    ) {
      return missingPlan;
    }

    logger.debug(
      "SCIM Authorization: refused, the project is below the " +
        missingPlan +
        " plan SCIM needs and this request can only give access",
      getLogAttributesFromRequest(data.req as OneUptimeRequest),
    );

    const refusal: ScimBelowPlanRefusal = sendScimBelowPlanRefusal({
      res: data.res,
      missingPlan: missingPlan,
    });

    data.logRefusal({
      refusal: refusal,
      operationType: getScimRefusedOperationType({
        method: data.req.method,
        routePath: typeof routePath === "string" ? routePath : undefined,
      }),
      missingPlan: missingPlan,
      steps: [
        `Refused below the ${missingPlan} plan SCIM needs: this request can only give access - creating a user or a group, or a Bulk request that is not all DELETEs`,
      ],
    });

    return REFUSED;
  }
}
