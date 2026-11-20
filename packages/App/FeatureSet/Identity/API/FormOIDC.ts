import OIDCUtil, { OidcCallbackResult } from "../Utils/OIDC";
import FormSignIn from "../Utils/FormSignIn";
import URL from "Common/Types/API/URL";
import { FORM_LOGIN_CODE_PARAMETER } from "Common/Types/Form/FormPrivateUserSignIn";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";
import ObjectID from "Common/Types/ObjectID";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import FormOidcService from "Common/Server/Services/FormOidcService";
import FormPrivateUserService from "Common/Server/Services/FormPrivateUserService";
import FormPrivateUserSessionService from "Common/Server/Services/FormPrivateUserSessionService";
import FormService from "Common/Server/Services/FormService";
import { PrivateUserSessionMetadata } from "Common/Server/Services/PrivateUserSessionServiceBase";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  extractDeviceInfo,
  getClientIp,
  headerValueToString,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import Response from "Common/Server/Utils/Response";
import FormOIDC from "Common/Models/DatabaseModels/FormOidc";
import FormPrivateUser from "Common/Models/DatabaseModels/FormPrivateUser";
import FormPrivateUserSession from "Common/Models/DatabaseModels/FormPrivateUserSession";
import { Client } from "openid-client";

const router: ExpressRouter = Express.getRouter();

const OIDC_STATE_COOKIE_TTL_SECONDS: number = 10 * 60;

const getOidcStateCookieName: (formOidcId: ObjectID) => string = (
  formOidcId: ObjectID,
): string => {
  return `form-oidc-state-${formOidcId.toString()}`;
};

/*
 * The redirect URI a form's OIDC provider is configured with, on
 * OneUptime's own address - shown on the form's Single Sign-On page
 * (Forms/View/SingleSignOn) exactly so.
 */
const getRedirectUri: (data: {
  formId: string;
  formOidcId: string;
}) => URL = (data: { formId: string; formOidcId: string }): URL => {
  return URL.fromString(
    `${HttpProtocol}${Host}/identity/form-oidc-callback/${data.formId}/${data.formOidcId}`,
  );
};

/*
 * ---------------------------------------------------------------------------
 * A FORM'S OPENID CONNECT SIGN-IN (#10249), for the people who open
 * its public link when it asks its visitors to sign in - as a status page's
 * (StatusPageOIDC), served by core in every edition. The redirect URI
 * (/identity/form-oidc-callback/:formId/:formOidcId) is
 * pasted into customers' identity providers, so no path below may ever
 * change: Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts pins
 * them.
 *
 * The sign-in starts on OneUptime's own address, so its state cookie - the
 * state, the nonce and the PKCE verifier, signed, for ten minutes - is on
 * the host the callback is: the provider's answer is held to all three and
 * to the provider's issuer (OIDCUtil.exchangeCodeAndValidate). Then, as for
 * SAML (FormSSO), the person is looked up and made one of the
 * form's private users the first time, and handed back to the
 * form's public link with a code its page exchanges on its own host.
 * ---------------------------------------------------------------------------
 */

