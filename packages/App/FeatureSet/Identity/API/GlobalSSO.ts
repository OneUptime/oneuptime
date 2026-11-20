import AuthenticationEmail from "../Utils/AuthenticationEmail";
import IdentityProviderSignOut from "../Utils/IdentityProviderSignOut";
import SamlSingleLogoutEndpoint from "../Utils/SamlSingleLogoutEndpoint";
import SignInAgain from "../Utils/SignInAgain";
import SSOUtil, { VerifiedSamlResponse } from "../Utils/SSO";
import SamlAssertionOneTimeUse, {
  SamlProviderKind,
} from "../Utils/SamlAssertionOneTimeUse";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "../Utils/SamlServiceProvider";
import {
  clearMobileSsoIntentCookie,
  getMobileSsoRelayState,
  isMobileSsoRequest,
  readMobileSsoFlowId,
  respondToMobileSsoFailure,
  respondToMobileSsoSuccess,
  startMobileSsoHandOff,
} from "../Utils/MobileSso";
import SsoTeamMembership, {
  SsoTeamMembershipOutcome,
} from "../Utils/SsoTeamMembership";
import { DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import PositiveNumber from "Common/Types/PositiveNumber";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import {
  SessionSignInAgain,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import OneUptimeDate from "Common/Types/Date";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import FailedSignInAuditLog from "Common/Server/Utils/AuditLog/FailedSignInAuditLog";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import GlobalSSOService from "Common/Server/Services/GlobalSsoService";
import GlobalSSOProjectService from "Common/Server/Services/GlobalSsoProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
import { getSessionCookieFields } from "Common/Server/Utils/SessionCookieFields";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  extractDeviceInfo,
  getClientIp,
  headerValueToString,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
import User from "Common/Models/DatabaseModels/User";
import Name from "Common/Types/Name";

const router: ExpressRouter = Express.getRouter();

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

/*
 * Instance-wide SAML sign-in (Global SSO), served by core in every edition.
 * The ACS URL (/identity/global-idp-login/:globalSsoId) is pasted into the
 * identity provider, so no path below may ever change:
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins them.
 */

/*
 * Service-provider initiated discovery for the login page. Returns the list of
 * enabled Global SSO providers so the Accounts UI can offer "Sign in with
 * <provider>". Global SSO is not bound to a specific email domain, so the
 * email query param is accepted for symmetry with project SSO discovery but
 * does not filter the list. Only id/name/description are disclosed.
 */
router.get(
  "/global-sso/service-provider-login",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const globalSsoList: Array<GlobalSSO> = await GlobalSSOService.findBy({
        query: { isEnabled: true },
        select: { _id: true, name: true, description: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

      return Response.sendEntityArrayResponse(
        req,
        res,
        globalSsoList,
        new PositiveNumber(globalSsoList.length),
        GlobalSSO,
      );
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      if (err instanceof Exception) {
        return next(err);
      }
      return next(new ServerException());
    }
  },
);

// SP-initiated login: redirect the browser to the IdP.
router.get(
  "/global-sso/:globalSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["globalSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Global SSO ID not found"),
        );
      }

      const globalSso: GlobalSSO | null = await GlobalSSOService.findOneBy({
        query: {
          _id: req.params["globalSsoId"],
          isEnabled: true,
        },
        select: {
          _id: true,
          signOnURL: true,
          issuerURL: true,
        },
        props: { isRoot: true },
      });

      if (!globalSso) {
        if (SignInAgain.isRequested(req)) {
          return await SignInAgain.sendToSignInPage(req, res);
        }

        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Global SSO Config not found"),
        );
      }

      if (!globalSso.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign On URL not found"),
        );
      }

      if (!globalSso.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Issuer not found"),
        );
      }

      const isMobileRequest: boolean = isMobileSsoRequest({
        req,
        providerId: globalSso.id!,
      });

      /*
       * RelayState is the primary carrier of "this is a mobile login", but it
       * is optional in the SAML specification and some identity providers do
       * not echo it back. Record the intent in a short-lived cookie as well,
       * so the ACS callback can still route the user to the app instead of
       * dropping them on the web dashboard, where the app cannot reach the
       * session.
       */
      let mobileFlowId: string | null = null;

      if (isMobileRequest) {
        /*
         * The app's state and PKCE challenge, kept for the round trip
         * (#9989): its flow rides in RelayState and in the intent cookie.
         */
        const handOff: { flowId: string | null } | null =
          await startMobileSsoHandOff({
            req,
            res,
            providerId: globalSso.id!,
            rememberInCookie: true,
          });

        if (!handOff) {
          return;
        }

        mobileFlowId = handOff.flowId;
      }

      // The same Entity ID and Reply URL the response is held to.
      const serviceProvider: SamlServiceProvider =
        SamlServiceProviders.forGlobalSso({ globalSsoId: globalSso.id! });

      /*
       * Sign In Again (#10217): the identity provider is asked to
       * authenticate the person again (ForceAuthn), with a request whose ID
       * keeps when they were sent, for the response to name back
       * (Utils/SignInAgain). Never for the mobile app, which has no prompt.
       */
      const isSignInAgain: boolean =
        SignInAgain.isRequested(req) && !isMobileRequest;

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(serviceProvider.replyUrl),
        signOnUrl: globalSso.signOnURL!,
        issuerUrl: URL.fromString(serviceProvider.entityId),
        ...(isSignInAgain
          ? {
              forceAuthn: true,
              requestId: SignInAgain.createSamlRequestId({
                providerId: globalSso.id!,
                requestedAt: OneUptimeDate.getCurrentDate(),
              }),
            }
          : {}),
      });

      if (isMobileRequest) {
        samlRequestUrl.addQueryParam(
          "RelayState",
          getMobileSsoRelayState(mobileFlowId),
        );
      }

      return Response.redirect(req, res, samlRequestUrl);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      if (err instanceof Exception) {
        return next(err);
      }
      return next(new ServerException());
    }
  },
);

