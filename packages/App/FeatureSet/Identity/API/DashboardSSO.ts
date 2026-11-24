import SSOUtil, { VerifiedSamlResponse } from "../Utils/SSO";
import DashboardSignIn from "../Utils/DashboardSignIn";
import SamlAssertionOneTimeUse, {
  SamlProviderKind,
} from "../Utils/SamlAssertionOneTimeUse";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "../Utils/SamlServiceProvider";
import URL from "Common/Types/API/URL";
import { DASHBOARD_LOGIN_CODE_PARAMETER } from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import DashboardPrivateUserService from "Common/Server/Services/DashboardPrivateUserService";
import DashboardPrivateUserSessionService from "Common/Server/Services/DashboardPrivateUserSessionService";
import DashboardService from "Common/Server/Services/DashboardService";
import DashboardSsoService from "Common/Server/Services/DashboardSsoService";
import { PrivateUserSessionMetadata } from "Common/Server/Services/PrivateUserSessionServiceBase";
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
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import Response from "Common/Server/Utils/Response";
import DashboardPrivateUser from "Common/Models/DatabaseModels/DashboardPrivateUser";
import DashboardPrivateUserSession from "Common/Models/DatabaseModels/DashboardPrivateUserSession";
import DashboardSSO from "Common/Models/DatabaseModels/DashboardSso";

const router: ExpressRouter = Express.getRouter();

/*
 * ---------------------------------------------------------------------------
 * A DASHBOARD'S SAML SIGN-IN (#10250), for the people who open its public
 * link when it asks its visitors to sign in - as a status page's
 * (StatusPageSSO), served by core in every edition. The ACS URL
 * (/identity/dashboard-idp-login/:dashboardId/:dashboardSsoId) is pasted
 * into customers' identity providers, so no path below may ever change:
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins them.
 *
 * The response is held to this provider's own Entity ID and Reply URL
 * (SamlServiceProviders.forDashboardSso), its signature and its time
 * (SSOUtil.getSamlResponseFromXML), its issuer, and one use
 * (SamlAssertionOneTimeUse) - the checks every SAML Reply URL makes,
 * pinned by SamlSignInRoutesGuard. Only then is the person looked up, and
 * made one of the dashboard's private users the first time - the identity
 * provider decides who may sign in, as on a status page.
 *
 * It ends on OneUptime's own address, where the identity provider sends
 * the person: they are handed back to the dashboard's public link - its
 * custom domain first - with a code good for five minutes, once, which the
 * page exchanges for its session on its own host
 * (DashboardPrivateUserAuthentication's exchange-login-code).
 * ---------------------------------------------------------------------------
 */

