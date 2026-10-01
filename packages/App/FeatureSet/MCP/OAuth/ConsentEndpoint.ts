/**
 * Consent endpoints (POST /mcp/oauth/consent/…)
 *
 * What the consent screen at /accounts/mcp-authorize calls. This is the one
 * step of the flow a person takes part in, and so the one place a grant can
 * come from: nothing else in the authorization server can cause a member's
 * access to be delegated.
 *
 *   details  - what is being asked for, by whom, and which of the member's
 *              projects it can be granted in
 *   approve  - record the grant and hand back where to send the browser
 *   deny     - hand back where to send the browser instead
 *
 * WHO MAY CALL THESE
 *
 * A person, signed in, from OneUptime's own page - and that is checked three
 * ways, because each alone leaves a gap:
 *
 *   - a browser session (UserMiddleware). An API key is refused, and so is
 *     the MCP server's own delegated credential: a connected client must not
 *     be able to approve a second client, or a wider grant, for itself.
 *   - the request comes from this instance's origin (SameOriginRequest), so
 *     another site's page cannot press Authorize with a visitor's session;
 *   - the session cookie is SameSite=Lax to begin with, which keeps it off
 *     cross-site POSTs in any current browser.
 *
 * Everything decided on the screen is decided again here. The page shows
 * which projects are eligible; the approval re-checks the one that was
 * chosen, because a page is not a place where rules are enforced.
 */

import AuthorizationRequest, {
  McpOAuthAuthorizationRequest,
} from "./AuthorizationRequest";
import { McpOAuthClientKind } from "./ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import RedirectUri from "./RedirectUri";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Project from "Common/Models/DatabaseModels/Project";
import McpOAuthGrantService, {
  McpOAuthGrantSsoEvidence,
} from "Common/Server/Services/McpOAuthGrantService";
import McpOAuthTokenService, {
  IssuedMcpOAuthAuthorizationCode,
} from "Common/Server/Services/McpOAuthTokenService";
import ProjectService, {
  CurrentPlan,
} from "Common/Server/Services/ProjectService";
import DatabaseRequestType from "Common/Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "Common/Server/Types/Database/Permissions/BillingPermission";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthGrantAccess, {
  McpOAuthGrantRefusal,
} from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import McpOAuthSso, {
  McpOAuthSsoRequirement,
} from "Common/Server/Utils/Mcp/McpOAuthSso";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import SameOriginRequest from "Common/Server/Utils/SameOriginRequest";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ServerException from "Common/Types/Exception/ServerException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";

/*
 * Why a project cannot be chosen. Sent to the page as a code, which the page
 * turns into words in the member's language.
 */
export enum ConsentProjectRefusal {
  // The project's plan does not include connecting MCP clients.
  Plan = "plan",

  // The project requires SSO and this browser session has not completed it.
  Sso = "sso",

  // A team the member is in blocks connecting MCP clients.
  Blocked = "blocked",

  NotAMember = "not-a-member",
}

export enum ConsentAccessLevel {
  ReadOnly = "read",
  ReadAndWrite = "write",
}

type ProjectEligibility =
  | { isEligible: true; ssoEvidence: McpOAuthGrantSsoEvidence | null }
  | { isEligible: false; refusal: ConsentProjectRefusal };

interface ConsentSession {
  userId: ObjectID;
  email: string;
  name: string;
  isMasterAdmin: boolean;
}

const EXPIRED_REQUEST_MESSAGE: string =
  "This authorization request has expired. Go back to your MCP client and start connecting again.";

export default class ConsentEndpoint {
  public static async details(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await ConsentEndpoint.respond(req, res, async (): Promise<JSONObject> => {
      const session: ConsentSession = ConsentEndpoint.requireSession(req);
      const request: McpOAuthAuthorizationRequest =
        ConsentEndpoint.requireRequest(req);

      const canWrite: boolean = McpOAuthScopeUtil.canWrite(request.scopes);

      return {
        client: {
          name: request.clientName,
          /*
           * For a client identified by a metadata document, the host that
           * document is served from. It is the one part of a client's
           * identity the client did not simply assert, so the page leads
           * with it. A registered client has no such thing.
           */
          verifiedHost:
            request.clientKind === McpOAuthClientKind.MetadataDocument
              ? new globalThis.URL(request.clientId).host
              : null,
          uri: request.clientUri || null,
          redirectTarget: RedirectUri.getDisplayTarget(request.redirectUri),
          isLoopbackRedirect: RedirectUri.isLoopback(request.redirectUri),
        },
        // The most the client asked for; the member may choose less.
        requestedAccess: canWrite
          ? ConsentAccessLevel.ReadAndWrite
          : ConsentAccessLevel.ReadOnly,
        user: {
          email: session.email,
          name: session.name,
        },
        projects: await ConsentEndpoint.listProjects(req, session),
      };
    });
  }

