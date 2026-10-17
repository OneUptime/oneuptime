import SSOUtil, { VerifiedSamlResponse } from "../Utils/SSO";
import SamlAssertionOneTimeUse, {
  SamlProviderKind,
} from "../Utils/SamlAssertionOneTimeUse";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "../Utils/SamlServiceProvider";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService, {
  SessionMetadata as StatusPageSessionMetadata,
} from "Common/Server/Services/StatusPagePrivateUserSessionService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSsoService from "Common/Server/Services/StatusPageSsoService";
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
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";

// Initialize Express router.
const router: ExpressRouter = Express.getRouter();

/*
 * Status page SAML sign-in, served by core in every edition. The ACS URL
 * (/identity/status-page-idp-login/:statusPageId/:statusPageSsoId) is pasted
 * into customers' identity providers, so no path below may ever change:
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins them.
 */

// Define a GET route for SSO in a status page context.
router.get(
  "/status-page-sso/:statusPageId/:statusPageSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Check if statusPageId parameter is present.
      if (!req.params["statusPageId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page ID not found"),
        );
      }

      // Check if statusPageSsoId parameter is present.
      if (!req.params["statusPageSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page SSO ID not found"),
        );
      }

      // Create ObjectID instance from statusPageId parameter.
      const statusPageId: ObjectID = new ObjectID(req.params["statusPageId"]);

      // Find SSO record in the database with specific query parameters.
      const statusPageSSO: StatusPageSSO | null =
        await StatusPageSsoService.findOneBy({
          query: {
            statusPageId: statusPageId, // Ensure that statusPageId matches.
            _id: req.params["statusPageSsoId"], // Ensure SSO ID matches.
            isEnabled: true, // Ensure the SSO is enabled.
          },
          select: {
            signOnURL: true,
            statusPageId: true,
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!statusPageSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config not found"),
        );
      }

      // redirect to Identity Provider.

      if (!statusPageSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign On URL not found"),
        );
      }

      // The same Entity ID and Reply URL the response is held to.
      const serviceProvider: SamlServiceProvider =
        SamlServiceProviders.forStatusPageSso({
          statusPageId: statusPageSSO.statusPageId!,
          statusPageSsoId: statusPageSSO.id!,
        });

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(serviceProvider.replyUrl),
        signOnUrl: statusPageSSO.signOnURL!,
        issuerUrl: URL.fromString(serviceProvider.entityId),
      });

      return Response.redirect(req, res, samlRequestUrl);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/status-page-idp-login/:statusPageId/:statusPageSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const samlResponseBase64: string = req.body.SAMLResponse;

      const samlResponse: string = Buffer.from(
        samlResponseBase64,
        "base64",
      ).toString();

      let verifiedSaml: VerifiedSamlResponse;
      let issuerUrl: string = "";
      let email: Email | null = null;

      if (!req.params["statusPageId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page ID not found"),
        );
      }

      if (!req.params["statusPageSsoId"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Status Page SSO ID not found"),
        );
      }

      const statusPageId: ObjectID = new ObjectID(req.params["statusPageId"]);

      const statusPageSSO: StatusPageSSO | null =
        await StatusPageSsoService.findOneBy({
          query: {
            statusPageId: statusPageId,
            _id: req.params["statusPageSsoId"],
            isEnabled: true,
          },
          select: {
            _id: true,
            signOnURL: true,
            issuerURL: true,
            publicCertificate: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!statusPageSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config not found"),
        );
      }

      if (!statusPageSSO.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("SSO Config Project ID not found"),
        );
      }

      const projectId: ObjectID = statusPageSSO.projectId;

      // redirect to Identity Provider.

      if (!statusPageSSO.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Issuer URL not found"),
        );
      }

      // redirect to Identity Provider.

      if (!statusPageSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Sign on URL not found"),
        );
      }

      if (!statusPageSSO.publicCertificate) {
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
          statusPageSSO.publicCertificate,
          SamlServiceProviders.forStatusPageSso({
            statusPageId: statusPageId,
            statusPageSsoId: req.params["statusPageSsoId"],
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

      if (statusPageSSO.issuerURL.toString() !== issuerUrl) {
        return Response.sendErrorResponse(
          req,

          res,
          new BadRequestException("Issuer URL does not match"),
        );
      }

      /*
       * One sign-in per response: a response posted again - kept from an
       * earlier sign-in, or sent twice - is refused before any private user
       * is looked up, created or signed in. Remembered under the provider
       * the lookup found, not under the Reply URL's spelling of its id, so
       * no other way of writing that URL starts a second record.
       */
      try {
        await SamlAssertionOneTimeUse.claim({
          providerKind: SamlProviderKind.StatusPageSso,
          providerId: statusPageSSO.id!,
          assertion: verifiedSaml,
        });
      } catch (err: unknown) {
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(req, res, new ServerException());
      }

      // Check if he already belongs to the project, If he does - then log in.

      let alreadySavedUser: StatusPagePrivateUser | null =
        await StatusPagePrivateUserService.findOneBy({
          query: { email: email, statusPageId: statusPageId },
          select: {
            _id: true,
            email: true,
            statusPageId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!alreadySavedUser) {
        /// Create a user.

        alreadySavedUser = new StatusPagePrivateUser();
        alreadySavedUser.projectId = projectId;
        alreadySavedUser.statusPageId = statusPageId;
        alreadySavedUser.email = email;
        alreadySavedUser.password = new HashedString(
          ObjectID.generate().toString(),
        );
        alreadySavedUser.isSsoUser = true;

        alreadySavedUser = await StatusPagePrivateUserService.create({
          data: alreadySavedUser,
          props: { isRoot: true },
        });
      }

      if (!alreadySavedUser.projectId) {
        alreadySavedUser.projectId = projectId;
      }

      /*
       * The session names the provider that signed the person in: it counts
       * only while that provider vouches for it, so turning it off or
       * deleting it ends the session (StatusPagePrivateUserSessionService.
       * addSignInRule).
       */
      const sessionMetadata: StatusPageSessionMetadata =
        await StatusPagePrivateUserSessionService.createLoginCodeSession({
          projectId: alreadySavedUser.projectId!,
          statusPageId: statusPageId,
          statusPagePrivateUserId: alreadySavedUser.id!,
          statusPageSsoId: statusPageSSO.id!,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      // get status page URL.
      const statusPageURL: string =
        await StatusPageService.getStatusPageFirstURL(statusPageId);

      Response.setNoCacheHeaders(res);

      return Response.redirect(
        req,
        res,
        URL.fromString(statusPageURL).addQueryParams({
          loginCode: sessionMetadata.refreshToken,
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
