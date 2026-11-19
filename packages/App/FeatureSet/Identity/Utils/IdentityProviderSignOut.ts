import SamlSingleLogout, { SamlSignOutProvider } from "./SamlSingleLogout";
import SamlServiceProviders, {
  SamlServiceProvider,
} from "./SamlServiceProvider";
import { VerifiedSamlResponse } from "./SSO";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";
import GlobalOidcService from "Common/Server/Services/GlobalOidcService";
import GlobalSsoService from "Common/Server/Services/GlobalSsoService";
import InstanceSamlSigningKeyService from "Common/Server/Services/InstanceSamlSigningKeyService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectSsoService from "Common/Server/Services/ProjectSsoService";
import UserSessionService, {
  SessionIdentityProviderSignOut,
} from "Common/Server/Services/UserSessionService";
import logger from "Common/Server/Utils/Logger";
import { SelfSignedKeyPair } from "Common/Server/Utils/SelfSignedCertificate";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import {
  buildIdentityProviderSignOutUrl,
  getPostLogoutRedirectUri,
  IdentityProviderSignOutRecord,
  isSamlIdentityProviderSignOutRecord,
  isUsableSamlSignOutValue,
  isUsableSingleLogoutUrl,
  OidcIdentityProviderSignOutRecord,
  readIdentityProviderSignOutRecord,
  SamlIdentityProviderSignOutRecord,
} from "Common/Types/SSO/IdentityProviderSignOut";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";