  public static async approve(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await ConsentEndpoint.respond(req, res, async (): Promise<JSONObject> => {
      const session: ConsentSession = ConsentEndpoint.requireSession(req);
      const request: McpOAuthAuthorizationRequest =
        ConsentEndpoint.requireRequest(req);

      const projectId: unknown = (req.body as JSONObject)?.["projectId"];

      if (typeof projectId !== "string" || !ObjectID.isValidUUID(projectId)) {
        throw new BadDataException("Choose a project to connect.");
      }

      const scopes: Array<McpOAuthScope> = ConsentEndpoint.getGrantedScopes(
        request,
        (req.body as JSONObject)?.["access"],
      );

      const eligibility: ProjectEligibility =
        await ConsentEndpoint.getProjectEligibility({
          req,
          session,
          projectId: new ObjectID(projectId),
        });

      if (!eligibility.isEligible) {
        throw ConsentEndpoint.toException(eligibility.refusal);
      }

      const now: Date = OneUptimeDate.getCurrentDate();

      /*
       * Pending until the client collects its tokens; if it never does, the
       * grant lapses with the code and is swept.
       */
      const grant: McpOAuthGrant =
        await McpOAuthGrantService.createPendingGrant({
          projectId: new ObjectID(projectId),
          userId: session.userId,
          clientId: request.clientId,
          clientName: request.clientName,
          scopes,
          resource: request.resource,
          expiresAt: OneUptimeDate.addRemoveSeconds(
            now,
            McpOAuthConfig.AUTHORIZATION_CODE_TTL_SECONDS,
          ),
          ssoEvidence: eligibility.ssoEvidence,
        });

      let issued: IssuedMcpOAuthAuthorizationCode;

      try {
        issued = await McpOAuthTokenService.issueAuthorizationCode({
          grantId: grant.id!,
          codeChallenge: request.codeChallenge,
          redirectUri: request.redirectUri,
          now,
        });
      } catch (err) {
        /*
         * A grant nobody was given a code for can never be collected. It
         * would lapse and be swept, but there is no reason to leave it lying
         * about (and in the audit trail) until then.
         */
        await McpOAuthGrantService.revoke({
          grantId: grant.id!,
          props: { isRoot: true },
        }).catch((): void => {
          // Best effort: the sweep removes it if this could not.
        });

        throw err;
      }

      return {
        redirectUrl: AuthorizationRequest.buildSuccessRedirect({
          request,
          code: issued.code,
        }),
      };
    });
  }

  public static async deny(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await ConsentEndpoint.respond(req, res, async (): Promise<JSONObject> => {
      ConsentEndpoint.requireSession(req);

      const request: McpOAuthAuthorizationRequest =
        ConsentEndpoint.requireRequest(req);

      return {
        redirectUrl: AuthorizationRequest.buildErrorRedirect({
          redirectUri: request.redirectUri,
          state: request.state,
          error: new McpOAuthError(
            McpOAuthErrorCode.AccessDenied,
            "The request was denied.",
          ),
        }),
      };
    });
  }

