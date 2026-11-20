import IdentityProviderSignOut from "../Utils/IdentityProviderSignOut";
import SamlSingleLogoutEndpoint from "../Utils/SamlSingleLogoutEndpoint";
import SSOUtil, { VerifiedSamlResponse } from "../Utils/SSO";
import SamlAssertionOneTimeUse, {
  SamlProviderKind,
} from "../Utils/SamlAssertionOneTimeUse";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "../Utils/SamlServiceProvider";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import { ProjectSsoKind } from "../Utils/ProjectSsoSignInConfirmation";
import ProjectSsoSignInGate, {
  ProjectSsoGateDecision,
  ProjectSsoGateOutcome,
} from "../Utils/ProjectSsoSignInGate";
import {
  clearMobileSsoIntentCookie,
  getMobileSsoRelayState,
  isMobileSsoRequest,
  readMobileSsoFlowId,
  respondToMobileSsoFailure,
  respondToMobileSsoSuccess,
  startMobileSsoHandOff,
} from "../Utils/MobileSso";
import ProjectSsoIdentityBinding, {
  PROJECT_SSO_IDENTITY_MISMATCH_ERROR,
  PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE,
  PROJECT_SSO_IDENTITY_MISMATCH_TITLE,
} from "../Utils/ProjectSsoIdentityBinding";
import SsoTeamMembership, {
  SSO_NO_ROOM_ERROR,
  SSO_NO_ROOM_MESSAGE,
  SSO_NO_ROOM_TITLE,
  SsoTeamMembershipOutcome,
} from "../Utils/SsoTeamMembership";
import { DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import InstanceSamlSigningKeyService from "Common/Server/Services/InstanceSamlSigningKeyService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
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
import ProjectSsoDiscovery from "Common/Server/Utils/ProjectSsoDiscovery";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import User from "Common/Models/DatabaseModels/User";
import Name from "Common/Types/Name";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import FailedSignInAuditLog from "Common/Server/Utils/AuditLog/FailedSignInAuditLog";

const router: ExpressRouter = Express.getRouter();

/*
 * Project SAML sign-in, served by core in every edition. The ACS URL
 * (/identity/idp-login/:projectId/:projectSsoId) is pasted into customers'
 * identity providers, so no path below may ever change:
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins them.
 */

/*
 * The project SAML providers "Sign in with SSO" offers an address: those
 * that list a verified domain of their project with the address's domain
 * (Common/Server/Utils/ProjectSsoDiscovery). No account is read, so the
 * answer, the empty list included, says nothing about whether the address
 * has one (#9745, #9824). The page and the mobile app read an empty list as
 * "no single sign-on for this address".
 */

router.get(
  "/service-provider-login",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.query["email"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Email is required"),
        );
      }

      const email: Email = new Email(req.query["email"] as string);

      const projectSSOList: Array<ProjectSSO> =
        await ProjectSsoDiscovery.findSamlProviders(email);

      return Response.sendEntityArrayResponse(
        req,
        res,
        projectSSOList,
        projectSSOList.length,
        ProjectSSO,
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

router.get(
  "/sso/:projectId/:projectSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.params["projectId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Project ID not found"),
        );
      }

      if (!req.params["projectSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Project SSO ID not found"),
        );
      }

      const projectSSO: ProjectSSO | null = await ProjectSSOService.findOneBy({
        query: {
          projectId: new ObjectID(req.params["projectId"]),
          _id: req.params["projectSsoId"],
          isEnabled: true,
        },
        select: {
          _id: true,
          signOnURL: true,
          issuerURL: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!projectSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config not found"),
        );
      }

      // redirect to Identity Provider.

      if (!projectSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign On URL not found"),
        );
      }

      if (!projectSSO.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Issuer not found"),
        );
      }

      const isMobileRequest: boolean = req.query["mobile"] === "true";

      /*
       * A sign-in the mobile app started keeps its state and PKCE challenge
       * for the round trip (#9989): the flow rides in RelayState, and in
       * the intent cookie for an identity provider that drops RelayState.
       */
      let mobileFlowId: string | null = null;

      if (isMobileRequest) {
        const handOff: { flowId: string | null } | null =
          await startMobileSsoHandOff({
            req,
            res,
            providerId: projectSSO.id!,
            rememberInCookie: true,
          });

        if (!handOff) {
          return;
        }

        mobileFlowId = handOff.flowId;
      }

      // The same Entity ID and Reply URL the response is held to.
      const serviceProvider: SamlServiceProvider =
        SamlServiceProviders.forProjectSso({
          projectId: projectSSO.projectId!,
          projectSsoId: projectSSO.id!,
        });

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(serviceProvider.replyUrl),
        signOnUrl: projectSSO.signOnURL!,
        issuerUrl: URL.fromString(serviceProvider.entityId),
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
  "/idp-login/:projectId/:projectSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await loginUserWithSso(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/idp-login/:projectId/:projectSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await loginUserWithSso(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * The provider's Single Logout URL (#9603), on the HTTP-Redirect (GET) and
 * HTTP-POST bindings: where the identity provider answers the sign-out
 * OneUptime sent a person with, and sends its own. Pasted into identity
 * providers like the Reply URL, so its path may never change either
 * (Utils/SamlSingleLogoutEndpoint).
 */
