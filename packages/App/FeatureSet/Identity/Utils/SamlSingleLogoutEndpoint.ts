import IdentityProviderSignOut from "./IdentityProviderSignOut";
import SamlSingleLogout, {
  ReadLogoutRequest,
  ReadLogoutResponse,
  ReceivedSamlLogoutMessage,
  SAML_STATUS_REQUESTER,
  SAML_STATUS_RESPONDER,
  SAML_STATUS_SUCCESS,
  SamlLogoutMessageKind,
  SamlSignOutProvider,
} from "./SamlSingleLogout";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import InstanceSamlSigningKeyService from "Common/Server/Services/InstanceSamlSigningKeyService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService, {
  SessionSignedInThroughSamlProvider,
} from "Common/Server/Services/UserSessionService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import Response from "Common/Server/Utils/Response";
import { SelfSignedKeyPair } from "Common/Server/Utils/SelfSignedCertificate";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { getPostLogoutRedirectUri } from "Common/Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import User from "Common/Models/DatabaseModels/User";

/*
 * ---------------------------------------------------------------------------
 * ONEUPTIME'S SINGLE LOGOUT URL: WHERE A SAML IDENTITY PROVIDER ANSWERS A
 * SIGN-OUT, AND SENDS ITS OWN (#9603).
 *
 * /identity/idp-logout/:projectId/:projectSsoId and
 * /identity/global-idp-logout/:globalSsoId, on GET (HTTP-Redirect) and POST
 * (HTTP-POST), for a project's and the instance's SAML providers. The
 * admin gives the identity provider this address with the provider's
 * Entity ID and Reply URL. What arrives:
 *
 *   - a LogoutResponse, the identity provider's answer to the sign-out
 *     OneUptime sent the browser with. The OneUptime session ended before
 *     the browser left, so this ends nothing: when it confirms the sign-out
 *     (SamlSingleLogout.assertConfirmsSignOut) the browser goes to the
 *     sign-in page, as an OpenID Connect provider sends it back; anything
 *     else - not verified, not an answer to OneUptime's request, not
 *     Success - is refused, and the page says the identity provider did not
 *     confirm it, so the person at a shared computer knows to make sure;
 *   - a LogoutRequest, the identity provider's own sign-out: the person
 *     signed out there, or of another app that uses it. Signed, from this
 *     provider and fresh (SamlSingleLogout.assertRequestIsForUs), it ends
 *     the person's OneUptime sessions that a sign-in through this provider
 *     gave and that the request names, then answers the identity provider
 *     with a signed LogoutResponse at its Sign Out URL. One that is not -
 *     unsigned, signed with another key, another provider's, stale - ends
 *     nothing, and is answered with Requester, so the identity provider's
 *     sign-out of its other apps goes on.
 *
 * Only while the provider is on and its "Sign out of the identity provider
 * too" switch is on: a provider set up without it takes no sign-out. The
 * browser is sent to the server's own sign-in page or the provider's
 * configured Sign Out URL, never to an address a message names.
 * ---------------------------------------------------------------------------
 */

const MESSAGE_VIEW: string = "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

export const SAML_SIGN_OUT_NOT_CONFIRMED_TITLE: string =
  "Signed out of OneUptime.";

export const SAML_SIGN_OUT_NOT_CONFIRMED_MESSAGE: string =
  "You are signed out of OneUptime, but your identity provider did not confirm that it signed you out too. On a shared computer, sign out at your identity provider before you leave.";

export const SAML_SIGN_OUT_NOT_SET_UP_TITLE: string = "Sign-out not set up.";

export const SAML_SIGN_OUT_NOT_SET_UP_MESSAGE: string =
  "This identity provider is not set up to sign people out of OneUptime. Ask your administrator to turn on Sign Out of the Identity Provider Too for it.";

export const SAML_SIGN_OUT_REQUEST_REFUSED_TITLE: string =
  "Sign-out request refused.";

export const SAML_SIGN_OUT_REQUEST_REFUSED_MESSAGE: string =
  "OneUptime could not check this sign-out request from your identity provider, so it did not act on it. To sign out of OneUptime, open OneUptime and sign out there.";

