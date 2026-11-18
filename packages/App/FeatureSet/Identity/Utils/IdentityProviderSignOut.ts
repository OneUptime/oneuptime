import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import GlobalOidcService from "Common/Server/Services/GlobalOidcService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import UserSessionService, {
  SessionIdentityProviderSignOut,
} from "Common/Server/Services/UserSessionService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import {
  buildIdentityProviderSignOutUrl,
  getPostLogoutRedirectUri,
  IdentityProviderSignOutRecord,
  readIdentityProviderSignOutRecord,
} from "Common/Types/SSO/IdentityProviderSignOut";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";

/*
 * SIGNING OUT OF THE IDENTITY PROVIDER TOO, AT SIGN-IN AND AT SIGN-OUT
 * (#9535, Common/Types/SSO/IdentityProviderSignOut).
 *
 *   - At a browser sign-in through a Global OIDC or Project OIDC provider
 *     whose "Sign out of the identity provider too" switch is on, the
 *     session keeps the provider, its end_session_endpoint and the sign-in's
 *     ID token (forSignIn), the ID token encrypted.
 *   - At POST /identity/logout, once the OneUptime session has ended, the
 *     browser is told where to go to end the provider's session too
 *     (getSignOutUrl) - and only while the provider is still on and still
 *     asks for it.
 *
 * Neither ever fails what it is part of: a sign-in that cannot keep this
 * still signs in, and a sign-out that cannot find the provider's address
 * still signs out of OneUptime and goes to the sign-in page, as before.
 */
export default class IdentityProviderSignOut {
  /*
   * What a sign-in keeps for its sign-out at the provider, or undefined: the
   * provider's switch is off, the sign-in is the mobile app's (which signs
   * out of OneUptime alone), or the provider gave no end_session_endpoint
   * or ID token OneUptime may use.
   */
  public static forSignIn(data: {
    signOutOfIdentityProvider: boolean | undefined;
    isMobileRequest: boolean;
    providerType: SsoProviderType.GlobalOIDC | SsoProviderType.ProjectOIDC;
    providerId: ObjectID;
    // Read only when the switch is on.
    getEndSessionEndpoint: () => string | null;
    idToken: string | null | undefined;
  }): IdentityProviderSignOutRecord | undefined {
    if (data.signOutOfIdentityProvider !== true || data.isMobileRequest) {
      return undefined;
    }

    try {
      const record: IdentityProviderSignOutRecord | null =
        readIdentityProviderSignOutRecord({
          providerType: data.providerType,
          providerId: data.providerId.toString(),
          endSessionEndpoint: data.getEndSessionEndpoint(),
          idToken: data.idToken,
        });

      if (!record) {
        logger.warn(
          `The OIDC provider ${data.providerId.toString()} asks to sign people out of it too, but its sign-in gave no end_session_endpoint or ID token to do it with. This session signs out of OneUptime alone.`,
        );
      }

      return record || undefined;
    } catch (err) {
      logger.warn(err);
      return undefined;
    }
  }

  /*
   * Where the browser goes, once the OneUptime session `found` named has
   * ended, to be signed out of its identity provider too - or null: the
   * provider was turned off, deleted, or no longer asks for it. The ID token
   * is cleared from the session, which has ended, once it is read. Never
   * throws.
   */
  public static async getSignOutUrl(
    found: SessionIdentityProviderSignOut,
  ): Promise<string | null> {
    try {
      const clientId: string | null =
        await IdentityProviderSignOut.getClientIdOfProviderThatSignsOut(
          found.record,
        );

      const signOutUrl: string | null = clientId
        ? buildIdentityProviderSignOutUrl({
            endSessionEndpoint: found.record.endSessionEndpoint,
            idToken: found.record.idToken,
            clientId: clientId,
            postLogoutRedirectUri: getPostLogoutRedirectUri({
              httpProtocol: HttpProtocol.toString(),
              host: Host,
            }),
          })
        : null;

      await UserSessionService.forgetIdentityProviderSignOut(found.sessionId);

      return signOutUrl;
    } catch (err) {
      logger.warn(
        "Could not work out where to sign this person out of their identity provider; they are signed out of OneUptime.",
      );
      logger.warn(err);
      return null;
    }
  }

  /*
   * The client ID OneUptime signs in with at the provider, while the
   * provider is on and asks to sign people out of it: the client_id of the
   * logout request. Null otherwise.
   */
  private static async getClientIdOfProviderThatSignsOut(
    record: IdentityProviderSignOutRecord,
  ): Promise<string | null> {
    const select: {
      clientId: true;
      signOutOfIdentityProvider: true;
    } = {
      clientId: true,
      signOutOfIdentityProvider: true,
    };

    const provider: GlobalOIDC | ProjectOIDC | null =
      record.providerType === SsoProviderType.GlobalOIDC
        ? await GlobalOidcService.findOneBy({
            query: { _id: record.providerId, isEnabled: true },
            select: select,
            props: { isRoot: true },
          })
        : await ProjectOidcService.findOneBy({
            query: { _id: record.providerId, isEnabled: true },
            select: select,
            props: { isRoot: true },
          });

    if (!provider || provider.signOutOfIdentityProvider !== true) {
      return null;
    }

    return provider.clientId || null;
  }
}
