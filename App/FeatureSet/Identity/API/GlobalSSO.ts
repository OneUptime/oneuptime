import AuthenticationEmail from "../Utils/AuthenticationEmail";
import SSOUtil, { VerifiedSamlResponse } from "../Utils/SSO";
import {
  buildMobileSsoSuccessUrl,
  clearMobileSsoIntentCookie,
  isMobileSsoRequest,
  respondToMobileSsoFailure,
  setMobileSsoIntentCookie,
} from "../Utils/MobileSso";
import { DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import GlobalSSOService from "Common/Server/Services/GlobalSsoService";
import GlobalSSOProjectService from "Common/Server/Services/GlobalSsoProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
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
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Name from "Common/Types/Name";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

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
      if (isMobileRequest) {
        setMobileSsoIntentCookie(res, globalSso.id!);
      }

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(
          `${HttpProtocol}${Host}/identity/global-idp-login/${globalSso.id?.toString()}`,
        ),
        signOnUrl: globalSso.signOnURL!,
        issuerUrl: URL.fromString(
          `${HttpProtocol}${Host}/global-sso/${globalSso.id?.toString()}`,
        ),
      });

      if (isMobileRequest) {
        samlRequestUrl.addQueryParam("RelayState", "mobile");
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
        signOnURL: true,
        issuerURL: true,
        publicCertificate: true,
        disableSignUpWithSso: true,
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

    let issuerUrl: string = "";
    let email: Email | null = null;
    let fullName: Name | null = null;

    try {
      /*
       * Verify the signature AND extract the identity from the SAME
       * cryptographically verified assertion. This single call defends against
       * XML Signature Wrapping - see SSOUtil.getSamlResponseFromXML and
       * GitHub issues #2949 and #2981.
       */
      const verifiedSaml: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
        samlResponse,
        globalSso.publicCertificate,
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

    if (!alreadySavedUser.isEmailVerified && !isNewUser) {
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

        for (const team of attachment.teams) {
          let teamMember: TeamMember = new TeamMember();
          teamMember.projectId = attachment.projectId;
          teamMember.userId = alreadySavedUser!.id!;
          teamMember.hasAcceptedInvitation = true;
          teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
          teamMember.teamId = team.id!;

          teamMember = await TeamMemberService.create({
            data: teamMember,
            props: { isRoot: true, ignoreHooks: true },
          });
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
        },
        expiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      /*
       * Built through the shared helper so the SAML and OIDC routers cannot
       * drift apart on the param names the mobile app parses. The single
       * global SSO token is sent back as `globalSsoToken`; the app replays it
       * on every request as the `x-global-sso-token` header.
       */
      const deepLinkUrl: string = buildMobileSsoSuccessUrl({
        accessToken,
        refreshToken: sessionMetadata.refreshToken,
        refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
        userId: alreadySavedUser.id!.toString(),
        email: alreadySavedUser.email!.toString(),
        name: alreadySavedUser.name?.toString() || "",
        isMasterAdmin: Boolean(alreadySavedUser.isMasterAdmin),
        globalSsoToken,
      });

      logger.info(
        "User logged in with Global SSO (mobile): " + email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      return res.redirect(deepLinkUrl);
    }

    // Web: mint the standard user cookie + the single global SSO cookie.
    CookieUtil.setGlobalSSOCookie({
      user: alreadySavedUser,
      expressResponse: res,
      ssoProviderId: globalSsoId,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    CookieUtil.setUserCookie({
      expressResponse: res,
      user: alreadySavedUser,
      isGlobalLogin: false,
      sessionId: sessionMetadata.session.id!,
      refreshToken: sessionMetadata.refreshToken,
      refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
      accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
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