const takeProjectSingleLogout: (
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
      providerType: SsoProviderType.ProjectSSO,
      providerId: req.params["projectSsoId"],
      projectId: req.params["projectId"],
    });
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));
    return next(err);
  }
};

router.get("/idp-logout/:projectId/:projectSsoId", takeProjectSingleLogout);

router.post("/idp-logout/:projectId/:projectSsoId", takeProjectSingleLogout);

/*
 * The certificate OneUptime signs its SAML sign-out messages with, for an
 * admin to give their identity provider (Okta's Signature Certificate, the
 * signature certificate of a relying party trust). One for every project's
 * provider and the instance's alike, made the first time it is needed
 * (InstanceSamlSigningKeyService). Public, as a service provider's
 * certificate is.
 */
router.get(
  "/saml-signing-certificate",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const certificate: string =
        await InstanceSamlSigningKeyService.getCertificate();

      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="oneuptime-saml-signing.crt"',
      );

      return Response.sendTextResponse(req, res, certificate);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(new ServerException());
    }
  },
);

/*
 * The answer to a sign-in through a project's SAML provider that names the
 * account's address but another person (ProjectSsoIdentityBinding): the page
 * that says so, or the mobile app's deep link. Logged for the project's
 * admins, without either person's object ID.
 */
const refuseSignInAsAnotherPerson: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  isMobileRequest: boolean;
  projectSsoId: ObjectID;
  userId: ObjectID;
}) => void = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  isMobileRequest: boolean;
  projectSsoId: ObjectID;
  userId: ObjectID;
}): void => {
  logger.warn(
    `Refused a SAML sign-in through project SSO ${data.projectSsoId.toString()}: the identity provider named the address of user ${data.userId.toString()} with an object ID other than the one the account is bound to.`,
    getLogAttributesFromRequest(data.req as RequestLike),
  );

  if (
    respondToMobileSsoFailure({
      res: data.res,
      isMobileRequest: data.isMobileRequest,
      error: PROJECT_SSO_IDENTITY_MISMATCH_ERROR,
      errorDescription: PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE,
    })
  ) {
    return;
  }

  Response.render(
    data.req,
    data.res,
    "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
    {
      title: PROJECT_SSO_IDENTITY_MISMATCH_TITLE,
      message: PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE,
    },
  );
};

type LoginUserWithSsoFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void>;