router.get(
  "/form-oidc/:formId/:formOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const formId: ObjectID = FormSignIn.readFormId(req.params["formId"]);

      if (
        !req.params["formOidcId"] ||
        !ObjectID.isValidUUID(req.params["formOidcId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This sign-in link names no OpenID Connect provider. Open the form's link and sign in from there.",
          ),
        );
      }

      // A form whose link signs nobody in starts no sign-in.
      await FormSignIn.getFormForSignIn({ req, formId });

      const formOidc: FormOIDC | null = await FormOidcService.findOneBy({
        query: {
          formId: formId,
          _id: req.params["formOidcId"],
          isEnabled: true,
        },
        select: {
          _id: true,
          formId: true,
          discoveryURL: true,
          clientId: true,
          clientSecret: true,
          scopes: true,
        },
        props: { isRoot: true },
      });

      if (!formOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This OpenID Connect provider is not set up for this form, or is turned off. Ask the form's team to check its Single Sign-On settings.",
          ),
        );
      }

      if (!formOidc.discoveryURL) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This OpenID Connect provider has no Discovery URL. Ask the form's team to add it on the form's Single Sign-On page.",
          ),
        );
      }

      if (!formOidc.clientId || !formOidc.clientSecret) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This OpenID Connect provider has no client ID or client secret. Ask the form's team to add them on the form's Single Sign-On page.",
          ),
        );
      }

      const redirectUri: URL = getRedirectUri({
        formId: formOidc.formId!.toString(),
        formOidcId: formOidc.id!.toString(),
      });

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: formOidc.discoveryURL,
        clientId: formOidc.clientId,
        clientSecret: formOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: formOidc.scopes || "openid email profile",
      });

      const state: string = OIDCUtil.generateState();
      const nonce: string = OIDCUtil.generateNonce();
      const codeVerifier: string = OIDCUtil.generateCodeVerifier();
      const codeChallenge: string =
        OIDCUtil.generateCodeChallenge(codeVerifier);

      const stateCookieToken: string = JSONWebToken.signJsonPayload(
        {
          state,
          nonce,
          codeVerifier,
        },
        OIDC_STATE_COOKIE_TTL_SECONDS,
      );

      CookieUtil.setCookie(
        res,
        getOidcStateCookieName(formOidc.id!),
        stateCookieToken,
        {
          maxAge: OIDC_STATE_COOKIE_TTL_SECONDS * 1000,
          httpOnly: true,
        },
      );

      const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
        client,
        scopes: formOidc.scopes || "openid email profile",
        state,
        nonce,
        codeChallenge,
      });

      return Response.redirect(req, res, authorizationUrl);
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
  "/form-oidc-callback/:formId/:formOidcId",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const formId: ObjectID = FormSignIn.readFormId(req.params["formId"]);

      if (
        !req.params["formOidcId"] ||
        !ObjectID.isValidUUID(req.params["formOidcId"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This sign-in link names no OpenID Connect provider. Open the form's link and sign in from there.",
          ),
        );
      }

      const formOidcId: ObjectID = new ObjectID(req.params["formOidcId"]);

      const stateCookieName: string = getOidcStateCookieName(formOidcId);
      const stateCookieValue: string | undefined =
        CookieUtil.getCookieFromExpressRequest(req, stateCookieName);

      if (!stateCookieValue) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC sign-in session expired. Please try signing in again.",
          ),
        );
      }

      let storedState: string;
      let storedNonce: string;
      let storedCodeVerifier: string;

      try {
        const decoded: Record<string, unknown> = JSONWebToken.decodeJsonPayload(
          stateCookieValue,
        ) as unknown as Record<string, unknown>;

        storedState = decoded["state"] as string;
        storedNonce = decoded["nonce"] as string;
        storedCodeVerifier = decoded["codeVerifier"] as string;
      } catch {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC sign-in session is invalid. Please try signing in again.",
          ),
        );
      }

      // Each state cookie is used once.
      CookieUtil.removeCookie(res, stateCookieName);

      const formOidc: FormOIDC | null = await FormOidcService.findOneBy({
        query: {
          formId: formId,
          _id: formOidcId,
          isEnabled: true,
        },
        select: {
          _id: true,
          name: true,
          discoveryURL: true,
          issuerURL: true,
          clientId: true,
          clientSecret: true,
          scopes: true,
          emailClaimName: true,
          nameClaimName: true,
          projectId: true,
        },
        props: { isRoot: true },
      });

      if (!formOidc) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This OpenID Connect provider is not set up for this form, or is turned off. Ask the form's team to check its Single Sign-On settings.",
          ),
        );
      }

      if (!formOidc.projectId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This OpenID Connect provider belongs to no project. Ask the form's team to set it up again.",
          ),
        );
      }

      if (
        !formOidc.discoveryURL ||
        !formOidc.issuerURL ||
        !formOidc.clientId ||
        !formOidc.clientSecret
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "This OpenID Connect provider is missing its Discovery URL, Issuer URL, client ID or client secret. Ask the form's team to complete it on the form's Single Sign-On page.",
          ),
        );
      }

      const redirectUri: URL = getRedirectUri({
        formId: formId.toString(),
        formOidcId: formOidc.id!.toString(),
      });

      const client: Client = await OIDCUtil.createClient({
        discoveryURL: formOidc.discoveryURL,
        clientId: formOidc.clientId,
        clientSecret: formOidc.clientSecret,
        redirectUri: redirectUri,
        scopes: formOidc.scopes || "openid email profile",
      });

      const callbackParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") {
          callbackParams[key] = value;
        }
      }

      let result: OidcCallbackResult;
      try {
        result = await OIDCUtil.exchangeCodeAndValidate({
          client,
          redirectUri,
          expectedIssuer: formOidc.issuerURL,
          expectedNonce: storedNonce,
          expectedState: storedState,
          codeVerifier: storedCodeVerifier,
          callbackParams,
          emailClaimName: formOidc.emailClaimName || "email",
          nameClaimName: formOidc.nameClaimName || "name",
        });
      } catch (err: unknown) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        if (err instanceof Exception) {
          return Response.sendErrorResponse(req, res, err);
        }
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "OIDC token exchange or validation failed. Please contact your administrator.",
          ),
        );
      }

      /*
       * The form must still ask its visitors to sign in, and its IP
       * allowlist let this visitor in: a form switched to another
       * choice since makes no private user and no session.
       */
      await FormSignIn.getFormForSignIn({ req, formId });

      const projectId: ObjectID = formOidc.projectId;

      let privateUser: FormPrivateUser | null =
        await FormPrivateUserService.findOneBy({
          query: { email: result.email, formId: formId },
          select: {
            _id: true,
            email: true,
            formId: true,
            projectId: true,
          },
          props: { isRoot: true },
        });

      // The identity provider vouches for them: they become a private user.
      if (!privateUser) {
        const newPrivateUser: FormPrivateUser = new FormPrivateUser();
        newPrivateUser.projectId = projectId;
        newPrivateUser.formId = formId;
        newPrivateUser.email = result.email;
        newPrivateUser.isSsoUser = true;

        privateUser = await FormPrivateUserService.create({
          data: newPrivateUser,
          props: { isRoot: true },
        });
      }

      /*
       * The session names the provider that signed the person in: it counts
       * only while that provider vouches for it (FormPrivateUserSession
       * Service.addSignInRule).
       */
      const sessionMetadata: PrivateUserSessionMetadata<FormPrivateUserSession> =
        await FormPrivateUserSessionService.createLoginCodeSession({
          projectId: privateUser.projectId || projectId,
          resourceId: formId,
          privateUserId: privateUser.id!,
          oidcProviderId: formOidc.id!,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
          signIn: {
            method: SignInMethod.OpenIdConnect,
            ssoProviderName: formOidc.name,
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