  /*
   * Every project the member belongs to, each marked with whether a client
   * can be connected to it right now and, if not, why. Ineligible projects
   * are listed rather than hidden: a member who cannot find their project
   * has no idea what to do about it, and one who sees "requires single
   * sign-on" does.
   */
  private static async listProjects(
    req: ExpressRequest,
    session: ConsentSession,
  ): Promise<JSONArray> {
    const projectIds: Array<ObjectID> =
      (req as OneUptimeRequest).userGlobalAccessPermission?.projectIds || [];

    if (projectIds.length === 0) {
      return [];
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(projectIds),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const listed: Array<JSONObject> = await Promise.all(
      projects
        .filter((project: Project): boolean => {
          return Boolean(project.id);
        })
        .map(async (project: Project): Promise<JSONObject> => {
          const eligibility: ProjectEligibility =
            await ConsentEndpoint.getProjectEligibility({
              req,
              session,
              projectId: project.id!,
            });

          return {
            id: project.id!.toString(),
            name: project.name?.toString() || "",
            isEligible: eligibility.isEligible,
            refusal: eligibility.isEligible ? null : eligibility.refusal,
          };
        }),
    );

    return listed.sort((a: JSONObject, b: JSONObject): number => {
      return String(a["name"]).localeCompare(String(b["name"]));
    });
  }

  /*
   * Whether this member, in this browser session, may connect a client to
   * this project - and, when the project requires SSO, the evidence of the
   * sign-in that satisfies it, to be copied onto the grant.
   *
   * The checks are the ones every later use of the grant is held to
   * (McpOAuthGrantAccess), plus the two that only make sense at this moment:
   * the plan, which gates creating a grant and nothing afterwards, and SSO
   * read from the live session rather than from a stored copy.
   */
  private static async getProjectEligibility(data: {
    req: ExpressRequest;
    session: ConsentSession;
    projectId: ObjectID;
  }): Promise<ProjectEligibility> {
    const refusal: McpOAuthGrantRefusal | null =
      await McpOAuthGrantAccess.getProjectRefusal({
        userId: data.session.userId,
        projectId: data.projectId,
      });

    if (refusal === McpOAuthGrantRefusal.BlockedByPermission) {
      return { isEligible: false, refusal: ConsentProjectRefusal.Blocked };
    }

    if (refusal) {
      return { isEligible: false, refusal: ConsentProjectRefusal.NotAMember };
    }

    if (!(await ConsentEndpoint.isPlanSufficient(data.projectId))) {
      return { isEligible: false, refusal: ConsentProjectRefusal.Plan };
    }

    const ssoRequirement: McpOAuthSsoRequirement =
      await McpOAuthSso.getRequirement({
        projectId: data.projectId,
        isMasterAdmin: data.session.isMasterAdmin,
      });

    if (!ssoRequirement.isRequired) {
      return { isEligible: true, ssoEvidence: null };
    }

    const ssoEvidence: McpOAuthGrantSsoEvidence | null =
      await McpOAuthSso.captureEvidence({
        req: data.req,
        projectId: data.projectId,
        userId: data.session.userId,
        requiredSsoProviderId: ssoRequirement.requiredSsoProviderId,
      });

    if (!ssoEvidence) {
      return { isEligible: false, refusal: ConsentProjectRefusal.Sso };
    }

    return { isEligible: true, ssoEvidence };
  }

  /*
   * The plan gate the grant model declares (@TableBillingAccessControl),
   * asked the way the permission layer asks it. It has to be asked by hand
   * because the grant is written as root, which skips that layer. Where
   * billing is off there are no plans and everything passes.
   */
  private static async isPlanSufficient(projectId: ObjectID): Promise<boolean> {
    let plan: CurrentPlan;

    try {
      plan = await ProjectService.getCurrentPlan(projectId);
    } catch {
      // A project with no plan at all (mid-onboarding) has not got this one.
      return false;
    }

    if (!plan.plan) {
      return true;
    }

    try {
      BillingPermissions.checkBillingPermissions(
        McpOAuthGrant,
        {
          tenantId: projectId,
          currentPlan: plan.plan,
          isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
        },
        DatabaseRequestType.Create,
      );

      return true;
    } catch (err) {
      if (err instanceof PaymentRequiredException) {
        return false;
      }

      throw err;
    }
  }

  /*
   * What the grant will carry: what the client asked for, narrowed by what
   * the member chose. The member can take write away; nothing here can add
   * it, because a client that asked only to read never finds out it was
   * given more, and a wider grant than anyone requested is just exposure.
   */
  private static getGrantedScopes(
    request: McpOAuthAuthorizationRequest,
    access: unknown,
  ): Array<McpOAuthScope> {
    if (access === ConsentAccessLevel.ReadAndWrite) {
      if (!McpOAuthScopeUtil.canWrite(request.scopes)) {
        throw new BadDataException(
          "This MCP client asked for read-only access, so that is all it can be given.",
        );
      }

      return McpOAuthScopeUtil.normalize(request.scopes);
    }

    if (access === ConsentAccessLevel.ReadOnly) {
      return McpOAuthScopeUtil.normalize(
        request.scopes
          .filter((scope: McpOAuthScope): boolean => {
            return scope !== McpOAuthScope.Write;
          })
          .concat([McpOAuthScope.Read]),
      );
    }

    throw new BadDataException("Choose what the MCP client may do.");
  }

  private static requireRequest(
    req: ExpressRequest,
  ): McpOAuthAuthorizationRequest {
    const request: McpOAuthAuthorizationRequest | null =
      AuthorizationRequest.fromTicket((req.body as JSONObject)?.["request"]);

    if (!request) {
      throw new BadDataException(EXPIRED_REQUEST_MESSAGE);
    }

    return request;
  }

  /*
   * The signed-in person making this request. 401 when there is none, which
   * is what sends the page to the sign-in screen.
   */
  private static requireSession(req: ExpressRequest): ConsentSession {
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    if (!McpOAuthConfig.isEnabled()) {
      throw new BadDataException(
        "Signing in to the MCP server with OAuth is turned off on this OneUptime instance.",
      );
    }

    if (
      SameOriginRequest.isForeignPageRequest({
        headers: req.headers,
        instanceOrigin: SameOriginRequest.getInstanceOrigin(),
      })
    ) {
      throw new ForbiddenException(
        "This request must come from the OneUptime consent page.",
      );
    }

    const userId: ObjectID | undefined =
      oneuptimeRequest.userAuthorization?.userId;

    const isPerson: boolean =
      oneuptimeRequest.userType === UserType.User ||
      oneuptimeRequest.userType === UserType.MasterAdmin;

    if (!userId || !isPerson) {
      throw new NotAuthenticatedException(
        "Sign in to OneUptime to continue connecting your MCP client.",
      );
    }

    /*
     * A session, not a key and not a connected client: only a person at the
     * consent screen may delegate their access.
     */
    if (
      oneuptimeRequest.apiKeyId ||
      oneuptimeRequest.apiKeyName ||
      oneuptimeRequest.mcpOAuth
    ) {
      throw new NotAuthorizedException(
        "Only a signed-in person can connect an MCP client.",
      );
    }

    return {
      userId,
      email: oneuptimeRequest.userAuthorization!.email.toString(),
      name: oneuptimeRequest.userAuthorization!.name?.toString() || "",
      isMasterAdmin: Boolean(oneuptimeRequest.userAuthorization!.isMasterAdmin),
    };
  }

  private static toException(refusal: ConsentProjectRefusal): Exception {
    switch (refusal) {
      case ConsentProjectRefusal.Plan:
        return new PaymentRequiredException(
          "This project's plan does not include connecting MCP clients. Upgrade the project, or use a different project.",
        );
      case ConsentProjectRefusal.Sso:
        return new NotAuthorizedException(
          "This project requires single sign-on. Sign in to it with SSO in this browser, then connect your MCP client again.",
        );
      case ConsentProjectRefusal.Blocked:
        return new NotAuthorizedException(
          "Your project administrator does not allow you to connect MCP clients to this project.",
        );
      default:
        return new NotAuthorizedException(
          "You are not a member of this project.",
        );
    }
  }

  /*
   * These are calls from OneUptime's own page, so they answer in the API's
   * envelope ({ message } on error), which the page's API client already
   * knows how to show - and whose 401 is what starts a sign-in.
   */
  private static async respond(
    req: ExpressRequest,
    res: ExpressResponse,
    work: () => Promise<JSONObject>,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store");

    try {
      Response.sendJsonObjectResponse(req, res, await work());
    } catch (err) {
      if (err instanceof Exception) {
        // Something this endpoint decided to say: sent as it is.
        Response.sendErrorResponse(req, res, err);
        return;
      }

      /*
       * Anything else is a fault nobody chose the wording of - a database
       * error, a bug - and its message can describe the inside of the server.
       * It goes to the log; the page is told only that it failed.
       */
      logger.error("MCP OAuth: a consent request failed unexpectedly.");
      logger.error(err);

      Response.sendErrorResponse(
        req,
        res,
        new ServerException(
          "Something went wrong on our side. Please try again in a few minutes.",
        ),
      );
    }
  }
}