const loginUserWithSso: LoginUserWithSsoFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    const samlResponseBase64: string = req.body.SAMLResponse;

    if (!samlResponseBase64) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("SAMLResponse not found"),
      );
    }

    const samlResponse: string = Buffer.from(
      samlResponseBase64,
      "base64",
    ).toString();

    let verifiedSaml: VerifiedSamlResponse;
    let issuerUrl: string = "";
    let email: Email | null = null;
    let fullName: Name | null = null;

    if (!req.params["projectId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Project ID not found"),
      );
    }

    if (!req.params["projectSsoId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Project SSO ID not found"),
      );
    }

    const projectSSO: ProjectSSO | null = await ProjectSSOService.findOneBy({
      query: {
        projectId: new ObjectID(req.params["projectId"]),
        _id: req.params["projectSsoId"],
        isEnabled: true,
      },
      select: {
        _id: true,
        // The audit log's sign-in entry names the provider (SessionSignIn).
        name: true,
        signOnURL: true,
        issuerURL: true,
        publicCertificate: true,
        // Whether the session keeps what signing out of the provider too takes.
        signOutOfIdentityProvider: true,
        teams: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectSSO) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("SSO Config not found"),
      );
    }

    // redirect to Identity Provider.

    if (!projectSSO.issuerURL) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Issuer URL not found"),
      );
    }

    // redirect to Identity Provider.

    if (!projectSSO.signOnURL) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Sign on URL not found"),
      );
    }

    if (!projectSSO.publicCertificate) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Public Certificate not found"),
      );
    }

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
        projectSSO.publicCertificate,
        SamlServiceProviders.forProjectSso({
          projectId: req.params["projectId"],
          projectSsoId: req.params["projectSsoId"],
        }),
      );

      issuerUrl = verifiedSaml.issuerUrl;
      email = verifiedSaml.email;
      fullName = verifiedSaml.name;
    } catch (err: unknown) {
      if (err instanceof Exception) {
        return Response.sendErrorResponse(req, res, err);
      }
      return Response.sendErrorResponse(req, res, new ServerException());
    }

    if (projectSSO.issuerURL.toString() !== issuerUrl) {
      logger.error(
        "Issuer URL does not match. It should be " +
          projectSSO.issuerURL.toString() +
          " but it is " +
          issuerUrl.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Issuer URL does not match"),
      );
    }

    /*
     * One sign-in per response: a response posted again - kept from an
     * earlier sign-in, or sent twice - is refused before anyone is looked
     * up, created or signed in. Remembered under the provider the lookup
     * found, not under the Reply URL's spelling of its id, so no other way
     * of writing that URL starts a second record.
     */
    try {
      await SamlAssertionOneTimeUse.claim({
        providerKind: SamlProviderKind.ProjectSso,
        providerId: projectSSO.id!,
        assertion: verifiedSaml,
      });
    } catch (err: unknown) {
      if (err instanceof Exception) {
        return Response.sendErrorResponse(req, res, err);
      }
      return Response.sendErrorResponse(req, res, new ServerException());
    }

    /*
     * A mobile sign-in by RelayState, or by the intent cookie its start set
     * for an identity provider that drops RelayState - with the hand-off
     * flow it carries (#9989), read before the cookie is cleared so a later
     * web sign-in through this provider is not sent to the app.
     */
    const isMobileRequest: boolean = isMobileSsoRequest({
      req,
      providerId: projectSSO.id!,
    });
    const mobileFlowId: string | null = isMobileRequest
      ? readMobileSsoFlowId({ req, providerId: projectSSO.id! })
      : null;

    if (isMobileRequest) {
      clearMobileSsoIntentCookie(res, projectSSO.id!);
    }

    /*
     * Whom this project's provider may sign in, and what everyone else is
     * told: one answer, in the same time, whether the address has no
     * account, one that has not confirmed this project's sign-in, a blocked
     * one or an administrator's (#9824). See ../Utils/ProjectSsoSignInGate.ts.
     */
    const decision: ProjectSsoGateDecision = await ProjectSsoSignInGate.decide({
      email: email,
      name: fullName,
      projectId: new ObjectID(req.params["projectId"] as string),
      kind: ProjectSsoKind.SAML,
      providerId: projectSSO.id!,
      origin: RequestOriginUtil.fromRequest(req),
    });

    /*
     * A sign-in the provider vouched for that OneUptime refuses, for the
     * audit log of every project the account's person is a member of
     * (issue #6788), after the answer (FailedSignInAuditLog). The provider
     * is this project's: only this project's entry names it.
     */
    const recordRefusedSignIn: (
      userId: ObjectID,
      reason: SignInFailureReason,
    ) => void = (userId: ObjectID, reason: SignInFailureReason): void => {
      FailedSignInAuditLog.record({
        req: req,
        userId: userId,
        reason: reason,
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: projectSSO.name,
          ssoProjectId: new ObjectID(req.params["projectId"] as string),
        },
      });
    };

    if (decision.outcome !== ProjectSsoGateOutcome.SignIn) {
      const failureReason: SignInFailureReason | null =
        ProjectSsoSignInGate.getFailureReason(decision.reason);

      if (failureReason && decision.user?.id) {
        recordRefusedSignIn(decision.user.id, failureReason);
      }

      return ProjectSsoSignInGate.respondNotSignedIn({
        req,
        res,
        isMobileRequest,
        outcome: decision.outcome,
      });
    }

    let alreadySavedUser: User = decision.user!;
    const isNewUser: boolean = decision.isNewUser;

    /*
     * Through this provider the account is bound to another person: whoever
     * holds its address in the identity provider now is not who signed it
     * in before. Refused before anything is emailed, provisioned or signed
     * in. See ../Utils/ProjectSsoIdentityBinding.ts.
     */
    if (
      !isNewUser &&
      (await ProjectSsoIdentityBinding.isBoundToAnotherPerson({
        projectSsoId: projectSSO.id!,
        userId: alreadySavedUser.id!,
        objectId: verifiedSaml.objectId,
      }))
    ) {
      recordRefusedSignIn(
        alreadySavedUser.id!,
        SignInFailureReason.SingleSignOnRefused,
      );

      return refuseSignInAsAnotherPerson({
        req,
        res,
        isMobileRequest,
        projectSsoId: projectSSO.id!,
        userId: alreadySavedUser.id!,
      });
    }

    // check if the user already belongs to the project
    const teamMemberCount: PositiveNumber = await TeamMemberService.countBy({
      query: {
        projectId: new ObjectID(req.params["projectId"] as string),
        userId: alreadySavedUser!.id!,
      },
      props: {
        isRoot: true,
      },
    });

    if (teamMemberCount.toNumber() === 0) {
      // user not in project, add him to default teams.

      if (!projectSSO.teams || projectSSO.teams.length === 0) {
        return Response.render(
          req,
          res,
          "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
          {
            title: "No teams added.",
            message:
              "No teams have been added to this SSO config. Please contact your admin and have default teams added.",
          },
        );
      }

      /*
       * They take a seat like anyone invited: a project with no room for
       * one more person adds them nowhere, and they are told so.
       */
      if (
        (await SsoTeamMembership.addToTeams({
          projectId: new ObjectID(req.params["projectId"] as string),
          userId: alreadySavedUser.id!,
          teams: projectSSO.teams,
        })) === SsoTeamMembershipOutcome.NoRoom
      ) {
        if (
          respondToMobileSsoFailure({
            res,
            isMobileRequest,
            error: SSO_NO_ROOM_ERROR,
            errorDescription: SSO_NO_ROOM_MESSAGE,
          })
        ) {
          return;
        }

        return Response.render(
          req,
          res,
          "/usr/src/app/FeatureSet/Identity/Views/Message.ejs",
          {
            title: SSO_NO_ROOM_TITLE,
            message: SSO_NO_ROOM_MESSAGE,
          },
        );
      }
    }

    const projectId: ObjectID = new ObjectID(req.params["projectId"] as string);

    // The sign-in is going through: bind the account to the person, the first time.
    if (
      !(await ProjectSsoIdentityBinding.bindOrRefuse({
        projectId: projectId,
        projectSsoId: projectSSO.id!,
        userId: alreadySavedUser.id!,
        objectId: verifiedSaml.objectId,
      }))
    ) {
      recordRefusedSignIn(
        alreadySavedUser.id!,
        SignInFailureReason.SingleSignOnRefused,
      );

      return refuseSignInAsAnotherPerson({
        req,
        res,
        isMobileRequest,
        projectSsoId: projectSSO.id!,
        userId: alreadySavedUser.id!,
      });
    }

    /*
     * Signing in through this project's own single sign-on is the person
     * joining it: an invitation into it still pending is accepted (#9819),
     * and an address the provider vouched for is verified, as for an
     * account it makes - after the memberships, so their defaults are made,
     * and once the person is bound, so a refused sign-in accepts nothing.
     */
    alreadySavedUser = await ProjectSsoSignInGate.joinOnSignIn({
      user: alreadySavedUser,
      projectId: projectId,
    });

    alreadySavedUser.email = email;

    // Refresh Permissions for this user here.
    await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

    const sessionMetadata: SessionMetadata =
      await UserSessionService.createSession({
        userId: alreadySavedUser.id!,
        isGlobalLogin: false,
        ipAddress: getClientIp(req),
        userAgent: headerValueToString(req.headers["user-agent"]),
        ...extractDeviceInfo(req),
        additionalInfo: {
          projectId: projectId.toString(),
        },
        requestOrigin: RequestOriginUtil.fromRequest(req),
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: projectSSO.name,
          ssoProjectId: projectId,
        },
        /*
         * With the provider's "Sign out of the identity provider too" on, a
         * browser sign-in keeps what the assertion named the person and
         * their session by, encrypted, for its sign-out at the provider
         * (Utils/IdentityProviderSignOut, #9603).
         */
        identityProviderSignOut: IdentityProviderSignOut.forSamlSignIn({
          signOutOfIdentityProvider: projectSSO.signOutOfIdentityProvider,
          isMobileRequest: isMobileRequest,
          providerType: SsoProviderType.ProjectSSO,
          providerId: projectSSO.id!,
          assertion: verifiedSaml,
        }),
      });

    if (isMobileRequest) {
      // For mobile SSO, generate an access token and redirect to the app deep link
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

      // Generate SSO token for per-project authentication (same as setSSOCookie)
      const ssoToken: string = CookieUtil.getSSOToken({
        user: alreadySavedUser,
        projectId: projectId,
        ssoProviderId: new ObjectID(req.params["projectSsoId"] as string),
        ssoProviderType: SsoProviderType.ProjectSSO,
        expiresInSeconds: sessionMetadata.ssoSignInExpiresInSeconds,
      });

      logger.info(
        "User logged in with SSO (mobile): " + email.toString(),
        getLogAttributesFromRequest(req as RequestLike),
      );

      /*
       * A one-time code the app redeems with its PKCE verifier, or - for an
       * app from before #9989 - the deep link that carries the session
       * (Utils/MobileSso).
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
          ssoToken,
          projectId: projectId.toString(),
        },
      });
    }

    CookieUtil.setSSOCookie({
      user: alreadySavedUser,
      projectId: projectId,
      expressResponse: res,
      ssoProviderId: new ObjectID(req.params["projectSsoId"] as string),
      ssoProviderType: SsoProviderType.ProjectSSO,
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
      "User logged in with SSO: " + email.toString(),
      getLogAttributesFromRequest(req as RequestLike),
    );

    return Response.redirect(
      req,
      res,
      new URL(
        httpProtocol,
        host,
        new Route(DashboardRoute.toString()).addRoute(
          "/" + req.params["projectId"],
        ),
      ),
    );
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));

    Response.sendErrorResponse(req, res, err as Exception);
  }
};

export default router;
