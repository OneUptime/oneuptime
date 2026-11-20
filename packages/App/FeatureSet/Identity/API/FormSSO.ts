import SSOUtil, { VerifiedSamlResponse } from "../Utils/SSO";
import FormSignIn from "../Utils/FormSignIn";
import SamlAssertionOneTimeUse, {
  SamlProviderKind,
} from "../Utils/SamlAssertionOneTimeUse";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "../Utils/SamlServiceProvider";
import URL from "Common/Types/API/URL";
import { FORM_LOGIN_CODE_PARAMETER } from "Common/Types/Form/FormPrivateUserSignIn";
import Email from "Common/Types/Email";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import FormPrivateUserService from "Common/Server/Services/FormPrivateUserService";
import FormPrivateUserSessionService from "Common/Server/Services/FormPrivateUserSessionService";
import FormService from "Common/Server/Services/FormService";
import FormSsoService from "Common/Server/Services/FormSsoService";
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
import FormPrivateUser from "Common/Models/DatabaseModels/FormPrivateUser";
import FormPrivateUserSession from "Common/Models/DatabaseModels/FormPrivateUserSession";
import FormSSO from "Common/Models/DatabaseModels/FormSso";

const router: ExpressRouter = Express.getRouter();

/*
 * ---------------------------------------------------------------------------
 * A FORM'S SAML SIGN-IN (#10249), for the people who open its public
 * link when it asks its visitors to sign in - as a status page's
 * (StatusPageSSO), served by core in every edition. The ACS URL
 * (/identity/form-idp-login/:formId/:formSsoId) is pasted
 * into customers' identity providers, so no path below may ever change:
 * Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins them.
 *
 * The response is held to this provider's own Entity ID and Reply URL
 * (SamlServiceProviders.forFormSso), its signature and its time
 * (SSOUtil.getSamlResponseFromXML), its issuer, and one use
 * (SamlAssertionOneTimeUse) - the checks every SAML Reply URL makes,
 * pinned by SamlSignInRoutesGuard. Only then is the person looked up, and
 * made one of the form's private users the first time - the identity
 * provider decides who may sign in, as on a status page.
 *
 * It ends on OneUptime's own address, where the identity provider sends
 * the person: they are handed back to the form's public link - its
 * custom domain first - with a code good for five minutes, once, which the
 * page exchanges for its session on its own host
 * (FormPrivateUserAuthentication's exchange-login-code).
 * ---------------------------------------------------------------------------
 */