/*
 * SIGNING OUT OF THE IDENTITY PROVIDER TOO, AT SIGN-IN AND AT SIGN-OUT
 * (#9535, #9603, Common/Types/SSO/IdentityProviderSignOut).
 *
 *   - At a browser sign-in through a provider whose "Sign out of the
 *     identity provider too" switch is on, the session keeps what the
 *     provider's sign-out needs, its secrets encrypted: for a Global OIDC or
 *     Project OIDC provider, its end_session_endpoint and the sign-in's ID
 *     token (forSignIn); for a Global SSO or Project SSO (SAML) provider,
 *     the assertion's Name ID and SessionIndex (forSamlSignIn).
 *   - At POST /identity/logout, once the OneUptime session has ended, the
 *     browser is told where to go to end the provider's session too
 *     (getSignOutUrl): the OIDC provider's end_session_endpoint, or the SAML
 *     provider's Sign Out URL with a signed LogoutRequest - and only while
 *     the provider is still on and still asks for it.
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
   * What a SAML sign-in keeps for its sign-out at the identity provider, or
   * undefined: the provider's switch is off, the sign-in is the mobile
   * app's (which signs out of OneUptime alone), or the assertion named the
   * person by nothing a LogoutRequest can carry back. A Format, qualifier or
   * SessionIndex too long or odd to keep is left out; the Name ID alone
   * still names the person.
   */
  public static forSamlSignIn(data: {
    signOutOfIdentityProvider: boolean | undefined;
    isMobileRequest: boolean;
    providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO;
    providerId: ObjectID;
    assertion: Pick<VerifiedSamlResponse, "nameId" | "sessionIndex">;
  }): IdentityProviderSignOutRecord | undefined {
    if (data.signOutOfIdentityProvider !== true || data.isMobileRequest) {
      return undefined;
    }

    try {
      const optional: (value: string | null) => string | undefined = (
        value: string | null,
      ): string | undefined => {
        return isUsableSamlSignOutValue(value) ? value : undefined;
      };

      const record: IdentityProviderSignOutRecord | null =
        readIdentityProviderSignOutRecord({
          providerType: data.providerType,
          providerId: data.providerId.toString(),
          nameId: data.assertion.nameId.value,
          nameIdFormat: optional(data.assertion.nameId.format),
          nameIdNameQualifier: optional(data.assertion.nameId.nameQualifier),
          nameIdSpNameQualifier: optional(
            data.assertion.nameId.spNameQualifier,
          ),
          sessionIndex: optional(data.assertion.sessionIndex),
        });

      if (!record) {
        logger.warn(
          `The SAML provider ${data.providerId.toString()} asks to sign people out of it too, but its assertion named the person by no Name ID a sign-out request can carry. This session signs out of OneUptime alone.`,
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
   * provider was turned off, deleted, or no longer asks for it. What the
   * session kept is cleared once it is read: the session has ended. Never
   * throws.
   */
  public static async getSignOutUrl(
    found: SessionIdentityProviderSignOut,
  ): Promise<string | null> {
    try {
      const signOutUrl: string | null = isSamlIdentityProviderSignOutRecord(
        found.record,
      )
        ? await IdentityProviderSignOut.getSamlSignOutUrl(found.record)
        : await IdentityProviderSignOut.getOidcSignOutUrl(found.record);

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
   * The SAML provider of a sign-out, as signing someone out of it needs it,
   * while it is on and asks for it, with a Sign Out URL a browser may be
   * sent to - or null. Read as root: whoever is signing out, the provider
   * answers for itself.
   */
  public static async findSamlProviderThatSignsOut(data: {
    providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO;
    providerId: ObjectID | string;
    // A project's provider is looked up in its project, when it is known.
    projectId?: ObjectID | string | undefined;
  }): Promise<SamlSignOutProvider | null> {
    const select: {
      _id: true;
      issuerURL: true;
      publicCertificate: true;
      singleLogoutURL: true;
      signOutOfIdentityProvider: true;
    } = {
      _id: true,
      issuerURL: true,
      publicCertificate: true,
      singleLogoutURL: true,
      signOutOfIdentityProvider: true,
    };

    let provider: GlobalSSO | ProjectSSO | null = null;
    let serviceProvider: SamlServiceProvider;

    if (data.providerType === SsoProviderType.GlobalSSO) {
      provider = await GlobalSsoService.findOneBy({
        query: { _id: data.providerId.toString(), isEnabled: true },
        select: select,
        props: { isRoot: true },
      });

      serviceProvider = SamlServiceProviders.forGlobalSso({
        globalSsoId: data.providerId,
      });
    } else {
      const projectProvider: ProjectSSO | null =
        await ProjectSsoService.findOneBy({
          query: {
            _id: data.providerId.toString(),
            isEnabled: true,
            ...(data.projectId
              ? { projectId: new ObjectID(data.projectId.toString()) }
              : {}),
          },
          select: { ...select, projectId: true },
          props: { isRoot: true },
        });

      provider = projectProvider;

      if (!projectProvider?.projectId) {
        return null;
      }

      serviceProvider = SamlServiceProviders.forProjectSso({
        projectId: projectProvider.projectId,
        projectSsoId: data.providerId,
      });
    }

    const identityProviderSignOutUrl: string = (
      provider?.singleLogoutURL?.toString() || ""
    ).trim();

    if (
      !provider ||
      provider.signOutOfIdentityProvider !== true ||
      !isUsableSingleLogoutUrl(identityProviderSignOutUrl) ||
      !provider.issuerURL ||
      !provider.publicCertificate ||
      !serviceProvider.singleLogoutUrl
    ) {
      return null;
    }

    return {
      providerType: data.providerType,
      providerId: data.providerId.toString(),
      entityId: serviceProvider.entityId,
      singleLogoutUrl: serviceProvider.singleLogoutUrl,
      identityProviderSignOutUrl: identityProviderSignOutUrl,
      issuerUrl: provider.issuerURL,
      certificate: provider.publicCertificate,
    };
  }

  /*
   * The SAML provider's Sign Out URL with a LogoutRequest naming the person
   * and their session, signed with the installation's key - or null when
   * the provider no longer signs people out.
   */
  private static async getSamlSignOutUrl(
    record: SamlIdentityProviderSignOutRecord,
  ): Promise<string | null> {
    const provider: SamlSignOutProvider | null =
      await IdentityProviderSignOut.findSamlProviderThatSignsOut({
        providerType: record.providerType,
        providerId: record.providerId,
      });

    if (!provider) {
      return null;
    }

    const signingKey: SelfSignedKeyPair =
      await InstanceSamlSigningKeyService.getKeyPair();

    return SamlSingleLogout.buildLogoutRequestUrl({
      provider: provider,
      record: record,
      signingKey: signingKey,
      now: OneUptimeDate.getCurrentDate(),
    });
  }

  // The OIDC provider's end_session_endpoint with the hint, the client and the way back.
  private static async getOidcSignOutUrl(
    record: OidcIdentityProviderSignOutRecord,
  ): Promise<string | null> {
    const clientId: string | null =
      await IdentityProviderSignOut.getClientIdOfProviderThatSignsOut(record);

    return clientId
      ? buildIdentityProviderSignOutUrl({
          endSessionEndpoint: record.endSessionEndpoint,
          idToken: record.idToken,
          clientId: clientId,
          postLogoutRedirectUri: getPostLogoutRedirectUri({
            httpProtocol: HttpProtocol.toString(),
            host: Host,
          }),
        })
      : null;
  }

  /*
   * The client ID OneUptime signs in with at the provider, while the
   * provider is on and asks to sign people out of it: the client_id of the
   * logout request. Null otherwise.
   */
  private static async getClientIdOfProviderThatSignsOut(
    record: OidcIdentityProviderSignOutRecord,
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