router.get(
  "/global-idp-login/:globalSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await loginUserWithGlobalSso(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/global-idp-login/:globalSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await loginUserWithGlobalSso(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * The provider's Single Logout URL (#9603), on the HTTP-Redirect (GET) and
 * HTTP-POST bindings: where the identity provider answers the sign-out
 * OneUptime sent a person with, and sends its own. Pasted into the
 * identity provider like the ACS URL, so its path may never change either
 * (Utils/SamlSingleLogoutEndpoint).
 */
const takeGlobalSingleLogout: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    await SamlSingleLogoutEndpoint.handle({
      req,
      res,
      providerType: SsoProviderType.GlobalSSO,
      providerId: req.params["globalSsoId"],
    });
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));
    return next(err);
  }
};

router.get("/global-idp-logout/:globalSsoId", takeGlobalSingleLogout);

router.post("/global-idp-logout/:globalSsoId", takeGlobalSingleLogout);

type LoginUserWithGlobalSsoFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void>;

const loginUserWithGlobalSso: LoginUserWithGlobalSsoFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    const samlResponseBase64: string = req.body.SAMLResponse;

    if (!samlResponseBase64) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest: isMobileSsoRequest({ req }),
          error: "sso_failed",
          errorDescription:
            "Your identity provider did not return a sign-in response. Please try again.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("SAMLResponse not found"),
      );
    }

    if (!req.params["globalSsoId"]) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest: isMobileSsoRequest({ req }),
          error: "sso_failed",
          errorDescription: "This sign-in link is missing its provider.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Global SSO ID not found"),
      );
    }

    const globalSsoId: ObjectID = new ObjectID(req.params["globalSsoId"]);

    /*
     * Resolved once, here, and used by every exit below. Mobile logins have to
     * end on the app's deep link whatever the outcome - a server-rendered page
     * or a JSON error is a dead end inside the auth browser, and the app can
     * only report it to the user as an unexplained cancellation.
     */
    const isMobileRequest: boolean = isMobileSsoRequest({
      req,
      providerId: globalSsoId,
    });

    // And the hand-off flow it carries (#9989), read before the cookie goes.
    const mobileFlowId: string | null = isMobileRequest
      ? readMobileSsoFlowId({ req, providerId: globalSsoId })
      : null;

    /*
     * The intent has been read into `isMobileRequest`; drop the cookie now so
     * a later WEB login through the same provider in the same browser is not
     * redirected into the app.
     */
    if (isMobileRequest) {
      clearMobileSsoIntentCookie(res, globalSsoId);
    }

    const samlResponse: string = Buffer.from(
      samlResponseBase64,
      "base64",
    ).toString();

    const globalSso: GlobalSSO | null = await GlobalSSOService.findOneBy({
      query: {
        _id: globalSsoId.toString(),
        isEnabled: true,
      },
      select: {
        _id: true,
        // The audit log's sign-in entry names the provider (SessionSignIn).
        name: true,
        signOnURL: true,
        issuerURL: true,
        publicCertificate: true,
        disableSignUpWithSso: true,
        restrictToAttachedProjects: true,
        // Whether the session keeps what signing out of the provider too takes.
        signOutOfIdentityProvider: true,
      },
      props: { isRoot: true },
    });

    if (!globalSso) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "provider_unavailable",
          errorDescription:
            "This SSO provider is no longer available. Please contact your administrator.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Global SSO Config not found"),
      );
    }

    if (!globalSso.issuerURL) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "provider_misconfigured",
          errorDescription:
            "This SSO provider is missing its issuer URL. Please contact your administrator.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Issuer URL not found"),
      );
    }

    if (!globalSso.publicCertificate) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "provider_misconfigured",
          errorDescription:
            "This SSO provider is missing its certificate. Please contact your administrator.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Public Certificate not found"),
      );
    }

    let verifiedSaml: VerifiedSamlResponse;
    let issuerUrl: string = "";
    let email: Email | null = null;
    let fullName: Name | null = null;

    try {
      /*
       * Verify the signature AND extract the identity from the SAME
       * cryptographically verified assertion. This single call defends against
       * XML Signature Wrapping - see SSOUtil.getSamlResponseFromXML and
       * GitHub issues #2949 and #2981 - and refuses a response made for
       * anything but this provider, or outside its time.
       */
      verifiedSaml = SSOUtil.getSamlResponseFromXML(
        samlResponse,
        globalSso.publicCertificate,
        SamlServiceProviders.forGlobalSso({ globalSsoId: globalSsoId }),
      );

      issuerUrl = verifiedSaml.issuerUrl;
      email = verifiedSaml.email;
      fullName = verifiedSaml.name;
    } catch (err: unknown) {
      /*
       * Logged before the mobile branch short-circuits: a failed signature
       * verification is security-relevant, and the deep-link redirect returns
       * without going through Response.sendErrorResponse, which is what
       * records it on the web path.
       */
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "invalid_assertion",
          errorDescription:
            "We could not verify the response from your identity provider. Please try again.",
        })
      ) {
        return;
      }

      if (err instanceof Exception) {
        return Response.sendErrorResponse(req, res, err);
      }
      return Response.sendErrorResponse(req, res, new ServerException());
    }

    if (globalSso.issuerURL.toString() !== issuerUrl) {
      logger.error(
        "Issuer URL does not match. It should be " +
          globalSso.issuerURL.toString() +
          " but it is " +
          issuerUrl.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "issuer_mismatch",
          errorDescription:
            "The response came from an unexpected identity provider. Please contact your administrator.",
        })
      ) {
        return;
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Issuer URL does not match"),
      );
    }

    /*
     * One sign-in per response: a response posted again - kept from an
     * earlier sign-in, or sent twice - is refused before anyone is looked
     * up, created, added to a project or signed in. Remembered under the
     * provider the lookup found, not under the Reply URL's spelling of its
     * id, so no other way of writing that URL starts a second record.
     */
    try {
      await SamlAssertionOneTimeUse.claim({
        providerKind: SamlProviderKind.GlobalSso,
        providerId: globalSso.id!,
        assertion: verifiedSaml,
      });
    } catch (err: unknown) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));

      // Both answers are written for the person signing in.
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "invalid_assertion",
          errorDescription:
            err instanceof Exception
              ? err.message
              : "We could not verify the response from your identity provider. Please try again.",
        })
      ) {
        return;
      }

      if (err instanceof Exception) {
        return Response.sendErrorResponse(req, res, err);
      }
      return Response.sendErrorResponse(req, res, new ServerException());
    }

    // Resolve attached projects. No attachment => "default-all" mode.
    const attachments: Array<GlobalSSOProject> =
      await GlobalSSOProjectService.findBy({
        query: { globalSsoId: globalSsoId, isEnabled: true },
        select: { projectId: true, teams: { _id: true } },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    const isDefaultAllMode: boolean = attachments.length === 0;

    /*
     * Sign up is disabled when the admin enabled the flag, OR implicitly in
     * default-all mode (we have no project/team to place a brand new user in).
     * In both cases the user must be invited to a project first.
     */
    const isSignUpDisabled: boolean =
      Boolean(globalSso.disableSignUpWithSso) || isDefaultAllMode;

    let alreadySavedUser: User | null = await UserService.findOneBy({
      query: { email: email },
      select: {
        _id: true,
        name: true,
        email: true,
        isMasterAdmin: true,
        isEmailVerified: true,
        isBlocked: true,
        profilePictureId: true,
        timezone: true,
      },
      props: { isRoot: true },
    });

    let isNewUser: boolean = false;

    if (!alreadySavedUser) {
      if (isSignUpDisabled) {
        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest,
            error: "invitation_required",
            errorDescription:
              "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
          })
        ) {
          return;
        }

        return Response.render(req, res, MESSAGE_VIEW, {
          title: "You need to be invited.",
          message:
            "You must be invited to a project on this OneUptime instance before you can sign in with SSO. Please contact your administrator.",
        });
      }

      // Explicit-attachment mode with sign up allowed: JIT-create the user.
      alreadySavedUser = await UserService.createByEmail({
        email,
        name: fullName || undefined,
        isEmailVerified: true,
        generateRandomPassword: true,
        props: { isRoot: true },
      });

      isNewUser = true;
    }

    const account: User = alreadySavedUser;

    /*
     * A sign-in the provider vouched for that OneUptime refuses, for the
     * audit log of every project the account's person is a member of
     * (issue #6788), after the answer (FailedSignInAuditLog). The server's
     * own provider: every project's entry names it.
     */
    const recordRefusedSignIn: (reason: SignInFailureReason) => void = (
      reason: SignInFailureReason,
    ): void => {
      FailedSignInAuditLog.record({
        req: req,
        userId: account.id!,
        reason: reason,
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: globalSso.name,
        },
      });
    };

    /*
     * Blocked by a master admin. The identity provider vouching for the user
     * does not lift that, so nothing is provisioned and no session is issued.
     */
    if (alreadySavedUser.isBlocked) {
      recordRefusedSignIn(SignInFailureReason.AccountBlocked);

      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "account_blocked",
          errorDescription: ExceptionMessages.UserBlocked,
        })
      ) {
        return;
      }

      return Response.render(req, res, MESSAGE_VIEW, {
        title: "Account blocked.",
        message: ExceptionMessages.UserBlocked,
      });
    }

    if (!alreadySavedUser.isEmailVerified && !isNewUser) {
      recordRefusedSignIn(SignInFailureReason.EmailNotVerified);

      await AuthenticationEmail.sendVerificationEmail(alreadySavedUser!);

      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "email_not_verified",
          errorDescription:
            "Your email is not verified. We have sent you a verification link - please check your inbox, and your spam folder.",
        })
      ) {
        return;
      }

      return Response.render(req, res, MESSAGE_VIEW, {
        title: "Email not verified.",
        message:
          "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
      });
    }

    // Provision into attached projects (explicit-attachment mode only).
    if (!isDefaultAllMode) {
      for (const attachment of attachments) {
        if (!attachment.projectId) {
          continue;
        }

        if (!attachment.teams || attachment.teams.length === 0) {
          // No default teams configured for this attachment; nothing to do.
          continue;
        }

        const teamMemberCount: PositiveNumber = await TeamMemberService.countBy(
          {
            query: {
              projectId: attachment.projectId,
              userId: alreadySavedUser!.id!,
            },
            props: { isRoot: true },
          },
        );

        if (teamMemberCount.toNumber() > 0) {
          // Already a member of this project; leave existing membership intact.
          continue;
        }

        /*
         * They take a seat in each project like anyone invited. A project
         * with no room for one more person adds them nowhere, and is left
         * out: they still sign in to every other project, and join this one
         * on a later sign-in once it has room.
         */
        if (
          (await SsoTeamMembership.addToTeams({
            projectId: attachment.projectId,
            userId: alreadySavedUser!.id!,
            teams: attachment.teams,
          })) === SsoTeamMembershipOutcome.NoRoom
        ) {
          logger.info(
            `Global SSO did not add ${email.toString()} to project ${attachment.projectId.toString()}: it has no room for another person.`,
            getLogAttributesFromRequest(req as RequestLike),
          );
        }
      }
    }

    alreadySavedUser.email = email;

    // Refresh permissions across all of the user's projects in one shot.
    await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

    /*
     * A Global SSO session is only useful if the user belongs to at least one
     * project (access is still gated per-project by team membership). In
     * default-all mode there is no JIT provisioning, so a brand-new member of
     * nothing is sent back with a clear message instead of an empty session.
     */
    const memberProjectCount: PositiveNumber = await TeamMemberService.countBy({
      query: { userId: alreadySavedUser.id! },
      props: { isRoot: true },
    });

    /*
     * When the admin has restricted this provider to its attached projects,
     * the session it is about to mint only authorizes those projects. Check
     * the user actually belongs to one of them BEFORE minting, otherwise the
     * login reports success and then every request is refused, with
     * re-authenticating producing an identical token - a dead end with no way
     * out from inside the product.
     */
    if (globalSso.restrictToAttachedProjects && !isDefaultAllMode) {
      const governedProjectIds: Array<ObjectID> = attachments
        .filter((attachment: GlobalSSOProject) => {
          return Boolean(attachment.projectId);
        })
        .map((attachment: GlobalSSOProject) => {
          return attachment.projectId!;
        });

      const governedMembershipCount: PositiveNumber =
        governedProjectIds.length === 0
          ? new PositiveNumber(0)
          : await TeamMemberService.countBy({
              query: {
                userId: alreadySavedUser.id!,
                projectId: QueryHelper.any(governedProjectIds),
              },
              props: { isRoot: true },
            });

      if (governedMembershipCount.toNumber() === 0) {
        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest,
            error: "no_project_access",
            errorDescription:
              "This SSO provider does not grant access to any project you are a member of. Please contact your administrator.",
          })
        ) {
          return;
        }

        return Response.render(req, res, MESSAGE_VIEW, {
          title: "No project access.",
          message:
            "This SSO provider does not grant access to any project you are a member of. Please contact your administrator.",
        });
      }
    }

    if (memberProjectCount.toNumber() === 0) {
      if (
        respondToMobileSsoFailure({
          res,
          isMobileRequest,
          error: "no_project_access",
          errorDescription:
            "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.",
        })
      ) {
        return;
      }

      return Response.render(req, res, MESSAGE_VIEW, {
        title: "No project access.",
        message:
          "You are not a member of any project on this OneUptime instance. Please contact your administrator to be invited.",
      });
    }

    /*
     * A sign-in Sign In Again started (#10217): it confirms the session only
     * when the identity provider says it authenticated the person at or
     * after the moment they were sent there (Utils/SignInAgain).
     */
    const now: Date = OneUptimeDate.getCurrentDate();
    const signInAgain: SessionSignInAgain | undefined = SignInAgain.judge({
      requestedAt: SignInAgain.readSamlRequestId({
        inResponseTo: verifiedSaml.inResponseTo,
        providerId: globalSsoId,
        now: now,
      }),
      authenticatedAt: verifiedSaml.authnInstant,
      now: now,
    });

    SignInAgain.logOutcome({
      outcome: signInAgain,
      providerKind: "Global SSO",
      providerId: globalSsoId,
    });

    const sessionMetadata: SessionMetadata =
      await UserSessionService.createSession({
        userId: alreadySavedUser.id!,
        isGlobalLogin: false,
        ipAddress: getClientIp(req),
        userAgent: headerValueToString(req.headers["user-agent"]),
        ...extractDeviceInfo(req),
        additionalInfo: {
          globalSsoId: globalSsoId.toString(),
        },
        requestOrigin: RequestOriginUtil.fromRequest(req),
        // The server's own provider: every project's audit log names it.
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: globalSso.name,
          ssoProviderId: globalSsoId,
          signInAgain: signInAgain,
        },
        /*
         * With the provider's "Sign out of the identity provider too" on, a
         * browser sign-in keeps what the assertion named the person and
         * their session by, encrypted, for its sign-out at the provider
         * (Utils/IdentityProviderSignOut, #9603).
         */
        identityProviderSignOut: IdentityProviderSignOut.forSamlSignIn({
          signOutOfIdentityProvider: globalSso.signOutOfIdentityProvider,
          isMobileRequest: isMobileRequest,
          providerType: SsoProviderType.GlobalSSO,
          providerId: globalSsoId,
          assertion: verifiedSaml,
        }),
      });

    /*
     * One Global SSO token (not bound to a project) satisfies SSO enforcement
     * for every project this user belongs to, now and in the future. This
     * replaces the previous per-project cookie fan-out (and its header-size
     * cap), and means projects created after login no longer require re-login.
     */
    const globalSsoToken: string = CookieUtil.getGlobalSSOToken({
      user: alreadySavedUser,
      ssoProviderId: globalSsoId,
      ssoProviderType: SsoProviderType.GlobalSSO,
      expiresInSeconds: sessionMetadata.ssoSignInExpiresInSeconds,
    });

    if (isMobileRequest) {
      const accessToken: string = JSONWebToken.signUserLoginToken({
        tokenData: {
          userId: alreadySavedUser.id!,
          email: alreadySavedUser.email!,
          name: alreadySavedUser.name!,
          timezone: alreadySavedUser.timezone || null,
          isMasterAdmin: alreadySavedUser.isMasterAdmin!,
          isGlobalLogin: false,
          sessionId: sessionMetadata.session.id!,
          signedInAt: sessionMetadata.signedInAt,
          lastActiveAt: sessionMetadata.lastActiveAt,
        },
        expiresInSeconds: sessionMetadata.accessTokenExpiresInSeconds,
      });

      logger.info(
        "User logged in with Global SSO (mobile): " + email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      /*
       * Handed back through the shared helper so the SAML and OIDC routers
       * cannot drift apart on what the mobile app reads: a one-time code it
       * redeems with its PKCE verifier, or - for an app from before #9989 -
       * the deep link that carries the session. The single global SSO token
       * is handed back as `globalSsoToken`; the app replays it on every
       * request as the `x-global-sso-token` header.
       */
      return respondToMobileSsoSuccess({
        res,
        flowId: mobileFlowId,
        signIn: {
          accessToken,
          refreshToken: sessionMetadata.refreshToken,
          refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
          userId: alreadySavedUser.id!.toString(),
          email: alreadySavedUser.email!.toString(),
          name: alreadySavedUser.name?.toString() || "",
          isMasterAdmin: Boolean(alreadySavedUser.isMasterAdmin),
          globalSsoToken,
        },
      });
    }

    // Web: mint the standard user cookie + the single global SSO cookie.
    CookieUtil.setGlobalSSOCookie({
      user: alreadySavedUser,
      expressResponse: res,
      ssoProviderId: globalSsoId,
      ssoProviderType: SsoProviderType.GlobalSSO,
      expiresInSeconds: sessionMetadata.ssoSignInExpiresInSeconds,
    });

    CookieUtil.setUserCookie({
      expressResponse: res,
      user: alreadySavedUser,
      isGlobalLogin: false,
      ...getSessionCookieFields(sessionMetadata),
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    logger.info(
      "User logged in with Global SSO: " + email.toString(),
      getLogAttributesFromRequest(req as RequestLike),
    );

    // Global login spans many projects; land on the dashboard root.
    return Response.redirect(
      req,
      res,
      new URL(httpProtocol, host, new Route(DashboardRoute.toString())),
    );
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));

    /*
     * Last resort. An unexpected server error must still leave the mobile
     * browser on the deep link, otherwise the app waits out the auth session
     * and reports a cancellation the user cannot act on.
     */
    if (
      respondToMobileSsoFailure({
        res,
        isMobileRequest: isMobileSsoRequest({ req }),
        error: "sso_failed",
        errorDescription:
          "Something went wrong while signing you in. Please try again.",
      })
    ) {
      return;
    }

    Response.sendErrorResponse(req, res, err as Exception);
  }
};

export default router;