export default class SamlSingleLogoutEndpoint {
  public static async handle(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO;
    providerId: string | undefined;
    projectId?: string | undefined;
  }): Promise<void> {
    const { req, res } = data;

    Response.setNoCacheHeaders(res);

    const isProjectProvider: boolean =
      data.providerType === SsoProviderType.ProjectSSO;

    const provider: SamlSignOutProvider | null =
      data.providerId &&
      ObjectID.isValidUUID(data.providerId) &&
      (!isProjectProvider ||
        (data.projectId && ObjectID.isValidUUID(data.projectId)))
        ? await IdentityProviderSignOut.findSamlProviderThatSignsOut({
            providerType: data.providerType,
            providerId: data.providerId,
            projectId: isProjectProvider ? data.projectId : undefined,
          })
        : null;

    if (!provider) {
      logger.warn(
        `A SAML sign-out message arrived for ${data.providerType} provider ${data.providerId || "(none)"}, which does not exist, is off, or does not sign people out.`,
        getLogAttributesFromRequest(req as RequestLike),
      );

      return Response.render(req, res, MESSAGE_VIEW, {
        title: SAML_SIGN_OUT_NOT_SET_UP_TITLE,
        message: SAML_SIGN_OUT_NOT_SET_UP_MESSAGE,
      });
    }

    let message: ReceivedSamlLogoutMessage;

    try {
      message = SamlSingleLogout.readMessage(req);
    } catch (err) {
      return SamlSingleLogoutEndpoint.refuse({
        req,
        res,
        provider,
        err,
        kind: null,
      });
    }

    if (message.kind === SamlLogoutMessageKind.Response) {
      return await SamlSingleLogoutEndpoint.takeLogoutResponse({
        req,
        res,
        provider,
        message,
      });
    }

    return await SamlSingleLogoutEndpoint.takeLogoutRequest({
      req,
      res,
      provider,
      message,
    });
  }

  /*
   * The answer to the sign-out OneUptime sent the browser with: the sign-in
   * page when it confirms the identity provider signed the person out, the
   * page that says it did not otherwise.
   */
  private static async takeLogoutResponse(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    provider: SamlSignOutProvider;
    message: ReceivedSamlLogoutMessage;
  }): Promise<void> {
    try {
      const response: ReadLogoutResponse = SamlSingleLogout.readLogoutResponse({
        message: data.message,
        certificate: data.provider.certificate,
      });

      const signingKey: SelfSignedKeyPair =
        await InstanceSamlSigningKeyService.getKeyPair();

      SamlSingleLogout.assertConfirmsSignOut({
        response: response,
        provider: data.provider,
        signingKey: signingKey,
        now: OneUptimeDate.getCurrentDate(),
      });
    } catch (err) {
      return SamlSingleLogoutEndpoint.refuse({
        req: data.req,
        res: data.res,
        provider: data.provider,
        err,
        kind: SamlLogoutMessageKind.Response,
      });
    }

    return Response.redirect(
      data.req,
      data.res,
      URL.fromString(
        getPostLogoutRedirectUri({
          httpProtocol: HttpProtocol.toString(),
          host: Host,
        }),
      ),
    );
  }

  /*
   * The identity provider's own sign-out: the sessions it names end, and
   * the identity provider is answered at its Sign Out URL - Success, or
   * Responder when the sessions could not be ended.
   */
  private static async takeLogoutRequest(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    provider: SamlSignOutProvider;
    message: ReceivedSamlLogoutMessage;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    let request: ReadLogoutRequest;

    try {
      request = SamlSingleLogout.readLogoutRequest({
        message: data.message,
        certificate: data.provider.certificate,
      });

      SamlSingleLogout.assertRequestIsForUs({
        request: request,
        provider: data.provider,
        now: now,
      });
    } catch (err) {
      /*
       * Not acted on: nothing ends. An identity provider signing someone out
       * of every app waits for each app's answer, so one with an ID to
       * answer to is answered - Requester, the request's fault - at the
       * provider's own Sign Out URL, and its sign-out goes on to the next
       * app. Only one with no ID at all stops at the page that says so.
       */
      const requestId: string | null = SamlSingleLogout.peekRequestId(
        data.message,
      );

      if (!requestId) {
        return SamlSingleLogoutEndpoint.refuse({
          req: data.req,
          res: data.res,
          provider: data.provider,
          err,
          kind: SamlLogoutMessageKind.Request,
        });
      }

      SamlSingleLogoutEndpoint.log({
        req: data.req,
        provider: data.provider,
        err,
      });

      const signingKey: SelfSignedKeyPair =
        await InstanceSamlSigningKeyService.getKeyPair();

      return data.res.redirect(
        SamlSingleLogout.buildLogoutResponseUrl({
          provider: data.provider,
          inResponseTo: requestId,
          statusCode: SAML_STATUS_REQUESTER,
          relayState: SamlSingleLogout.relayStateToEcho(
            data.message.relayState,
          ),
          signingKey: signingKey,
          now: now,
        }),
      );
    }

    let statusCode: string = SAML_STATUS_SUCCESS;

    try {
      await SamlSingleLogoutEndpoint.endSessionsNamedBy({
        req: data.req,
        provider: data.provider,
        request: request,
      });
    } catch (err) {
      logger.error(
        `Could not end the sessions a SAML sign-out request from ${data.provider.providerType} provider ${data.provider.providerId} named.`,
        getLogAttributesFromRequest(data.req as RequestLike),
      );
      logger.error(err);
      statusCode = SAML_STATUS_RESPONDER;
    }

    const signingKey: SelfSignedKeyPair =
      await InstanceSamlSigningKeyService.getKeyPair();

    /*
     * Sent as built: the signature covers the query exactly as it is
     * written, so nothing may encode it again on the way.
     */
    return data.res.redirect(
      SamlSingleLogout.buildLogoutResponseUrl({
        provider: data.provider,
        inResponseTo: request.id,
        statusCode: statusCode,
        relayState: SamlSingleLogout.relayStateToEcho(data.message.relayState),
        signingKey: signingKey,
        now: now,
      }),
    );
  }

  /*
   * Ends the live sessions of the person the request names that a sign-in
   * through this provider gave: the very Name ID the assertion had, and
   * one of the sessions the request names, when it names any. A person
   * with no account, or with no such session, has nothing to end.
   */
  private static async endSessionsNamedBy(data: {
    req: ExpressRequest;
    provider: SamlSignOutProvider;
    request: ReadLogoutRequest;
  }): Promise<number> {
    if (!Email.isValid(data.request.nameId)) {
      return 0;
    }

    const user: User | null = await UserService.findByEmail(
      new Email(data.request.nameId),
      { isRoot: true },
    );

    if (!user?.id) {
      return 0;
    }

    const sessions: Array<SessionSignedInThroughSamlProvider> =
      await UserSessionService.findLiveSessionsSignedInThroughSamlProvider({
        userId: user.id,
        providerType: data.provider.providerType,
        providerId: new ObjectID(data.provider.providerId),
      });

    let ended: number = 0;

    for (const session of sessions) {
      if (
        !SamlSingleLogout.isNamedBy({
          request: data.request,
          record: session.record,
        })
      ) {
        continue;
      }

      await UserSessionService.revokeSessionById(session.sessionId, {
        cause: SessionEndCause.SignedOut,
        requestOrigin: RequestOriginUtil.fromRequest(data.req),
      });

      ended++;
    }

    logger.info(
      `A SAML sign-out request from ${data.provider.providerType} provider ${data.provider.providerId} ended ${ended} session(s).`,
      getLogAttributesFromRequest(data.req as RequestLike),
    );

    return ended;
  }

  // Why a message was not taken, for the log.
  private static log(data: {
    req: ExpressRequest;
    provider: SamlSignOutProvider;
    err: unknown;
  }): void {
    logger.warn(
      `A SAML sign-out message for ${data.provider.providerType} provider ${data.provider.providerId} was not taken: ${
        data.err instanceof Error ? data.err.message : String(data.err)
      }`,
      getLogAttributesFromRequest(data.req as RequestLike),
    );
  }

  // A message not taken: logged, and the page that says what it means.
  private static refuse(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    provider: SamlSignOutProvider;
    err: unknown;
    kind: SamlLogoutMessageKind | null;
  }): void {
    SamlSingleLogoutEndpoint.log(data);

    if (data.kind === SamlLogoutMessageKind.Request) {
      return Response.render(data.req, data.res, MESSAGE_VIEW, {
        title: SAML_SIGN_OUT_REQUEST_REFUSED_TITLE,
        message: SAML_SIGN_OUT_REQUEST_REFUSED_MESSAGE,
      });
    }

    return Response.render(data.req, data.res, MESSAGE_VIEW, {
      title: SAML_SIGN_OUT_NOT_CONFIRMED_TITLE,
      message: SAML_SIGN_OUT_NOT_CONFIRMED_MESSAGE,
    });
  }
}