router.get(
  "/dashboard-sso/:dashboardId/:dashboardSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const dashboardId: ObjectID = DashboardSignIn.readDashboardId(
        req.params["dashboardId"],
      );

      if (
        !req.params["dashboardSsoId"] ||
        !ObjectID.isValidUUID(req.params["dashboardSsoId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This sign-in link names no single sign-on provider. Open the dashboard's link and sign in from there.",
          ),
        );
      }

      // A dashboard whose link signs nobody in starts no sign-in.
      await DashboardSignIn.getDashboardForSignIn({ req, dashboardId });

      const dashboardSSO: DashboardSSO | null =
        await DashboardSsoService.findOneBy({
          query: {
            dashboardId: dashboardId,
            _id: req.params["dashboardSsoId"],
            isEnabled: true,
          },
          select: {
            _id: true,
            signOnURL: true,
            dashboardId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!dashboardSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider is not set up for this dashboard, or is turned off. Ask the dashboard's team to check its Single Sign-On settings.",
          ),
        );
      }

      if (!dashboardSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no Sign On URL. Ask the dashboard's team to add it on the dashboard's Single Sign-On page.",
          ),
        );
      }

      // The same Entity ID and Reply URL the response is held to.
      const serviceProvider: SamlServiceProvider =
        SamlServiceProviders.forDashboardSso({
          dashboardId: dashboardSSO.dashboardId!,
          dashboardSsoId: dashboardSSO.id!,
        });

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(serviceProvider.replyUrl),
        signOnUrl: dashboardSSO.signOnURL!,
        issuerUrl: URL.fromString(serviceProvider.entityId),
      });

      return Response.redirect(req, res, samlRequestUrl);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/dashboard-idp-login/:dashboardId/:dashboardSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const samlResponseBase64: unknown = req.body
        ? req.body["SAMLResponse"]
        : undefined;

      if (typeof samlResponseBase64 !== "string" || !samlResponseBase64) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "The identity provider sent no SAML response. Open the dashboard's link and sign in again.",
          ),
        );
      }

      const samlResponse: string = Buffer.from(
        samlResponseBase64,
        "base64",
      ).toString();

      let verifiedSaml: VerifiedSamlResponse;
      let issuerUrl: string = "";
      let email: Email | null = null;

      const dashboardId: ObjectID = DashboardSignIn.readDashboardId(
        req.params["dashboardId"],
      );

      if (
        !req.params["dashboardSsoId"] ||
        !ObjectID.isValidUUID(req.params["dashboardSsoId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This sign-in link names no single sign-on provider. Open the dashboard's link and sign in from there.",
          ),
        );
      }

      const dashboardSSO: DashboardSSO | null =
        await DashboardSsoService.findOneBy({
          query: {
            dashboardId: dashboardId,
            _id: req.params["dashboardSsoId"],
            isEnabled: true,
          },
          select: {
            _id: true,
            name: true,
            signOnURL: true,
            issuerURL: true,
            publicCertificate: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!dashboardSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider is not set up for this dashboard, or is turned off. Ask the dashboard's team to check its Single Sign-On settings.",
          ),
        );
      }

      if (!dashboardSSO.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider belongs to no project. Ask the dashboard's team to set it up again.",
          ),
        );
      }

      const projectId: ObjectID = dashboardSSO.projectId;

      if (!dashboardSSO.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no Issuer URL. Ask the dashboard's team to add it on the dashboard's Single Sign-On page.",
          ),
        );
      }

      if (!dashboardSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no Sign On URL. Ask the dashboard's team to add it on the dashboard's Single Sign-On page.",
          ),
        );
      }

      if (!dashboardSSO.publicCertificate) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no public certificate. Ask the dashboard's team to add it on the dashboard's Single Sign-On page.",
          ),
        );
      }

      try {
        /*
         * Verify the signature AND extract the identity from the SAME
         * cryptographically verified assertion. This single call defends
         * against XML Signature Wrapping - see SSOUtil.getSamlResponseFromXML
         * - and refuses a response made for anything but this provider, or
         * outside its time.
         */
        verifiedSaml = SSOUtil.getSamlResponseFromXML(
          samlResponse,
          dashboardSSO.publicCertificate,
          SamlServiceProviders.forDashboardSso({
            dashboardId: dashboardId,
            dashboardSsoId: dashboardSSO.id!,
          }),
        );

        issuerUrl = verifiedSaml.issuerUrl;
        email = verifiedSaml.email;
      } catch (err: unknown) {
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(req, res, new ServerException());
      }

      if (dashboardSSO.issuerURL.toString() !== issuerUrl) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "The identity provider that signed this response is not the one this dashboard trusts. Ask the dashboard's team to check the provider's Issuer URL.",
          ),
        );
      }

      if (!email) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "The identity provider sent no email address. Ask its admin to send the email address in the SAML response.",
          ),
        );
      }

      /*
       * One sign-in per response: a response posted again - kept from an
       * earlier sign-in, or sent twice - is refused before any private user
       * is looked up, made or signed in. Remembered under the provider the
       * lookup found, never under the Reply URL's spelling of its id.
       */
      try {
        await SamlAssertionOneTimeUse.claim({
          providerKind: SamlProviderKind.DashboardSso,
          providerId: dashboardSSO.id!,
          assertion: verifiedSaml,
        });
      } catch (err: unknown) {
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(req, res, new ServerException());
      }

      /*
       * The dashboard must still ask its visitors to sign in, and its IP
       * allowlist let this visitor in: a dashboard switched to another
       * choice since makes no private user and no session.
       */
      await DashboardSignIn.getDashboardForSignIn({ req, dashboardId });

      let privateUser: DashboardPrivateUser | null =
        await DashboardPrivateUserService.findOneBy({
          query: { email: email, dashboardId: dashboardId },
          select: {
            _id: true,
            email: true,
            dashboardId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      // The identity provider vouches for them: they become a private user.
      if (!privateUser) {
        const newPrivateUser: DashboardPrivateUser = new DashboardPrivateUser();
        newPrivateUser.projectId = projectId;
        newPrivateUser.dashboardId = dashboardId;
        newPrivateUser.email = email;
        newPrivateUser.isSsoUser = true;

        privateUser = await DashboardPrivateUserService.create({
          data: newPrivateUser,
          props: { isRoot: true },
        });
      }

      /*
       * The session names the provider that signed the person in: it counts
       * only while that provider vouches for it, so turning it off or
       * deleting it ends the session (DashboardPrivateUserSessionService.
       * addSignInRule).
       */
      const sessionMetadata: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await DashboardPrivateUserSessionService.createLoginCodeSession({
          projectId: privateUser.projectId || projectId,
          resourceId: dashboardId,
          privateUserId: privateUser.id!,
          ssoProviderId: dashboardSSO.id!,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          signIn: {
            method: SignInMethod.Saml,
            ssoProviderName: dashboardSSO.name,
          },
          requestOrigin: RequestOriginUtil.fromRequest(req),
        });

      const dashboardUrl: string =
        await DashboardService.getPublicDashboardUrl(dashboardId);

      Response.setNoCacheHeaders(res);

      return Response.redirect(
        req,
        res,
        URL.fromString(dashboardUrl).addQueryParams({
          [DASHBOARD_LOGIN_CODE_PARAMETER]: sessionMetadata.refreshToken,
        }),
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

export default router;