router.get(
  "/form-sso/:formId/:formSsoId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const formId: ObjectID = FormSignIn.readFormId(req.params["formId"]);

      if (
        !req.params["formSsoId"] ||
        !ObjectID.isValidUUID(req.params["formSsoId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This sign-in link names no single sign-on provider. Open the form's link and sign in from there.",
          ),
        );
      }

      // A form whose link signs nobody in starts no sign-in.
      await FormSignIn.getFormForSignIn({ req, formId });

      const formSSO: FormSSO | null = await FormSsoService.findOneBy({
        query: {
          formId: formId,
          _id: req.params["formSsoId"],
          isEnabled: true,
        },
        select: {
          _id: true,
          signOnURL: true,
          formId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!formSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider is not set up for this form, or is turned off. Ask the form's team to check its Single Sign-On settings.",
          ),
        );
      }

      if (!formSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no Sign On URL. Ask the form's team to add it on the form's Single Sign-On page.",
          ),
        );
      }

      // The same Entity ID and Reply URL the response is held to.
      const serviceProvider: SamlServiceProvider =
        SamlServiceProviders.forFormSso({
          formId: formSSO.formId!,
          formSsoId: formSSO.id!,
        });

      const samlRequestUrl: URL = SSOUtil.createSAMLRequestUrl({
        acsUrl: URL.fromString(serviceProvider.replyUrl),
        signOnUrl: formSSO.signOnURL!,
        issuerUrl: URL.fromString(serviceProvider.entityId),
      });

      return Response.redirect(req, res, samlRequestUrl);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/form-idp-login/:formId/:formSsoId",
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
            "The identity provider sent no SAML response. Open the form's link and sign in again.",
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

      const formId: ObjectID = FormSignIn.readFormId(req.params["formId"]);

      if (
        !req.params["formSsoId"] ||
        !ObjectID.isValidUUID(req.params["formSsoId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This sign-in link names no single sign-on provider. Open the form's link and sign in from there.",
          ),
        );
      }

      const formSSO: FormSSO | null = await FormSsoService.findOneBy({
        query: {
          formId: formId,
          _id: req.params["formSsoId"],
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

      if (!formSSO) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider is not set up for this form, or is turned off. Ask the form's team to check its Single Sign-On settings.",
          ),
        );
      }

      if (!formSSO.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider belongs to no project. Ask the form's team to set it up again.",
          ),
        );
      }

      const projectId: ObjectID = formSSO.projectId;

      if (!formSSO.issuerURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no Issuer URL. Ask the form's team to add it on the form's Single Sign-On page.",
          ),
        );
      }

      if (!formSSO.signOnURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no Sign On URL. Ask the form's team to add it on the form's Single Sign-On page.",
          ),
        );
      }

      if (!formSSO.publicCertificate) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This single sign-on provider has no public certificate. Ask the form's team to add it on the form's Single Sign-On page.",
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
          formSSO.publicCertificate,
          SamlServiceProviders.forFormSso({
            formId: formId,
            formSsoId: formSSO.id!,
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

      if (formSSO.issuerURL.toString() !== issuerUrl) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "The identity provider that signed this response is not the one this form trusts. Ask the form's team to check the provider's Issuer URL.",
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
          providerKind: SamlProviderKind.FormSso,
          providerId: formSSO.id!,
          assertion: verifiedSaml,
        });
      } catch (err: unknown) {
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(req, res, new ServerException());
      }

      /*
       * The form must still ask its visitors to sign in, and its IP
       * allowlist let this visitor in: a form switched to another
       * choice since makes no private user and no session.
       */
      await FormSignIn.getFormForSignIn({ req, formId });

      let privateUser: FormPrivateUser | null =
        await FormPrivateUserService.findOneBy({
          query: { email: email, formId: formId },
          select: {
            _id: true,
            email: true,
            formId: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      // The identity provider vouches for them: they become a private user.
      if (!privateUser) {
        const newPrivateUser: FormPrivateUser = new FormPrivateUser();
        newPrivateUser.projectId = projectId;
        newPrivateUser.formId = formId;
        newPrivateUser.email = email;
        newPrivateUser.isSsoUser = true;

        privateUser = await FormPrivateUserService.create({
          data: newPrivateUser,
          props: { isRoot: true },
        });
      }

      /*
       * The session names the provider that signed the person in: it counts
       * only while that provider vouches for it, so turning it off or
       * deleting it ends the session (FormPrivateUserSessionService.
       * addSignInRule).
       */
      const sessionMetadata: PrivateUserSessionMetadata<FormPrivateUserSession> =
        await FormPrivateUserSessionService.createLoginCodeSession({
          projectId: privateUser.projectId || projectId,
          resourceId: formId,
          privateUserId: privateUser.id!,
          ssoProviderId: formSSO.id!,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          signIn: {
            method: SignInMethod.Saml,
            ssoProviderName: formSSO.name,
          },
          requestOrigin: RequestOriginUtil.fromRequest(req),
        });

      const formUrl: string = await FormService.getPublicFormUrl(formId);

      Response.setNoCacheHeaders(res);

      return Response.redirect(
        req,
        res,
        URL.fromString(formUrl).addQueryParams({
          [FORM_LOGIN_CODE_PARAMETER]: sessionMetadata.refreshToken,
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
